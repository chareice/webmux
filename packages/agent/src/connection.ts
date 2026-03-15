import WebSocket from 'ws'

import type { AgentMessage, ServerToAgentMessage } from '@webmux/shared'
import type { TmuxClient } from './tmux.js'
import { createTerminalBridge, type TerminalBridge } from './terminal.js'

const HEARTBEAT_INTERVAL_MS = 30_000
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export class AgentConnection {
  private readonly serverUrl: string
  private readonly agentId: string
  private readonly agentSecret: string
  private readonly tmux: TmuxClient

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
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
      this.sendMessage({ type: 'auth', agentId: this.agentId, agentSecret: this.agentSecret })
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
        this.startHeartbeat()
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
        this.handleSessionCreate(msg.name)
        break

      case 'session-kill':
        this.handleSessionKill(msg.name)
        break

      default:
        console.warn('[agent] Unknown message type:', (msg as { type: string }).type)
    }
  }

  private async syncSessions(): Promise<void> {
    try {
      const sessions = await this.tmux.listSessions()
      this.sendMessage({ type: 'sessions-sync', sessions })
    } catch (err) {
      console.error('[agent] Failed to list sessions:', err)
      this.sendMessage({ type: 'error', message: 'Failed to list sessions' })
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
        },
      })

      this.bridges.set(browserId, bridge)
      this.sendMessage({ type: 'terminal-ready', browserId, sessionName })
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

  private async handleSessionCreate(name: string): Promise<void> {
    try {
      await this.tmux.createSession(name)
      await this.syncSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to create session "${name}":`, message)
      this.sendMessage({ type: 'error', message: `Failed to create session: ${message}` })
    }
  }

  private async handleSessionKill(name: string): Promise<void> {
    try {
      await this.tmux.killSession(name)
      await this.syncSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to kill session "${name}":`, message)
      this.sendMessage({ type: 'error', message: `Failed to kill session: ${message}` })
    }
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

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
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
