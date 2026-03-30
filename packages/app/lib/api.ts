import { Platform } from 'react-native'
import type {
  AgentListResponse,
  ContinueRunRequest,
  CreateRegistrationTokenResponse,
  ImportableSessionListResponse,
  ImportableSessionSummary,
  InstructionsResponse,
  RepositoryBrowseResponse,
  Run,
  RunDetailResponse,
  RunListResponse,
  RunTool,
  StartRunRequest,
} from '@webmux/shared'
import {
  buildInstructionsPath,
  buildSaveInstructionsBody,
} from './instructions-api'
import { buildImportableSessionsPath } from './importable-sessions-api'
import { resolveRegistrationTokenResponse } from './registration-utils'

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

// --- QR Login ---

export interface QrCreateResponse {
  sessionId: string
  qrUrl: string
}

export async function createQrSession(): Promise<QrCreateResponse> {
  return request<QrCreateResponse>('/api/auth/qr/create', { method: 'POST' })
}

export async function confirmQrSession(sessionId: string): Promise<void> {
  await request('/api/auth/qr/confirm', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
}

export function connectQrWebSocket(
  sessionId: string,
  onMessage: (data: { type: string; token?: string; message?: string }) => void,
  onClose?: () => void,
): WebSocket {
  const isSecure = _baseUrl
    ? _baseUrl.startsWith('https')
    : typeof window !== 'undefined' && window.location.protocol === 'https:'
  const wsProtocol = isSecure ? 'wss' : 'ws'
  const host = _baseUrl.replace(/^https?:\/\//, '') || window.location.host
  const wsUrl = `${wsProtocol}://${host}/ws/qr/${encodeURIComponent(sessionId)}`

  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string)
      onMessage(data)
    } catch {
      // Ignore malformed messages
    }
  }

  ws.onclose = () => {
    onClose?.()
  }

  return ws
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
  if (!_baseUrl && Platform.OS !== 'web') {
    throw new Error('API base URL is not configured')
  }

  const response = await fetch(`${_baseUrl}/api/agents/register-token`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: {
      'Content-Type': 'application/json',
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`API error ${response.status}: ${text || response.statusText}`)
  }

  const data = await response.json() as CreateRegistrationTokenResponse
  return resolveRegistrationTokenResponse(
    data,
    response.headers.get('x-webmux-server-url'),
  )
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

export async function listImportableSessions(
  agentId: string,
  tool: RunTool,
  repoPath: string,
): Promise<ImportableSessionSummary[]> {
  const response = await request<ImportableSessionListResponse>(
    buildImportableSessionsPath(agentId, tool, repoPath),
  )
  return response.sessions
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

// --- Instructions ---

export async function getInstructions(
  agentId: string,
  tool: RunTool,
): Promise<InstructionsResponse> {
  return request<InstructionsResponse>(buildInstructionsPath(agentId, tool))
}

export async function saveInstructions(
  agentId: string,
  tool: RunTool,
  content: string,
): Promise<void> {
  await request(buildInstructionsPath(agentId, tool), {
    method: 'PUT',
    body: buildSaveInstructionsBody(tool, content),
  })
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

