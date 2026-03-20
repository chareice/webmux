import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'libsql'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  appendRunTimelineEvent,
  createRunTurn,
  createRunWithInitialTurn,
  deleteNotificationDevice,
  initDb,
  findUserByProvider,
  findUserById,
  createUser,
  countUsers,
  findAgentsByUserId,
  findAgentById,
  createAgent,
  deleteAgent,
  findRunById,
  findRunTurnById,
  findRunTurnDetails,
  findRunTurnsByRunId,
  renameAgent,
  updateAgentStatus,
  updateAgentLastSeen,
  createRegistrationToken,
  consumeRegistrationToken,
  findNotificationDevicesByUserId,
  updateRunToolThreadId,
  upsertNotificationDevice,
  createProject,
  findProjectById,
  findProjectsByUserId,
  findProjectsByAgentId,
  updateProject,
  deleteProject,
  createTask,
  findTaskById,
  findTasksByProjectId,
  findPendingTasksByProjectId,
  findPendingTasksByAgentId,
  updateTaskStatus,
  updateTaskRunInfo,
  updateTaskWorktreeInfo,
  updateTaskPrompt,
  deleteTask,
  resetTaskToPending,
} from './db.js'
import type Database from 'libsql'

let db: Database.Database

beforeEach(() => {
  db = initDb(':memory:')
})

describe('users', () => {
  it('creates and finds a user by provider', () => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '12345',
      displayName: 'testuser',
      avatarUrl: 'https://example.com/avatar.png',
    })

    expect(user.provider).toBe('github')
    expect(user.provider_id).toBe('12345')
    expect(user.display_name).toBe('testuser')
    expect(user.role).toBe('user')

    const found = findUserByProvider(db, 'github', '12345')
    expect(found?.id).toBe(user.id)
  })

  it('finds user by id', () => {
    const user = createUser(db, {
      provider: 'google',
      providerId: 'g-001',
      displayName: 'googleuser',
      avatarUrl: null,
    })

    const found = findUserById(db, user.id)
    expect(found?.display_name).toBe('googleuser')
  })

  it('returns undefined for nonexistent user', () => {
    expect(findUserByProvider(db, 'github', 'nope')).toBeUndefined()
    expect(findUserById(db, 'nope')).toBeUndefined()
  })

  it('enforces unique provider+provider_id', () => {
    createUser(db, { provider: 'github', providerId: '1', displayName: 'a', avatarUrl: null })
    expect(() =>
      createUser(db, { provider: 'github', providerId: '1', displayName: 'b', avatarUrl: null }),
    ).toThrow()
  })

  it('allows same provider_id for different providers', () => {
    createUser(db, { provider: 'github', providerId: '1', displayName: 'gh', avatarUrl: null })
    const google = createUser(db, { provider: 'google', providerId: '1', displayName: 'gg', avatarUrl: null })
    expect(google.provider).toBe('google')
  })

  it('first user gets admin role when specified', () => {
    const admin = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'admin',
      avatarUrl: null,
      role: 'admin',
    })
    expect(admin.role).toBe('admin')
  })

  it('counts users', () => {
    expect(countUsers(db)).toBe(0)
    createUser(db, { provider: 'github', providerId: '1', displayName: 'a', avatarUrl: null })
    expect(countUsers(db)).toBe(1)
    createUser(db, { provider: 'google', providerId: '2', displayName: 'b', avatarUrl: null })
    expect(countUsers(db)).toBe(2)
  })
})

