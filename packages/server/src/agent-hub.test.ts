import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'

import type { AgentUpgradePolicy, ServerToAgentMessage } from '@webmux/shared'

import { hashSecret } from './auth.js'
import { AgentHub } from './agent-hub.js'
import { createAgent, createRun, createUser, findRunById, initDb } from './db.js'

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

describe('AgentHub run lifecycle', () => {
  it('ignores run events from the wrong authenticated agent', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const owner = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const intruder = createAgent(db, { userId: user.id, name: 'intruder', agentSecretHash: 'hash' })
    const run = createRun(db, {
      id: 'run-1',
      agentId: owner.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })

    const hub = new AgentHub()
    hub.handleAgentMessage(
      intruder.id,
      { type: 'run-status', runId: run.id, status: 'success', summary: 'done' },
      db,
    )

    expect(findRunById(db, run.id)?.status).toBe('starting')
  })

  it('marks active runs as failed when an agent disconnects unexpectedly', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const run = createRun(db, {
      id: 'run-1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)

    const hub = new AgentHub()
    ;(hub as unknown as {
      agents: Map<
        string,
        {
          socket: { close: () => void }
          userId: string
          name: string
          sessions: []
        }
      >
    }).agents.set(agent.id, {
      socket: { close: vi.fn() },
      userId: user.id,
      name: agent.name,
      sessions: [],
    })

    hub.removeAgent(agent.id, db)

    expect(findRunById(db, run.id)).toMatchObject({
      status: 'failed',
      summary: 'Agent disconnected before the run completed.',
    })
  })

  it('resolves repository browse requests with the agent response payload', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const socket = createSocket()
    const hub = new AgentHub()

    ;(hub as unknown as {
      agents: Map<
        string,
        {
          socket: TestSocket
          userId: string
          name: string
          sessions: []
        }
      >
    }).agents.set(agent.id, {
      socket,
      userId: user.id,
      name: agent.name,
      sessions: [],
    })

    const browsePromise = hub.requestRepositoryBrowse(agent.id, '/home/chareice/projects')
    const message = socket.messages[0] as Extract<ServerToAgentMessage, { type: 'repository-browse' }>

    expect(message).toMatchObject({
      type: 'repository-browse',
      path: '/home/chareice/projects',
    })

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'repository-browse-result',
        requestId: message.requestId,
        ok: true,
        currentPath: '/home/chareice/projects',
        parentPath: '/home/chareice',
        entries: [
          {
            kind: 'repository',
            name: 'webmux',
            path: '/home/chareice/projects/webmux',
          },
        ],
      },
      db,
    )

    await expect(browsePromise).resolves.toEqual({
      currentPath: '/home/chareice/projects',
      parentPath: '/home/chareice',
      entries: [
        {
          kind: 'repository',
          name: 'webmux',
          path: '/home/chareice/projects/webmux',
        },
      ],
    })
  })
})
