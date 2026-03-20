import crypto from 'node:crypto'

import type { WebSocket } from 'ws'
import type { Database } from 'libsql'
import type {
  AgentMessage,
  AgentUpgradePolicy,
  RepositoryBrowseResponse,
  RunTimelineEventPayload,
  ServerToAgentMessage,
  RunEvent,
  Run,
  Task,
  TaskStatus,
} from '@webmux/shared'
import type { TaskDispatcher } from './task-dispatcher.js'
import { compareSemanticVersions } from '@webmux/shared'
import { verifySecret } from './auth.js'
import { describeMinimumVersionFailure } from './agent-upgrade.js'
import {
  appendRunTimelineEvent,
  createRunWithInitialTurn,
  createTaskMessage,
  createTaskStep,
  findActiveRunsByAgentId,
  findAgentById,
  findMessagesByTaskId,
  findProjectById,
  findRunById,
  findActiveRunTurnByRunId,
  findQueuedRunTurnsByRunId,
  findRunTurnById,
  findLatestRunTurnByRunId,
  findTaskById,
  runTurnRowToRunTurn,
  updateAgentLastSeen,
  updateAgentStatus,
  updateRunStatus,
  updateRunToolThreadId,
  updateRunTurnStatus,
  updateTaskStep,
  updateTaskStatus,
  updateTaskSummary,
  updateTaskRunInfo,
  updateTaskWorktreeInfo,
} from './db.js'
import type { RunRow, TaskRow } from './db.js'

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
}

interface PendingCommand<T> {
  agentId: string
  timer: ReturnType<typeof setTimeout>
  resolve: (value: T) => void
  reject: (reason: Error) => void
  type: 'repository-browse'
}

export class AgentHub {
  upgradePolicy: AgentUpgradePolicy | null
  private notificationService: NotificationService | null
  private taskDispatcher: TaskDispatcher | null
  private agents = new Map<string, OnlineAgent>()
  private heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingCommands = new Map<string, PendingCommand<unknown>>()
  private runClients = new Map<string, Set<WebSocket>>()
  private projectClients = new Map<string, Set<WebSocket>>()