describe('agents', () => {
  let userId: string

  beforeEach(() => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'owner',
      avatarUrl: null,
    })
    userId = user.id
  })

  it('creates and finds agents by user id', () => {
    const agent = createAgent(db, { userId, name: 'my-nas', agentSecretHash: 'hash123' })

    expect(agent.name).toBe('my-nas')
    expect(agent.status).toBe('offline')

    const agents = findAgentsByUserId(db, userId)
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe(agent.id)
  })

  it('finds agent by id', () => {
    const agent = createAgent(db, { userId, name: 'dev-box', agentSecretHash: 'hash' })
    const found = findAgentById(db, agent.id)
    expect(found?.name).toBe('dev-box')
  })

  it('returns empty array for user with no agents', () => {
    expect(findAgentsByUserId(db, userId)).toEqual([])
  })

  it('deletes an agent', () => {
    const agent = createAgent(db, { userId, name: 'temp', agentSecretHash: 'hash' })
    deleteAgent(db, agent.id)
    expect(findAgentById(db, agent.id)).toBeUndefined()
  })

  it('cascades runs and output when deleting an agent', () => {
    const agent = createAgent(db, { userId, name: 'temp', agentSecretHash: 'hash' })
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-1',
      turnId: 'run-1:turn:1',
      agentId: agent.id,
      userId,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    appendRunTimelineEvent(db, run.id, turn.id, {
      type: 'message',
      role: 'assistant',
      text: 'hello',
    })

    deleteAgent(db, agent.id)

    expect(findAgentById(db, agent.id)).toBeUndefined()
    expect(findRunById(db, run.id)).toBeUndefined()
    expect(findRunTurnDetails(db, run.id)).toEqual([])
  })

  it('renames an agent', () => {
    const agent = createAgent(db, { userId, name: 'old-name', agentSecretHash: 'h' })
    renameAgent(db, agent.id, 'new-name')
    expect(findAgentById(db, agent.id)?.name).toBe('new-name')
  })

  it('updates agent status', () => {
    const agent = createAgent(db, { userId, name: 'a', agentSecretHash: 'h' })
    updateAgentStatus(db, agent.id, 'online')
    expect(findAgentById(db, agent.id)?.status).toBe('online')

    updateAgentStatus(db, agent.id, 'offline')
    expect(findAgentById(db, agent.id)?.status).toBe('offline')
  })

  it('updates last seen timestamp', () => {
    const agent = createAgent(db, { userId, name: 'a', agentSecretHash: 'h' })
    expect(agent.last_seen_at).toBeNull()

    updateAgentLastSeen(db, agent.id)
    const updated = findAgentById(db, agent.id)
    expect(updated?.last_seen_at).toBeGreaterThan(0)
  })
})

describe('runs', () => {
  it('persists the external Codex thread id on the run row', () => {
    const user = createUser(db, {
      provider: 'github',
      providerId: 'thread-owner',
      displayName: 'owner',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'nas', agentSecretHash: 'hash' })
    const { run } = createRunWithInitialTurn(db, {
      runId: 'run-thread-id',
      turnId: 'run-thread-id:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Inspect the repository',
    })

    updateRunToolThreadId(db, run.id, 'codex-thread-1')

    expect(findRunById(db, run.id)?.tool_thread_id).toBe('codex-thread-1')
  })
})

describe('notification devices', () => {
  it('upserts a device token for a user installation', () => {
    const user = createUser(db, {
      provider: 'github',
      providerId: 'push-owner',
      displayName: 'owner',
      avatarUrl: null,
    })

    upsertNotificationDevice(db, {
      installationId: 'device-1',
      userId: user.id,
      platform: 'android',
      provider: 'fcm',
      pushToken: 'token-1',
      deviceName: 'Pixel',
    })

    upsertNotificationDevice(db, {
      installationId: 'device-1',
      userId: user.id,
      platform: 'android',
      provider: 'fcm',
      pushToken: 'token-2',
      deviceName: 'Pixel',
    })

    expect(findNotificationDevicesByUserId(db, user.id)).toEqual([
      expect.objectContaining({
        installation_id: 'device-1',
        user_id: user.id,
        platform: 'android',
        provider: 'fcm',
        push_token: 'token-2',
        device_name: 'Pixel',
      }),
    ])
  })

  it('deletes a stored device token for the owning user', () => {
    const user = createUser(db, {
      provider: 'github',
      providerId: 'push-owner',
      displayName: 'owner',
      avatarUrl: null,
    })

    upsertNotificationDevice(db, {
      installationId: 'device-1',
      userId: user.id,
      platform: 'android',
      provider: 'fcm',
      pushToken: 'token-1',
    })

    deleteNotificationDevice(db, user.id, 'device-1')

    expect(findNotificationDevicesByUserId(db, user.id)).toEqual([])
  })
})

