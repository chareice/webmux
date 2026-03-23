use serde::{Deserialize, Serialize};

// --- Agent info ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub status: AgentStatus,
    pub last_seen_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Online,
    Offline,
}

// --- Agent upgrade policy ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpgradePolicy {
    pub package_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_version: Option<String>,
}

// --- Repository types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepositoryEntryKind {
    Directory,
    Repository,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub name: String,
    pub path: String,
    pub kind: RepositoryEntryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBrowseResponse {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<RepositoryEntry>,
}

// --- Run image attachment ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunImageAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunImageAttachmentUpload {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub base64: String,
}

// --- Agent -> Server messages ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentMessage {
    #[serde(rename = "auth")]
    Auth {
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "agentSecret")]
        agent_secret: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
    },

    #[serde(rename = "heartbeat")]
    Heartbeat {},

    #[serde(rename = "repository-browse-result")]
    RepositoryBrowseResult(RepositoryBrowseResultPayload),

    #[serde(rename = "instructions-result")]
    InstructionsResult(InstructionsResultPayload),

    #[serde(rename = "instructions-written")]
    InstructionsWritten(InstructionsWrittenPayload),

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "run-status")]
    RunStatus {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        status: RunStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "hasDiff")]
        has_diff: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "toolThreadId")]
        tool_thread_id: Option<String>,
    },

    #[serde(rename = "run-item")]
    RunItem {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        item: RunTimelineEventPayload,
    },

    #[serde(rename = "task-claimed")]
    TaskClaimed {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "branchName")]
        branch_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "worktreePath")]
        worktree_path: Option<String>,
    },

    #[serde(rename = "task-running")]
    TaskRunning {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "branchName")]
        branch_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "worktreePath")]
        worktree_path: Option<String>,
    },

    #[serde(rename = "task-completed")]
    TaskCompleted {
        #[serde(rename = "taskId")]
        task_id: String,
        summary: String,
    },

    #[serde(rename = "task-failed")]
    TaskFailed {
        #[serde(rename = "taskId")]
        task_id: String,
        error: String,
    },

    #[serde(rename = "task-step-update")]
    TaskStepUpdate {
        #[serde(rename = "taskId")]
        task_id: String,
        step: TaskStepWithoutTaskId,
    },

    #[serde(rename = "task-message")]
    TaskMessage {
        #[serde(rename = "taskId")]
        task_id: String,
        message: AgentTaskMessagePayload,
    },

    #[serde(rename = "task-waiting")]
    TaskWaiting {
        #[serde(rename = "taskId")]
        task_id: String,
    },
}

/// Payload for the repository-browse-result variant.
/// TypeScript has two overloads (ok: true | ok: false); we model this
/// with an untagged enum wrapped inside the variant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RepositoryBrowseResultPayload {
    Ok {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always true
        #[serde(rename = "currentPath")]
        current_path: String,
        #[serde(rename = "parentPath")]
        parent_path: Option<String>,
        entries: Vec<RepositoryEntry>,
    },
    Err {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always false
        error: String,
    },
}

/// Payload for the instructions-result variant (ok: true | ok: false).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InstructionsResultPayload {
    Ok {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always true
        tool: RunTool,
        content: Option<String>,
    },
    Err {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always false
        tool: RunTool,
        error: String,
    },
}

/// Payload for the instructions-written variant (ok: true | ok: false).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InstructionsWrittenPayload {
    Ok {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always true
        tool: RunTool,
    },
    Err {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: serde_json::Value, // always false
        tool: RunTool,
        error: String,
    },
}

/// Message payload for agent task messages (role is always "agent").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskMessagePayload {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: f64,
}

/// TaskStep without the taskId field (used in task-step-update).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStepWithoutTaskId {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: StepType,
    pub label: String,
    pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    pub created_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<f64>,
}

// --- Server -> Agent messages ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerToAgentMessage {
    #[serde(rename = "auth-ok")]
    AuthOk {
        #[serde(skip_serializing_if = "Option::is_none", rename = "upgradePolicy")]
        upgrade_policy: Option<AgentUpgradePolicy>,
    },

    #[serde(rename = "auth-fail")]
    AuthFail { message: String },

    #[serde(rename = "repository-browse")]
    RepositoryBrowse {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },

    #[serde(rename = "read-instructions")]
    ReadInstructions {
        #[serde(rename = "requestId")]
        request_id: String,
        tool: RunTool,
    },

    #[serde(rename = "write-instructions")]
    WriteInstructions {
        #[serde(rename = "requestId")]
        request_id: String,
        tool: RunTool,
        content: String,
    },

    #[serde(rename = "run-turn-start")]
    RunTurnStart {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        tool: RunTool,
        #[serde(rename = "repoPath")]
        repo_path: String,
        prompt: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "toolThreadId")]
        tool_thread_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<RunImageAttachmentUpload>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<RunTurnOptions>,
    },

    #[serde(rename = "run-turn-interrupt")]
    RunTurnInterrupt {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
    },

    #[serde(rename = "run-turn-kill")]
    RunTurnKill {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
    },

    #[serde(rename = "task-dispatch")]
    TaskDispatch {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "projectId")]
        project_id: String,
        #[serde(rename = "repoPath")]
        repo_path: String,
        tool: RunTool,
        title: String,
        prompt: String,
        #[serde(rename = "llmConfig")]
        llm_config: Option<LlmConfigInline>,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<RunImageAttachmentUpload>>,
    },

    #[serde(rename = "task-user-reply")]
    TaskUserReply {
        #[serde(rename = "taskId")]
        task_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<RunImageAttachmentUpload>>,
    },
}

