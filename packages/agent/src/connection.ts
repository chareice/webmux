import { execSync } from 'node:child_process'
import WebSocket from 'ws'

import type { AgentMessage, ServerToAgentMessage, SessionSummary } from '@webmux/shared'
import type { TmuxClient } from './tmux.js'
import { createTerminalBridge, type TerminalBridge } from './terminal.js'

const AGENT_VERSION = '0.1.4'
const HEARTBEAT_INTERVAL_MS = 30_000
const SESSION_SYNC_INTERVAL_MS = 15_000
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export class AgentConnection {
  private readonly serverUrl: string
  private readonly agentId: string
  private readonly agentSecret: string
  private readonly tmux: TmuxClient

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sessionSyncTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  private bridges = new Map<string, TerminalBridge>()
  private stopped = false

  constructor(
    serverUrl: string,
    agentId: string,
    agentSecret: string,
    tmux: TmuxClient,
  ) {
    this.serverUrl = serverUrl
    this.agentId = agentId
    this.agentSecret = agentSecret
    this.tmux = tmux
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
      this.sendMessage({ type: 'auth', agentId: this.agentId, agentSecret: this.agentSecret, version: AGENT_VERSION })
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
        if (msg.latestVersion && msg.latestVersion !== AGENT_VERSION) {
          console.log(`[agent] Update available: ${AGENT_VERSION} → ${msg.latestVersion}`)
          this.selfUpdate(msg.latestVersion)
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
        process.exit(1)
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

  private selfUpdate(targetVersion: string): void {
    console.log(`[agent] Installing @webmux/agent@${targetVersion}...`)
    try {
      execSync(`npm install -g @webmux/agent@${targetVersion}`, { stdio: 'inherit' })
      console.log('[agent] Update installed. Restarting...')
    } catch (err) {
      console.error('[agent] Update failed:', err instanceof Error ? err.message : err)
      console.log('[agent] Continuing with current version')
      this.startHeartbeat()
      this.startSessionSync()
      this.syncSessions()
      return
    }

    // Exit cleanly — systemd will restart with the new version
    this.stop()
    process.exit(0)
  }

  private sendMessage(msg: AgentMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
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