describe('registration tokens', () => {
  let userId: string

  beforeEach(() => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'owner',
      avatarUrl: null,
    })
    userId = user.id
  })

  it('creates and consumes a token', () => {
    const token = createRegistrationToken(db, {
      userId,
      agentName: 'my-agent',
      tokenHash: 'abc123',
      expiresAt: Date.now() + 60000,
    })

    expect(token.used).toBe(0)

    const consumed = consumeRegistrationToken(db, 'abc123')
    expect(consumed?.agent_name).toBe('my-agent')
    expect(consumed?.user_id).toBe(userId)
  })

  it('cannot consume the same token twice', () => {
    createRegistrationToken(db, {
      userId,
      agentName: 'agent',
      tokenHash: 'once',
      expiresAt: Date.now() + 60000,
    })

    expect(consumeRegistrationToken(db, 'once')).toBeDefined()
    expect(consumeRegistrationToken(db, 'once')).toBeUndefined()
  })

  it('cannot consume expired token', () => {
    createRegistrationToken(db, {
      userId,
      agentName: 'agent',
      tokenHash: 'expired',
      expiresAt: Date.now() - 1000,
    })

    expect(consumeRegistrationToken(db, 'expired')).toBeUndefined()
  })

  it('returns undefined for nonexistent token', () => {
    expect(consumeRegistrationToken(db, 'nope')).toBeUndefined()
  })

  it('cleans up expired and used tokens when creating new ones', () => {
    // Manually insert an expired token (bypass createRegistrationToken to avoid cleanup)
    db.prepare(
      'INSERT INTO registration_tokens (id, user_id, agent_name, token_hash, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)',
    ).run('t1', userId, 'old', 'expired-hash', Date.now() - 1000)

    // Manually insert a used token
    db.prepare(
      'INSERT INTO registration_tokens (id, user_id, agent_name, token_hash, expires_at, used) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('t2', userId, 'used', 'used-hash', Date.now() + 60000)

    const countBefore = (db.prepare('SELECT COUNT(*) as cnt FROM registration_tokens').get() as { cnt: number }).cnt
    expect(countBefore).toBe(2)

    // Creating a new token should clean up the stale ones
    createRegistrationToken(db, {
      userId, agentName: 'new', tokenHash: 'new-hash', expiresAt: Date.now() + 60000,
    })

    const countAfter = (db.prepare('SELECT COUNT(*) as cnt FROM registration_tokens').get() as { cnt: number }).cnt
    expect(countAfter).toBe(1)
  })
})

