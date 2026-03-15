// Duplicated from @webmux/shared because React Native cannot resolve
// workspace packages directly.

export type RunTool = 'codex' | 'claude';

export type RunStatus =
  | 'starting'
  | 'running'
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
}

export type RunTimelineEventStatus = 'info' | 'success' | 'warning' | 'error';

export type RunTimelineEventPayload =
  | {
      type: 'message';
      role: 'assistant' | 'user' | 'system';
      text: string;
    }
  | {
      type: 'command';
      status: 'started' | 'completed' | 'failed';
      command: string;
      output: string;
      exitCode: number | null;
    }
  | {
      type: 'activity';
      status: RunTimelineEventStatus;
      label: string;
      detail?: string;
    };

export type RunTimelineEvent = RunTimelineEventPayload & {
  id: number;
  createdAt: number;
};

export interface AgentInfo {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastSeenAt: number | null;
}

export interface RepositoryEntry {
  name: string;
  path: string;
  kind: 'directory' | 'repository';
}

export interface RepositoryBrowseResponse {
  currentPath: string;
  parentPath: string | null;
  entries: RepositoryEntry[];
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
  items: RunTimelineEvent[];
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
  | { type: 'run-item'; runId: string; item: RunTimelineEvent };
