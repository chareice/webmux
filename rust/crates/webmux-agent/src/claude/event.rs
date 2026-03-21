use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;
use webmux_shared::{
    CommandStatus, MessageRole, RunStatus, RunTimelineEventPayload, RunTimelineEventStatus,
    TodoEntry, TodoEntryStatus,
};

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ClaudeEventParseResult {
    pub items: Vec<RunTimelineEventPayload>,
    pub summary: Option<String>,
    pub final_status: Option<RunStatus>,
}

// ---------------------------------------------------------------------------
// Stateful parser (tracks pending tool_use blocks across messages)
// ---------------------------------------------------------------------------

struct PendingToolUse {
    name: String,
    command: Option<String>,
}

pub struct ClaudeMessageParser {
    pending_tool_uses: HashMap<String, PendingToolUse>,
}

impl ClaudeMessageParser {
    pub fn new() -> Self {
        Self {
            pending_tool_uses: HashMap::new(),
        }
    }

    pub fn parse(&mut self, message: &ClaudeMessage) -> ClaudeEventParseResult {
        match &message.msg_type {
            ClaudeMessageType::Assistant => self.parse_assistant_message(message),
            ClaudeMessageType::User => self.parse_user_message(message),
            ClaudeMessageType::Result => self.parse_result_message(message),
            ClaudeMessageType::AuthStatus => {
                if let Some(error) = &message.error {
                    ClaudeEventParseResult {
                        items: vec![RunTimelineEventPayload::Activity {
                            status: RunTimelineEventStatus::Error,
                            label: "Claude authentication failed".to_string(),
                            detail: Some(error.clone()),
                        }],
                        summary: Some(error.clone()),
                        final_status: Some(RunStatus::Failed),
                    }
                } else {
                    ClaudeEventParseResult::default()
                }
            }
            ClaudeMessageType::System => self.parse_system_message(message),
            ClaudeMessageType::ToolProgress => {
                let tool_name = message
                    .tool_name
                    .as_deref()
                    .unwrap_or("unknown");
                let detail = message
                    .elapsed_time_seconds
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .map(|v| format!("{v:.1}s"));
                ClaudeEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: RunTimelineEventStatus::Info,
                        label: format!("Running tool: {tool_name}"),
                        detail,
                    }],
                    ..Default::default()
                }
            }
            ClaudeMessageType::ToolUseSummary => {
                let detail = message
                    .summary_text
                    .clone();
                ClaudeEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: RunTimelineEventStatus::Info,
                        label: "Tool summary".to_string(),
                        detail,
                    }],
                    ..Default::default()
                }
            }
            ClaudeMessageType::StreamEvent | ClaudeMessageType::RateLimitEvent => {
                ClaudeEventParseResult::default()
            }
            ClaudeMessageType::Unknown => ClaudeEventParseResult::default(),
        }
    }

    // -- assistant message --------------------------------------------------

    fn parse_assistant_message(&mut self, message: &ClaudeMessage) -> ClaudeEventParseResult {
        let mut items: Vec<RunTimelineEventPayload> = Vec::new();
        let mut text_blocks: Vec<String> = Vec::new();
        let mut summary: Option<String> = None;

        let content = match &message.message {
            Some(m) => m.content.as_ref(),
            None => None,
        };

        if let Some(blocks) = content {
            for block in blocks {
                // Thinking block
                if block.block_type == "thinking" {
                    if let Some(thinking) = &block.thinking {
                        let trimmed = thinking.trim();
                        if !trimmed.is_empty() {
                            items.push(RunTimelineEventPayload::Activity {
                                status: RunTimelineEventStatus::Info,
                                label: "Thinking".to_string(),
                                detail: Some(trimmed.to_string()),
                            });
                        }
                    }
                    continue;
                }

                // Text block
                if block.block_type == "text" {
                    if let Some(text) = &block.text {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            text_blocks.push(trimmed.to_string());
                        }
                    }
                    continue;
                }

                // Tool use block
                if block.block_type == "tool_use" {
                    if let (Some(id), Some(name)) = (&block.id, &block.name) {
                        // TodoWrite — emit dedicated todo event
                        if name == "TodoWrite" {
                            if let Some(input) = &block.input {
                                if let Some(todos) = input.get("todos").and_then(|v| v.as_array()) {
                                    self.pending_tool_uses.insert(
                                        id.clone(),
                                        PendingToolUse {
                                            name: name.clone(),
                                            command: None,
                                        },
                                    );
                                    let todo_items: Vec<TodoEntry> = todos
                                        .iter()
                                        .map(|t| {
                                            let text = t
                                                .get("content")
                                                .and_then(|c| c.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            let status = match t
                                                .get("status")
                                                .and_then(|s| s.as_str())
                                            {
                                                Some("completed") => TodoEntryStatus::Completed,
                                                Some("in_progress") => TodoEntryStatus::InProgress,
                                                _ => TodoEntryStatus::Pending,
                                            };
                                            TodoEntry { text, status }
                                        })
                                        .collect();
                                    items.push(RunTimelineEventPayload::Todo {
                                        items: todo_items,
                                    });
                                    continue;
                                }
                            }
                        }

                        let command = if name == "Bash" {
                            block
                                .input
                                .as_ref()
                                .and_then(|inp| inp.get("command"))
                                .and_then(|c| c.as_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        };

                        self.pending_tool_uses.insert(
                            id.clone(),
                            PendingToolUse {
                                name: name.clone(),
                                command: command.clone(),
                            },
                        );

                        if name == "Bash" {
                            if let Some(cmd) = &command {
                                items.push(RunTimelineEventPayload::Command {
                                    status: CommandStatus::Started,
                                    command: cmd.clone(),
                                    output: String::new(),
                                    exit_code: None,
                                });
                            }
                        } else {
                            items.push(RunTimelineEventPayload::Activity {
                                status: RunTimelineEventStatus::Info,
                                label: format!("Tool: {name}"),
                                detail: format_tool_input(block.input.as_ref()),
                            });
                        }
                    }
                }
            }
        }

        let text = text_blocks.join("\n\n");
        if !text.is_empty() {
            items.push(RunTimelineEventPayload::Message {
                role: MessageRole::Assistant,
                text: text.clone(),
            });
            summary = Some(text);
        }

        if let Some(error) = &message.error {
            items.push(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Claude response error".to_string(),
                detail: Some(error.clone()),
            });
            if summary.is_none() {
                summary = Some(error.clone());
            }
        }

        ClaudeEventParseResult {
            items,
            summary,
            final_status: None,
        }
    }

    // -- user message -------------------------------------------------------

    fn parse_user_message(&mut self, message: &ClaudeMessage) -> ClaudeEventParseResult {
        let mut items: Vec<RunTimelineEventPayload> = Vec::new();
        let mut text_blocks: Vec<String> = Vec::new();

        let content = match &message.message {
            Some(m) => m.content.as_ref(),
            None => None,
        };

        if let Some(blocks) = content {
            for block in blocks {
                // Text block
                if block.block_type == "text" {
                    if let Some(text) = &block.text {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            text_blocks.push(trimmed.to_string());
                        }
                    }
                    continue;
                }

                // Tool result block
                if block.block_type != "tool_result" {
                    continue;
                }

                let tool_use_id = match &block.tool_use_id {
                    Some(id) => id.clone(),
                    None => continue,
                };

                let pending = self.pending_tool_uses.remove(&tool_use_id);
                let output = extract_tool_result_output(
                    block.content_value.as_ref(),
                    message.tool_use_result.as_ref(),
                );
                let is_error = block.is_error.unwrap_or(false);

                if let Some(ref p) = pending {
                    if p.name == "Bash" {
                        let exit_code = infer_exit_code(
                            block.content_value.as_ref(),
                            message.tool_use_result.as_ref(),
                            is_error,
                        );
                        items.push(RunTimelineEventPayload::Command {
                            status: if is_error {
                                CommandStatus::Failed
                            } else {
                                CommandStatus::Completed
                            },
                            command: p.command.clone().unwrap_or_else(|| "Bash".to_string()),
                            output,
                            exit_code,
                        });
                        continue;
                    }

                    // TodoWrite result — skip silently
                    if p.name == "TodoWrite" {
                        continue;
                    }

                    let (status, label) = if is_error {
                        (
                            RunTimelineEventStatus::Error,
                            format!("Tool failed: {}", p.name),
                        )
                    } else {
                        (
                            RunTimelineEventStatus::Success,
                            format!("Tool finished: {}", p.name),
                        )
                    };
                    items.push(RunTimelineEventPayload::Activity {
                        status,
                        label,
                        detail: if output.is_empty() {
                            None
                        } else {
                            Some(output)
                        },
                    });
                }
            }
        }

        if !items.is_empty() {
            return ClaudeEventParseResult {
                items,
                ..Default::default()
            };
        }

        let text = text_blocks.join("\n\n");
        if text.is_empty() {
            return ClaudeEventParseResult::default();
        }

        ClaudeEventParseResult {
            items: vec![RunTimelineEventPayload::Message {
                role: MessageRole::User,
                text,
            }],
            ..Default::default()
        }
    }

    // -- result message -----------------------------------------------------

    fn parse_result_message(&self, message: &ClaudeMessage) -> ClaudeEventParseResult {
        if message.subtype.as_deref() == Some("success") {
            let summary = message
                .result
                .as_ref()
                .map(|r| r.trim().to_string())
                .filter(|s| !s.is_empty());
            return ClaudeEventParseResult {
                items: Vec::new(),
                summary,
                final_status: Some(RunStatus::Success),
            };
        }

        let detail = message
            .errors
            .as_ref()
            .map(|e| e.join("\n").trim().to_string())
            .unwrap_or_default();
        ClaudeEventParseResult {
            items: vec![RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Claude thread failed".to_string(),
                detail: if detail.is_empty() {
                    None
                } else {
                    Some(detail.clone())
                },
            }],
            summary: if detail.is_empty() {
                None
            } else {
                Some(detail)
            },
            final_status: Some(RunStatus::Failed),
        }
    }

    // -- system message -----------------------------------------------------

    fn parse_system_message(&self, message: &ClaudeMessage) -> ClaudeEventParseResult {
        match message.subtype.as_deref() {
            Some("status") => {
                if message.status.as_deref() == Some("compacting") {
                    ClaudeEventParseResult {
                        items: vec![RunTimelineEventPayload::Activity {
                            status: RunTimelineEventStatus::Info,
                            label: "Compacting conversation".to_string(),
                            detail: None,
                        }],
                        ..Default::default()
                    }
                } else {
                    ClaudeEventParseResult::default()
                }
            }
            Some("compact_boundary") => ClaudeEventParseResult {
                items: vec![RunTimelineEventPayload::Activity {
                    status: RunTimelineEventStatus::Info,
                    label: "Conversation compacted".to_string(),
                    detail: None,
                }],
                ..Default::default()
            },
            Some("local_command_output") => {
                let text = message
                    .content_text
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                ClaudeEventParseResult {
                    items: vec![RunTimelineEventPayload::Message {
                        role: MessageRole::System,
                        text,
                    }],
                    ..Default::default()
                }
            }
            Some("task_started") => ClaudeEventParseResult {
                items: vec![RunTimelineEventPayload::Activity {
                    status: RunTimelineEventStatus::Info,
                    label: message
                        .description
                        .clone()
                        .unwrap_or_default(),
                    detail: message.prompt_field.clone(),
                }],
                ..Default::default()
            },
            Some("task_progress") => {
                let label = message
                    .summary_text
                    .as_ref()
                    .filter(|s| !s.trim().is_empty())
                    .cloned()
                    .or_else(|| message.description.clone())
                    .unwrap_or_default();
                ClaudeEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: RunTimelineEventStatus::Info,
                        label,
                        detail: message.last_tool_name.clone(),
                    }],
                    ..Default::default()
                }
            }
            Some("task_notification") => {
                let task_status = message
                    .status
                    .as_deref()
                    .unwrap_or("completed");
                let event_status = match task_status {
                    "completed" => RunTimelineEventStatus::Success,
                    "failed" => RunTimelineEventStatus::Error,
                    _ => RunTimelineEventStatus::Warning,
                };
                ClaudeEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: event_status,
                        label: message
                            .summary_text
                            .clone()
                            .unwrap_or_default(),
                        detail: message.output_file.clone(),
                    }],
                    ..Default::default()
                }
            }
            // Ignored subtypes
            Some("hook_started")
            | Some("hook_progress")
            | Some("hook_response")
            | Some("files_persisted")
            | Some("elicitation_complete")
            | Some("init") => ClaudeEventParseResult::default(),
            _ => ClaudeEventParseResult::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Claude message serde types (JSONL from claude --print --output-format stream-json)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeMessageType {
    Assistant,
    User,
    Result,
    AuthStatus,
    System,
    ToolProgress,
    ToolUseSummary,
    StreamEvent,
    RateLimitEvent,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeContentBlock {
    #[serde(rename = "type", default)]
    pub block_type: String,
    // text block
    pub text: Option<String>,
    // thinking block
    pub thinking: Option<String>,
    // tool_use block
    pub id: Option<String>,
    pub name: Option<String>,
    pub input: Option<Value>,
    // tool_result block
    pub tool_use_id: Option<String>,
    pub is_error: Option<bool>,
    /// Tool result content — may be a string or array of objects
    #[serde(rename = "content")]
    pub content_value: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeMessageBody {
    #[serde(default)]
    #[allow(dead_code)]
    pub role: Option<String>,
    pub content: Option<Vec<ClaudeContentBlock>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeMessage {
    #[serde(rename = "type")]
    pub msg_type: ClaudeMessageType,
    pub session_id: Option<String>,

    // assistant / user
    pub message: Option<ClaudeMessageBody>,

    // result
    pub subtype: Option<String>,
    pub result: Option<String>,
    pub errors: Option<Vec<String>>,

    // auth_status
    pub error: Option<String>,

    // tool_progress
    pub tool_name: Option<String>,
    pub elapsed_time_seconds: Option<f64>,

    // tool_use_summary
    #[serde(rename = "summary")]
    pub summary_text: Option<String>,

    // user tool_use_result (top-level field)
    pub tool_use_result: Option<Value>,

    // system subtypes — `status` is used by both "status" subtype (status field)
    // and "task_notification" subtype (completed/failed/stopped). We use a single
    // field since they never coexist.
    pub status: Option<String>,
    #[serde(rename = "content")]
    pub content_text: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "prompt")]
    pub prompt_field: Option<String>,
    pub last_tool_name: Option<String>,
    pub output_file: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn format_tool_input(input: Option<&Value>) -> Option<String> {
    let input = input?;

    if let Some(s) = input.as_str() {
        return Some(s.to_string());
    }

    if let Some(obj) = input.as_object() {
        if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
            return Some(cmd.to_string());
        }
    }

    serde_json::to_string(input).ok()
}

fn extract_tool_result_output(content: Option<&Value>, tool_use_result: Option<&Value>) -> String {
    // First try structured tool_use_result with stdout/stderr
    if let Some(tur) = tool_use_result {
        if let Some(obj) = tur.as_object() {
            let stdout = obj
                .get("stdout")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let stderr = obj
                .get("stderr")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let mut chunks = Vec::new();
            if let Some(out) = stdout {
                chunks.push(out);
            }
            if let Some(err) = stderr {
                chunks.push(err);
            }
            if !chunks.is_empty() {
                return chunks.join("\n");
            }
        }
    }

    // Try content as string
    if let Some(c) = content {
        if let Some(s) = c.as_str() {
            return s.trim().to_string();
        }

        // Content as array
        if let Some(arr) = c.as_array() {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|entry| {
                    if let Some(s) = entry.as_str() {
                        let trimmed = s.trim().to_string();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed)
                        }
                    } else if let Some(obj) = entry.as_object() {
                        obj.get("text")
                            .and_then(|t| t.as_str())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                    } else {
                        None
                    }
                })
                .collect();
            if !parts.is_empty() {
                return parts.join("\n");
            }
        }
    }

    // Fallback: tool_use_result as string
    if let Some(tur) = tool_use_result {
        if let Some(s) = tur.as_str() {
            return s.trim().to_string();
        }
    }

    String::new()
}

fn infer_exit_code(content: Option<&Value>, tool_use_result: Option<&Value>, is_error: bool) -> Option<i32> {
    if !is_error {
        return Some(0);
    }

    let candidates = [
        content.and_then(|v| v.as_str()).unwrap_or(""),
        tool_use_result.and_then(|v| v.as_str()).unwrap_or(""),
    ];

    for candidate in &candidates {
        // Look for "exit code NNN"
        if let Some(pos) = candidate.to_lowercase().find("exit code") {
            let rest = &candidate[pos + 9..];
            let digits: String = rest
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(code) = digits.parse::<i32>() {
                return Some(code);
            }
        }
    }

    None
}
