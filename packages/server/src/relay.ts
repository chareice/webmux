import type { WebSocket } from 'ws'
import type { TerminalClientMessage, ServerToAgentMessage, TerminalServerMessage } from '@webmux/shared'
import type { AgentHub } from './agent-hub.js'

export function handleTerminalConnection(
  socket: WebSocket,
  agentHub: AgentHub,
  agentId: string,
  sessionName: string,
  cols: number,
  rows: number,
  userId: string,
  browserId: string
): void {
  // Verify agent belongs to this user and is online
  const agent = agentHub.getAgent(agentId)
  if (!agent) {
    const errMsg: TerminalServerMessage = { type: 'error', message: 'Agent is not online' }
    socket.send(JSON.stringify(errMsg))
    socket.close()
    return
  }

  if (agent.userId !== userId) {
    const errMsg: TerminalServerMessage = { type: 'error', message: 'Agent does not belong to you' }
    socket.send(JSON.stringify(errMsg))
    socket.close()
    return
  }

  // Register browser in hub
  agentHub.registerBrowser(browserId, socket, agentId)

  // Send terminal-attach to agent
  const attachMsg: ServerToAgentMessage = {
    type: 'terminal-attach',
    browserId,
    sessionName,
    cols,
    rows,
  }
  const sent = agentHub.sendToAgent(agentId, attachMsg)
  if (!sent) {
    const errMsg: TerminalServerMessage = { type: 'error', message: 'Failed to reach agent' }
    socket.send(JSON.stringify(errMsg))
    socket.close()
    agentHub.removeBrowser(browserId)
    return
  }

  // Forward browser messages to agent
  socket.on('message', (raw) => {
    let message: TerminalClientMessage
    try {
      message = JSON.parse(raw.toString()) as TerminalClientMessage
    } catch {
      return
    }

    switch (message.type) {
      case 'input': {
        const inputMsg: ServerToAgentMessage = {
          type: 'terminal-input',
          browserId,
          data: message.data,
        }
        agentHub.sendToAgent(agentId, inputMsg)
        break
      }

      case 'resize': {
        const resizeMsg: ServerToAgentMessage = {
          type: 'terminal-resize',
          browserId,
          cols: message.cols,
          rows: message.rows,
        }
        agentHub.sendToAgent(agentId, resizeMsg)
        break
      }
    }
  })

  // On browser disconnect, send terminal-detach to agent
  socket.on('close', () => {
    const detachMsg: ServerToAgentMessage = { type: 'terminal-detach', browserId }
    agentHub.sendToAgent(agentId, detachMsg)
    agentHub.removeBrowser(browserId)
  })

  socket.on('error', () => {
    const detachMsg: ServerToAgentMessage = { type: 'terminal-detach', browserId }
    agentHub.sendToAgent(agentId, detachMsg)
    agentHub.removeBrowser(browserId)
  })
}
