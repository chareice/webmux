// Duplicated from @webmux/shared because React Native cannot resolve
// workspace packages directly.

export type RunTool = 'codex' | 'claude';

export type RunStatus =
  | 'starting'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'success'
  | 'failed'
  | 'interrupted';

export interface Run {
  id: string;
  agentId: string;
  tool: RunTool;
  repoPath: string;
  branch: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  hasDiff: boolean;
  unread: boolean;
  tmuxSession: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastSeenAt: number | null;
}

export interface StartRunRequest {
  tool: RunTool;
  repoPath: string;
  prompt: string;
}

export interface RunListResponse {
  runs: Run[];
}

export interface RunDetailResponse {
  run: Run;
}

export interface AgentListResponse {
  agents: AgentInfo[];
}

export interface LoginResponse {
  token: string;
}

// Server -> Browser (run WebSocket events)
export type RunEvent =
  | { type: 'run-status'; run: Run }
  | { type: 'run-output'; runId: string; data: string };
