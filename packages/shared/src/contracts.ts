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

export interface RunImageAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}

export interface RunImageAttachmentUpload extends RunImageAttachment {
  base64: string
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
  | { type: 'run-status'; runId: string; turnId: string; status: RunStatus; summary?: string; hasDiff?: boolean; toolThreadId?: string }
  | { type: 'run-item'; runId: string; turnId: string; item: RunTimelineEventPayload }

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
  | {
      type: 'run-turn-start'
      runId: string
      turnId: string
      tool: RunTool
      repoPath: string
      prompt: string
      toolThreadId?: string
      attachments?: RunImageAttachmentUpload[]
      options?: RunTurnOptions
    }
  | { type: 'run-turn-interrupt'; runId: string; turnId: string }
  | { type: 'run-turn-kill'; runId: string; turnId: string }

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
  | 'queued'
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

export interface RunTurn {
  id: string
  runId: string
  index: number
  prompt: string
  attachments: RunImageAttachment[]
  status: RunStatus
  createdAt: number
  updatedAt: number
  summary?: string
  hasDiff: boolean
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

export interface RunTurnDetail extends RunTurn {
  items: RunTimelineEvent[]
}

// --- Run turn options (model / effort / session control) ---

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max'
export type CodexEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface RunTurnOptions {
  /** Model identifier (e.g. "claude-sonnet-4-6", "o4-mini"). */
  model?: string
  /** Effort level for Claude. */
  claudeEffort?: ClaudeEffort
  /** Reasoning effort level for Codex. */
  codexEffort?: CodexEffort
  /** If true, start a fresh session instead of resuming. Equivalent to /clear. */
  clearSession?: boolean
}

// --- Run REST API types ---

export interface StartRunRequest {
  tool: RunTool
  repoPath: string
  prompt: string
  attachments?: RunImageAttachmentUpload[]
  options?: RunTurnOptions
}

export interface RunListResponse {
  runs: Run[]
}

export interface RunDetailResponse {
  run: Run
  turns: RunTurnDetail[]
}

export interface ContinueRunRequest {
  prompt: string
  attachments?: RunImageAttachmentUpload[]
  options?: RunTurnOptions
}

export interface UpdateQueuedTurnRequest {
  prompt: string
}

// --- Run WebSocket event (Server → Browser) ---

export type RunEvent =
  | { type: 'run-status'; run: Run }
  | { type: 'run-turn'; runId: string; turn: RunTurn }
  | { type: 'run-item'; runId: string; turnId: string; item: RunTimelineEvent }
