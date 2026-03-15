import WebSocket from 'ws'

import {
  compareSemanticVersions,
  type AgentMessage,
  type AgentUpgradePolicy,
  type RunStatus,
  type ServerToAgentMessage,
  type SessionSummary,
} from '@webmux/shared'
import { upgradeService } from './service.js'
import type { TmuxClient } from './tmux.js'
import { createTerminalBridge, type TerminalBridge } from './terminal.js'
import { RunWrapper } from './run-wrapper.js'
import { AGENT_PACKAGE_NAME, AGENT_VERSION } from './version.js'

const HEARTBEAT_INTERVAL_MS = 30_000
const SESSION_SYNC_INTERVAL_MS = 15_000
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export interface AgentRuntime {
  version: string
  serviceMode: boolean
  autoUpgrade: boolean
  applyServiceUpgrade: (options: { packageName: string; targetVersion: string }) => void
  exit: (code: number) => void
}

const defaultAgentRuntime: AgentRuntime = {
  version: AGENT_VERSION,
  serviceMode: process.env.WEBMUX_AGENT_SERVICE === '1',
  autoUpgrade: process.env.WEBMUX_AGENT_AUTO_UPGRADE !== '0',
  applyServiceUpgrade: ({ packageName, targetVersion }) => {
    upgradeService({
      agentName: process.env.WEBMUX_AGENT_NAME ?? 'webmux-agent',
      packageName,
      version: targetVersion,
    })
  },
  exit: (code: number) => {
    process.exit(code)
  },
}

export class AgentConnection {
  private readonly serverUrl: string
  private readonly agentId: string
  private readonly agentSecret: string
  private readonly tmux: TmuxClient
  private readonly runtime: AgentRuntime

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sessionSyncTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  private bridges = new Map<string, TerminalBridge>()
  private runs = new Map<string, RunWrapper>()
  private stopped = false

  constructor(
    serverUrl: string,
    agentId: string,
    agentSecret: string,
    tmux: TmuxClient,
    runtime: AgentRuntime = defaultAgentRuntime,
  ) {
    this.serverUrl = serverUrl
    this.agentId = agentId
    this.agentSecret = agentSecret
    this.tmux = tmux
    this.runtime = runtime
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.stopHeartbeat()
    this.stopSessionSync()
    this.disposeAllBridges()
    this.disposeAllRuns()

    if (this.ws) {
      this.ws.close(1000, 'agent shutting down')
      this.ws = null
    }
  }

