/// Row types for reading from SQLite.
/// These map directly to the database columns and may differ from the shared contract types.

#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: String,
    pub provider: String,
    pub provider_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct AgentRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub agent_secret_hash: String,
    pub status: String,
    pub last_seen_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct RegistrationTokenRow {
    pub id: String,
    pub user_id: String,
    pub agent_name: String,
    pub token_hash: String,
    pub expires_at: i64,
    pub used: i64,
}

#[derive(Debug, Clone)]
pub struct NotificationDeviceRow {
    pub installation_id: String,
    pub user_id: String,
    pub platform: String,
    pub provider: String,
    pub push_token: String,
    pub device_name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct RunRow {
    pub id: String,
    pub agent_id: String,
    pub user_id: String,
    pub tool: String,
    pub tool_thread_id: Option<String>,
    pub repo_path: String,
    pub branch: String,
    pub prompt: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub summary: Option<String>,
    pub has_diff: i64,
    pub unread: i64,
}

#[derive(Debug, Clone)]
pub struct RunTurnRow {
    pub id: String,
    pub run_id: String,
    pub turn_index: i64,
    pub prompt: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub summary: Option<String>,
    pub has_diff: i64,
}

#[derive(Debug, Clone)]
pub struct RunTurnAttachmentRow {
    pub id: String,
    pub turn_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub user_id: String,
    pub agent_id: String,
    pub name: String,
    pub description: String,
    pub repo_path: String,
    pub default_tool: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct ProjectActionRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub tool: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct TaskRow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub tool: Option<String>,
    pub status: String,
    pub priority: i64,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub run_id: Option<String>,
    pub error_message: Option<String>,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub claimed_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LlmConfigRow {
    pub id: String,
    pub user_id: String,
    pub project_id: Option<String>,
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct TaskStepRow {
    pub id: String,
    pub task_id: String,
    pub step_type: String,
    pub label: String,
    pub status: String,
    pub detail: Option<String>,
    pub tool_name: String,
    pub run_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct TaskMessageRow {
    pub id: String,
    pub task_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct RunEventRow {
    pub id: i64,
    pub run_id: String,
    pub turn_id: String,
    pub event_type: String,
    pub payload_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct ApiTokenRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub token_hash: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct QrLoginSessionRow {
    pub id: String,
    pub status: String,
    pub user_id: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}
