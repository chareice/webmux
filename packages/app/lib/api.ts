import { Platform } from 'react-native'
import type {
  AgentListResponse,
  ContinueRunRequest,
  CreateLlmConfigRequest,
  CreateProjectActionRequest,
  CreateProjectRequest,
  CreateRegistrationTokenResponse,
  CreateTaskRequest,
  GenerateProjectActionRequest,
  InstructionsResponse,
  LlmConfig,
  Project,
  ProjectAction,
  ProjectActionListResponse,
  ProjectDetailResponse,
  ProjectListResponse,
  RepositoryBrowseResponse,
  Run,
  RunDetailResponse,
  RunImageAttachmentUpload,
  RunListResponse,
  RunTool,
  StartRunRequest,
  Task,
  TaskMessage,
  TaskStep,
  UpdateLlmConfigRequest,
  UpdateProjectActionRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from '@webmux/shared'

// --- User type (not in @webmux/shared) ---

export interface User {
  id: string
  displayName: string
  avatarUrl: string | null
  role: string
}

// --- Push device types (not in @webmux/shared) ---

export type PushPlatform = 'android'
export type PushProvider = 'fcm'

export interface RegisterPushDeviceRequest {
  installationId: string
  platform: PushPlatform
  provider: PushProvider
  pushToken: string
  deviceName?: string
}

// --- Module-level state ---

let _baseUrl = ''
let _token = ''

// --- Configuration ---

export function configure(baseUrl: string, token: string): void {
  _baseUrl = baseUrl.replace(/\/+$/, '')
  _token = token
}

export function getBaseUrl(): string {
  return _baseUrl
}

export function getToken(): string {
  return _token
}

export function setBaseUrl(baseUrl: string): void {
  _baseUrl = baseUrl.replace(/\/+$/, '')
}

export function setToken(token: string): void {
  _token = token
}

// --- Internal request helper ---

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // On web, empty baseUrl is valid (same-origin relative paths).
  // On native, baseUrl must be set explicitly.
  if (!_baseUrl && Platform.OS !== 'web') {
    throw new Error('API base URL is not configured')
  }

  const url = `${_baseUrl}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (_token) {
    headers['Authorization'] = `Bearer ${_token}`
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`API error ${response.status}: ${text || response.statusText}`)
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T
  }

  return response.json()
}

// --- Auth ---

export function getOAuthUrl(provider: 'github' | 'google'): string {
  if (Platform.OS === 'web') {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}?provider=${provider}`
    return `${_baseUrl}/api/auth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}`
  }
  const redirectTo = `webmux://auth?server=${encodeURIComponent(_baseUrl)}&provider=${provider}`
  return `${_baseUrl}/api/auth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}`
}

export async function getMe(): Promise<User> {
  return request<User>('/api/auth/me')
}

export async function devLogin(): Promise<{ token: string } | null> {
  try {
    return await request<{ token: string }>('/api/auth/dev')
  } catch {
    return null
  }
}

// --- Agents ---

export async function listAgents(): Promise<AgentListResponse> {
  return request<AgentListResponse>('/api/agents')
}

export async function deleteAgent(agentId: string): Promise<void> {
  await request(`/api/agents/${agentId}`, { method: 'DELETE' })
}

export async function renameAgent(agentId: string, name: string): Promise<void> {
  await request(`/api/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function createRegistrationToken(): Promise<CreateRegistrationTokenResponse> {
  return request<CreateRegistrationTokenResponse>('/api/agents/register-token', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function browseAgentRepositories(
  agentId: string,
  path?: string,
): Promise<RepositoryBrowseResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  return request<RepositoryBrowseResponse>(
    `/api/agents/${agentId}/repositories${query}`,
  )
}

// --- Threads ---

export async function startThread(
  agentId: string,
  req: StartRunRequest,
): Promise<Run> {
  const response = await request<{ run: Run }>(
    `/api/agents/${agentId}/threads`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  )
  return response.run
}

export async function listThreads(agentId: string): Promise<Run[]> {
  const response = await request<RunListResponse>(
    `/api/agents/${agentId}/threads`,
  )
  return response.runs
}

export async function listAllThreads(): Promise<Run[]> {
  const response = await request<RunListResponse>('/api/threads')
  return response.runs
}

export async function getThreadDetail(
  agentId: string,
  threadId: string,
): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(
    `/api/agents/${agentId}/threads/${threadId}`,
  )
}

export async function continueThread(
  agentId: string,
  threadId: string,
  req: ContinueRunRequest,
): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(
    `/api/agents/${agentId}/threads/${threadId}/turns`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  )
}

export async function interruptThread(
  agentId: string,
  threadId: string,
): Promise<void> {
  await request(`/api/agents/${agentId}/threads/${threadId}/interrupt`, {
    method: 'POST',
  })
}

export async function deleteThread(
  agentId: string,
  threadId: string,
): Promise<void> {
  await request(`/api/agents/${agentId}/threads/${threadId}`, {
    method: 'DELETE',
  })
}

// --- Turn Queue ---

export async function updateQueuedTurn(
  agentId: string,
  threadId: string,
  turnId: string,
  prompt: string,
): Promise<void> {
  await request(
    `/api/agents/${agentId}/threads/${threadId}/turns/${turnId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ prompt }),
    },
  )
}