  constructor(
    options: {
      upgradePolicy?: AgentUpgradePolicy | null
      notificationService?: NotificationService | null
      taskDispatcher?: TaskDispatcher | null
    } = {},
  ) {
    this.upgradePolicy = options.upgradePolicy ?? null
    this.notificationService = options.notificationService ?? null
    this.taskDispatcher = options.taskDispatcher ?? null
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
    })

    updateAgentStatus(db, agentId, 'online')
    updateAgentLastSeen(db, agentId)

    const msg: ServerToAgentMessage = {
      type: 'auth-ok',
      upgradePolicy: this.upgradePolicy ?? undefined,
    }
    socket.send(JSON.stringify(msg))

    // Dispatch pending tasks for this agent
    if (this.taskDispatcher) {
      this.taskDispatcher.dispatchPendingTasksForAgent(agentId)
    }

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

      case 'error': {
        console.error(`[agent-hub] Agent ${agentId} error: ${message.message}`)
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

      case 'task-claimed':
        this.handleTaskClaimed(message, db)
        break

      case 'task-running':
        this.handleTaskRunning(message, db)
        break

      case 'task-completed':
        this.handleTaskCompleted(message, db)
        break

      case 'task-failed':
        this.handleTaskFailed(message, db)
        break

      case 'task-step-update':
        this.handleTaskStepUpdate(message, db)
        break

      case 'task-message': {
        const { taskId, message: msg } = message as any
        // Store the message in DB
        createTaskMessage(db, taskId, msg.role, msg.content, msg.id)
        // Broadcast to web clients
        this.broadcastTaskMessage(db, taskId, msg)
        break
      }

      case 'task-waiting': {
        const { taskId } = message as any
        updateTaskStatus(db, taskId, 'waiting')
        this.broadcastTaskSnapshot(db, taskId)
        break
      }

      // auth is handled separately; ignore here
      case 'auth':
        break
    }
  }

  setTaskDispatcher(dispatcher: TaskDispatcher): void {
    this.taskDispatcher = dispatcher
  }

  getAgent(agentId: string): OnlineAgent | undefined {
    return this.agents.get(agentId)
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

    // Fail any dispatched or running tasks for this agent
    const activeTasks = db.prepare(
      `SELECT t.id FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE p.agent_id = ? AND t.status IN ('dispatched', 'running', 'waiting')`,
    ).all(agentId) as Array<{ id: string }>

    for (const { id } of activeTasks) {
      updateTaskStatus(db, id, 'failed', 'Agent disconnected')
    }
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

  // --- Project client management ---

  addProjectClient(projectId: string, socket: WebSocket): void {
    let clients = this.projectClients.get(projectId)
    if (!clients) {
      clients = new Set()
      this.projectClients.set(projectId, clients)
    }
    clients.add(socket)

    socket.on('close', () => {
      this.removeProjectClient(projectId, socket)
    })
    socket.on('error', () => {
      this.removeProjectClient(projectId, socket)
    })
  }

  removeProjectClient(projectId: string, socket: WebSocket): void {
    const clients = this.projectClients.get(projectId)
    if (clients) {
      clients.delete(socket)
      if (clients.size === 0) {
        this.projectClients.delete(projectId)
      }
    }
  }

  broadcastTaskSnapshot(db: Database, taskId: string): void {
    const taskRow = findTaskById(db, taskId)
    if (!taskRow) return

    const clients = this.projectClients.get(taskRow.project_id)
    if (!clients || clients.size === 0) return

    const event: RunEvent = {
      type: 'task-status',
      task: taskRowToTask(taskRow),
    }

    for (const client of clients) {
      this.safeSend(client, event)
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

  private handleTaskClaimed(
    message: { type: 'task-claimed'; taskId: string; branchName?: string; worktreePath?: string },
    db: Database,
  ): void {
    const task = findTaskById(db, message.taskId)
    if (!task) return

    if (message.branchName && message.worktreePath) {
      updateTaskWorktreeInfo(db, message.taskId, message.branchName, message.worktreePath)
    }

    this.broadcastTaskSnapshot(db, message.taskId)
  }

  private handleTaskRunning(
    message: { type: 'task-running'; taskId: string; runId: string; turnId: string; branchName?: string; worktreePath?: string },
    db: Database,
  ): void {
    const task = findTaskById(db, message.taskId)
    if (!task) return

    // Create run record if it doesn't exist (task-created runs aren't registered via normal flow)
    if (message.runId) {
      const existingRun = findRunById(db, message.runId)
      if (!existingRun) {
        const project = findProjectById(db, task.project_id)
        if (project) {
          createRunWithInitialTurn(db, {
            runId: message.runId,
            turnId: message.turnId,
            agentId: project.agent_id,
            userId: project.user_id,
            tool: project.default_tool,
            repoPath: project.repo_path,
            prompt: task.prompt,
          })
        }
      }
    }

    updateTaskStatus(db, message.taskId, 'running')
    updateTaskRunInfo(db, message.taskId, message.runId)

    if (message.branchName && message.worktreePath) {
      updateTaskWorktreeInfo(db, message.taskId, message.branchName, message.worktreePath)
    }

    this.broadcastTaskSnapshot(db, message.taskId)
  }

  private handleTaskCompleted(
    message: { type: 'task-completed'; taskId: string; summary: string },
    db: Database,
  ): void {
    updateTaskStatus(db, message.taskId, 'completed')
    updateTaskSummary(db, message.taskId, message.summary)
    this.broadcastTaskSnapshot(db, message.taskId)
  }

  private handleTaskFailed(
    message: { type: 'task-failed'; taskId: string; error: string },
    db: Database,
  ): void {
    updateTaskStatus(db, message.taskId, 'failed', message.error)
    this.broadcastTaskSnapshot(db, message.taskId)
  }

  private handleTaskStepUpdate(
    message: { type: 'task-step-update'; taskId: string; step: any },
    db: Database,
  ): void {
    const { taskId, step } = message
    if (step.status === 'running') {
      // Create new step record
      createTaskStep(db, {
        id: step.id,
        task_id: taskId,
        type: step.type,
        label: step.label,
        status: 'running',
        detail: step.detail || null,
        tool_name: step.toolName,
        run_id: step.runId || null,
        created_at: step.createdAt,
      })
    } else {
      // Update existing step (completed or failed)
      updateTaskStep(db, step.id, {
        status: step.status,
        detail: step.detail || null,
        run_id: step.runId || null,
        duration_ms: step.durationMs || null,
        completed_at: step.completedAt || null,
      })
    }
    // Broadcast to web clients
    this.broadcastStepUpdate(db, taskId, step)
  }

  private broadcastStepUpdate(db: Database, taskId: string, step: any): void {
    const task = findTaskById(db, taskId)
    if (!task) return
    const clients = this.projectClients.get(task.project_id)
    if (!clients?.size) return
    const event = { type: 'task-step', taskId, step }
    for (const client of clients) {
      this.safeSend(client, event)
    }
  }

  private broadcastTaskMessage(db: Database, taskId: string, msg: any): void {
    const task = findTaskById(db, taskId)
    if (!task) return
    const clients = this.projectClients.get(task.project_id)
    if (!clients?.size) return
    const taskMessage = {
      id: msg.id,
      taskId,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    }
    const event = { type: 'task-message', taskId, message: taskMessage }
    for (const client of clients) {
      this.safeSend(client, event)
    }
  }

  public sendUserReplyToAgent(db: Database, taskId: string): void {
    const task = findTaskById(db, taskId)
    if (!task) return
    const project = findProjectById(db, task.project_id)
    if (!project) return
    const messages = findMessagesByTaskId(db, taskId)
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMsg) return
    this.sendToAgent(project.agent_id, {
      type: 'task-user-reply',
      taskId,
      content: lastUserMsg.content,
    })
  }

  private requestCommand<TResult>(
    agentId: string,
    type: 'repository-browse',
    payload: { path?: string },
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

      const message: ServerToAgentMessage = {
        type,
        requestId,
        path: payload.path,
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

function taskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    prompt: row.prompt,
    tool: (row.tool || 'claude') as Task['tool'],
    status: row.status as TaskStatus,
    priority: row.priority,
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    runId: row.run_id,
    errorMessage: row.error_message,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
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