describe('run timeline events', () => {
  let userId: string
  let agentId: string

  beforeEach(() => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'owner',
      avatarUrl: null,
    })
    userId = user.id
    agentId = createAgent(db, { userId, name: 'runner', agentSecretHash: 'hash' }).id
  })

  it('stores timeline events in order and returns typed items', () => {
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-output',
      turnId: 'run-output:turn:1',
      agentId,
      userId,
      tool: 'claude',
      repoPath: '/tmp/project',
      prompt: 'ship it',
    })

    appendRunTimelineEvent(db, run.id, turn.id, {
      type: 'message',
      role: 'assistant',
      text: 'Planning the fix.',
    })
    appendRunTimelineEvent(db, run.id, turn.id, {
      type: 'command',
      status: 'completed',
      command: '/usr/bin/bash -lc ls',
      output: 'README.md\nsrc\n',
      exitCode: 0,
    })

    expect(findRunTurnDetails(db, run.id)).toEqual([
      {
        id: turn.id,
        runId: run.id,
        index: 1,
        prompt: 'ship it',
        attachments: [],
        status: 'starting',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        hasDiff: false,
        summary: undefined,
        items: [
          {
            id: 1,
            createdAt: expect.any(Number),
            type: 'message',
            role: 'assistant',
            text: 'Planning the fix.',
          },
          {
            id: 2,
            createdAt: expect.any(Number),
            type: 'command',
            status: 'completed',
            command: '/usr/bin/bash -lc ls',
            output: 'README.md\nsrc\n',
            exitCode: 0,
          },
        ],
      },
    ])
  })

  it('creates follow-up turns under the same run in order', () => {
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-thread',
      turnId: 'run-thread:turn:1',
      agentId,
      userId,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Inspect the repo',
    })

    const followUpTurn = createRunTurn(db, {
      id: 'run-thread:turn:2',
      runId: run.id,
      prompt: 'Now apply the fix',
    })

    expect(findRunTurnsByRunId(db, run.id).map((item) => item.id)).toEqual([
      turn.id,
      followUpTurn.id,
    ])
    expect(findRunTurnById(db, followUpTurn.id)).toMatchObject({
      run_id: run.id,
      turn_index: 2,
      prompt: 'Now apply the fix',
      status: 'starting',
    })
  })

  it('migrates legacy run tables by dropping the tmux session column and creating an initial turn', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'webmux-db-'))
    const dbPath = path.join(tempDir, 'webmux.db')
    const legacyDb = new BetterSqlite3(dbPath)

    legacyDb.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        agent_secret_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        tool TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT,
        has_diff INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 1,
        tmux_session TEXT NOT NULL
      );

      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    legacyDb
      .prepare('INSERT INTO users (id, provider, provider_id, display_name, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('user-1', 'github', '1', 'owner', null, 'user', 1)
    legacyDb
      .prepare('INSERT INTO agents (id, user_id, name, agent_secret_hash, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('agent-1', 'user-1', 'runner', 'hash', 'offline', null, 1)
    legacyDb
      .prepare('INSERT INTO runs (id, agent_id, user_id, tool, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread, tmux_session) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('run-legacy', 'agent-1', 'user-1', 'codex', '/tmp/project', 'main', 'Fix it', 'success', 1, 2, 'done', 1, 0, 'run-legacy')
    legacyDb
      .prepare('INSERT INTO run_events (run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)')
      .run('run-legacy', 'message', JSON.stringify({
        type: 'message',
        role: 'assistant',
        text: 'done',
      }), 2)
    legacyDb.close()

    const migratedDb = initDb(dbPath)
    const columns = migratedDb.pragma('table_info(runs)') as Array<{ name: string }>
    const turnColumns = migratedDb.pragma('table_info(run_events)') as Array<{ name: string }>
    const migratedRun = findRunById(migratedDb, 'run-legacy')
    const migratedTurns = findRunTurnsByRunId(migratedDb, 'run-legacy')
    const migratedTurnDetails = findRunTurnDetails(migratedDb, 'run-legacy')

    expect(columns.map((column) => column.name)).not.toContain('tmux_session')
    expect(turnColumns.map((column) => column.name)).toContain('turn_id')
    expect(migratedRun).toMatchObject({
      id: 'run-legacy',
      agent_id: 'agent-1',
      user_id: 'user-1',
      prompt: 'Fix it',
      summary: 'done',
      has_diff: 1,
      unread: 0,
    })
    expect(migratedTurns).toHaveLength(1)
    expect(migratedTurns[0]).toMatchObject({
      id: 'run-legacy:turn:1',
      run_id: 'run-legacy',
      turn_index: 1,
      prompt: 'Fix it',
      status: 'success',
      summary: 'done',
      has_diff: 1,
    })
    expect(migratedTurnDetails).toEqual([
      {
        id: 'run-legacy:turn:1',
        runId: 'run-legacy',
        index: 1,
        prompt: 'Fix it',
        attachments: [],
        status: 'success',
        createdAt: 1,
        updatedAt: 2,
        summary: 'done',
        hasDiff: true,
        items: [
          {
            id: 1,
            createdAt: 2,
            type: 'message',
            role: 'assistant',
            text: 'done',
          },
        ],
      },
    ])

    migratedDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('rewires legacy turn and event foreign keys after renaming runs', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'webmux-db-'))
    const dbPath = path.join(tempDir, 'legacy-turns.sqlite')
    const legacyDb = new BetterSqlite3(dbPath)

    legacyDb.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        agent_secret_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        tool TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT,
        has_diff INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 1,
        tmux_session TEXT NOT NULL
      );

      CREATE TABLE run_turns (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        turn_index INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT,
        has_diff INTEGER NOT NULL DEFAULT 0,
        UNIQUE(run_id, turn_index)
      );

      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    legacyDb
      .prepare('INSERT INTO users (id, provider, provider_id, display_name, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('user-1', 'github', '1', 'owner', null, 'user', 1)
    legacyDb
      .prepare('INSERT INTO agents (id, user_id, name, agent_secret_hash, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('agent-1', 'user-1', 'runner', 'hash', 'online', 1, 1)
    legacyDb
      .prepare('INSERT INTO runs (id, agent_id, user_id, tool, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread, tmux_session) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('run-legacy', 'agent-1', 'user-1', 'codex', '/tmp/project', 'main', 'Fix it', 'success', 1, 2, 'done', 1, 0, 'run-legacy')
    legacyDb
      .prepare('INSERT INTO run_turns (id, run_id, turn_index, prompt, status, created_at, updated_at, summary, has_diff) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('run-legacy:turn:1', 'run-legacy', 1, 'Fix it', 'success', 1, 2, 'done', 1)
    legacyDb
      .prepare('INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('run-legacy', 'run-legacy:turn:1', 'message', JSON.stringify({
        type: 'message',
        role: 'assistant',
        text: 'done',
      }), 2)
    legacyDb.close()

    const migratedDb = initDb(dbPath)
    const turnForeignKeys = migratedDb.pragma('foreign_key_list(run_turns)') as Array<{ table: string }>
    const eventForeignKeys = migratedDb.pragma('foreign_key_list(run_events)') as Array<{ table: string }>

    expect(turnForeignKeys.map((fk) => fk.table)).toContain('runs')
    expect(turnForeignKeys.map((fk) => fk.table)).not.toContain('runs_legacy')
    expect(eventForeignKeys.map((fk) => fk.table)).toContain('runs')
    expect(eventForeignKeys.map((fk) => fk.table)).toContain('run_turns')
    expect(eventForeignKeys.map((fk) => fk.table)).not.toContain('runs_legacy')
    expect(eventForeignKeys.map((fk) => fk.table)).not.toContain('run_turns_legacy')

    expect(() =>
      createRunWithInitialTurn(migratedDb, {
        runId: 'run-new',
        turnId: 'run-new:turn:1',
        agentId: 'agent-1',
        userId: 'user-1',
        tool: 'codex',
        repoPath: '/tmp/new-project',
        prompt: 'Continue',
      }),
    ).not.toThrow()

    expect(() =>
      appendRunTimelineEvent(migratedDb, 'run-new', 'run-new:turn:1', {
        type: 'message',
        role: 'assistant',
        text: 'still works',
      }),
    ).not.toThrow()

    migratedDb.close()
    rmSync(tempDir, { recursive: true, force: true })
  })
})