export async function deleteQueuedTurn(
  agentId: string,
  threadId: string,
  turnId: string,
): Promise<void> {
  await request(
    `/api/agents/${agentId}/threads/${threadId}/turns/${turnId}`,
    { method: 'DELETE' },
  )
}

export async function resumeQueue(
  agentId: string,
  threadId: string,
): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(
    `/api/agents/${agentId}/threads/${threadId}/resume-queue`,
    { method: 'POST' },
  )
}

export async function discardQueue(
  agentId: string,
  threadId: string,
): Promise<void> {
  await request(
    `/api/agents/${agentId}/threads/${threadId}/discard-queue`,
    { method: 'POST' },
  )
}

// --- Projects ---

export async function listProjects(): Promise<ProjectListResponse> {
  return request<ProjectListResponse>('/api/projects')
}

export async function createProject(
  req: CreateProjectRequest,
): Promise<{ project: Project }> {
  return request<{ project: Project }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function getProjectDetail(
  projectId: string,
): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(`/api/projects/${projectId}`)
}

export async function updateProject(
  projectId: string,
  req: UpdateProjectRequest,
): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export async function deleteProject(projectId: string): Promise<void> {
  await request(`/api/projects/${projectId}`, { method: 'DELETE' })
}

// --- Tasks ---

export async function createTask(
  projectId: string,
  req: CreateTaskRequest,
): Promise<{ task: Task }> {
  return request<{ task: Task }>(
    `/api/projects/${projectId}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  )
}

export async function updateTask(
  projectId: string,
  taskId: string,
  req: UpdateTaskRequest,
): Promise<{ task: Task }> {
  return request<{ task: Task }>(
    `/api/projects/${projectId}/tasks/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(req),
    },
  )
}

