use std::process::Stdio;

use tokio::process::Command;
use tracing::error;

use webmux_shared::{
    RunImageAttachmentUpload, RunStatus, RunTimelineEventPayload, RunTimelineEventStatus,
    RunTool, RunTurnOptions,
};

use crate::claude::client::{
    start_claude, ClaudeClientOptions, ClaudeHandle, ClaudeStreamEvent,
};
use crate::claude::event::ClaudeMessageParser;
use crate::codex::client::{start_codex, CodexClientOptions, CodexHandle, CodexStreamEvent};
use crate::codex::event::{parse_codex_event, CodexEvent};
use crate::codex::input::prepare_codex_input;

// ---------------------------------------------------------------------------
// RunWrapper — orchestrates a single LLM execution (Claude or Codex)
// ---------------------------------------------------------------------------

pub struct RunWrapperOptions {
    #[allow(dead_code)]
    pub run_id: String,
    pub tool: RunTool,
    pub tool_thread_id: Option<String>,
    pub repo_path: String,
    pub prompt: String,
    pub attachments: Vec<RunImageAttachmentUpload>,
    pub options: RunTurnOptions,
}

/// Callbacks invoked during a run.
pub struct RunCallbacks<FEvent, FFinish, FItem, FThread>
where
    FEvent: FnMut(RunStatus, Option<String>, Option<bool>),
    FFinish: FnMut(RunStatus),
    FItem: FnMut(RunTimelineEventPayload),
    FThread: FnMut(String),
{
    pub on_event: FEvent,
    pub on_finish: FFinish,
    pub on_item: FItem,
    pub on_thread_ready: FThread,
}

/// The mutable state of a run, shared between the wrapper and the async
/// execution loop.
#[allow(dead_code)]
pub struct RunState {
    pub current_status: RunStatus,
    pub latest_summary: Option<String>,
    pub interrupted: bool,
    pub finished: bool,
    pub disposed: bool,
}

impl RunState {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            current_status: RunStatus::Starting,
            latest_summary: None,
            interrupted: false,
            finished: false,
            disposed: false,
        }
    }
}

/// Active run handle. Holds the subprocess handle so it can be interrupted or
/// killed.
#[allow(dead_code)]
pub enum ActiveHandle {
    Claude(ClaudeHandle),
    Codex(CodexHandle),
    None,
}

impl ActiveHandle {
    /// Interrupt the running process.
    pub fn interrupt(&mut self) {
        match self {
            ActiveHandle::Claude(h) => h.interrupt(),
            ActiveHandle::Codex(h) => h.abort(),
            ActiveHandle::None => {}
        }
    }

