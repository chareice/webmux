import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { SessionSummary } from '@webmux/shared'

import { signJwt } from './auth.js'
import { AgentHub } from './agent-hub.js'
import { buildApp } from './app.js'
import {
  appendRunTimelineEvent,
  createAgent,
  createRun,
  createUser,
  findAgentById,
  findRunById,
  findRunTimelineEvents,
  findRunsByAgentId,
  initDb,
  updateAgentLastSeen,
} from './db.js'

const TEST_SECRET = 'test-secret'

function createSession(name: string): SessionSummary {
  return {
    name,
    windows: 1,
    attachedClients: 0,
    createdAt: 1_700_000_000,
    lastActivityAt: 1_700_000_100,
    path: '/tmp',
    preview: ['echo ready'],
    currentCommand: 'bash',
  }
}

function createTestConfig(baseUrl: string) {
  return {
    jwtSecret: TEST_SECRET,
    githubClientId: '',
    githubClientSecret: '',
    googleClientId: '',
    googleClientSecret: '',
    baseUrl,
    devMode: false,
    agentUpgradePolicy: null,
  }
}

describe('buildApp', () => {
  it('returns structured session data after create succeeds', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const hub = new AgentHub()
    const fakeSocket = {
      OPEN: 1,
      readyState: 1,
      send(raw: string) {
        const message = JSON.parse(raw) as { type: string; requestId?: string; name?: string }
        if (message.type !== 'session-create' || !message.requestId || !message.name) {
          return
        }

        const requestId = message.requestId
        const session = createSession(message.name)
        setTimeout(() => {
          hub.handleAgentMessage(
            agent.id,
            { type: 'sessions-sync', sessions: [session] },
            db,
          )
          hub.handleAgentMessage(
            agent.id,
            { type: 'command-result', requestId, ok: true, session },
            db,
          )
        }, 0)
      },
      close() {},
      on() {},
    }

    ;(hub as unknown as {
      agents: Map<
        string,
        {
          socket: typeof fakeSocket
          userId: string
          name: string
          sessions: SessionSummary[]
        }
      >
    }).agents.set(agent.id, {
      socket: fakeSocket,
      userId: user.id,
      name: agent.name,
      sessions: [],
    })

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/sessions`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'codex',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      session: createSession('codex'),
    })

    await app.close()
  })

  it('returns repository choices for an online agent', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const browseResult = {
      currentPath: '/home/chareice/projects',
      parentPath: '/home/chareice',
      entries: [
        {
          kind: 'repository',
          name: 'webmux',
          path: '/home/chareice/projects/webmux',
        },
      ],
    }

    const hub = {
      getAgent: () => ({ id: agent.id }),
      removeAgent() {},
      getAgentSessions: () => [],
      requestSessionCreate: async () => createSession('unused'),
      requestSessionKill: async () => undefined,
      sendToAgent: () => true,
      requestRepositoryBrowse: vi.fn().mockResolvedValue(browseResult),
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/agents/${agent.id}/repositories?path=${encodeURIComponent('/home/chareice/projects')}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(browseResult)

    await app.close()
  })

  it('keeps API 404 responses as JSON while SPA routes fall back to index.html', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'webmux-static-'))
    writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><html><body>webmux</body></html>')

    const { app } = buildApp({
      db: initDb(':memory:'),
      hub: new AgentHub(),
      config: createTestConfig('http://127.0.0.1:4317'),
      staticRoot: tempDir,
    })

    const spaResponse = await app.inject({
      method: 'GET',
      url: '/agents/123',
    })
    expect(spaResponse.statusCode).toBe(200)
    expect(spaResponse.headers['content-type']).toContain('text/html')
    expect(spaResponse.body).toContain('webmux')

    const apiResponse = await app.inject({
      method: 'GET',
      url: '/api/missing',
    })
    expect(apiResponse.statusCode).toBe(404)
    expect(apiResponse.headers['content-type']).toContain('application/json')
    expect(apiResponse.body).not.toContain('<html')

    await app.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('skips SPA fallback when the static root has no index.html', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'webmux-static-empty-'))

    const { app } = buildApp({
      db: initDb(':memory:'),
      hub: new AgentHub(),
      config: createTestConfig('http://127.0.0.1:4317'),
      staticRoot: tempDir,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/missing',
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      error: 'Not Found',
      statusCode: 404,
    })

    await app.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('normalizes agent lastSeenAt to seconds in the API response', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    updateAgentLastSeen(db, agent.id)

    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const { app } = buildApp({
      db,
      hub: new AgentHub(),
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json() as {
      agents: Array<{ id: string; lastSeenAt: number | null }>
    }
    expect(payload.agents).toHaveLength(1)
    expect(payload.agents[0].id).toBe(agent.id)
    expect(payload.agents[0].lastSeenAt).toBeTypeOf('number')
    expect(Number.isInteger(payload.agents[0].lastSeenAt)).toBe(true)
    expect(payload.agents[0].lastSeenAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))

    await app.close()
  })

  it('returns 503 and does not persist the run when the start command cannot reach the agent', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: () => false,
      removeAgent() {},
      getAgentSessions: () => [],
      requestSessionCreate: async () => createSession('unused'),
      requestSessionKill: async () => undefined,
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/runs`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        tool: 'codex',
        repoPath: '/tmp/project',
        prompt: 'Fix it',
      },
    })

    expect(response.statusCode).toBe(503)
    expect(findRunsByAgentId(db, agent.id)).toEqual([])

    await app.close()
  })

  it('does not expose the legacy interactive run routes', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const run = createRun(db, {
      id: 'run-1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; input?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; input?: string }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
      getAgentSessions: () => [],
      requestSessionCreate: async () => createSession('unused'),
      requestSessionKill: async () => undefined,
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const requests = [
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/runs/${run.id}/input`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          input: 'continue',
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/runs/${run.id}/approve`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/runs/${run.id}/reject`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
    ]

    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.statusCode).toBe(404)
    }
    expect(messages).toEqual([])

    await app.close()
  })

  it('kills active runs before deleting them', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const run = createRun(db, {
      id: 'run-1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; runId?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; runId?: string }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
      getAgentSessions: () => [],
      requestSessionCreate: async () => createSession('unused'),
      requestSessionKill: async () => undefined,
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}/runs/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(messages).toContainEqual({
      type: 'run-kill',
      runId: run.id,
    })
    expect(findRunById(db, run.id)).toBeUndefined()

    await app.close()
  })

  it('kills interrupted runs before deleting them', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const run = createRun(db, {
      id: 'run-2',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('interrupted', run.id)
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; runId?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; runId?: string }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
      getAgentSessions: () => [],
      requestSessionCreate: async () => createSession('unused'),
      requestSessionKill: async () => undefined,
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}/runs/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(messages).toContainEqual({
      type: 'run-kill',
      runId: run.id,
    })
    expect(findRunById(db, run.id)).toBeUndefined()

    await app.close()
  })

  it('returns stored timeline items in the run detail response', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    const run = createRun(db, {
      id: 'run-1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    appendRunTimelineEvent(db, run.id, {
      type: 'message',
      role: 'assistant',
      text: 'hello world',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const { app } = buildApp({
      db,
      hub: new AgentHub(),
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/agents/${agent.id}/runs/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      run: {
        id: run.id,
      },
      items: [
        {
          type: 'message',
          role: 'assistant',
          text: 'hello world',
        },
      ],
    })
    expect(response.json().run).not.toHaveProperty('tmuxSession')
    expect(findRunTimelineEvents(db, run.id)).toHaveLength(1)

    await app.close()
  })

  it('deletes agents that already have run history', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'u-1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: 'hash',
    })
    createRun(db, {
      id: 'run-1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const { app } = buildApp({
      db,
      hub: new AgentHub(),
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(findAgentById(db, agent.id)).toBeUndefined()

    await app.close()
  })
})