describe('projects', () => {
  let userId: string
  let agentId: string

  beforeEach(() => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'owner',
      avatarUrl: null,
    })
    userId = user.id
    agentId = createAgent(db, { userId, name: 'runner', agentSecretHash: 'hash' }).id
  })

  it('creates and finds a project', () => {
    const project = createProject(db, {
      userId,
      agentId,
      name: 'my-project',
      description: 'A test project',
      repoPath: '/tmp/my-project',
      defaultTool: 'codex',
    })

    expect(project.name).toBe('my-project')
    expect(project.description).toBe('A test project')
    expect(project.default_tool).toBe('codex')

    const found = findProjectById(db, project.id)
    expect(found?.id).toBe(project.id)
    expect(found?.user_id).toBe(userId)
    expect(found?.agent_id).toBe(agentId)
    expect(found?.repo_path).toBe('/tmp/my-project')
  })

  it('lists projects by user ordered by updated_at desc', () => {
    const proj1 = createProject(db, { userId, agentId, name: 'proj-1', repoPath: '/tmp/p1' })
    createProject(db, { userId, agentId, name: 'proj-2', repoPath: '/tmp/p2' })

    // Update proj-1 so it has the most recent updated_at
    updateProject(db, proj1.id, { name: 'proj-1-updated' })

    const projects = findProjectsByUserId(db, userId)
    expect(projects).toHaveLength(2)
    // Most recently updated first
    expect(projects[0].name).toBe('proj-1-updated')
    expect(projects[1].name).toBe('proj-2')
  })

  it('lists projects by agent', () => {
    createProject(db, { userId, agentId, name: 'proj-1', repoPath: '/tmp/p1' })

    const projects = findProjectsByAgentId(db, agentId)
    expect(projects).toHaveLength(1)
    expect(projects[0].agent_id).toBe(agentId)
  })

  it('updates a project', () => {
    const project = createProject(db, { userId, agentId, name: 'old-name', repoPath: '/tmp/p' })
    updateProject(db, project.id, { name: 'new-name', description: 'updated' })

    const found = findProjectById(db, project.id)
    expect(found?.name).toBe('new-name')
    expect(found?.description).toBe('updated')
  })

  it('deletes a project and cascades to tasks', () => {
    const project = createProject(db, { userId, agentId, name: 'doomed', repoPath: '/tmp/p' })
    const task = createTask(db, { projectId: project.id, title: 'task-1', prompt: 'do it' })

    deleteProject(db, project.id)

    expect(findProjectById(db, project.id)).toBeUndefined()
    expect(findTaskById(db, task.id)).toBeUndefined()
  })
})

