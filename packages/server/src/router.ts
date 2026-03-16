import crypto from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from 'libsql'
import type {
  AgentListResponse,
  CreateRegistrationTokenResponse,
  RegisterAgentRequest,
  RegisterAgentResponse,
  CreateSessionRequest,
  ListSessionsResponse,
  RepositoryBrowseResponse,
  ContinueRunRequest,
  RunImageAttachmentUpload,
  StartRunRequest,
  RunListResponse,
  RunDetailResponse,
  ServerToAgentMessage,
} from '@webmux/shared'
import {
  appendAuthTokenToRedirectTarget,
  decodeOAuthState,
  signJwt,
  verifyJwt,
  encodeOAuthState,
  hashSecret,
  getGithubOAuthUrl,
  exchangeGithubCode,
  getGithubUser,
  getGoogleOAuthUrl,
  exchangeGoogleCode,
  getGoogleUser,
} from './auth.js'
import type { JwtPayload } from './auth.js'
import {
  findUserByProvider,
  createUser,
  countUsers,
  findUserById,
  deleteNotificationDevice,
  findAgentsByUserId,
  findAgentById,
  findNotificationDevicesByUserId,
  deleteAgent,
  createAgent,
  renameAgent,
  createRegistrationToken,
  consumeRegistrationToken,
  createRunWithInitialTurn,
  createRunTurn,
  findRunById,
  findRunTurnDetails,
  findActiveRunTurnByRunId,
  findRunsByAgentId,
  findRunsByUserId,
  markRunRead,
  deleteRun,
  deleteRunTurn,
  upsertNotificationDevice,
} from './db.js'
import type { AgentHub } from './agent-hub.js'
import { runRowToRun } from './agent-hub.js'

interface ServerConfig {
  jwtSecret: string
  githubClientId: string
  githubClientSecret: string
  googleClientId: string
  googleClientSecret: string
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
  const MAX_IMAGE_ATTACHMENTS = 4
  const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024

  const redirectAfterAuth = (jwt: string, state?: string): string => {
    const redirectTo = decodeOAuthState(state).redirectTo
    if (!redirectTo) {
      return `${config.baseUrl}/?token=${jwt}`
    }

    try {
      return appendAuthTokenToRedirectTarget(redirectTo, jwt)
    } catch {
      return `${config.baseUrl}/?token=${jwt}`
    }
  }

  const sendRunMessage = (
    agentId: string,
    message: ServerToAgentMessage,
    reply: FastifyReply,
  ): boolean => {
    if (hub.sendToAgent(agentId, message)) {
      return true
    }

    void reply.status(503).send({ error: 'Agent became unavailable before the command could be delivered' })
    return false
  }

  const normalizeAttachments = (value: unknown): RunImageAttachmentUpload[] => {
    if (value == null) {
      return []
    }

    if (!Array.isArray(value)) {
      throw new Error('Attachments must be an array')
    }

    if (value.length > MAX_IMAGE_ATTACHMENTS) {
      throw new Error(`At most ${MAX_IMAGE_ATTACHMENTS} images can be attached`)
    }

    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Invalid image attachment')
      }

      const candidate = entry as Partial<RunImageAttachmentUpload>
      const mimeType = candidate.mimeType?.trim()
      if (!mimeType || !mimeType.startsWith('image/')) {
        throw new Error('Only image attachments are supported')
      }

      const rawBase64 = candidate.base64?.trim()
      if (!rawBase64) {
        throw new Error('Image attachment is missing base64 data')
      }

