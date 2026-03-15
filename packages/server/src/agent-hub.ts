import type { WebSocket } from 'ws'
import type { Database } from 'better-sqlite3'
import type {
  AgentMessage,
  ServerToAgentMessage,
  SessionSummary,
  TerminalServerMessage,
  SessionEvent,
} from '@webmux/shared'
import { verifySecret } from './auth.js'
import { findAgentById, updateAgentStatus, updateAgentLastSeen } from './db.js'

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

export class AgentHub {
  private agents = new Map<string, OnlineAgent>()
  private browsers = new Map<string, BrowserConnection>()
  private eventClients: EventClient[] = []
  private heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

        this.authenticateAgent(socket, db, message.agentId, message.agentSecret)
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
    agentSecret: string
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

    const msg: ServerToAgentMessage = { type: 'auth-ok' }
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
}