describe('tasks', () => {
  let userId: string
  let agentId: string
  let projectId: string

  beforeEach(() => {
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'owner',
      avatarUrl: null,
    })
    userId = user.id
    agentId = createAgent(db, { userId, name: 'runner', agentSecretHash: 'hash' }).id
    projectId = createProject(db, { userId, agentId, name: 'test-project', repoPath: '/tmp/p' }).id
  })

  it('creates and finds a task', () => {
    const task = createTask(db, {
      projectId,
      title: 'Fix bug',
      prompt: 'Fix the login bug',
      priority: 5,
    })

    expect(task.status).toBe('pending')
    expect(task.priority).toBe(5)
    expect(task.branch_name).toBeNull()
    expect(task.run_id).toBeNull()

    const found = findTaskById(db, task.id)
    expect(found?.title).toBe('Fix bug')
    expect(found?.prompt).toBe('Fix the login bug')
  })

  it('finds pending tasks by project ordered by priority desc', () => {
    createTask(db, { projectId, title: 'low', prompt: 'low priority', priority: 1 })
    createTask(db, { projectId, title: 'high', prompt: 'high priority', priority: 10 })
    createTask(db, { projectId, title: 'mid', prompt: 'mid priority', priority: 5 })

    const pending = findPendingTasksByProjectId(db, projectId)
    expect(pending).toHaveLength(3)
    expect(pending[0].title).toBe('high')
    expect(pending[1].title).toBe('mid')
    expect(pending[2].title).toBe('low')
  })

  it('finds pending tasks by agent id', () => {
    createTask(db, { projectId, title: 'agent-task', prompt: 'do it' })

    const pending = findPendingTasksByAgentId(db, agentId)
    expect(pending).toHaveLength(1)
    expect(pending[0].title).toBe('agent-task')
  })

  it('finds all tasks by project ordered by priority desc then created_at asc', () => {
    createTask(db, { projectId, title: 'a', prompt: 'first', priority: 5 })
    createTask(db, { projectId, title: 'b', prompt: 'second', priority: 5 })
    createTask(db, { projectId, title: 'c', prompt: 'third', priority: 10 })

    const tasks = findTasksByProjectId(db, projectId)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].title).toBe('c')
    expect(tasks[1].title).toBe('a')
    expect(tasks[2].title).toBe('b')
  })

  it('updates task status', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'go' })

    updateTaskStatus(db, task.id, 'dispatched')
    const dispatched = findTaskById(db, task.id)
    expect(dispatched?.status).toBe('dispatched')
    expect(dispatched?.claimed_at).toBeGreaterThan(0)

    updateTaskStatus(db, task.id, 'completed')
    const completed = findTaskById(db, task.id)
    expect(completed?.status).toBe('completed')
    expect(completed?.completed_at).toBeGreaterThan(0)
  })

  it('updates task run info', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'go' })
    updateTaskRunInfo(db, task.id, 'run-123')

    const found = findTaskById(db, task.id)
    expect(found?.run_id).toBe('run-123')
  })

  it('updates task worktree info', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'go' })
    updateTaskWorktreeInfo(db, task.id, 'feature/foo', '/tmp/worktrees/foo')

    const found = findTaskById(db, task.id)
    expect(found?.branch_name).toBe('feature/foo')
    expect(found?.worktree_path).toBe('/tmp/worktrees/foo')
  })

  it('marks task as failed with error message', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'go' })
    updateTaskStatus(db, task.id, 'failed', 'Something went wrong')

    const found = findTaskById(db, task.id)
    expect(found?.status).toBe('failed')
    expect(found?.error_message).toBe('Something went wrong')
    expect(found?.completed_at).toBeGreaterThan(0)
  })

  it('deletes a task', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'go' })
    expect(deleteTask(db, task.id)).toBe(true)
    expect(findTaskById(db, task.id)).toBeUndefined()
    expect(deleteTask(db, 'nonexistent')).toBe(false)
  })

  it('updates task prompt fields', () => {
    const task = createTask(db, { projectId, title: 'old title', prompt: 'old prompt', priority: 1 })
    updateTaskPrompt(db, task.id, { title: 'new title', prompt: 'new prompt', priority: 10 })

    const found = findTaskById(db, task.id)
    expect(found?.title).toBe('new title')
    expect(found?.prompt).toBe('new prompt')
    expect(found?.priority).toBe(10)
  })

  it('resets a task to pending', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'original' })
    updateTaskStatus(db, task.id, 'dispatched')
    updateTaskRunInfo(db, task.id, 'run-1')
    updateTaskWorktreeInfo(db, task.id, 'branch-1', '/tmp/wt')

    resetTaskToPending(db, task.id)

    const found = findTaskById(db, task.id)
    expect(found?.status).toBe('pending')
    expect(found?.run_id).toBeNull()
    expect(found?.branch_name).toBeNull()
    expect(found?.worktree_path).toBeNull()
    expect(found?.error_message).toBeNull()
    expect(found?.claimed_at).toBeNull()
    expect(found?.completed_at).toBeNull()
  })

  it('resets a task to pending with additional prompt', () => {
    const task = createTask(db, { projectId, title: 'task', prompt: 'original prompt' })
    updateTaskStatus(db, task.id, 'failed', 'it broke')

    resetTaskToPending(db, task.id, 'Try a different approach')

    const found = findTaskById(db, task.id)
    expect(found?.status).toBe('pending')
    expect(found?.prompt).toBe('original prompt\n\nTry a different approach')
    expect(found?.error_message).toBeNull()
  })
})
