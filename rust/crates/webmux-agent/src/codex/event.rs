use serde::Deserialize;
use webmux_shared::{
    CommandStatus, MessageRole, RunStatus, RunTimelineEventPayload, RunTimelineEventStatus,
    TodoEntry, TodoEntryStatus,
};

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct CodexEventParseResult {
    pub items: Vec<RunTimelineEventPayload>,
    pub summary: Option<String>,
    pub final_status: Option<RunStatus>,
    pub thread_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Codex JSONL event types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum CodexEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted { thread_id: Option<String> },

    #[serde(rename = "turn.started")]
    TurnStarted {},

    #[serde(rename = "turn.completed")]
    TurnCompleted {},

    #[serde(rename = "turn.failed")]
    TurnFailed { error: CodexErrorPayload },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "item.started")]
    ItemStarted { item: CodexItem },

    #[serde(rename = "item.updated")]
    ItemUpdated { item: CodexItem },

    #[serde(rename = "item.completed")]
    ItemCompleted { item: CodexItem },
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexErrorPayload {
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum CodexItem {
    #[serde(rename = "agent_message")]
    AgentMessage {
        #[serde(default)]
        text: String,
    },

    #[serde(rename = "reasoning")]
    Reasoning {
        #[serde(default)]
        text: String,
    },

    #[serde(rename = "command_execution")]
    CommandExecution {
        command: String,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        aggregated_output: Option<String>,
        #[serde(default)]
        exit_code: Option<i32>,
    },

    #[serde(rename = "file_change")]
    FileChange {
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        changes: Vec<FileChangeEntry>,
    },

    #[serde(rename = "mcp_tool_call")]
    McpToolCall {
        tool: String,
        server: String,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        error: Option<CodexErrorPayload>,
    },

    #[serde(rename = "web_search")]
    WebSearch { query: String },

    #[serde(rename = "todo_list")]
    TodoList { items: Vec<CodexTodoItem> },

    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileChangeEntry {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodexTodoItem {
    pub text: String,
    #[serde(default)]
    pub completed: bool,
}

// ---------------------------------------------------------------------------
// Stateless parser
// ---------------------------------------------------------------------------

/// The event type tag extracted from the wrapping CodexEvent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemEventKind {
    Started,
    Updated,
    Completed,
}

/// Parse a single Codex JSONL event into our unified result.
pub fn parse_codex_event(event: &CodexEvent) -> CodexEventParseResult {
    match event {
        CodexEvent::ThreadStarted { thread_id } => CodexEventParseResult {
            thread_id: thread_id.clone(),
            ..Default::default()
        },

        CodexEvent::TurnFailed { error } => CodexEventParseResult {
            items: vec![RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Turn failed".to_string(),
                detail: Some(error.message.clone()),
            }],
            final_status: Some(RunStatus::Failed),
            summary: Some(error.message.clone()),
            ..Default::default()
        },

        CodexEvent::Error { message } => CodexEventParseResult {
            items: vec![RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Thread error".to_string(),
                detail: Some(message.clone()),
            }],
            final_status: Some(RunStatus::Failed),
            summary: Some(message.clone()),
            ..Default::default()
        },

        CodexEvent::ItemStarted { item } => parse_codex_item(item, ItemEventKind::Started),
        CodexEvent::ItemUpdated { item } => parse_codex_item(item, ItemEventKind::Updated),
        CodexEvent::ItemCompleted { item } => parse_codex_item(item, ItemEventKind::Completed),

        CodexEvent::TurnStarted {} | CodexEvent::TurnCompleted {} => {
            CodexEventParseResult::default()
        }
    }
}

