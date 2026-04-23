use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use crate::pty::{tmux_list_sessions, tmux_session_name, PtyManager};

/// Outbound message: a terminal id whose tmux session vanished.
#[derive(Debug, Clone)]
pub struct TerminalDeath {
    pub terminal_id: String,
}

/// Polls `tmux ls` every `interval` and reports terminals that disappeared
/// from the live list.
///
/// The new architecture spawns tmux attach subprocesses on-demand (per
/// browser WS); when zero browsers are attached, no one is reading the
/// PTY of any tmux client and so PTY-EOF death detection is unavailable.
/// This watcher fills that gap with a low-frequency poll.
pub struct SessionWatcher {
    handle: Option<JoinHandle<()>>,
}

impl SessionWatcher {
    pub fn start(
        pty: Arc<PtyManager>,
        deaths_tx: mpsc::UnboundedSender<TerminalDeath>,
        interval: Duration,
    ) -> Self {
        // Don't re-emit a death if PtyManager hasn't pruned the entry yet
        // (shouldn't normally happen, but the guard is cheap and prevents
        // dupe flooding the hub).
        let reported: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                let known: Vec<String> = pty.list_terminal_ids();
                let alive_names: HashSet<String> = tmux_list_sessions().into_iter().collect();
                for id in known {
                    let expected_name = tmux_session_name(&id);
                    if !alive_names.contains(&expected_name) {
                        let mut reported_g = reported.lock().await;
                        if reported_g.insert(id.clone()) {
                            let _ = deaths_tx.send(TerminalDeath { terminal_id: id });
                        }
                    }
                }
            }
        });
        Self {
            handle: Some(handle),
        }
    }
}

impl Drop for SessionWatcher {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}
