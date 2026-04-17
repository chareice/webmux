use bytes::Bytes;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::pty::spawn_tmux_attach;

/// Reason a per-client tmux attach ended.
#[derive(Debug, Clone)]
pub enum AttachExitReason {
    /// Hub asked us to close (the consumer dropped events_rx). Treated the
    /// same as a clean close from the user's point of view.
    HubRequested,
    /// The tmux attach process exited (PTY EOF or `tmux ls` lost the
    /// session). Includes shell-died, session-killed, tmux-server-died.
    ProcessExited,
    /// Could not spawn the attach or read from its PTY. Should be rare.
    IoError(String),
}

impl std::fmt::Display for AttachExitReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HubRequested => write!(f, "hub requested close"),
            Self::ProcessExited => write!(f, "tmux attach process exited"),
            Self::IoError(e) => write!(f, "io error: {}", e),
        }
    }
}

/// Outbound event from a single attach task to the hub-conn forwarding loop.
#[derive(Debug)]
pub enum AttachEvent {
    Output(Bytes),
    Died(AttachExitReason),
}

/// Per-machine collection of live attaches.
///
/// Each attach owns one `tmux attach-session` subprocess + the PTY it speaks
/// over. Browsers don't share attaches; tmux's multi-client design gives
/// each browser an independent client view of the same session.
pub struct AttachManager {
    inner: Arc<Mutex<HashMap<String, AttachHandle>>>,
}

struct AttachHandle {
    /// Sending here writes to the attach's PTY (i.e., the user's input).
    /// Dropping this is the close signal — the writer thread sees the
    /// channel close, kills the tmux attach child, and the reader thread
    /// follows on PTY EOF.
    input_tx: mpsc::Sender<Bytes>,
    /// Recorded so callers can look up which session this attach belongs to
    /// (e.g., to issue `tmux resize-window` against the right session).
    session_id: String,
}

impl AttachManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Open a new attach for the given session. Returns a receiver that
    /// yields one `AttachEvent::Output` per chunk read from the PTY,
    /// followed by exactly one `AttachEvent::Died` when the attach ends.
    pub async fn open(
        &self,
        attach_id: String,
        session_id: String,
        cols: u16,
        rows: u16,
    ) -> mpsc::Receiver<AttachEvent> {
        let (events_tx, events_rx) = mpsc::channel::<AttachEvent>(64);
        let (input_tx, input_rx) = mpsc::channel::<Bytes>(64);

        self.inner.lock().await.insert(
            attach_id.clone(),
            AttachHandle {
                input_tx,
                session_id: session_id.clone(),
            },
        );

        std::thread::spawn(move || {
            run_attach_task(attach_id, session_id, cols, rows, events_tx, input_rx);
        });

        events_rx
    }

    pub async fn write_input(&self, attach_id: &str, data: Bytes) -> bool {
        // Clone the sender out from under the lock; awaiting send() while
        // holding the async Mutex would block close() / close_all() /
        // session_of() if the writer thread is slow to drain input_rx.
        let input_tx = {
            let inner = self.inner.lock().await;
            inner.get(attach_id).map(|handle| handle.input_tx.clone())
        };
        if let Some(input_tx) = input_tx {
            input_tx.send(data).await.is_ok()
        } else {
            false
        }
    }

    /// Drop the attach handle. The writer thread sees its input channel
    /// close, kills the tmux attach child, and the reader thread exits on
    /// PTY EOF — eventually emitting an `AttachEvent::Died` to the consumer.
    pub async fn close(&self, attach_id: &str) {
        self.inner.lock().await.remove(attach_id);
    }

    pub async fn close_all(&self) {
        self.inner.lock().await.clear();
    }

    pub async fn session_of(&self, attach_id: &str) -> Option<String> {
        self.inner
            .lock()
            .await
            .get(attach_id)
            .map(|h| h.session_id.clone())
    }
}

impl Default for AttachManager {
    fn default() -> Self {
        Self::new()
    }
}

fn run_attach_task(
    attach_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    events_tx: mpsc::Sender<AttachEvent>,
    mut input_rx: mpsc::Receiver<Bytes>,
) {
    let _ = attach_id; // reserved for tracing in a future change

    // Spawn the tmux attach. On failure we report Died and bail.
    let (mut writer, reader, mut child) = match spawn_tmux_attach(&session_id, cols, rows) {
        Ok(v) => v,
        Err(e) => {
            let _ = events_tx.blocking_send(AttachEvent::Died(AttachExitReason::IoError(e)));
            return;
        }
    };

    // Reader thread: blocking PTY reads → events_tx. Owns the reader handle
    // and emits the Died event when the PTY closes (which happens on shell
    // exit, tmux session kill, or this main thread killing the child).
    let reader_events_tx = events_tx.clone();
    let reader_handle = std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 16_384];
        let exit = loop {
            match reader.read(&mut buf) {
                Ok(0) => break AttachExitReason::ProcessExited,
                Ok(n) => {
                    let chunk = Bytes::copy_from_slice(&buf[..n]);
                    if reader_events_tx
                        .blocking_send(AttachEvent::Output(chunk))
                        .is_err()
                    {
                        // Consumer of events_rx is gone; nothing left to do.
                        break AttachExitReason::HubRequested;
                    }
                }
                Err(e) => break AttachExitReason::IoError(e.to_string()),
            }
        };
        let _ = reader_events_tx.blocking_send(AttachEvent::Died(exit));
    });

    // Writer loop on this thread: input_rx → PTY. Exits when input_tx is
    // dropped (close_attach / AttachManager dropped).
    while let Some(chunk) = input_rx.blocking_recv() {
        if writer.write_all(&chunk).is_err() {
            break;
        }
        let _ = writer.flush();
    }

    // Force the child down so the reader thread sees PTY EOF and finishes.
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader_handle.join();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity check: the manager can be constructed and cleaned up without
    /// spawning anything. Real attach behavior is exercised by the new E2E
    /// specs (`terminal-multi-attach`, `terminal-attach-recovery`); a unit
    /// test would need an injectable tmux socket which the current
    /// `spawn_tmux_attach` doesn't expose.
    #[tokio::test]
    async fn manager_construct_and_drop() {
        let mgr = AttachManager::new();
        mgr.close_all().await;
    }
}
