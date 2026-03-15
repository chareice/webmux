import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'

import type { AgentUpgradePolicy, ServerToAgentMessage } from '@webmux/shared'

import { hashSecret } from './auth.js'
import { AgentHub } from './agent-hub.js'
import { createAgent, createUser, initDb } from './db.js'

function createSocket() {
  const messages: ServerToAgentMessage[] = []

  return {
    messages,
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerToAgentMessage)
    },
    close: vi.fn(),
  }
}

type TestSocket = ReturnType<typeof createSocket>
type AuthenticateAgent = (
  socket: TestSocket,
  db: Database.Database,
  agentId: string,
  agentSecret: string,
  version?: string,
) => Promise<boolean>

describe('AgentHub upgrade policy', () => {
  it('sends the configured upgrade policy to compatible agents', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: await hashSecret(secret),
    })
    const socket = createSocket()
    const upgradePolicy: AgentUpgradePolicy = {
      packageName: '@webmux/agent',
      targetVersion: '0.1.6',
      minimumVersion: '0.1.4',
    }

    const hub = new AgentHub({ upgradePolicy })
    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.4')

    expect(authenticated).toBe(true)
    expect(socket.messages).toContainEqual({
      type: 'auth-ok',
      upgradePolicy,
    })
  })

  it('rejects agents below the configured minimum version', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: await hashSecret(secret),
    })
    const socket = createSocket()

    const hub = new AgentHub({
      upgradePolicy: {
        packageName: '@webmux/agent',
        targetVersion: '0.1.6',
        minimumVersion: '0.1.5',
      },
    })

    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.4')

    expect(authenticated).toBe(false)
    expect(socket.messages).toHaveLength(1)
    expect(socket.messages[0]).toMatchObject({
      type: 'auth-fail',
      message: expect.stringContaining('0.1.5'),
    })
    expect(socket.close).toHaveBeenCalledTimes(1)
  })
})
