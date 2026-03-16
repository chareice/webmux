import {
  AgentListResponse,
  ContinueRunRequest,
  RepositoryBrowseResponse,
  Run,
  RunDetailResponse,
  RunListResponse,
  RunTool,
  StartRunRequest,
} from './types';
import { normalizeServerUrl } from './server-url';
import { normalizeRunDetailResponse } from './run-detail-response';
import { buildApiHeaders } from './api-request';

let _serverUrl = '';
let _token = '';

export type OAuthProvider = 'github' | 'google';

export function setServerUrl(url: string): void {
  _serverUrl = normalizeServerUrl(url);
}

export function getServerUrl(): string {
  return _serverUrl;
}

export function setToken(jwt: string): void {
  _token = jwt;
}

export function getToken(): string {
  return _token;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  if (!_serverUrl) {
    throw new Error('Server URL is not configured');
  }

  const url = `${_serverUrl}${path}`;
  const headers = buildApiHeaders(options, _token);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${text || response.statusText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// --- Auth ---

export function getOAuthUrl(provider: OAuthProvider): string {
  const redirectTo = `webmux://auth?server=${encodeURIComponent(_serverUrl)}&provider=${provider}`;
  return `${_serverUrl}/api/auth/${provider}?redirectTo=${encodeURIComponent(redirectTo)}`;
}

// --- Agents ---

export async function listAgents(): Promise<AgentListResponse> {
  return fetchApi<AgentListResponse>('/api/agents');
}

export async function browseAgentRepositories(
  agentId: string,
  repositoryPath?: string,
): Promise<RepositoryBrowseResponse> {
  const query = repositoryPath
    ? `?path=${encodeURIComponent(repositoryPath)}`
    : '';

  return fetchApi<RepositoryBrowseResponse>(
    `/api/agents/${agentId}/repositories${query}`,
  );
}

// --- Threads ---

export async function startThread(
  agentId: string,
  request: StartRunRequest,
): Promise<Run> {
  const response = await fetchApi<{ run: Run }>(
    `/api/agents/${agentId}/threads`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
  return response.run;
}

export async function listThreads(agentId: string): Promise<Run[]> {
  const response = await fetchApi<RunListResponse>(
    `/api/agents/${agentId}/threads`,
  );
  return response.runs;
}

export async function listAllThreads(): Promise<Run[]> {
  const response = await fetchApi<RunListResponse>('/api/threads');
  return response.runs;
}

export async function getThreadDetail(
  agentId: string,
  threadId: string,
): Promise<RunDetailResponse> {
  const response = await fetchApi<RunDetailResponse>(
    `/api/agents/${agentId}/threads/${threadId}`,
  );
  return normalizeRunDetailResponse(response);
}

export async function continueThread(
  agentId: string,
  threadId: string,
  request: ContinueRunRequest,
): Promise<RunDetailResponse> {
  const response = await fetchApi<RunDetailResponse>(
    `/api/agents/${agentId}/threads/${threadId}/turns`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
  return normalizeRunDetailResponse(response);
}

export async function interruptThread(
  agentId: string,
  threadId: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/threads/${threadId}/interrupt`, {
    method: 'POST',
  });
}

export async function deleteThread(
  agentId: string,
  threadId: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/threads/${threadId}`, {
    method: 'DELETE',
  });
}

// --- WebSocket ---

export function connectThreadWebSocket(
  threadId: string,
  onMessage: (event: unknown) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
): WebSocket {
  const wsProtocol = _serverUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = _serverUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProtocol}://${wsHost}/ws/thread?threadId=${threadId}&token=${_token}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event: WebSocketMessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onerror = (error: Event) => {
    onError?.(error);
  };

  ws.onclose = () => {
    onClose?.();
  };

  return ws;
}