      const base64 = rawBase64.replace(/^data:[^;]+;base64,/, '')
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.length === 0) {
        throw new Error('Image attachment is empty')
      }

      if (bytes.length > MAX_IMAGE_ATTACHMENT_BYTES) {
        throw new Error('Each image must be 5MB or smaller')
      }

      return {
        id: candidate.id?.trim() || crypto.randomUUID(),
        name: candidate.name?.trim() || `image-${index + 1}`,
        mimeType,
        sizeBytes: bytes.length,
        base64,
      }
    })
  }

  const hasPromptContent = (value: unknown): value is string => {
    return typeof value === 'string' && value.trim().length > 0
  }

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

  app.get('/api/auth/github', async (request, reply) => {
    if (config.devMode) {
      return reply.status(400).send({ error: 'GitHub OAuth is not available in dev mode' })
    }
    const { redirectTo } = request.query as { redirectTo?: string }
    const url = getGithubOAuthUrl(
      config.githubClientId,
      config.baseUrl,
      encodeOAuthState({ redirectTo }),
    )
    return reply.redirect(url)
  })

  app.get('/api/auth/github/callback', async (request, reply) => {
    if (config.devMode) {
      return reply.status(400).send({ error: 'GitHub OAuth is not available in dev mode' })
    }

    const { code, state } = request.query as { code?: string; state?: string }
    if (!code) {
      return reply.status(400).send({ error: 'Missing code parameter' })
    }

    try {
      const accessToken = await exchangeGithubCode(config.githubClientId, config.githubClientSecret, code)
      const ghUser = await getGithubUser(accessToken)

      let user = findUserByProvider(db, 'github', String(ghUser.id))
      if (!user) {
        // First user becomes admin
        const isFirst = countUsers(db) === 0
        user = createUser(db, {
          provider: 'github',
          providerId: String(ghUser.id),
          displayName: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          role: isFirst ? 'admin' : 'user',
        })
      }

      const jwt = signJwt(
        { userId: user.id, displayName: user.display_name, role: user.role },
        config.jwtSecret
      )

      return reply.redirect(redirectAfterAuth(jwt, state))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: message })
    }
  })

  // --- Google OAuth routes ---

  app.get('/api/auth/google', async (request, reply) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      return reply.status(400).send({ error: 'Google OAuth is not configured' })
    }
    const { redirectTo } = request.query as { redirectTo?: string }
    const url = getGoogleOAuthUrl(
      config.googleClientId,
      config.baseUrl,
      encodeOAuthState({ redirectTo }),
    )
    return reply.redirect(url)
  })

  app.get('/api/auth/google/callback', async (request, reply) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      return reply.status(400).send({ error: 'Google OAuth is not configured' })
    }

    const { code, state } = request.query as { code?: string; state?: string }
    if (!code) {
      return reply.status(400).send({ error: 'Missing code parameter' })
    }

    try {
      const accessToken = await exchangeGoogleCode(config.googleClientId, config.googleClientSecret, code, config.baseUrl)
      const googleUser = await getGoogleUser(accessToken)

      let user = findUserByProvider(db, 'google', googleUser.id)
      if (!user) {
        // First user becomes admin
        const isFirst = countUsers(db) === 0
        user = createUser(db, {
          provider: 'google',
          providerId: googleUser.id,
          displayName: googleUser.name || googleUser.email,
          avatarUrl: googleUser.picture || null,
          role: isFirst ? 'admin' : 'user',
        })
      }

      const jwt = signJwt(
        { userId: user.id, displayName: user.display_name, role: user.role },
        config.jwtSecret
      )

      return reply.redirect(redirectAfterAuth(jwt, state))
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
    let user = findUserByProvider(db, 'dev', '0')
    if (!user) {
      user = createUser(db, {
        provider: 'dev',
        providerId: '0',
        displayName: 'dev-admin',
        avatarUrl: null,
        role: 'admin',
      })
    }

    const jwt = signJwt(
      { userId: user.id, displayName: user.display_name, role: user.role },
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
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      role: user.role,
    }
  })

  // --- Mobile push devices ---

  app.post('/api/mobile/push-devices', { preHandler: authPreHandler }, async (request, reply) => {
    const body = (request.body as {
      installationId?: string
      platform?: string
      provider?: string
      pushToken?: string
      deviceName?: string
    } | undefined) ?? {}

    const installationId = body.installationId?.trim()
    const platform = body.platform?.trim()
    const provider = body.provider?.trim()
    const pushToken = body.pushToken?.trim()

    if (!installationId || !platform || !provider || !pushToken) {
      return reply.status(400).send({
        error: 'Missing required fields: installationId, platform, provider, pushToken',
      })
    }

    if (platform !== 'android') {
      return reply.status(400).send({ error: 'Only Android push devices are currently supported' })
    }

    if (provider !== 'fcm') {
      return reply.status(400).send({ error: 'Only the FCM push provider is currently supported' })
    }

    upsertNotificationDevice(db, {
      installationId,
      userId: request.user!.userId,
      platform,
      provider,
      pushToken,
      deviceName: body.deviceName?.trim(),
    })

    return {
      ok: true,
      devices: findNotificationDevicesByUserId(db, request.user!.userId).length,
    }
  })

  app.delete('/api/mobile/push-devices/:installationId', { preHandler: authPreHandler }, async (request) => {
    const { installationId } = request.params as { installationId: string }
    deleteNotificationDevice(db, request.user!.userId, installationId)
    return { ok: true }
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
          lastSeenAt: a.last_seen_at ? Math.floor(a.last_seen_at / 1000) : null,
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
    if (!body?.token) {
      return reply.status(400).send({ error: 'Missing token' })
    }

    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex')
    const regToken = consumeRegistrationToken(db, tokenHash)

    if (!regToken) {
      return reply.status(400).send({ error: 'Invalid, expired, or already used registration token' })
    }

    const agentSecret = crypto.randomUUID()
    const agentSecretHash = await hashSecret(agentSecret)

    // Use provided name, or fall back to the name stored with the token
    const agentName = body.name || regToken.agent_name

    const agent = createAgent(db, {
      userId: regToken.user_id,
      name: agentName,
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

  app.patch('/api/agents/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { name?: string } | undefined

    if (!body?.name?.trim()) {
      return reply.status(400).send({ error: 'Missing name' })
    }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    renameAgent(db, id, body.name.trim())
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

    const session = await hub.requestSessionCreate(id, body.name)
    return { session }
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

    await hub.requestSessionKill(id, name)

    return { ok: true }
  })

  app.get('/api/agents/:id/repositories', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { path } = request.query as { path?: string }

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

    try {
      const response: RepositoryBrowseResponse = await hub.requestRepositoryBrowse(id, path)
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to browse repositories'
      return reply.status(400).send({ error: message })
    }
  })

  // --- Run routes ---

  // Start a thread
  app.post('/api/agents/:id/threads', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as StartRunRequest | undefined
    let attachments: RunImageAttachmentUpload[] = []

    try {
      attachments = normalizeAttachments(body?.attachments)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid image attachments'
      return reply.status(400).send({ error: message })
    }

    if (!body?.tool || !body?.repoPath || (!hasPromptContent(body.prompt) && attachments.length === 0)) {
      return reply.status(400).send({ error: 'Missing required fields: tool, repoPath, and prompt or attachments' })
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

    const runId = crypto.randomUUID()
    const turnId = crypto.randomUUID()
    const { run: runRow } = createRunWithInitialTurn(db, {
      runId,
      turnId,
      agentId: id,
      userId: request.user!.userId,
      tool: body.tool,
      repoPath: body.repoPath,
      prompt: body.prompt?.trim() ?? '',
      attachments,
    })

    // Send run-turn-start to agent
    const msg: ServerToAgentMessage = {
      type: 'run-turn-start',
      runId,
      turnId,
      tool: body.tool,
      repoPath: body.repoPath,
      prompt: body.prompt?.trim() ?? '',
      toolThreadId: runRow.tool_thread_id ?? undefined,
      attachments,
      options: body.options,
    }
    if (!hub.sendToAgent(id, msg)) {
      deleteRun(db, runId)
      return reply.status(503).send({
        error: 'Agent became unavailable before the thread could start',
      })
    }

    const response: RunDetailResponse = {
      run: runRowToRun(runRow),
      turns: findRunTurnDetails(db, runId),
    }
    return reply.status(201).send(response)
  })

  // List threads for an agent
  app.get('/api/agents/:id/threads', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const rows = findRunsByAgentId(db, id)
    const response: RunListResponse = { runs: rows.map(runRowToRun) }
    return response
  })

  // List all threads for current user
  app.get('/api/threads', { preHandler: authPreHandler }, async (request) => {
    const rows = findRunsByUserId(db, request.user!.userId)
    const response: RunListResponse = { runs: rows.map(runRowToRun) }
    return response
  })

  // Thread detail
  app.get('/api/agents/:id/threads/:threadId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.agent_id !== id) {
      return reply.status(404).send({ error: 'Thread not found' })
    }

    const response: RunDetailResponse = {
      run: runRowToRun(runRow),
      turns: findRunTurnDetails(db, threadId),
    }
    return response
  })

  app.post('/api/agents/:id/threads/:threadId/turns', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }
    const body = request.body as ContinueRunRequest | undefined
    let attachments: RunImageAttachmentUpload[] = []

    try {
      attachments = normalizeAttachments(body?.attachments)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid image attachments'
      return reply.status(400).send({ error: message })
    }

    if (!hasPromptContent(body?.prompt) && attachments.length === 0) {
      return reply.status(400).send({ error: 'Missing prompt or attachments' })
    }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.agent_id !== id) {
      return reply.status(404).send({ error: 'Thread not found' })
    }

    if (findActiveRunTurnByRunId(db, threadId)) {
      return reply.status(409).send({ error: 'Thread is still active' })
    }

    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

    const trimmedPrompt = body?.prompt?.trim() ?? ''
    const turnId = crypto.randomUUID()
    createRunTurn(db, {
      id: turnId,
      runId: threadId,
      prompt: trimmedPrompt,
      attachments,
    })

    const msg: ServerToAgentMessage = {
      type: 'run-turn-start',
      runId: threadId,
      turnId,
      tool: runRow.tool as StartRunRequest['tool'],
      repoPath: runRow.repo_path,
      prompt: trimmedPrompt,
      toolThreadId: runRow.tool_thread_id ?? undefined,
      attachments,
      options: body?.options,
    }

    if (!hub.sendToAgent(id, msg)) {
      deleteRunTurn(db, turnId)
      return reply.status(503).send({
        error: 'Agent became unavailable before the thread could continue',
      })
    }

    hub.broadcastRunSnapshot(db, threadId)

    return {
      run: runRowToRun(findRunById(db, threadId)!),
      turns: findRunTurnDetails(db, threadId),
    } satisfies RunDetailResponse
  })

  // Interrupt a thread
  app.post('/api/agents/:id/threads/:threadId/interrupt', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.agent_id !== id) {
      return reply.status(404).send({ error: 'Thread not found' })
    }

    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

    const activeTurn = findActiveRunTurnByRunId(db, threadId)
    if (!activeTurn) {
      return reply.status(409).send({ error: 'Thread is not active' })
    }

    const msg: ServerToAgentMessage = {
      type: 'run-turn-interrupt',
      runId: threadId,
      turnId: activeTurn.id,
    }
    if (!sendRunMessage(id, msg, reply)) {
      return
    }

    return { ok: true }
  })

  // Mark thread as read
  app.post('/api/agents/:id/threads/:threadId/read', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.agent_id !== id) {
      return reply.status(404).send({ error: 'Thread not found' })
    }

    markRunRead(db, threadId)

    return { ok: true }
  })

  // Delete a thread
  app.delete('/api/agents/:id/threads/:threadId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (agent.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your agent' })
    }

    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.agent_id !== id) {
      return reply.status(404).send({ error: 'Thread not found' })
    }

    const online = hub.getAgent(id)
    if (online) {
      const activeTurn = findActiveRunTurnByRunId(db, threadId)
      if (activeTurn && !sendRunMessage(id, { type: 'run-turn-kill', runId: threadId, turnId: activeTurn.id }, reply)) {
        return
      }
    }

    deleteRun(db, threadId)

    return { ok: true }
  })
}