    /// Kill / dispose the running process.
    pub fn dispose(&mut self) {
        match self {
            ActiveHandle::Claude(h) => h.close(),
            ActiveHandle::Codex(h) => h.abort(),
            ActiveHandle::None => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start a run. This spawns the appropriate subprocess and reads events until
/// completion or interruption. Callbacks are invoked inline.
///
/// Returns the active handle and run state. The caller can use the handle to
/// interrupt or dispose the run.
pub async fn start_run<FEvent, FFinish, FItem, FThread>(
    opts: RunWrapperOptions,
    callbacks: &mut RunCallbacks<FEvent, FFinish, FItem, FThread>,
) where
    FEvent: FnMut(RunStatus, Option<String>, Option<bool>),
    FFinish: FnMut(RunStatus),
    FItem: FnMut(RunTimelineEventPayload),
    FThread: FnMut(String),
{
    match opts.tool {
        RunTool::Codex => run_codex(opts, callbacks).await,
        RunTool::Claude => run_claude(opts, callbacks).await,
    }
}

// ---------------------------------------------------------------------------
// Codex run
// ---------------------------------------------------------------------------

async fn run_codex<FEvent, FFinish, FItem, FThread>(
    opts: RunWrapperOptions,
    cb: &mut RunCallbacks<FEvent, FFinish, FItem, FThread>,
) where
    FEvent: FnMut(RunStatus, Option<String>, Option<bool>),
    FFinish: FnMut(RunStatus),
    FItem: FnMut(RunTimelineEventPayload),
    FThread: FnMut(String),
{
    (cb.on_event)(RunStatus::Starting, None, None);
    (cb.on_item)(RunTimelineEventPayload::Activity {
        status: RunTimelineEventStatus::Info,
        label: "Starting Codex".to_string(),
        detail: Some(opts.repo_path.clone()),
    });

    let clear_session = opts.options.clear_session.unwrap_or(false);
    let resume_id = if clear_session {
        None
    } else {
        opts.tool_thread_id.clone()
    };

    let codex_opts = CodexClientOptions {
        working_directory: opts.repo_path.clone(),
        model: opts.options.model.clone(),
        reasoning_effort: opts.options.codex_effort.as_ref().map(|e| format!("{e:?}").to_lowercase()),
        resume_thread_id: resume_id,
    };

    // Prepare input (write images to temp files)
    let prepared = match prepare_codex_input(&opts.prompt, &opts.attachments).await {
        Ok(p) => p,
        Err(e) => {
            (cb.on_item)(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Run failed".to_string(),
                detail: Some(e.clone()),
            });
            let has_diff = detect_repo_changes(&opts.repo_path).await;
            (cb.on_event)(RunStatus::Failed, Some(e), Some(has_diff));
            (cb.on_finish)(RunStatus::Failed);
            return;
        }
    };

    let mut handle = match start_codex(&prepared.prompt, &prepared.image_paths, &codex_opts) {
        Ok(h) => h,
        Err(e) => {
            prepared.cleanup().await;
            (cb.on_item)(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Run failed".to_string(),
                detail: Some(e.clone()),
            });
            let has_diff = detect_repo_changes(&opts.repo_path).await;
            (cb.on_event)(RunStatus::Failed, Some(e), Some(has_diff));
            (cb.on_finish)(RunStatus::Failed);
            return;
        }
    };

    (cb.on_event)(RunStatus::Running, None, None);

    let current_status = RunStatus::Running;
    let mut latest_summary: Option<String> = None;
    let interrupted = false;
    let mut saw_turn_completed = false;
    let mut announced_thread_id = opts.tool_thread_id.clone();
    let mut final_result: Option<RunStatus> = None;

    while let Some(stream_event) = handle.rx.recv().await {
        match stream_event {
            CodexStreamEvent::Event(event) => {
                let result = parse_codex_event(&event);

                // Track thread id
                if let Some(tid) = &result.thread_id {
                    if announced_thread_id.as_ref() != Some(tid) {
                        announced_thread_id = Some(tid.clone());
                        (cb.on_thread_ready)(tid.clone());
                    }
                }

                if let Some(summary) = &result.summary {
                    latest_summary = Some(summary.clone());
                    (cb.on_event)(current_status.clone(), Some(summary.clone()), None);
                }

                for item in result.items {
                    (cb.on_item)(item);
                }

                if matches!(event, CodexEvent::TurnCompleted { .. }) {
                    saw_turn_completed = true;
                }

                if let Some(fs) = result.final_status {
                    final_result = Some(fs);
                    break;
                }
            }
            CodexStreamEvent::Done => break,
            CodexStreamEvent::Error(e) => {
                error!("Codex stream error: {e}");
                (cb.on_item)(RunTimelineEventPayload::Activity {
                    status: RunTimelineEventStatus::Error,
                    label: "Run failed".to_string(),
                    detail: Some(e.clone()),
                });
                final_result = Some(RunStatus::Failed);
                break;
            }
        }
    }

    prepared.cleanup().await;

    let final_status = final_result.unwrap_or_else(|| {
        if interrupted {
            RunStatus::Interrupted
        } else if saw_turn_completed {
            RunStatus::Success
        } else {
            RunStatus::Failed
        }
    });

    complete_run(&opts.repo_path, final_status.clone(), &latest_summary, cb).await;
}

// ---------------------------------------------------------------------------
// Claude run
// ---------------------------------------------------------------------------

async fn run_claude<FEvent, FFinish, FItem, FThread>(
    opts: RunWrapperOptions,
    cb: &mut RunCallbacks<FEvent, FFinish, FItem, FThread>,
) where
    FEvent: FnMut(RunStatus, Option<String>, Option<bool>),
    FFinish: FnMut(RunStatus),
    FItem: FnMut(RunTimelineEventPayload),
    FThread: FnMut(String),
{
    (cb.on_event)(RunStatus::Starting, None, None);
    (cb.on_item)(RunTimelineEventPayload::Activity {
        status: RunTimelineEventStatus::Info,
        label: "Starting Claude".to_string(),
        detail: Some(opts.repo_path.clone()),
    });

    let clear_session = opts.options.clear_session.unwrap_or(false);
    let resume = if clear_session {
        None
    } else {
        opts.tool_thread_id.clone()
    };

    let claude_opts = ClaudeClientOptions {
        cwd: opts.repo_path.clone(),
        resume,
        model: opts.options.model.clone(),
        effort: opts.options.claude_effort.as_ref().map(|e| format!("{e:?}").to_lowercase()),
        attachments: opts.attachments.clone(),
    };

    let mut handle = match start_claude(&opts.prompt, &claude_opts) {
        Ok(h) => h,
        Err(e) => {
            (cb.on_item)(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Run failed".to_string(),
                detail: Some(e.clone()),
            });
            let has_diff = detect_repo_changes(&opts.repo_path).await;
            (cb.on_event)(RunStatus::Failed, Some(e), Some(has_diff));
            (cb.on_finish)(RunStatus::Failed);
            return;
        }
    };

