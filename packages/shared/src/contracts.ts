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
  | { type: 'repository-browse-result'; requestId: string; ok: true; currentPath: string; parentPath: string | null; entries: RepositoryEntry[] }
  | { type: 'repository-browse-result'; requestId: string; ok: false; error: string }
  | { type: 'error'; message: string }
  | { type: 'run-status'; runId: string; turnId: string; status: RunStatus; summary?: string; hasDiff?: boolean; toolThreadId?: string }
  | { type: 'run-item'; runId: string; turnId: string; item: RunTimelineEventPayload }
  | { type: 'task-claimed'; taskId: string; branchName?: string; worktreePath?: string }
  | { type: 'task-running'; taskId: string; runId: string; turnId: string; branchName?: string; worktreePath?: string }
  | { type: 'task-completed'; taskId: string; summary: string }
  | { type: 'task-failed'; taskId: string; error: string }
  | { type: 'task-step-update'; taskId: string; step: Omit<TaskStep, 'taskId'> }
  | { type: 'task-message'; taskId: string; message: { id: string; role: 'agent'; content: string; createdAt: number } }
  | { type: 'task-waiting'; taskId: string }

// Server → Agent
export type ServerToAgentMessage =
  | { type: 'auth-ok'; upgradePolicy?: AgentUpgradePolicy }
  | { type: 'auth-fail'; message: string }
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
  | {
      type: 'task-dispatch'
      taskId: string
      projectId: string
      repoPath: string
      tool: RunTool
      title: string
      prompt: string
      llmConfig: { apiBaseUrl: string; apiKey: string; model: string } | null
      conversationHistory?: Array<{ role: 'agent' | 'user'; content: string }>
    }
  | { type: 'task-user-reply'; taskId: string; content: string }

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

export type TodoEntryStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoEntry {
  text: string
  status: TodoEntryStatus
}

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
  | {
      type: 'todo'
      items: TodoEntry[]
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
  | { type: 'task-status'; task: Task }
  | { type: 'task-step'; taskId: string; step: TaskStep }
  | { type: 'task-message'; taskId: string; message: TaskMessage }
  | { type: 'project-status'; project: Project }

// --- Project + Task types ---

export type TaskStatus = 'pending' | 'dispatched' | 'running' | 'waiting' | 'completed' | 'failed'

export interface Project {
  id: string
  name: string
  description: string
  repoPath: string
  agentId: string
  defaultTool: RunTool
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: string
  projectId: string
  title: string
  prompt: string
  status: TaskStatus
  priority: number
  branchName: string | null
  worktreePath: string | null
  runId: string | null
  errorMessage: string | null
  summary: string | null
  createdAt: number
  updatedAt: number
  claimedAt: number | null
  completedAt: number | null
}

// --- LLM Config types ---

export interface LlmConfig {
  id: string
  apiBaseUrl: string
  apiKey: string
  model: string
  projectId: string | null   // null = user default
  createdAt: number
  updatedAt: number
}

export interface CreateLlmConfigRequest {
  apiBaseUrl: string
  apiKey: string
  model: string
  projectId?: string
}

export interface UpdateLlmConfigRequest {
  apiBaseUrl?: string
  apiKey?: string
  model?: string
}

// --- Task Step types ---

export type StepStatus = 'running' | 'completed' | 'failed'
export type StepType = 'think' | 'code' | 'review' | 'message' | 'command' | 'read_file'

export interface TaskStep {
  id: string
  taskId: string
  type: StepType
  label: string
  status: StepStatus
  detail?: string
  toolName: string
  runId?: string
  durationMs?: number
  createdAt: number
  completedAt?: number
}

// --- Task Message types ---

export interface TaskMessage {
  id: string
  taskId: string
  role: 'agent' | 'user'
  content: string
  createdAt: number
}

// --- Project REST API types ---

export interface CreateProjectRequest {
  name: string
  description?: string
  repoPath: string
  agentId: string
  defaultTool?: RunTool
}

export interface UpdateProjectRequest {
  name?: string
  description?: string
  defaultTool?: RunTool
}

export interface ProjectListResponse {
  projects: Project[]
}

export interface ProjectDetailResponse {
  project: Project
  tasks: Task[]
}

// --- Task REST API types ---

export interface CreateTaskRequest {
  title: string
  prompt?: string
  priority?: number
}

export interface UpdateTaskRequest {
  title?: string
  prompt?: string
  priority?: number
}

export interface TaskDetailResponse {
  task: Task
  run: Run | null
}
