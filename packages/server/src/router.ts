import crypto from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from 'better-sqlite3'
import type {
  AgentListResponse,
  CreateRegistrationTokenResponse,
  RegisterAgentRequest,
  RegisterAgentResponse,
  CreateSessionRequest,
  ListSessionsResponse,
  ServerToAgentMessage,
} from '@webmux/shared'
import {
  signJwt,
  verifyJwt,
  hashSecret,
  getGithubOAuthUrl,
  exchangeGithubCode,
  getGithubUser,
} from './auth.js'
import type { JwtPayload } from './auth.js'
import {
  findUserByGithubId,
  createUser,
  countUsers,
  findUserById,
  findAgentsByUserId,
  findAgentById,
  deleteAgent,
  createAgent,
  createRegistrationToken,
  consumeRegistrationToken,
} from './db.js'
import type { AgentHub } from './agent-hub.js'

interface ServerConfig {
  jwtSecret: string
  githubClientId: string
  githubClientSecret: string
  baseUrl: string
  devMode: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload
  }
}

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  hub: AgentHub,
  config: ServerConfig
): void {
  // --- JWT auth middleware ---
  const authPreHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid authorization header' })
    }

    const token = authHeader.slice(7)
    try {
      request.user = verifyJwt(token, config.jwtSecret)
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }
  }

  // --- Auth routes ---

  app.get('/api/auth/github', async (_request, reply) => {
    if (config.devMode) {
      return reply.status(400).send({ error: 'GitHub OAuth is not available in dev mode' })
    }
    const url = getGithubOAuthUrl(config.githubClientId, config.baseUrl)
    return reply.redirect(url)
  })

  app.get('/api/auth/github/callback', async (request, reply) => {
    if (config.devMode) {
      return reply.status(400).send({ error: 'GitHub OAuth is not available in dev mode' })
    }

    const { code } = request.query as { code?: string }
    if (!code) {
      return reply.status(400).send({ error: 'Missing code parameter' })
    }

    try {
      const accessToken = await exchangeGithubCode(config.githubClientId, config.githubClientSecret, code)
      const ghUser = await getGithubUser(accessToken)

      let user = findUserByGithubId(db, ghUser.id)
      if (!user) {
        // First user becomes admin
        const isFirst = countUsers(db) === 0
        user = createUser(db, {
          githubId: ghUser.id,
          githubLogin: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          role: isFirst ? 'admin' : 'user',
        })
      }

      const jwt = signJwt(
        { userId: user.id, githubLogin: user.github_login, role: user.role },
        config.jwtSecret
      )

      return reply.redirect(`${config.baseUrl}/?token=${jwt}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: message })
    }
  })

  app.get('/api/auth/dev', async (_request, reply) => {
    if (!config.devMode) {
      return reply.status(404).send({ error: 'Not found' })
    }

    // Find or create dev user
    let user = findUserByGithubId(db, 0)
    if (!user) {
      user = createUser(db, {
        githubId: 0,
        githubLogin: 'dev-admin',
        avatarUrl: null,
        role: 'admin',
      })
    }

    const jwt = signJwt(
      { userId: user.id, githubLogin: user.github_login, role: user.role },
      config.jwtSecret
    )

    return { token: jwt }
  })

  app.get('/api/auth/me', { preHandler: authPreHandler }, async (request, reply) => {
    const user = findUserById(db, request.user!.userId)
    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    return {
      id: user.id,
      githubLogin: user.github_login,
      avatarUrl: user.avatar_url,
      role: user.role,
    }
  })

  // --- Agent routes ---

  app.get('/api/agents', { preHandler: authPreHandler }, async (request) => {
    const agents = findAgentsByUserId(db, request.user!.userId)

    const response: AgentListResponse = {
      agents: agents.map((a) => {
        const online = hub.getAgent(a.id)
        return {
          id: a.id,
          name: a.name,
          status: online ? 'online' : 'offline',
          lastSeenAt: a.last_seen_at,
        }
      }),
    }

    return response
  })

  app.post('/api/agents/register-token', { preHandler: authPreHandler }, async (request) => {
    const { name } = (request.body as { name?: string }) ?? {}
    const agentName = name ?? 'unnamed'

    const plainToken = crypto.randomUUID()
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex')
    const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour

    createRegistrationToken(db, {
      userId: request.user!.userId,
      agentName,
      tokenHash,
      expiresAt,
    })

    const response: CreateRegistrationTokenResponse = {
      token: plainToken,
      expiresAt,
    }

    return response
  })

  app.post('/api/agents/register', async (request, reply) => {
    const body = request.body as RegisterAgentRequest | undefined
    if (!body?.token || !body?.name) {
      return reply.status(400).send({ error: 'Missing token or name' })
    }

    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex')
    const regToken = consumeRegistrationToken(db, tokenHash)

    if (!regToken) {
      return reply.status(400).send({ error: 'Invalid, expired, or already used registration token' })
    }

    const agentSecret = crypto.randomUUID()
    const agentSecretHash = await hashSecret(agentSecret)

    const agent = createAgent(db, {
      userId: regToken.user_id,
      name: body.name,
      agentSecretHash,
    })

    const response: RegisterAgentResponse = {
      agentId: agent.id,
      agentSecret,
    }

    return response
  })

  app.delete('/api/agents/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const agent = findAgentById(db, id)

    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    // Disconnect if online
    hub.removeAgent(id, db)
    deleteAgent(db, id)

    return { ok: true }
  })

  // --- Session routes ---

  app.get('/api/agents/:id/sessions', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const agent = findAgentById(db, id)

    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const sessions = hub.getAgentSessions(id)
    const response: ListSessionsResponse = { sessions }
    return response
  })

  app.post('/api/agents/:id/sessions', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as CreateSessionRequest | undefined

    if (!body?.name) {
      return reply.status(400).send({ error: 'Missing session name' })
    }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

    const msg: ServerToAgentMessage = { type: 'session-create', name: body.name }
    hub.sendToAgent(id, msg)

    return { ok: true }
  })

  app.delete('/api/agents/:id/sessions/:name', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, name } = request.params as { id: string; name: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

    const msg: ServerToAgentMessage = { type: 'session-kill', name }
    hub.sendToAgent(id, msg)

    return { ok: true }
  })
}
