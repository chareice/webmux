import WebSocket from 'ws'

import {
  compareSemanticVersions,
  type AgentMessage,
  type AgentUpgradePolicy,
  type RunImageAttachmentUpload,
  type RunStatus,
  type RunTurnOptions,
  type ServerToAgentMessage,
} from '@webmux/shared'
import { upgradeService } from './service.js'
import { RunWrapper } from './run-wrapper.js'
import { browseRepositories } from './repositories.js'
import { AGENT_PACKAGE_NAME, AGENT_VERSION } from './version.js'

const HEARTBEAT_INTERVAL_MS = 30_000
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
  private readonly workspaceRoot: string
  private readonly runtime: AgentRuntime

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  private runs = new Map<string, { turnId: string; wrapper: RunWrapper }>()
  private stopped = false

  constructor(
    serverUrl: string,
    agentId: string,
    agentSecret: string,
    workspaceRoot: string,
    runtime: AgentRuntime = defaultAgentRuntime,
  ) {
    this.serverUrl = serverUrl
    this.agentId = agentId
    this.agentSecret = agentSecret
    this.workspaceRoot = workspaceRoot
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

      case 'repository-browse':
        this.handleRepositoryBrowse(msg.requestId, msg.path)
        break

      case 'run-turn-start':
        this.handleRunStart(msg.runId, msg.turnId, msg.tool, msg.repoPath, msg.prompt, msg.toolThreadId, msg.attachments, msg.options)
        break

      case 'run-turn-interrupt':
        this.handleRunInterrupt(msg.runId, msg.turnId)
        break

      case 'run-turn-kill':
        this.handleRunKill(msg.runId, msg.turnId)
        break

      default:
        console.warn('[agent] Unknown message type:', (msg as { type: string }).type)
    }
  }

  private async handleRepositoryBrowse(requestId: string, requestedPath?: string): Promise<void> {
    try {
      const result = await browseRepositories({
        rootPath: this.workspaceRoot,
        requestedPath,
      })
      this.sendMessage({
        type: 'repository-browse-result',
        requestId,
        ok: true,
        currentPath: result.currentPath,
        parentPath: result.parentPath,
        entries: result.entries,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[agent] Failed to browse repositories:', message)
      this.sendMessage({ type: 'repository-browse-result', requestId, ok: false, error: message })
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

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private disposeAllRuns(): void {
    for (const [runId, run] of this.runs) {
      run.wrapper.dispose()
      this.runs.delete(runId)
    }
  }

  private handleRunStart(
    runId: string,
    turnId: string,
    tool: 'codex' | 'claude',
    repoPath: string,
    prompt: string,
    toolThreadId?: string,
    attachments?: RunImageAttachmentUpload[],
    options?: RunTurnOptions,
  ): void {
    // Dispose existing run with the same id if any
    const existing = this.runs.get(runId)
    if (existing) {
      existing.wrapper.dispose()
      this.runs.delete(runId)
    }

    const run = new RunWrapper({
      runId,
      tool,
      toolThreadId,
      repoPath,
      prompt,
      attachments,
      options,
      onEvent: (status: RunStatus, summary?: string, hasDiff?: boolean) => {
        this.sendMessage({ type: 'run-status', runId, turnId, status, summary, hasDiff })
      },
      onFinish: () => {
        this.runs.delete(runId)
      },
      onItem: (item) => {
        this.sendMessage({ type: 'run-item', runId, turnId, item })
      },
      onThreadReady: (nextToolThreadId) => {
        this.sendMessage({
          type: 'run-status',
          runId,
          turnId,
          status: 'running',
          toolThreadId: nextToolThreadId,
        })
      },
    })

    this.runs.set(runId, { turnId, wrapper: run })

    run.start().catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to start run ${runId}:`, message)
      this.sendMessage({
        type: 'run-status',
        runId,
        turnId,
        status: 'failed',
        summary: `Failed to start: ${message}`,
      })
      this.runs.delete(runId)
    })
  }

  private handleRunInterrupt(runId: string, turnId: string): void {
    const run = this.runs.get(runId)
    if (run && run.turnId === turnId) {
      run.wrapper.interrupt()
    } else {
      console.warn(`[agent] run-turn-interrupt: no matching turn found for ${runId}/${turnId}`)
    }
  }

  private handleRunKill(runId: string, turnId: string): void {
    const run = this.runs.get(runId)
    if (run && run.turnId === turnId) {
      run.wrapper.dispose()
      this.runs.delete(runId)
    }
  }

  private onDisconnect(): void {
    this.stopHeartbeat()
    this.disposeAllRuns()
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