    let mut parser = ClaudeMessageParser::new();
    (cb.on_event)(RunStatus::Running, None, None);

    let current_status = RunStatus::Running;
    let mut latest_summary: Option<String> = None;
    let interrupted = false;
    let mut announced_thread_id = opts.tool_thread_id.clone();
    let mut final_result: Option<RunStatus> = None;

    while let Some(stream_event) = handle.rx.recv().await {
        match stream_event {
            ClaudeStreamEvent::Message(msg) => {
                // Track session_id
                if let Some(sid) = &msg.session_id {
                    if announced_thread_id.as_ref() != Some(sid) {
                        announced_thread_id = Some(sid.clone());
                        (cb.on_thread_ready)(sid.clone());
                    }
                }

                let result = parser.parse(&msg);

                if let Some(summary) = &result.summary {
                    latest_summary = Some(summary.clone());
                    (cb.on_event)(current_status.clone(), Some(summary.clone()), None);
                }

                for item in result.items {
                    (cb.on_item)(item);
                }

                if let Some(fs) = result.final_status {
                    let status = if interrupted {
                        RunStatus::Interrupted
                    } else {
                        fs
                    };
                    final_result = Some(status);
                    break;
                }
            }
            ClaudeStreamEvent::Done => break,
            ClaudeStreamEvent::Error(e) => {
                error!("Claude stream error: {e}");
                (cb.on_item)(RunTimelineEventPayload::Activity {
                    status: RunTimelineEventStatus::Error,
                    label: "Run failed".to_string(),
                    detail: Some(e.clone()),
                });
                final_result = Some(RunStatus::Failed);
                break;
            }
        }
    }

    let final_status = final_result.unwrap_or_else(|| {
        if interrupted {
            RunStatus::Interrupted
        } else {
            RunStatus::Failed
        }
    });

    complete_run(&opts.repo_path, final_status, &latest_summary, cb).await;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async fn complete_run<FEvent, FFinish, FItem, FThread>(
    repo_path: &str,
    final_status: RunStatus,
    latest_summary: &Option<String>,
    cb: &mut RunCallbacks<FEvent, FFinish, FItem, FThread>,
) where
    FEvent: FnMut(RunStatus, Option<String>, Option<bool>),
    FFinish: FnMut(RunStatus),
    FItem: FnMut(RunTimelineEventPayload),
    FThread: FnMut(String),
{
    let has_diff = detect_repo_changes(repo_path).await;

    match &final_status {
        RunStatus::Success => {
            (cb.on_item)(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Success,
                label: "Run completed".to_string(),
                detail: None,
            });
        }
        RunStatus::Failed => {
            (cb.on_item)(RunTimelineEventPayload::Activity {
                status: RunTimelineEventStatus::Error,
                label: "Run failed".to_string(),
                detail: None,
            });
        }
        _ => {}
    }

    (cb.on_event)(
        final_status.clone(),
        latest_summary.clone(),
        Some(has_diff),
    );
    (cb.on_finish)(final_status);
}

/// Detect uncommitted changes in a git repo via `git status --porcelain`.
pub async fn detect_repo_changes(repo_path: &str) -> bool {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;

    match output {
        Ok(o) => !o.stdout.is_empty(),
        Err(_) => false,
    }
}
