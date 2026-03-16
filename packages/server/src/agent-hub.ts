import crypto from 'node:crypto'

import type { WebSocket } from 'ws'
import type { Database } from 'libsql'
import type {
  AgentMessage,
  AgentUpgradePolicy,
  RepositoryBrowseResponse,
  RunTimelineEventPayload,
  SessionSummary,
  ServerToAgentMessage,
  SessionEvent,
  TerminalServerMessage,
  RunEvent,
  Run,
} from '@webmux/shared'
import { compareSemanticVersions } from '@webmux/shared'
import { verifySecret } from './auth.js'
import { describeMinimumVersionFailure } from './agent-upgrade.js'
import {
  appendRunTimelineEvent,
  createRunTurn,
  findActiveRunsByAgentId,
  findAgentById,
  findRunById,
  findActiveRunTurnByRunId,
  findQueuedRunTurnsByRunId,
  findRunTurnById,
  findLatestRunTurnByRunId,
  runTurnRowToRunTurn,
  updateAgentLastSeen,
  updateAgentStatus,
  updateRunStatus,
  updateRunToolThreadId,
  updateRunTurnStatus,
} from './db.js'
import type { RunRow, RunTurnRow } from './db.js'

export interface TurnCompletionNotification {
  userId: string
  agentId: string
  runId: string
  turnId: string
  repoPath: string
  tool: Run['tool']
  status: Run['status']
  summary?: string
  turnIndex: number
}

export interface NotificationService {
  notifyTurnCompleted(notification: TurnCompletionNotification): Promise<void>
}

interface OnlineAgent {
  socket: WebSocket
  userId: string
  name: string
  sessions: SessionSummary[]
}

interface BrowserConnection {
  browserSocket: WebSocket
  agentId: string
}

// Event clients keyed by userId
interface EventClient {
  socket: WebSocket
  userId: string
}

interface PendingCommand<T> {
  agentId: string
  timer: ReturnType<typeof setTimeout>
  resolve: (value: T) => void
  reject: (reason: Error) => void
  type: 'session-create' | 'session-kill' | 'repository-browse'
}

export class AgentHub {
  upgradePolicy: AgentUpgradePolicy | null
  private notificationService: NotificationService | null
  private agents = new Map<string, OnlineAgent>()
  private browsers = new Map<string, BrowserConnection>()
  private eventClients: EventClient[] = []
  private heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingCommands = new Map<string, PendingCommand<unknown>>()
  private runClients = new Map<string, Set<WebSocket>>()

  constructor(
    options: {
      upgradePolicy?: AgentUpgradePolicy | null
      notificationService?: NotificationService | null
    } = {},
  ) {
    this.upgradePolicy = options.upgradePolicy ?? null
    this.notificationService = options.notificationService ?? null
  }

