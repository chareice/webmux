import {
  AgentListResponse,
  Run,
  RunDetailResponse,
  RunListResponse,
  RunTool,
  StartRunRequest,
} from './types';

let _serverUrl = '';
let _token = '';

export function setServerUrl(url: string): void {
  // Remove trailing slash
  _serverUrl = url.replace(/\/+$/, '');
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (_token) {
    headers.Authorization = `Bearer ${_token}`;
  }

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

export function getOAuthUrl(): string {
  const redirectTo = `webmux://auth?server=${encodeURIComponent(_serverUrl)}`;
  return `${_serverUrl}/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`;
}

// --- Agents ---

export async function listAgents(): Promise<AgentListResponse> {
  return fetchApi<AgentListResponse>('/api/agents');
}

// --- Runs ---

export async function startRun(
  agentId: string,
  request: StartRunRequest,
): Promise<Run> {
  const response = await fetchApi<{ run: Run }>(
    `/api/agents/${agentId}/runs`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
  return response.run;
}

export async function listRuns(agentId: string): Promise<Run[]> {
  const response = await fetchApi<RunListResponse>(
    `/api/agents/${agentId}/runs`,
  );
  return response.runs;
}

export async function listAllRuns(): Promise<Run[]> {
  const response = await fetchApi<RunListResponse>('/api/runs');
  return response.runs;
}

export async function getRunDetail(
  agentId: string,
  runId: string,
): Promise<RunDetailResponse> {
  return fetchApi<RunDetailResponse>(
    `/api/agents/${agentId}/runs/${runId}`,
  );
}

export async function sendInput(
  agentId: string,
  runId: string,
  input: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/runs/${runId}/input`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export async function interruptRun(
  agentId: string,
  runId: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/runs/${runId}/interrupt`, {
    method: 'POST',
  });
}

export async function approveRun(
  agentId: string,
  runId: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/runs/${runId}/approve`, {
    method: 'POST',
  });
}

export async function rejectRun(
  agentId: string,
  runId: string,
): Promise<void> {
  await fetchApi(`/api/agents/${agentId}/runs/${runId}/reject`, {
    method: 'POST',
  });
}

// --- WebSocket ---

export function connectRunWebSocket(
  runId: string,
  onMessage: (event: unknown) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
): WebSocket {
  const wsProtocol = _serverUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = _serverUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProtocol}://${wsHost}/ws/run?runId=${runId}&token=${_token}`;

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