/// Inline LLM config object used in task-dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigInline {
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
}

// --- REST API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListResponse {
    pub agents: Vec<AgentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRegistrationTokenResponse {
    pub token: String,
    pub expires_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAgentRequest {
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAgentResponse {
    pub agent_id: String,
    pub agent_secret: String,
}

// --- Run types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunTool {
    Codex,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Starting,
    Running,
    Success,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    pub tool: RunTool,
    pub repo_path: String,
    pub branch: String,
    pub prompt: String,
    pub status: RunStatus,
    pub created_at: f64,
    pub updated_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub has_diff: bool,
    pub unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTurn {
    pub id: String,
    pub run_id: String,
    pub index: i64,
    pub prompt: String,
    pub attachments: Vec<RunImageAttachment>,
    pub status: RunStatus,
    pub created_at: f64,
    pub updated_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub has_diff: bool,
}

// --- Run timeline event types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunTimelineEventStatus {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoEntryStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoEntry {
    pub text: String,
    pub status: TodoEntryStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RunTimelineEventPayload {
    #[serde(rename = "message")]
    Message {
        role: MessageRole,
        text: String,
    },

    #[serde(rename = "command")]
    Command {
        status: CommandStatus,
        command: String,
        output: String,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },

    #[serde(rename = "activity")]
    Activity {
        status: RunTimelineEventStatus,
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },

    #[serde(rename = "todo")]
    Todo {
        items: Vec<TodoEntry>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    Assistant,
    User,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandStatus {
    Started,
    Completed,
    Failed,
}

/// A timeline event with its database id and timestamp.
/// In TypeScript this is `RunTimelineEventPayload & { id: number; createdAt: number }`.
/// We flatten the payload so the `type` discriminator stays at top level.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTimelineEvent {
    pub id: i64,
    pub created_at: f64,
    #[serde(flatten)]
    pub payload: RunTimelineEventPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTurnDetail {
    pub id: String,
    pub run_id: String,
    pub index: i64,
    pub prompt: String,
    pub attachments: Vec<RunImageAttachment>,
    pub status: RunStatus,
    pub created_at: f64,
    pub updated_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub has_diff: bool,
    pub items: Vec<RunTimelineEvent>,
}

// --- Run turn options ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeEffort {
    Low,
    Medium,
    High,
    Max,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexEffort {
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTurnOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_effort: Option<ClaudeEffort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_effort: Option<CodexEffort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear_session: Option<bool>,
}

// --- Run REST API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    pub tool: RunTool,
    pub repo_path: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<RunImageAttachmentUpload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<RunTurnOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListResponse {
    pub runs: Vec<Run>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetailResponse {
    pub run: Run,
    pub turns: Vec<RunTurnDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueRunRequest {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<RunImageAttachmentUpload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<RunTurnOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQueuedTurnRequest {
    pub prompt: String,
}

// --- Run WebSocket event (Server -> Browser) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RunEvent {
    #[serde(rename = "run-status")]
    RunStatus { run: Run },

    #[serde(rename = "run-turn")]
    RunTurn {
        #[serde(rename = "runId")]
        run_id: String,
        turn: RunTurn,
    },

    #[serde(rename = "run-item")]
    RunItem {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "turnId")]
        turn_id: String,
        item: RunTimelineEvent,
    },

    #[serde(rename = "task-status")]
    TaskStatus { task: Task },

    #[serde(rename = "task-step")]
    TaskStep {
        #[serde(rename = "taskId")]
        task_id: String,
        step: TaskStep,
    },

    #[serde(rename = "task-message")]
    TaskMessage {
        #[serde(rename = "taskId")]
        task_id: String,
        message: TaskMessage,
    },

    #[serde(rename = "project-status")]
    ProjectStatus { project: Project },
}

// --- Project + Task types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Pending,
    Dispatched,
    Running,
    Waiting,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub agent_id: String,
    pub default_tool: RunTool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub tool: RunTool,
    pub status: TaskStatus,
    pub priority: i64,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub run_id: Option<String>,
    pub error_message: Option<String>,
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<RunImageAttachment>>,
    pub created_at: f64,
    pub updated_at: f64,
    pub claimed_at: Option<f64>,
    pub completed_at: Option<f64>,
}

// --- LLM Config types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub id: String,
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
    pub project_id: Option<String>,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmConfigRequest {
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmConfigRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

// --- Task Step types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Think,
    Code,
    Review,
    Message,
    Command,
    ReadFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStep {
    pub id: String,
    pub task_id: String,
    #[serde(rename = "type")]
    pub step_type: StepType,
    pub label: String,
    pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    pub created_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<f64>,
}

// --- Task Message types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMessage {
    pub id: String,
    pub task_id: String,
    pub role: TaskMessageRole,
    pub content: String,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskMessageRole {
    Agent,
    User,
}

// --- Project Action types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAction {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub tool: RunTool,
    pub sort_order: i64,
    pub created_at: f64,
    pub updated_at: f64,
}

// --- Project REST API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub repo_path: String,
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_tool: Option<RunTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_tool: Option<RunTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResponse {
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailResponse {
    pub project: Project,
    pub tasks: Vec<Task>,
    pub actions: Vec<ProjectAction>,
}

// --- Task REST API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<RunTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<RunImageAttachmentUpload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetailResponse {
    pub task: Task,
    pub run: Option<Run>,
}

// --- Project Action REST API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectActionRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<RunTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectActionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<RunTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateProjectActionRequest {
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionListResponse {
    pub actions: Vec<ProjectAction>,
}