  handleConnection(socket: WebSocket, db: Database): void {
    let authenticated = false
    let agentId: string | null = null

    // Give the agent 10 seconds to authenticate
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        const msg: ServerToAgentMessage = { type: 'auth-fail', message: 'Authentication timeout' }
        socket.send(JSON.stringify(msg))
        socket.close()
      }
    }, 10_000)

    socket.on('message', (raw) => {
      let message: AgentMessage
      try {
        message = JSON.parse(raw.toString()) as AgentMessage
      } catch {
        return
      }

      if (!authenticated) {
        if (message.type !== 'auth') {
          const msg: ServerToAgentMessage = { type: 'auth-fail', message: 'Must authenticate first' }
          socket.send(JSON.stringify(msg))
          return
        }

        this.authenticateAgent(socket, db, message.agentId, message.agentSecret, message.version)
          .then((result) => {
            clearTimeout(authTimeout)
            if (result) {
              authenticated = true
              agentId = message.agentId
              this.startHeartbeatMonitor(message.agentId, db)
              // Request initial session list
              const listMsg: ServerToAgentMessage = { type: 'sessions-list' }
              socket.send(JSON.stringify(listMsg))
            }
          })
          .catch(() => {
            const msg: ServerToAgentMessage = { type: 'auth-fail', message: 'Internal error' }
            socket.send(JSON.stringify(msg))
            socket.close()
          })
        return
      }

      if (agentId) {
        this.handleAgentMessage(agentId, message, db)
      }
    })

    socket.on('close', () => {
      clearTimeout(authTimeout)
      if (agentId) {
        this.removeAgent(agentId, db)
      }
    })

    socket.on('error', () => {
      clearTimeout(authTimeout)
      if (agentId) {
        this.removeAgent(agentId, db)
      }
    })
  }

  private async authenticateAgent(
    socket: WebSocket,
    db: Database,
    agentId: string,
    agentSecret: string,
    version?: string,
  ): Promise<boolean> {
    const agent = findAgentById(db, agentId)
    if (!agent) {
      const msg: ServerToAgentMessage = { type: 'auth-fail', message: 'Agent not found' }
      socket.send(JSON.stringify(msg))
      socket.close()
      return false
    }

    const valid = await verifySecret(agentSecret, agent.agent_secret_hash)
    if (!valid) {
      const msg: ServerToAgentMessage = { type: 'auth-fail', message: 'Invalid credentials' }
      socket.send(JSON.stringify(msg))
      socket.close()
      return false
    }

    if (isAgentBelowMinimumVersion(version, this.upgradePolicy)) {
      const msg: ServerToAgentMessage = {
        type: 'auth-fail',
        message: describeMinimumVersionFailure(version, this.upgradePolicy!),
      }
      socket.send(JSON.stringify(msg))
      socket.close()
      return false
    }

    // Disconnect existing connection if agent is already online
    const existing = this.agents.get(agentId)
    if (existing) {
      existing.socket.close()
    }

    this.agents.set(agentId, {
      socket,
      userId: agent.user_id,
      name: agent.name,
      sessions: [],
    })

    updateAgentStatus(db, agentId, 'online')
    updateAgentLastSeen(db, agentId)

    const msg: ServerToAgentMessage = {
      type: 'auth-ok',
      upgradePolicy: this.upgradePolicy ?? undefined,
    }
    socket.send(JSON.stringify(msg))

    return true
  }

  private startHeartbeatMonitor(agentId: string, db: Database): void {
    this.clearHeartbeatTimer(agentId)

    const timer = setTimeout(() => {
      console.log(`Agent ${agentId} heartbeat timeout, marking offline`)
      this.removeAgent(agentId, db)
    }, 60_000)

    this.heartbeatTimers.set(agentId, timer)
  }

  private resetHeartbeatTimer(agentId: string, db: Database): void {
    this.startHeartbeatMonitor(agentId, db)
  }

  private clearHeartbeatTimer(agentId: string): void {
    const existing = this.heartbeatTimers.get(agentId)
    if (existing) {
      clearTimeout(existing)
      this.heartbeatTimers.delete(agentId)
    }
  }

  handleAgentMessage(agentId: string, message: AgentMessage, db: Database): void {
    switch (message.type) {
      case 'heartbeat': {
        updateAgentLastSeen(db, agentId)
        this.resetHeartbeatTimer(agentId, db)
        break
      }

      case 'sessions-sync': {
        const agent = this.agents.get(agentId)
        if (agent) {
          agent.sessions = message.sessions
          // Forward to all event clients for this user
          this.broadcastSessionSync(agentId, agent.userId, message.sessions)
        }
        break
      }

      case 'command-result': {
        const pending = this.pendingCommands.get(message.requestId)
        if (!pending) {
          break
        }

        this.pendingCommands.delete(message.requestId)
        clearTimeout(pending.timer)

        if (!message.ok) {
          pending.reject(new Error(message.error))
          break
        }

        if (pending.type === 'session-create') {
          if (!message.session) {
            pending.reject(new Error('Agent did not return the created session'))
            break
          }
          pending.resolve(message.session)
          break
        }

        pending.resolve(undefined)
        break
      }

      case 'repository-browse-result': {
        const pending = this.pendingCommands.get(message.requestId)
        if (!pending || pending.type !== 'repository-browse') {
          break
        }

        this.pendingCommands.delete(message.requestId)
        clearTimeout(pending.timer)

        if (!message.ok) {
          pending.reject(new Error(message.error))
          break
        }

        pending.resolve({
          currentPath: message.currentPath,
          parentPath: message.parentPath,
          entries: message.entries,
        })
        break
      }

      case 'terminal-output': {
        const browser = this.browsers.get(message.browserId)
        if (browser && browser.agentId === agentId) {
          const outMsg: TerminalServerMessage = { type: 'data', data: message.data }
          this.safeSend(browser.browserSocket, outMsg)
        }
        break
      }

      case 'terminal-ready': {
        const browser = this.browsers.get(message.browserId)
        if (browser && browser.agentId === agentId) {
          const readyMsg: TerminalServerMessage = { type: 'ready', sessionName: message.sessionName }
          this.safeSend(browser.browserSocket, readyMsg)
        }
        break
      }

      case 'terminal-exit': {
        const browser = this.browsers.get(message.browserId)
        if (browser && browser.agentId === agentId) {
          const exitMsg: TerminalServerMessage = { type: 'exit', exitCode: message.exitCode }
          this.safeSend(browser.browserSocket, exitMsg)
          browser.browserSocket.close()
          this.browsers.delete(message.browserId)
        }
        break
      }

      case 'error': {
        if (message.browserId) {
          const browser = this.browsers.get(message.browserId)
          if (browser && browser.agentId === agentId) {
            const errMsg: TerminalServerMessage = { type: 'error', message: message.message }
            this.safeSend(browser.browserSocket, errMsg)
          }
        }
        break
      }

      case 'run-status': {
        this.handleRunEvent(agentId, message, db)
        break
      }

      case 'run-item': {
        this.handleRunItem(agentId, message, db)
        break
      }

      // auth is handled separately; ignore here
      case 'auth':
        break
    }
  }

  getAgent(agentId: string): OnlineAgent | undefined {
    return this.agents.get(agentId)
  }

  getAgentSessions(agentId: string): SessionSummary[] {
    return this.agents.get(agentId)?.sessions ?? []
  }

  async requestSessionCreate(agentId: string, name: string): Promise<SessionSummary> {
    return this.requestCommand<SessionSummary>(agentId, 'session-create', { name })
  }

  async requestSessionKill(agentId: string, name: string): Promise<void> {
    await this.requestCommand<void>(agentId, 'session-kill', { name })
  }

  async requestRepositoryBrowse(agentId: string, repositoryPath?: string): Promise<RepositoryBrowseResponse> {
    return this.requestCommand<RepositoryBrowseResponse>(
      agentId,
      'repository-browse',
      { path: repositoryPath },
    )
  }

  sendToAgent(agentId: string, message: ServerToAgentMessage): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    this.safeSend(agent.socket, message)
    return true
  }

  removeAgent(agentId: string, db: Database): void {
    this.clearHeartbeatTimer(agentId)

    const agent = this.agents.get(agentId)
    if (!agent) return

    for (const [requestId, pending] of this.pendingCommands) {
      if (pending.agentId !== agentId) {
        continue
      }

      clearTimeout(pending.timer)
      this.pendingCommands.delete(requestId)
      pending.reject(new Error('Agent disconnected'))
    }

    // Close all browser connections to this agent
    for (const [browserId, browser] of this.browsers) {
      if (browser.agentId === agentId) {
        const errMsg: TerminalServerMessage = { type: 'error', message: 'Agent disconnected' }
        this.safeSend(browser.browserSocket, errMsg)
        browser.browserSocket.close()
        this.browsers.delete(browserId)
      }
    }

    // Close agent socket
    try {
      agent.socket.close()
    } catch {
      // Already closed
    }

    this.agents.delete(agentId)
    updateAgentStatus(db, agentId, 'offline')
    for (const run of findActiveRunsByAgentId(db, agentId)) {
      const activeTurn = findActiveRunTurnByRunId(db, run.id)
      if (activeTurn) {
        const summary = 'Agent disconnected before the run completed.'
        updateRunTurnStatus(
          db,
          activeTurn.id,
          'failed',
          summary,
        )
        this.notifyTurnCompleted(run, activeTurn, 'failed', summary)
      } else {
        updateRunStatus(
          db,
          run.id,
          'failed',
          'Agent disconnected before the run completed.',
        )
      }
      this.broadcastRunSnapshot(db, run.id, activeTurn?.id)
    }

    // Notify event clients that sessions are gone
    this.broadcastSessionSync(agentId, agent.userId, [])
  }

  // --- Browser connection management ---

  registerBrowser(browserId: string, browserSocket: WebSocket, agentId: string): void {
    this.browsers.set(browserId, { browserSocket, agentId })
  }

  removeBrowser(browserId: string): void {
    this.browsers.delete(browserId)
  }

  // --- Event clients ---

  addEventClient(socket: WebSocket, userId: string): void {
    this.eventClients.push({ socket, userId })

    socket.on('close', () => {
      this.removeEventClient(socket)
    })

    socket.on('error', () => {
      this.removeEventClient(socket)
    })

    // Send current sessions for all user's agents
    for (const [agentId, agent] of this.agents) {
      if (agent.userId === userId) {
        const event: SessionEvent = {
          type: 'sessions-sync',
          agentId,
          sessions: agent.sessions,
        }
        this.safeSend(socket, event)
      }
    }
  }

  private removeEventClient(socket: WebSocket): void {
    this.eventClients = this.eventClients.filter((c) => c.socket !== socket)
  }

  // --- Run client management ---

  addRunClient(runId: string, socket: WebSocket): void {
    let clients = this.runClients.get(runId)
    if (!clients) {
      clients = new Set()
      this.runClients.set(runId, clients)
    }
    clients.add(socket)

    socket.on('close', () => {
      this.removeRunClient(runId, socket)
    })

    socket.on('error', () => {
      this.removeRunClient(runId, socket)
    })
  }

  broadcastRunSnapshot(db: Database, runId: string, turnId?: string): void {
    const clients = this.runClients.get(runId)
    if (!clients || clients.size === 0) {
      return
    }

    const runRow = findRunById(db, runId)
    if (!runRow) {
      return
    }

    const statusEvent: RunEvent = { type: 'run-status', run: runRowToRun(runRow) }
    for (const client of clients) {
      this.safeSend(client, statusEvent)
    }

    const targetTurn = turnId
      ? findRunTurnById(db, turnId)
      : findLatestRunTurnByRunId(db, runId)
    if (!targetTurn) {
      return
    }

    const turnEvent: RunEvent = {
      type: 'run-turn',
      runId,
      turn: runTurnRowToRunTurn(targetTurn),
    }
    for (const client of clients) {
      this.safeSend(client, turnEvent)
    }
  }

  removeRunClient(runId: string, socket: WebSocket): void {
    const clients = this.runClients.get(runId)
    if (clients) {
      clients.delete(socket)
      if (clients.size === 0) {
        this.runClients.delete(runId)
      }
    }
  }

  private handleRunEvent(
    agentId: string,
    message: { type: 'run-status'; runId: string; turnId: string; status: string; summary?: string; hasDiff?: boolean; toolThreadId?: string },
    db: Database
  ): void {
    const runRow = findRunById(db, message.runId)
    const turnRow = findRunTurnById(db, message.turnId)
    if (!runRow || !turnRow || runRow.agent_id !== agentId || turnRow.run_id !== message.runId) {
      return
    }

    if (message.toolThreadId) {
      updateRunToolThreadId(db, message.runId, message.toolThreadId)
    }

    const wasActive = isActiveRunStatus(turnRow.status)
    const nextSummary = message.summary ?? turnRow.summary ?? undefined
    updateRunTurnStatus(db, message.turnId, message.status, message.summary, message.hasDiff)
    this.broadcastRunSnapshot(db, message.runId, message.turnId)
    if (wasActive && isTerminalRunStatus(message.status)) {
      this.notifyTurnCompleted(
        runRow,
        turnRow,
        message.status as Run['status'],
        nextSummary,
      )
      // Auto-dispatch next queued turn (skip if interrupted — let user decide)
      if (message.status !== 'interrupted') {
        this.dispatchNextQueuedTurn(agentId, message.runId, db)
      }
    }
  }

  private handleRunItem(
    agentId: string,
    message: { type: 'run-item'; runId: string; turnId: string; item: RunTimelineEventPayload },
    db: Database,
  ): void {
    const ownedRun = findRunById(db, message.runId)
    const turnRow = findRunTurnById(db, message.turnId)
    if (!ownedRun || !turnRow || ownedRun.agent_id !== agentId || turnRow.run_id !== message.runId) {
      return
    }

    const item = appendRunTimelineEvent(db, message.runId, message.turnId, message.item)
    const event: RunEvent = {
      type: 'run-item',
      runId: message.runId,
      turnId: message.turnId,
      item,
    }

    const clients = this.runClients.get(message.runId)
    if (clients) {
      for (const client of clients) {
        this.safeSend(client, event)
      }
    }
  }

  private requestCommand<TResult>(
    agentId: string,
    type: 'session-create' | 'session-kill' | 'repository-browse',
    payload: { name?: string; path?: string },
  ): Promise<TResult> {
    const requestId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId)
        reject(new Error(`Timed out waiting for ${type}`))
      }, 5_000)

      this.pendingCommands.set(requestId, {
        agentId,
        timer,
        resolve: (value) => resolve(value as TResult),
        reject,
        type,
      })

      const message: ServerToAgentMessage =
        type === 'repository-browse'
          ? {
              type,
              requestId,
              path: payload.path,
            }
          : {
              type,
              requestId,
              name: payload.name ?? '',
            }

      const sent = this.sendToAgent(agentId, message)

      if (sent) {
        return
      }

      clearTimeout(timer)
      this.pendingCommands.delete(requestId)
      reject(new Error('Failed to reach agent'))
    })
  }

  private broadcastSessionSync(agentId: string, userId: string, sessions: SessionSummary[]): void {
    const event: SessionEvent = { type: 'sessions-sync', agentId, sessions }
    for (const client of this.eventClients) {
      if (client.userId === userId) {
        this.safeSend(client.socket, event)
      }
    }
  }

  private safeSend(socket: WebSocket, message: unknown): void {
    try {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message))
      }
    } catch {
      // Ignore send errors on closed sockets
    }
  }

  /** Pick the next queued turn and send it to the agent for execution. */
  dispatchNextQueuedTurn(agentId: string, runId: string, db: Database): boolean {
    const queued = findQueuedRunTurnsByRunId(db, runId)
    if (queued.length === 0) return false

    const next = queued[0]
    const runRow = findRunById(db, runId)
    if (!runRow) return false

    // Promote queued → starting
    updateRunTurnStatus(db, next.id, 'starting')

    const msg: ServerToAgentMessage = {
      type: 'run-turn-start',
      runId,
      turnId: next.id,
      tool: runRow.tool as Run['tool'],
      repoPath: runRow.repo_path,
      prompt: next.prompt,
      toolThreadId: runRow.tool_thread_id ?? undefined,
    }

    if (!this.sendToAgent(agentId, msg)) {
      // Agent went offline; revert to queued
      updateRunTurnStatus(db, next.id, 'queued')
      return false
    }

    this.broadcastRunSnapshot(db, runId, next.id)
    return true
  }

  private notifyTurnCompleted(
    runRow: RunRow,
    turnRow: { id: string; turn_index: number },
    status: Run['status'],
    summary?: string,
  ): void {
    if (!this.notificationService || status === 'interrupted') {
      return
    }

    void this.notificationService.notifyTurnCompleted({
      userId: runRow.user_id,
      agentId: runRow.agent_id,
      runId: runRow.id,
      turnId: turnRow.id,
      repoPath: runRow.repo_path,
      tool: runRow.tool as Run['tool'],
      status,
      summary,
      turnIndex: turnRow.turn_index,
    })
  }
}

export function runRowToRun(row: RunRow): Run {
  return {
    id: row.id,
    agentId: row.agent_id,
    tool: row.tool as Run['tool'],
    repoPath: row.repo_path,
    branch: row.branch,
    prompt: row.prompt,
    status: row.status as Run['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.summary ?? undefined,
    hasDiff: row.has_diff === 1,
    unread: row.unread === 1,
  }
}

function isAgentBelowMinimumVersion(
  version: string | undefined,
  upgradePolicy: AgentUpgradePolicy | null,
): boolean {
  const minimumVersion = upgradePolicy?.minimumVersion
  if (!minimumVersion) {
    return false
  }

  if (!version) {
    return true
  }

  try {
    return compareSemanticVersions(version, minimumVersion) < 0
  } catch {
    return true
  }
}

function isActiveRunStatus(status: string): boolean {
  return status === 'starting' || status === 'running'
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'success' || status === 'failed' || status === 'interrupted'
}