  private connect(): void {
    const wsUrl = buildWsUrl(this.serverUrl)
    console.log(`[agent] Connecting to ${wsUrl}`)

    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      console.log('[agent] WebSocket connected, authenticating...')
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS
      this.sendMessage({
        type: 'auth',
        agentId: this.agentId,
        agentSecret: this.agentSecret,
        version: this.runtime.version,
      })
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: ServerToAgentMessage
      try {
        msg = JSON.parse(raw.toString()) as ServerToAgentMessage
      } catch {
        console.error('[agent] Failed to parse server message:', raw.toString())
        return
      }

      this.handleMessage(msg)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[agent] WebSocket closed: code=${code} reason=${reason.toString()}`)
      this.onDisconnect()
    })

    ws.on('error', (err: Error) => {
      console.error('[agent] WebSocket error:', err.message)
      // The 'close' event will follow, triggering reconnect
    })
  }

  private handleMessage(msg: ServerToAgentMessage): void {
    switch (msg.type) {
      case 'auth-ok':
        console.log('[agent] Authenticated successfully')
        if (this.applyRecommendedUpgrade(msg.upgradePolicy)) {
          return
        }
        this.startHeartbeat()
        this.startSessionSync()
        this.syncSessions()
        break

      case 'auth-fail':
        console.error(`[agent] Authentication failed: ${msg.message}`)
        this.stopped = true
        if (this.ws) {
          this.ws.close()
          this.ws = null
        }
        this.runtime.exit(1)
        break

      case 'sessions-list':
        this.syncSessions()
        break

      case 'terminal-attach':
        this.handleTerminalAttach(msg.browserId, msg.sessionName, msg.cols, msg.rows)
        break

      case 'terminal-detach':
        this.handleTerminalDetach(msg.browserId)
        break

      case 'terminal-input':
        this.handleTerminalInput(msg.browserId, msg.data)
        break

      case 'terminal-resize':
        this.handleTerminalResize(msg.browserId, msg.cols, msg.rows)
        break

      case 'session-create':
        this.handleSessionCreate(msg.requestId, msg.name)
        break

      case 'session-kill':
        this.handleSessionKill(msg.requestId, msg.name)
        break

      case 'run-start':
        this.handleRunStart(msg.runId, msg.tool, msg.repoPath, msg.prompt)
        break

      case 'run-input':
        this.handleRunInput(msg.runId, msg.input)
        break

      case 'run-interrupt':
        this.handleRunInterrupt(msg.runId)
        break

      case 'run-approve':
        this.handleRunApprove(msg.runId)
        break

      case 'run-reject':
        this.handleRunReject(msg.runId)
        break

      default:
        console.warn('[agent] Unknown message type:', (msg as { type: string }).type)
    }
  }

  private async syncSessions(): Promise<SessionSummary[]> {
    try {
      const sessions = await this.tmux.listSessions()
      this.sendMessage({ type: 'sessions-sync', sessions })
      return sessions
    } catch (err) {
      console.error('[agent] Failed to list sessions:', err)
      this.sendMessage({ type: 'error', message: 'Failed to list sessions' })
      return []
    }
  }

  private async handleTerminalAttach(
    browserId: string,
    sessionName: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    // Dispose existing bridge for this browserId if any
    const existing = this.bridges.get(browserId)
    if (existing) {
      existing.dispose()
      this.bridges.delete(browserId)
    }

    try {
      const bridge = await createTerminalBridge({
        tmux: this.tmux,
        sessionName,
        cols,
        rows,
        onData: (data: string) => {
          this.sendMessage({ type: 'terminal-output', browserId, data })
        },
        onExit: (exitCode: number) => {
          this.bridges.delete(browserId)
          this.sendMessage({ type: 'terminal-exit', browserId, exitCode })
          void this.syncSessions()
        },
      })

      this.bridges.set(browserId, bridge)
      this.sendMessage({ type: 'terminal-ready', browserId, sessionName })
      await this.syncSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to attach terminal for browser ${browserId}:`, message)
      this.sendMessage({ type: 'error', browserId, message: `Failed to attach: ${message}` })
    }
  }

  private handleTerminalDetach(browserId: string): void {
    const bridge = this.bridges.get(browserId)
    if (bridge) {
      bridge.dispose()
      this.bridges.delete(browserId)
      void this.syncSessions()
    }
  }

  private handleTerminalInput(browserId: string, data: string): void {
    const bridge = this.bridges.get(browserId)
    if (bridge) {
      bridge.write(data)
    }
  }

  private handleTerminalResize(browserId: string, cols: number, rows: number): void {
    const bridge = this.bridges.get(browserId)
    if (bridge) {
      bridge.resize(cols, rows)
    }
  }

  private async handleSessionCreate(requestId: string, name: string): Promise<void> {
    try {
      await this.tmux.createSession(name)
      const sessions = await this.syncSessions()
      const session = sessions.find((item) => item.name === name)
      if (!session) {
        throw new Error('Created session was not returned by tmux')
      }
      this.sendMessage({ type: 'command-result', requestId, ok: true, session })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to create session "${name}":`, message)
      this.sendMessage({ type: 'command-result', requestId, ok: false, error: message })
    }
  }

  private async handleSessionKill(requestId: string, name: string): Promise<void> {
    try {
      await this.tmux.killSession(name)
      await this.syncSessions()
      this.sendMessage({ type: 'command-result', requestId, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to kill session "${name}":`, message)
      this.sendMessage({ type: 'command-result', requestId, ok: false, error: message })
    }
  }

  private sendMessage(msg: AgentMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private applyRecommendedUpgrade(upgradePolicy?: AgentUpgradePolicy): boolean {
    const targetVersion = upgradePolicy?.targetVersion
    if (!targetVersion) {
      return false
    }

    let comparison: number
    try {
      comparison = compareSemanticVersions(this.runtime.version, targetVersion)
    } catch {
      console.warn('[agent] Skipping automatic upgrade because version parsing failed')
      return false
    }

    if (comparison >= 0) {
      return false
    }

    console.log(`[agent] Update available: ${this.runtime.version} → ${targetVersion}`)

    if (!this.runtime.serviceMode || !this.runtime.autoUpgrade) {
      console.log('[agent] Automatic upgrades are only applied for the managed systemd service')
      console.log(`[agent] To upgrade manually, run: pnpm dlx @webmux/agent service upgrade --to ${targetVersion}`)
      return false
    }

    try {
      this.runtime.applyServiceUpgrade({
        packageName: upgradePolicy.packageName || AGENT_PACKAGE_NAME,
        targetVersion,
      })
      console.log(`[agent] Managed service switched to ${targetVersion}. Restarting...`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to apply managed upgrade: ${message}`)
      console.log('[agent] Continuing with current version')
      return false
    }

    this.stop()
    this.runtime.exit(0)
    return true
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage({ type: 'heartbeat' })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private startSessionSync(): void {
    this.stopSessionSync()
    this.sessionSyncTimer = setInterval(() => {
      void this.syncSessions()
    }, SESSION_SYNC_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private stopSessionSync(): void {
    if (this.sessionSyncTimer) {
      clearInterval(this.sessionSyncTimer)
      this.sessionSyncTimer = null
    }
  }

  private disposeAllBridges(): void {
    for (const [browserId, bridge] of this.bridges) {
      bridge.dispose()
      this.bridges.delete(browserId)
    }
  }

  private disposeAllRuns(): void {
    for (const [runId, run] of this.runs) {
      run.dispose()
      this.runs.delete(runId)
    }
  }

  private handleRunStart(
    runId: string,
    tool: 'codex' | 'claude',
    repoPath: string,
    prompt: string,
  ): void {
    // Dispose existing run with the same id if any
    const existing = this.runs.get(runId)
    if (existing) {
      existing.dispose()
      this.runs.delete(runId)
    }

    const run = new RunWrapper({
      runId,
      tool,
      repoPath,
      prompt,
      tmux: this.tmux,
      onEvent: (status: RunStatus, summary?: string, hasDiff?: boolean) => {
        this.sendMessage({ type: 'run-event', runId, status, summary, hasDiff })
      },
      onOutput: (data: string) => {
        this.sendMessage({ type: 'run-output', runId, data })
      },
    })

    this.runs.set(runId, run)

    run.start().catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to start run ${runId}:`, message)
      this.sendMessage({
        type: 'run-event',
        runId,
        status: 'failed',
        summary: `Failed to start: ${message}`,
      })
      this.runs.delete(runId)
    })
  }

  private handleRunInput(runId: string, input: string): void {
    const run = this.runs.get(runId)
    if (run) {
      run.sendInput(input)
    } else {
      console.warn(`[agent] run-input: no run found for ${runId}`)
    }
  }

  private handleRunInterrupt(runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      run.interrupt()
    } else {
      console.warn(`[agent] run-interrupt: no run found for ${runId}`)
    }
  }

  private handleRunApprove(runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      run.approve()
    } else {
      console.warn(`[agent] run-approve: no run found for ${runId}`)
    }
  }

  private handleRunReject(runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      run.reject()
    } else {
      console.warn(`[agent] run-reject: no run found for ${runId}`)
    }
  }

  private onDisconnect(): void {
    this.stopHeartbeat()
    this.stopSessionSync()
    this.disposeAllBridges()
    this.ws = null

    if (this.stopped) {
      return
    }

    console.log(`[agent] Reconnecting in ${this.reconnectDelay}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }
}

function buildWsUrl(serverUrl: string): string {
  // Convert http(s) URL to ws(s) URL
  const url = new URL('/ws/agent', serverUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
