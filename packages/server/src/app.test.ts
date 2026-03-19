import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'


import { signJwt } from './auth.js'
import { AgentHub } from './agent-hub.js'
import { buildApp } from './app.js'
import {
  appendRunTimelineEvent,
  createAgent,
  createRun,
  createRunWithInitialTurn,
  createUser,
  findNotificationDevicesByUserId,
  findAgentById,
  findRunById,
  findRunTurnDetails,
  findRunTurnsByRunId,
  findRunsByAgentId,
  initDb,
  updateRunToolThreadId,
  updateAgentLastSeen,
} from './db.js'

const TEST_SECRET = 'test-secret'

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
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/threads`,
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

  it('registers and unregisters an Android push device for the current user', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'push-user',
      displayName: 'alice',
      avatarUrl: null,
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

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/mobile/push-devices',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        installationId: 'device-1',
        platform: 'android',
        provider: 'fcm',
        pushToken: 'fcm-token-1',
        deviceName: 'Pixel 9',
      },
    })

    expect(registerResponse.statusCode).toBe(200)
    expect(findNotificationDevicesByUserId(db, user.id)).toEqual([
      expect.objectContaining({
        installation_id: 'device-1',
        push_token: 'fcm-token-1',
        device_name: 'Pixel 9',
      }),
    ])

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/mobile/push-devices/device-1',
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(deleteResponse.statusCode).toBe(200)
    expect(findNotificationDevicesByUserId(db, user.id)).toEqual([])

    await app.close()
  })

  it('starts a thread with image attachments for Codex and stores attachment metadata on the turn', async () => {
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

    const messages: Array<{
      type: string
      runId?: string
      turnId?: string
      prompt?: string
      attachments?: Array<{ id: string; name: string; mimeType: string; sizeBytes: number; base64: string }>
    }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: {
        type: string
        runId?: string
        turnId?: string
        prompt?: string
        attachments?: Array<{ id: string; name: string; mimeType: string; sizeBytes: number; base64: string }>
      }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/threads`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        tool: 'codex',
        repoPath: '/tmp/project',
        prompt: 'Describe this screenshot',
        attachments: [
          {
            id: 'image-1',
            name: 'screen.png',
            mimeType: 'image/png',
            sizeBytes: 16,
            base64: Buffer.from('fake-image').toString('base64'),
          },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(messages[0]).toMatchObject({
      type: 'run-turn-start',
      prompt: 'Describe this screenshot',
      attachments: [
        {
          id: 'image-1',
          name: 'screen.png',
          mimeType: 'image/png',
          sizeBytes: 10,
        },
      ],
    })
    expect(response.json()).toMatchObject({
      turns: [
        {
          prompt: 'Describe this screenshot',
          attachments: [
            {
              id: 'image-1',
              name: 'screen.png',
              mimeType: 'image/png',
              sizeBytes: 10,
            },
          ],
        },
      ],
    })

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
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const requests = [
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/threads/${run.id}/input`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          input: 'continue',
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/threads/${run.id}/approve`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/agents/${agent.id}/threads/${run.id}/reject`,
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

  it('starts a follow-up turn under the same run', async () => {
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
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-1',
      turnId: 'run-1:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ?, summary = ? WHERE id = ?').run('success', 'done', run.id)
    db.prepare('UPDATE run_turns SET status = ?, summary = ? WHERE id = ?').run('success', 'done', turn.id)
    updateRunToolThreadId(db, run.id, 'codex-thread-1')
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; runId?: string; turnId?: string; prompt?: string; toolThreadId?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; runId?: string; turnId?: string; prompt?: string; toolThreadId?: string }) => {
        messages.push(message)
        return true
      },
      broadcastRunSnapshot() {},
      removeAgent() {},
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${agent.id}/threads/${run.id}/turns`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        prompt: 'Continue with the implementation',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(messages[0]).toMatchObject({
      type: 'run-turn-start',
      runId: run.id,
      prompt: 'Continue with the implementation',
      toolThreadId: 'codex-thread-1',
    })
    expect(findRunById(db, run.id)).toMatchObject({
      id: run.id,
      status: 'starting',
    })
    expect(findRunTurnsByRunId(db, run.id)).toHaveLength(2)

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
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-2',
      turnId: 'run-2:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('interrupted', run.id)
    db.prepare('UPDATE run_turns SET status = ? WHERE id = ?').run('running', turn.id)
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; runId?: string; turnId?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; runId?: string; turnId?: string }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}/threads/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(messages).toContainEqual({
      type: 'run-turn-kill',
      runId: run.id,
      turnId: turn.id,
    })
    expect(findRunById(db, run.id)).toBeUndefined()

    await app.close()
  })

  it('does not send a kill command for completed turns when deleting a run', async () => {
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
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-3',
      turnId: 'run-3:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('interrupted', run.id)
    db.prepare('UPDATE run_turns SET status = ? WHERE id = ?').run('interrupted', turn.id)
    const token = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
      TEST_SECRET,
    )

    const messages: Array<{ type: string; runId?: string; turnId?: string }> = []
    const hub = {
      getAgent: () => ({ id: agent.id }),
      sendToAgent: (_agentId: string, message: { type: string; runId?: string; turnId?: string }) => {
        messages.push(message)
        return true
      },
      removeAgent() {},
    } as unknown as AgentHub

    const { app } = buildApp({
      db,
      hub,
      config: createTestConfig('http://127.0.0.1:4317'),
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}/threads/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(messages).toEqual([])
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
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-1',
      turnId: 'run-1:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    appendRunTimelineEvent(db, run.id, turn.id, {
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
      url: `/api/agents/${agent.id}/threads/${run.id}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      run: {
        id: run.id,
      },
      turns: [
        {
          id: turn.id,
          prompt: 'Fix it',
          items: [
            {
              type: 'message',
              role: 'assistant',
              text: 'hello world',
            },
          ],
        },
      ],
    })
    expect(response.json().run).not.toHaveProperty('tmuxSession')
    expect(findRunTurnDetails(db, run.id)[0]?.items).toHaveLength(1)

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
