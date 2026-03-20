import crypto from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from 'libsql'
import type {
  AgentListResponse,
  CreateRegistrationTokenResponse,
  RegisterAgentRequest,
  RegisterAgentResponse,
  RepositoryBrowseResponse,
  ContinueRunRequest,
  UpdateQueuedTurnRequest,
  RunImageAttachmentUpload,
  StartRunRequest,
  RunListResponse,
  RunDetailResponse,
  ServerToAgentMessage,
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  Project,
  Task,
  TaskStatus,
  RunTool,
  LlmConfig,
  CreateLlmConfigRequest,
  UpdateLlmConfigRequest,
  TaskStep,
  StepType,
  StepStatus,
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
  createQueuedRunTurn,
  createRunWithInitialTurn,
  createRunTurn,
  deleteQueuedTurnsByRunId,
  findRunById,
  findRunTurnById,
  findRunTurnDetails,
  findActiveRunTurnByRunId,
  findRunsByAgentId,
  findRunsByUserId,
  markRunRead,
  deleteRun,
  deleteRunTurn,
  updateQueuedTurnPrompt,
  upsertNotificationDevice,
  createProject,
  createTaskMessage,
  findMessagesByTaskId,
  findProjectById,
  findProjectsByUserId,
  updateProject,
  deleteProject,
  createTask,
  findTaskById,
  findTasksByProjectId,
  updateTaskPrompt,
  updateTaskStatus,
  updateTaskSummary,
  deleteTask,
  resetTaskToPending,
  findLlmConfigsByUser,
  findLlmConfigById,
  createLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  findStepsByTaskId,
} from './db.js'
import type { ProjectRow, TaskRow, TaskMessageRow, LlmConfigRow, TaskStepRow } from './db.js'
import type { AgentHub } from './agent-hub.js'
import { runRowToRun } from './agent-hub.js'
import type { TaskDispatcher } from './task-dispatcher.js'

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
  config: ServerConfig,
  taskDispatcher: TaskDispatcher,
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

    const trimmedPrompt = body?.prompt?.trim() ?? ''
    const turnId = crypto.randomUUID()
    const activeTurn = findActiveRunTurnByRunId(db, threadId)

    // If a turn is already running, queue the message for later
    if (activeTurn) {
      createQueuedRunTurn(db, {
        id: turnId,
        runId: threadId,
        prompt: trimmedPrompt,
        attachments,
      })
      hub.broadcastRunSnapshot(db, threadId, turnId)
      return {
        run: runRowToRun(findRunById(db, threadId)!),
        turns: findRunTurnDetails(db, threadId),
      } satisfies RunDetailResponse
    }

    // No active turn — also accept queued turns that need resuming
    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

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

  // Update a queued turn's prompt
  app.patch('/api/agents/:id/threads/:threadId/turns/:turnId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId, turnId } = request.params as { id: string; threadId: string; turnId: string }
    const body = request.body as UpdateQueuedTurnRequest | undefined

    if (!body?.prompt?.trim()) {
      return reply.status(400).send({ error: 'Missing prompt' })
    }

    const agent = findAgentById(db, id)
    if (!agent || agent.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const turn = findRunTurnById(db, turnId)
    if (!turn || turn.run_id !== threadId) {
      return reply.status(404).send({ error: 'Turn not found' })
    }

    const updated = updateQueuedTurnPrompt(db, turnId, body.prompt.trim())
    if (!updated) {
      return reply.status(409).send({ error: 'Turn is not queued' })
    }

    hub.broadcastRunSnapshot(db, threadId, turnId)
    return { ok: true }
  })

  // Delete a queued turn
  app.delete('/api/agents/:id/threads/:threadId/turns/:turnId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId, turnId } = request.params as { id: string; threadId: string; turnId: string }

    const agent = findAgentById(db, id)
    if (!agent || agent.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const turn = findRunTurnById(db, turnId)
    if (!turn || turn.run_id !== threadId || turn.status !== 'queued') {
      return reply.status(409).send({ error: 'Turn is not queued' })
    }

    deleteRunTurn(db, turnId)
    hub.broadcastRunSnapshot(db, threadId)
    return { ok: true }
  })

  // Discard all queued turns
  app.post('/api/agents/:id/threads/:threadId/discard-queue', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent || agent.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const deleted = deleteQueuedTurnsByRunId(db, threadId)
    hub.broadcastRunSnapshot(db, threadId)
    return { ok: true, deleted }
  })

  // Resume queue (dispatch next queued turn)
  app.post('/api/agents/:id/threads/:threadId/resume-queue', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, threadId } = request.params as { id: string; threadId: string }

    const agent = findAgentById(db, id)
    if (!agent || agent.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (findActiveRunTurnByRunId(db, threadId)) {
      return reply.status(409).send({ error: 'Thread is still active' })
    }

    const online = hub.getAgent(id)
    if (!online) {
      return reply.status(400).send({ error: 'Agent is offline' })
    }

    if (!hub.dispatchNextQueuedTurn(id, threadId, db)) {
      return reply.status(404).send({ error: 'No queued turns' })
    }

    return {
      run: runRowToRun(findRunById(db, threadId)!),
      turns: findRunTurnDetails(db, threadId),
    } satisfies RunDetailResponse
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

  // --- Conversion helpers ---

  function projectRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      repoPath: row.repo_path,
      agentId: row.agent_id,
      defaultTool: row.default_tool as RunTool,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  function taskRowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      prompt: row.prompt,
      status: row.status as TaskStatus,
      priority: row.priority,
      branchName: row.branch_name,
      worktreePath: row.worktree_path,
      runId: row.run_id,
      errorMessage: row.error_message,
      summary: row.summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      claimedAt: row.claimed_at,
      completedAt: row.completed_at,
    }
  }

  function llmConfigRowToLlmConfig(row: LlmConfigRow): LlmConfig {
    return {
      id: row.id,
      apiBaseUrl: row.api_base_url,
      apiKey: row.api_key,
      model: row.model,
      projectId: row.project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  function taskStepRowToTaskStep(row: TaskStepRow): TaskStep {
    return {
      id: row.id,
      taskId: row.task_id,
      type: row.type as StepType,
      label: row.label,
      status: row.status as StepStatus,
      detail: row.detail ?? undefined,
      toolName: row.tool_name,
      runId: row.run_id ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }
  }

  // --- Project routes ---

  app.post('/api/projects', { preHandler: authPreHandler }, async (request, reply) => {
    const body = request.body as CreateProjectRequest | undefined
    if (!body?.name?.trim() || !body?.repoPath?.trim() || !body?.agentId?.trim()) {
      return reply.status(400).send({ error: 'Missing required fields: name, repoPath, agentId' })
    }

    const agent = findAgentById(db, body.agentId)
    if (!agent || agent.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const project = createProject(db, {
      userId: request.user!.userId,
      agentId: body.agentId,
      name: body.name.trim(),
      description: body.description?.trim() ?? '',
      repoPath: body.repoPath.trim(),
      defaultTool: body.defaultTool ?? 'claude',
    })

    return reply.status(201).send({ project: projectRowToProject(project) })
  })

  app.get('/api/projects', { preHandler: authPreHandler }, async (request) => {
    const rows = findProjectsByUserId(db, request.user!.userId)
    return { projects: rows.map(projectRowToProject) }
  })

  app.get('/api/projects/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const tasks = findTasksByProjectId(db, id)
    return { project: projectRowToProject(project), tasks: tasks.map(taskRowToTask) }
  })

  app.patch('/api/projects/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as UpdateProjectRequest | undefined
    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    updateProject(db, id, {
      name: body?.name?.trim(),
      description: body?.description?.trim(),
      defaultTool: body?.defaultTool,
    })

    return { ok: true }
  })

  app.delete('/api/projects/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    deleteProject(db, id)
    return { ok: true }
  })

  // --- Task routes ---

  app.post('/api/projects/:id/tasks', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as CreateTaskRequest | undefined

    if (!body?.title?.trim()) {
      return reply.status(400).send({ error: 'Missing required field: title' })
    }

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const titleTrimmed = body.title.trim()
    const promptTrimmed = body.prompt?.trim() || titleTrimmed

    const task = createTask(db, {
      projectId: id,
      title: titleTrimmed,
      prompt: promptTrimmed,
      priority: body.priority ?? 0,
    })

    // Trigger dispatch for this project
    taskDispatcher.dispatchPendingTasksForProject(id)

    return reply.status(201).send({ task: taskRowToTask(task) })
  })

  app.get('/api/projects/:id/tasks', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const tasks = findTasksByProjectId(db, id)
    return { tasks: tasks.map(taskRowToTask) }
  })

  app.patch('/api/projects/:id/tasks/:taskId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }
    const body = request.body as UpdateTaskRequest | undefined

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    if (task.status !== 'pending') {
      return reply.status(409).send({ error: 'Can only edit pending tasks' })
    }

    updateTaskPrompt(db, taskId, {
      title: body?.title?.trim(),
      prompt: body?.prompt?.trim(),
      priority: body?.priority,
    })

    return { ok: true }
  })

  app.delete('/api/projects/:id/tasks/:taskId', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    deleteTask(db, taskId)
    return { ok: true }
  })

  app.post('/api/projects/:id/tasks/:taskId/retry', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }
    const body = request.body as { prompt?: string } | undefined

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    if (task.status !== 'failed') {
      return reply.status(409).send({ error: 'Can only retry failed tasks' })
    }

    resetTaskToPending(db, taskId, body?.prompt?.trim())
    taskDispatcher.dispatchPendingTasksForProject(id)

    return { task: taskRowToTask(findTaskById(db, taskId)!) }
  })

  // --- Task Steps ---

  app.get('/api/projects/:id/tasks/:taskId/steps', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    const steps = findStepsByTaskId(db, taskId)
    return { steps: steps.map(taskStepRowToTaskStep) }
  })

  // --- Task Messages ---

  // Get messages for a task
  app.get('/api/projects/:id/tasks/:taskId/messages', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    const rows = findMessagesByTaskId(db, taskId)
    const messages = rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }))

    return { messages }
  })

  // User sends a message to a task
  app.post('/api/projects/:id/tasks/:taskId/messages', { preHandler: authPreHandler }, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string }
    const { content } = request.body as { content: string }

    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Content is required' })
    }

    const project = findProjectById(db, id)
    if (!project || project.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    const task = findTaskById(db, taskId)
    if (!task || task.project_id !== id) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    // Store user message
    const msgRow = createTaskMessage(db, taskId, 'user', content.trim())
    const message = {
      id: msgRow.id,
      taskId: msgRow.task_id,
      role: msgRow.role,
      content: msgRow.content,
      createdAt: msgRow.created_at,
    }

    if (task.status === 'waiting') {
      // Agent is waiting — send reply to agent, update status to running
      updateTaskStatus(db, taskId, 'running')
      hub.sendUserReplyToAgent(db, taskId)
      hub.broadcastTaskSnapshot(db, taskId)
    } else if (task.status === 'completed' || task.status === 'failed') {
      // Task is done — re-dispatch with conversation history
      updateTaskStatus(db, taskId, 'dispatched')
      // Clear previous summary/error
      updateTaskSummary(db, taskId, '')

      // Get all messages for conversation history
      const allMessages = findMessagesByTaskId(db, taskId)
      const conversationHistory = allMessages.map(m => ({
        role: m.role as 'agent' | 'user',
        content: m.content,
      }))

      // Re-dispatch via task dispatcher
      taskDispatcher.dispatchSingleTask(db, taskId, conversationHistory)
    }

    return reply.status(201).send({ message })
  })

  // --- LLM Config routes ---

  app.get('/api/llm-configs', { preHandler: authPreHandler }, async (request, reply) => {
    const configs = findLlmConfigsByUser(db, request.user!.userId)
    return reply.send({ configs: configs.map(llmConfigRowToLlmConfig) })
  })

  app.post('/api/llm-configs', { preHandler: authPreHandler }, async (request, reply) => {
    const body = request.body as CreateLlmConfigRequest | undefined

    if (!body?.apiBaseUrl?.trim() || !body?.apiKey?.trim() || !body?.model?.trim()) {
      return reply.status(400).send({ error: 'Missing required fields: apiBaseUrl, apiKey, model' })
    }

    const config = createLlmConfig(db, request.user!.userId, {
      api_base_url: body.apiBaseUrl.trim(),
      api_key: body.apiKey.trim(),
      model: body.model.trim(),
      project_id: body.projectId?.trim(),
    })

    return reply.status(201).send({ config: llmConfigRowToLlmConfig(config) })
  })

  app.patch('/api/llm-configs/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as UpdateLlmConfigRequest | undefined

    const config = findLlmConfigById(db, id)
    if (!config) {
      return reply.status(404).send({ error: 'LLM config not found' })
    }

    if (config.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your config' })
    }

    updateLlmConfig(db, id, {
      api_base_url: body?.apiBaseUrl?.trim(),
      api_key: body?.apiKey?.trim(),
      model: body?.model?.trim(),
    })

    const updated = findLlmConfigById(db, id)!
    return { config: llmConfigRowToLlmConfig(updated) }
  })

  app.delete('/api/llm-configs/:id', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const config = findLlmConfigById(db, id)
    if (!config) {
      return reply.status(404).send({ error: 'LLM config not found' })
    }

    if (config.user_id !== request.user!.userId) {
      return reply.status(403).send({ error: 'Not your config' })
    }

    deleteLlmConfig(db, id)
    return reply.status(204).send()
  })
}