fn parse_codex_item(item: &CodexItem, event_kind: ItemEventKind) -> CodexEventParseResult {
    match item {
        CodexItem::AgentMessage { text } => {
            let trimmed = text.trim();
            if trimmed.is_empty() || event_kind != ItemEventKind::Completed {
                return CodexEventParseResult::default();
            }
            CodexEventParseResult {
                items: vec![RunTimelineEventPayload::Message {
                    role: MessageRole::Assistant,
                    text: trimmed.to_string(),
                }],
                summary: Some(trimmed.to_string()),
                ..Default::default()
            }
        }

        CodexItem::Reasoning { text } => {
            let trimmed = text.trim();
            if trimmed.is_empty() || event_kind != ItemEventKind::Completed {
                return CodexEventParseResult::default();
            }
            CodexEventParseResult {
                items: vec![RunTimelineEventPayload::Activity {
                    status: RunTimelineEventStatus::Info,
                    label: "Reasoning".to_string(),
                    detail: Some(trimmed.to_string()),
                }],
                ..Default::default()
            }
        }

        CodexItem::CommandExecution {
            command,
            status,
            aggregated_output,
            exit_code,
        } => {
            if event_kind == ItemEventKind::Started {
                return CodexEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: RunTimelineEventStatus::Info,
                        label: "Running command".to_string(),
                        detail: Some(command.clone()),
                    }],
                    ..Default::default()
                };
            }

            if event_kind != ItemEventKind::Completed {
                return CodexEventParseResult::default();
            }

            let failed = status.as_deref() == Some("failed")
                || exit_code.map_or(false, |c| c != 0);

            CodexEventParseResult {
                items: vec![RunTimelineEventPayload::Command {
                    status: if failed {
                        CommandStatus::Failed
                    } else {
                        CommandStatus::Completed
                    },
                    command: command.clone(),
                    output: aggregated_output.clone().unwrap_or_default(),
                    exit_code: *exit_code,
                }],
                ..Default::default()
            }
        }

        CodexItem::FileChange { status, changes } => {
            let failed = status.as_deref() == Some("failed");
            let detail = format_file_change_summary(changes);
            CodexEventParseResult {
                items: vec![RunTimelineEventPayload::Activity {
                    status: if failed {
                        RunTimelineEventStatus::Error
                    } else {
                        RunTimelineEventStatus::Success
                    },
                    label: if failed {
                        "File changes failed".to_string()
                    } else {
                        "Applied file changes".to_string()
                    },
                    detail: Some(detail),
                }],
                ..Default::default()
            }
        }

        CodexItem::McpToolCall {
            tool,
            server,
            status,
            error,
        } => {
            if event_kind == ItemEventKind::Started {
                return CodexEventParseResult {
                    items: vec![RunTimelineEventPayload::Activity {
                        status: RunTimelineEventStatus::Info,
                        label: format!("Tool: {tool}"),
                        detail: Some(format!("{server} / {tool}")),
                    }],
                    ..Default::default()
                };
            }

            if event_kind != ItemEventKind::Completed {
                return CodexEventParseResult::default();
            }

            let failed = status.as_deref() == Some("failed");
            CodexEventParseResult {
                items: vec![RunTimelineEventPayload::Activity {
                    status: if failed {
                        RunTimelineEventStatus::Error
                    } else {
                        RunTimelineEventStatus::Success
                    },
                    label: if failed {
                        format!("Tool failed: {tool}")
                    } else {
                        format!("Tool finished: {tool}")
                    },
                    detail: if failed {
                        error.as_ref().map(|e| e.message.clone())
                    } else {
                        Some(format!("{server} / {tool}"))
                    },
                }],
                ..Default::default()
            }
        }

        CodexItem::WebSearch { query } => CodexEventParseResult {
            items: vec![RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Info,
                label: "Web search".to_string(),
                detail: Some(query.clone()),
            }],
            ..Default::default()
        },

        CodexItem::TodoList { items } => CodexEventParseResult {
            items: vec![RunTimelineEventPayload::Todo {
                items: items
                    .iter()
                    .map(|entry| TodoEntry {
                        text: entry.text.clone(),
                        status: if entry.completed {
                            TodoEntryStatus::Completed
                        } else {
                            TodoEntryStatus::Pending
                        },
                    })
                    .collect(),
            }],
            ..Default::default()
        },

        CodexItem::Error { message } => CodexEventParseResult {
            items: vec![RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Tool error".to_string(),
                detail: Some(message.clone()),
            }],
            summary: Some(message.clone()),
            ..Default::default()
        },
    }
}

fn format_file_change_summary(changes: &[FileChangeEntry]) -> String {
    if changes.is_empty() {
        return "No files changed".to_string();
    }
    changes
        .iter()
        .map(|c| format!("{}: {}", c.kind, c.path))
        .collect::<Vec<_>>()
        .join("\n")
}
