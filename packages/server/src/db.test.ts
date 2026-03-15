import { describe, expect, it, beforeEach } from 'vitest'
import {
  initDb,
  findUserByProvider,
  findUserById,
  createUser,
  countUsers,
  findAgentsByUserId,
  findAgentById,
  createAgent,
  deleteAgent,
  updateAgentStatus,
  updateAgentLastSeen,
  createRegistrationToken,
  consumeRegistrationToken,
} from './db.js'
import type Database from 'better-sqlite3'

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
})
