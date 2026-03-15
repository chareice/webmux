export interface SessionSummary {
  name: string
  windows: number
  attachedClients: number
  createdAt: number
  lastActivityAt: number
  path: string
  preview: string[]
  currentCommand: string
}

export interface AgentInfo {
  id: string
  name: string
  status: 'online' | 'offline'
  lastSeenAt: number | null
}

export interface AgentUpgradePolicy {
  packageName: string
  targetVersion?: string
  minimumVersion?: string
}

export interface RepositoryEntry {
  name: string
  path: string
  kind: 'directory' | 'repository'
}

export interface RepositoryBrowseResponse {
  currentPath: string
  parentPath: string | null
  entries: RepositoryEntry[]
}

// Agent → Server
export type AgentMessage =
  | { type: 'auth'; agentId: string; agentSecret: string; version?: string }
  | { type: 'heartbeat' }
  | { type: 'sessions-sync'; sessions: SessionSummary[] }
  | { type: 'command-result'; requestId: string; ok: true; session?: SessionSummary }
  | { type: 'command-result'; requestId: string; ok: false; error: string }
  | { type: 'repository-browse-result'; requestId: string; ok: true; currentPath: string; parentPath: string | null; entries: RepositoryEntry[] }
  | { type: 'repository-browse-result'; requestId: string; ok: false; error: string }
  | { type: 'terminal-output'; browserId: string; data: string }
  | { type: 'terminal-ready'; browserId: string; sessionName: string }
  | { type: 'terminal-exit'; browserId: string; exitCode: number }
  | { type: 'error'; browserId?: string; message: string }
  | { type: 'run-status'; runId: string; status: RunStatus; summary?: string; hasDiff?: boolean }
  | { type: 'run-item'; runId: string; item: RunTimelineEventPayload }

// Server → Agent
export type ServerToAgentMessage =
  | { type: 'auth-ok'; upgradePolicy?: AgentUpgradePolicy }
  | { type: 'auth-fail'; message: string }
  | { type: 'sessions-list' }
  | { type: 'terminal-attach'; browserId: string; sessionName: string; cols: number; rows: number }
  | { type: 'terminal-detach'; browserId: string }
  | { type: 'terminal-input'; browserId: string; data: string }
  | { type: 'terminal-resize'; browserId: string; cols: number; rows: number }
  | { type: 'session-create'; requestId: string; name: string }
  | { type: 'session-kill'; requestId: string; name: string }
  | { type: 'repository-browse'; requestId: string; path?: string }
  | { type: 'run-start'; runId: string; tool: RunTool; repoPath: string; prompt: string }
  | { type: 'run-interrupt'; runId: string }
  | { type: 'run-kill'; runId: string }

// Browser → Server
export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// Server → Browser
export type TerminalServerMessage =
  | { type: 'ready'; sessionName: string }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }

// Server → Browser (events WebSocket)
export type SessionEvent = {
  type: 'sessions-sync'
  agentId: string
  sessions: SessionSummary[]
}

// REST API types

export interface LoginResponse {
  token: string
}

export interface AgentListResponse {
  agents: AgentInfo[]
}

export interface CreateRegistrationTokenResponse {
  token: string
  expiresAt: number
}

export interface RegisterAgentRequest {
  token: string
  name?: string
}

export interface RegisterAgentResponse {
  agentId: string
  agentSecret: string
}

export interface CreateSessionRequest {
  name: string
}

export interface CreateSessionResponse {
  session: SessionSummary
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
}

export const DEFAULT_TERMINAL_SIZE = {
  cols: 120,
  rows: 36,
} as const

// --- Run types ---

export type RunTool = 'codex' | 'claude'

export type RunStatus =
  | 'starting'
  | 'running'
  | 'success'
  | 'failed'
  | 'interrupted'

export interface Run {
  id: string
  agentId: string
  tool: RunTool
  repoPath: string
  branch: string
  prompt: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  summary?: string
  hasDiff: boolean
  unread: boolean
}

export type RunTimelineEventStatus = 'info' | 'success' | 'warning' | 'error'

export type RunTimelineEventPayload =
  | {
      type: 'message'
      role: 'assistant' | 'user' | 'system'
      text: string
    }
  | {
      type: 'command'
      status: 'started' | 'completed' | 'failed'
      command: string
      output: string
      exitCode: number | null
    }
  | {
      type: 'activity'
      status: RunTimelineEventStatus
      label: string
      detail?: string
    }

export type RunTimelineEvent = RunTimelineEventPayload & {
  id: number
  createdAt: number
}

// --- Run REST API types ---

export interface StartRunRequest {
  tool: RunTool
  repoPath: string
  prompt: string
}

export interface RunListResponse {
  runs: Run[]
}

export interface RunDetailResponse {
  run: Run
  items: RunTimelineEvent[]
}

// --- Run WebSocket event (Server → Browser) ---

export type RunEvent =
  | { type: 'run-status'; run: Run }
  | { type: 'run-item'; runId: string; item: RunTimelineEvent }