export async function deleteTask(
  projectId: string,
  taskId: string,
): Promise<void> {
  await request(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export async function retryTask(
  projectId: string,
  taskId: string,
): Promise<{ task: Task }> {
  return request<{ task: Task }>(
    `/api/projects/${projectId}/tasks/${taskId}/retry`,
    { method: 'POST' },
  )
}

export async function completeTask(
  projectId: string,
  taskId: string,
): Promise<void> {
  await request(
    `/api/projects/${projectId}/tasks/${taskId}/complete`,
    { method: 'POST' },
  )
}

export async function interruptTask(
  projectId: string,
  taskId: string,
): Promise<void> {
  await request(
    `/api/projects/${projectId}/tasks/${taskId}/interrupt`,
    { method: 'POST' },
  )
}

export async function getTaskSteps(
  projectId: string,
  taskId: string,
): Promise<TaskStep[]> {
  const response = await request<{ steps: TaskStep[] }>(
    `/api/projects/${projectId}/tasks/${taskId}/steps`,
  )
  return response.steps
}

export async function getTaskMessages(
  projectId: string,
  taskId: string,
): Promise<TaskMessage[]> {
  const response = await request<{ messages: TaskMessage[] }>(
    `/api/projects/${projectId}/tasks/${taskId}/messages`,
  )
  return response.messages
}

export async function sendTaskMessage(
  projectId: string,
  taskId: string,
  content: string,
  attachments?: RunImageAttachmentUpload[],
): Promise<{ message: TaskMessage }> {
  const body: { content: string; attachments?: RunImageAttachmentUpload[] } = { content }
  if (attachments && attachments.length > 0) {
    body.attachments = attachments
  }
  return request<{ message: TaskMessage }>(
    `/api/projects/${projectId}/tasks/${taskId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

// --- LLM Config ---

export async function listLlmConfigs(): Promise<{ configs: LlmConfig[] }> {
  return request<{ configs: LlmConfig[] }>('/api/llm-configs')
}

export async function createLlmConfig(
  req: CreateLlmConfigRequest,
): Promise<{ config: LlmConfig }> {
  return request<{ config: LlmConfig }>('/api/llm-configs', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function updateLlmConfig(
  configId: string,
  req: UpdateLlmConfigRequest,
): Promise<{ config: LlmConfig }> {
  return request<{ config: LlmConfig }>(`/api/llm-configs/${configId}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export async function deleteLlmConfig(configId: string): Promise<void> {
  await request(`/api/llm-configs/${configId}`, { method: 'DELETE' })
}

// --- Instructions ---

export async function getInstructions(
  agentId: string,
  tool: RunTool,
): Promise<InstructionsResponse> {
  return request<InstructionsResponse>(
    `/api/agents/${agentId}/instructions/${tool}`,
  )
}

export async function saveInstructions(
  agentId: string,
  tool: RunTool,
  content: string,
): Promise<void> {
  await request(`/api/agents/${agentId}/instructions/${tool}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// --- Project Actions ---

export async function listProjectActions(
  projectId: string,
): Promise<ProjectActionListResponse> {
  return request<ProjectActionListResponse>(
    `/api/projects/${projectId}/actions`,
  )
}

export async function createProjectAction(
  projectId: string,
  req: CreateProjectActionRequest,
): Promise<{ action: ProjectAction }> {
  return request<{ action: ProjectAction }>(
    `/api/projects/${projectId}/actions`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  )
}

export async function updateProjectAction(
  projectId: string,
  actionId: string,
  req: UpdateProjectActionRequest,
): Promise<{ action: ProjectAction }> {
  return request<{ action: ProjectAction }>(
    `/api/projects/${projectId}/actions/${actionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(req),
    },
  )
}

export async function deleteProjectAction(
  projectId: string,
  actionId: string,
): Promise<void> {
  await request(`/api/projects/${projectId}/actions/${actionId}`, {
    method: 'DELETE',
  })
}

export async function generateProjectAction(
  projectId: string,
  req: GenerateProjectActionRequest,
): Promise<{ action: ProjectAction }> {
  return request<{ action: ProjectAction }>(
    `/api/projects/${projectId}/actions/generate`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  )
}

export async function runProjectAction(
  projectId: string,
  actionId: string,
): Promise<{ runId: string }> {
  return request<{ runId: string }>(
    `/api/projects/${projectId}/actions/${actionId}/run`,
    { method: 'POST' },
  )
}

// --- Push Devices ---

export async function registerPushDevice(
  req: RegisterPushDeviceRequest,
): Promise<void> {
  await request('/api/mobile/push-devices', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function unregisterPushDevice(
  installationId: string,
): Promise<void> {
  await request(
    `/api/mobile/push-devices/${encodeURIComponent(installationId)}`,
    { method: 'DELETE' },
  )
}

// --- WebSocket ---

export function connectThreadWebSocket(
  threadId: string,
  onMessage: (event: unknown) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
): WebSocket {
  const wsProtocol = _baseUrl.startsWith('https') ? 'wss' : 'ws'
  const wsHost = _baseUrl.replace(/^https?:\/\//, '')
  const wsUrl = `${wsProtocol}://${wsHost}/ws/thread?threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(_token)}`

  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)
      onMessage(data)
    } catch {
      // Ignore malformed messages
    }
  }

  ws.onerror = (error: Event) => {
    onError?.(error)
  }

  ws.onclose = () => {
    onClose?.()
  }

  return ws
}

export function connectProjectWebSocket(
  projectId: string,
  onMessage: (event: unknown) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
): WebSocket {
  const wsProtocol = _baseUrl.startsWith('https') ? 'wss' : 'ws'
  const wsHost = _baseUrl.replace(/^https?:\/\//, '')
  const wsUrl = `${wsProtocol}://${wsHost}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(_token)}`

  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)
      onMessage(data)
    } catch {
      // Ignore malformed messages
    }
  }

  ws.onerror = (error: Event) => {
    onError?.(error)
  }

  ws.onclose = () => {
    onClose?.()
  }

  return ws
}
