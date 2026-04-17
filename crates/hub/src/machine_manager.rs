use bytes::Bytes;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tc_protocol::{
    BrowserEvent, BrowserEventEnvelope, BrowserStateSnapshot, ControlLeaseSnapshot, DirEntry,
    HubToMachine, MachineInfo, MachineStatsSnapshot, MachineToHub, TerminalInfo,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

struct ModeState {
    control_leases: HashMap<String, String>,
    connected_devices: HashMap<String, usize>,
    /// Leases released by grace-period disconnect, keyed by device_id → Vec<machine_id>.
    /// Restored when the same device reconnects, if no other device claimed them.
    released_leases: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug)]
pub struct EventEnvelope {
    pub seq: u64,
    pub target_user_id: Option<String>,
    pub event: BrowserEvent,
}

/// Pending request waiting for a Machine response
type PendingResponse = oneshot::Sender<Result<PendingResult, String>>;

pub enum PendingResult {
    TerminalCreated {
        terminal_id: String,
        title: String,
        cwd: String,
        cols: u16,
        rows: u16,
    },
    FsListResult {
        entries: Vec<DirEntry>,
    },
    ForegroundProcessResult {
        has_foreground_process: bool,
        process_name: Option<String>,
    },
}

pub struct EventSubscription {
    pub replay: Vec<BrowserEventEnvelope>,
    pub receiver: broadcast::Receiver<EventEnvelope>,
    pub requires_resync: bool,
}

/// How the hub decided to respond to a terminal-output subscribe request.
/// See docs/superpowers/specs/2026-04-17-terminal-resume-protocol-design.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachMode {
    /// Initial attach — client had no prior state. Replay is the hub's buffer.
    Full,
    /// Client's after_seq was in range. Replay is the bytes since that seq (possibly empty).
    Delta,
    /// Client's after_seq was outside the hub's buffer window (stale) or past current
    /// (e.g. hub restarted). Replay is the full buffer; client must clear its terminal first.
    Reset,
}

pub struct TerminalSubscription {
    pub mode: AttachMode,
    /// Hub's current output_seq for the terminal at subscribe time.
    pub seq: u64,
    /// Bytes the client should write. Semantics depend on `mode`.
    pub replay: Vec<u8>,
    pub output_rx: broadcast::Receiver<Bytes>,
}

const OUTPUT_BUFFER_SIZE: usize = 64 * 1024;
const EVENT_HISTORY_LIMIT: usize = 1024;
/// Safety offset added to persisted event sequence on recovery.
/// Must exceed the maximum number of events that can go unflushed
/// (flush cadence is every 100 events or 5 seconds).
const SEQ_RECOVERY_OFFSET: u64 = 200;

/// A connected machine
struct MachineConnection {
    /// Unique connection ID (changes on reconnect)
    pub conn_id: String,
    pub info: MachineInfo,
    pub user_id: Option<String>,
    /// Send commands to this machine
    pub cmd_tx: mpsc::Sender<HubToMachine>,
    /// Terminal IDs hosted on this machine
    pub terminals: HashMap<String, TerminalInfo>,
    /// Terminal output subscribers: terminal_id -> broadcast sender
    pub output_channels: HashMap<String, broadcast::Sender<Bytes>>,
    /// Terminal output buffers for replay on new subscriber
    pub output_buffers: HashMap<String, Vec<u8>>,
    /// Monotonically increasing total bytes emitted for each terminal. Used by the
    /// resume protocol — clients can subscribe with an `after_seq` to receive only
    /// bytes since their last seen offset.
    pub output_seqs: HashMap<String, u64>,
    /// Latest resource stats from this machine
    pub latest_stats: Option<tc_protocol::ResourceStats>,
}

pub struct MachineManager {
    machines: Arc<Mutex<HashMap<String, MachineConnection>>>,
    /// Pending request/response tracking
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    /// Browser events broadcast
    event_tx: broadcast::Sender<EventEnvelope>,
    event_history: Arc<std::sync::Mutex<VecDeque<EventEnvelope>>>,
    next_event_seq: AtomicU64,
    mode: Arc<std::sync::Mutex<HashMap<String, ModeState>>>,
    db: crate::db::DbPool,
    /// Persisted terminals loaded at startup, consumed during machine reconnect reconciliation
    persisted_terminals: Arc<Mutex<HashMap<String, Vec<TerminalInfo>>>>,
}

impl MachineManager {
    pub fn new(db: crate::db::DbPool) -> Self {
        // Load persisted event sequence
        let initial_seq = {
            let conn = db.get().expect("Failed to get DB connection for startup");
            crate::db::hub_state::get(&conn, "next_event_seq")
                .ok()
                .flatten()
                .and_then(|v| v.parse::<u64>().ok())
                .map(|v| v + SEQ_RECOVERY_OFFSET)
                .unwrap_or(0)
        };

        // Load persisted active terminals
        let persisted_terminals = {
            let conn = db.get().expect("Failed to get DB connection for startup");
            let rows = crate::db::terminal_sessions::find_all_active(&conn).unwrap_or_default();
            let mut by_machine: HashMap<String, Vec<TerminalInfo>> = HashMap::new();
            for row in rows {
                by_machine
                    .entry(row.machine_id.clone())
                    .or_default()
                    .push(TerminalInfo {
                        id: row.id,
                        machine_id: row.machine_id,
                        title: row.title,
                        cwd: row.cwd,
                        cols: u16::try_from(row.cols).unwrap_or(80),
                        rows: u16::try_from(row.rows).unwrap_or(24),
                        reachable: false,
                    });
            }
            by_machine
        };

        let (event_tx, _) = broadcast::channel(256);
        Self {
            machines: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            event_history: Arc::new(std::sync::Mutex::new(VecDeque::with_capacity(
                EVENT_HISTORY_LIMIT,
            ))),
            next_event_seq: AtomicU64::new(initial_seq),
            mode: Arc::new(std::sync::Mutex::new(HashMap::new())),
            db,
            persisted_terminals: Arc::new(Mutex::new(persisted_terminals)),
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<EventEnvelope> {
        self.event_tx.subscribe()
    }

    pub fn subscribe_events_after(&self, user_id: &str, after_seq: u64) -> EventSubscription {
        self.build_event_subscription(Some(user_id), after_seq)
    }

    pub fn subscribe_public_events_after(&self, after_seq: u64) -> EventSubscription {
        self.build_event_subscription(None, after_seq)
    }

    /// Register a machine connection. Returns (conn_id, cmd_receiver).
    pub async fn register_machine(
        &self,
        info: MachineInfo,
        user_id: Option<String>,
    ) -> (String, mpsc::Receiver<HubToMachine>) {
        let (cmd_tx, cmd_rx) = mpsc::channel(256);
        let machine_id = info.id.clone();
        let conn_id = uuid::Uuid::new_v4().to_string();

        let conn = MachineConnection {
            conn_id: conn_id.clone(),
            info: info.clone(),
            user_id: user_id.clone(),
            cmd_tx,
            terminals: HashMap::new(),
            output_channels: HashMap::new(),
            output_buffers: HashMap::new(),
            output_seqs: HashMap::new(),
            latest_stats: None,
        };

        self.machines.lock().await.insert(machine_id, conn);

        self.send_event(user_id, BrowserEvent::MachineOnline { machine: info });

        (conn_id, cmd_rx)
    }

    /// Unregister a machine when it disconnects. Only removes if conn_id matches.
    /// Terminals are preserved as unreachable (moved to persisted_terminals) instead of being destroyed.
    pub async fn unregister_machine(&self, machine_id: &str, conn_id: &str) {
        let mut machines = self.machines.lock().await;
        let should_remove = machines
            .get(machine_id)
            .map(|c| c.conn_id == conn_id)
            .unwrap_or(false);
        if !should_remove {
            return;
        }
        if let Some(conn) = machines.remove(machine_id) {
            let target_user_id = conn.user_id.clone();

            // Move terminals to persisted_terminals instead of destroying them
            if !conn.terminals.is_empty() {
                let unreachable_terminals: Vec<TerminalInfo> = conn
                    .terminals
                    .values()
                    .map(|t| TerminalInfo {
                        reachable: false,
                        ..t.clone()
                    })
                    .collect();

                // Send reachable_changed events for each terminal
                for terminal in &unreachable_terminals {
                    self.send_event(
                        target_user_id.clone(),
                        BrowserEvent::TerminalReachableChanged {
                            machine_id: machine_id.to_string(),
                            terminal_id: terminal.id.clone(),
                            reachable: false,
                        },
                    );
                }

                self.persisted_terminals
                    .lock()
                    .await
                    .insert(machine_id.to_string(), unreachable_terminals);
            }

            self.send_event(
                target_user_id,
                BrowserEvent::MachineOffline {
                    machine_id: machine_id.to_string(),
                },
            );
        }
    }

    /// List all online machines
    pub async fn list_machines(&self) -> Vec<MachineInfo> {
        self.machines
            .lock()
            .await
            .values()
            .map(|c| c.info.clone())
            .collect()
    }

    pub async fn list_machines_for_user(&self, user_id: &str) -> Vec<MachineInfo> {
        self.machines
            .lock()
            .await
            .values()
            .filter(|conn| connection_visible_to(conn, user_id))
            .map(|conn| conn.info.clone())
            .collect()
    }

    /// List all terminals across all machines (or for a specific machine)
    pub async fn list_terminals(&self, machine_id: Option<&str>) -> Vec<TerminalInfo> {
        let machines = self.machines.lock().await;
        let mut result = Vec::new();
        for (mid, conn) in machines.iter() {
            if let Some(filter) = machine_id {
                if mid != filter {
                    continue;
                }
            }
            result.extend(conn.terminals.values().cloned());
        }
        result
    }

    pub async fn list_terminals_for_user(
        &self,
        user_id: &str,
        machine_id: Option<&str>,
    ) -> Vec<TerminalInfo> {
        let machines = self.machines.lock().await;
        let mut result = Vec::new();
        for (mid, conn) in machines.iter() {
            if !connection_visible_to(conn, user_id) {
                continue;
            }
            if let Some(filter) = machine_id {
                if mid != filter {
                    continue;
                }
            }
            result.extend(conn.terminals.values().cloned());
        }
        result
    }

    pub async fn user_can_access_machine(&self, user_id: &str, machine_id: &str) -> bool {
        self.machines
            .lock()
            .await
            .get(machine_id)
            .map(|conn| connection_visible_to(conn, user_id))
            .unwrap_or(false)
    }

    pub async fn user_can_access_terminal(
        &self,
        user_id: &str,
        machine_id: &str,
        terminal_id: &str,
    ) -> bool {
        self.machines
            .lock()
            .await
            .get(machine_id)
            .map(|conn| {
                connection_visible_to(conn, user_id) && conn.terminals.contains_key(terminal_id)
            })
            .unwrap_or(false)
    }

    /// Send a create terminal command to a machine and wait for the response
    pub async fn create_terminal(
        &self,
        machine_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        startup_command: Option<String>,
    ) -> Result<TerminalInfo, String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        // Register pending request
        let rx = self.register_pending(&request_id).await;

        // Send command to machine
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                drop(machines);
                self.remove_pending(&request_id).await;
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        if let Err(_error) = cmd_tx
            .send(HubToMachine::CreateTerminal {
                request_id: request_id.clone(),
                cwd: cwd.to_string(),
                cols,
                rows,
                startup_command,
            })
            .await
        {
            self.remove_pending(&request_id).await;
            return Err("Machine disconnected".to_string());
        }

        // Wait for response with timeout
        let result = match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                self.remove_pending(&request_id).await;
                return Err("Machine disconnected".to_string());
            }
            Err(_) => {
                self.remove_pending(&request_id).await;
                return Err("Timeout waiting for terminal creation".to_string());
            }
        };

        match result? {
            PendingResult::TerminalCreated {
                terminal_id,
                title,
                cwd,
                cols,
                rows,
            } => {
                let terminal = TerminalInfo {
                    id: terminal_id,
                    machine_id: machine_id.to_string(),
                    title,
                    cwd,
                    cols,
                    rows,
                    reachable: true,
                };
                Ok(terminal)
            }
            _ => Err("Unexpected response".to_string()),
        }
    }

    /// Destroy a terminal on a machine
    pub async fn destroy_terminal(
        &self,
        machine_id: &str,
        terminal_id: &str,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::DestroyTerminal {
                terminal_id: terminal_id.to_string(),
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;
        Ok(())
    }

    /// Check if a terminal has a foreground process running
    pub async fn check_foreground_process(
        &self,
        machine_id: &str,
        terminal_id: &str,
    ) -> Result<(bool, Option<String>), String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        let rx = self.register_pending(&request_id).await;

        // Send command; clean up pending entry on failure
        {
            let machines = self.machines.lock().await;
            let conn = match machines.get(machine_id) {
                Some(c) => c,
                None => {
                    self.pending.lock().await.remove(&request_id);
                    return Err(format!("Machine {} not found", machine_id));
                }
            };
            if conn
                .cmd_tx
                .send(HubToMachine::CheckForegroundProcess {
                    request_id: request_id.clone(),
                    terminal_id: terminal_id.to_string(),
                })
                .await
                .is_err()
            {
                self.pending.lock().await.remove(&request_id);
                return Err("Machine disconnected".to_string());
            }
        }

        // Wait for response; clean up pending entry on timeout/disconnect
        let result = match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&request_id);
                return Err("Machine disconnected".to_string());
            }
            Err(_) => {
                self.pending.lock().await.remove(&request_id);
                return Err("Timeout".to_string());
            }
        };

        match result? {
            PendingResult::ForegroundProcessResult {
                has_foreground_process,
                process_name,
            } => Ok((has_foreground_process, process_name)),
            _ => Err("Unexpected response".to_string()),
        }
    }

    /// Send input to a terminal
    pub async fn send_input(
        &self,
        machine_id: &str,
        terminal_id: &str,
        data: &str,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::TerminalInput {
                terminal_id: terminal_id.to_string(),
                data: data.to_string(),
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;
        Ok(())
    }

    /// Send an arbitrary `HubToMachine` command to the machine. Used by the
    /// per-attach WS handler to forward `OpenAttach` / `CloseAttach` /
    /// `AttachInput` etc. without each variant needing its own helper.
    pub async fn send_to_machine(
        &self,
        machine_id: &str,
        msg: HubToMachine,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(msg)
            .await
            .map_err(|_| "Machine disconnected".to_string())
    }

    /// Look up the (cols, rows) of a terminal. The hub-side WS handler uses
    /// this to open a new tmux attach at the right initial size.
    pub async fn terminal_dimensions(
        &self,
        machine_id: &str,
        terminal_id: &str,
    ) -> Option<(u16, u16)> {
        let machines = self.machines.lock().await;
        machines
            .get(machine_id)
            .and_then(|conn| conn.terminals.get(terminal_id))
            .map(|t| (t.cols, t.rows))
    }

    /// Resize a terminal
    pub async fn resize_terminal(
        &self,
        machine_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let (cmd_tx, target_user_id) = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                return Err(format!("Machine {} not found", machine_id));
            };
            if !conn.terminals.contains_key(terminal_id) {
                return Err(format!("Terminal {} not found", terminal_id));
            }
            (conn.cmd_tx.clone(), conn.user_id.clone())
        };
        cmd_tx
            .send(HubToMachine::TerminalResize {
                terminal_id: terminal_id.to_string(),
                cols,
                rows,
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;

        let updated_terminal = {
            let mut machines = self.machines.lock().await;
            let Some(conn) = machines.get_mut(machine_id) else {
                return Ok(());
            };
            let Some(terminal) = conn.terminals.get_mut(terminal_id) else {
                return Ok(());
            };
            terminal.cols = cols;
            terminal.rows = rows;
            terminal.clone()
        };

        // Persist size change to DB
        if let Ok(db_conn) = self.db.get() {
            if let Err(e) = crate::db::terminal_sessions::update_size(&db_conn, terminal_id, cols, rows) {
                tracing::warn!("Failed to persist terminal size update: {}", e);
            }
        }

        self.send_event(
            target_user_id,
            BrowserEvent::TerminalResized {
                terminal: updated_terminal,
            },
        );
        Ok(())
    }

    /// Send image paste to a terminal on a machine
    pub async fn send_image_paste(
        &self,
        machine_id: &str,
        terminal_id: &str,
        data: &str,
        mime: &str,
        filename: &str,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::ImagePaste {
                terminal_id: terminal_id.to_string(),
                data: data.to_string(),
                mime: mime.to_string(),
                filename: filename.to_string(),
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;
        Ok(())
    }

    /// Request directory listing from a machine
    pub async fn list_directory(
        &self,
        machine_id: &str,
        path: &str,
    ) -> Result<Vec<DirEntry>, String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        let rx = self.register_pending(&request_id).await;

        let cmd_tx = {
            let machines = self.machines.lock().await;
            let Some(conn) = machines.get(machine_id) else {
                drop(machines);
                self.remove_pending(&request_id).await;
                return Err(format!("Machine {} not found", machine_id));
            };
            conn.cmd_tx.clone()
        };
        if let Err(_error) = cmd_tx
            .send(HubToMachine::FsListDir {
                request_id: request_id.clone(),
                path: path.to_string(),
            })
            .await
        {
            self.remove_pending(&request_id).await;
            return Err("Machine disconnected".to_string());
        }

        let result = match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                self.remove_pending(&request_id).await;
                return Err("Machine disconnected".to_string());
            }
            Err(_) => {
                self.remove_pending(&request_id).await;
                return Err("Timeout".to_string());
            }
        };

        match result? {
            PendingResult::FsListResult { entries } => Ok(entries),
            _ => Err("Unexpected response".to_string()),
        }
    }

    /// Subscribe to terminal output. Returns (buffered_output, receiver).
    pub async fn subscribe_terminal_output(
        &self,
        machine_id: &str,
        terminal_id: &str,
    ) -> Result<(Vec<u8>, broadcast::Receiver<Bytes>), String> {
        let sub = self
            .subscribe_terminal_output_from(machine_id, terminal_id, None)
            .await?;
        Ok((sub.replay, sub.output_rx))
    }

    /// Resume-aware subscribe. When `after_seq` is provided the hub returns only the
    /// bytes the client has not yet seen (`Delta`), or signals the client to clear
    /// its terminal when the request falls outside the retained window (`Reset`).
    /// Passing `None` is equivalent to an initial attach (`Full`).
    pub async fn subscribe_terminal_output_from(
        &self,
        machine_id: &str,
        terminal_id: &str,
        after_seq: Option<u64>,
    ) -> Result<TerminalSubscription, String> {
        let machines = self.machines.lock().await;
        let conn = machines
            .get(machine_id)
            .ok_or_else(|| format!("Machine {} not found", machine_id))?;
        let tx = conn
            .output_channels
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;
        let buffer = conn
            .output_buffers
            .get(terminal_id)
            .cloned()
            .unwrap_or_default();
        let seq = conn
            .output_seqs
            .get(terminal_id)
            .copied()
            .unwrap_or(0);

        let (mode, replay) = match after_seq {
            None => (AttachMode::Full, buffer),
            Some(n) if n == seq => (AttachMode::Delta, Vec::new()),
            Some(n) if n > seq => (AttachMode::Reset, buffer),
            Some(n) => {
                // Keep the delta in u64 until we've verified it fits: on 32-bit
                // targets `seq - n` can be large enough to truncate when cast to
                // usize and slip through the bound check.
                let delta = seq - n;
                if delta <= buffer.len() as u64 {
                    let delta = delta as usize;
                    let start = buffer.len() - delta;
                    (AttachMode::Delta, buffer[start..].to_vec())
                } else {
                    (AttachMode::Reset, buffer)
                }
            }
        };

        Ok(TerminalSubscription {
            mode,
            seq,
            replay,
            output_rx: tx.subscribe(),
        })
    }

    /// Handle a message from a machine
    pub async fn handle_machine_message(&self, machine_id: &str, msg: MachineToHub) {
        match msg {
            MachineToHub::Register { .. } => {
                // Already handled during connection setup in ws.rs
            }
            MachineToHub::TerminalCreated {
                request_id,
                terminal_id,
                title,
                cwd,
                cols,
                rows,
            } => {
                // Create output channel for this terminal
                let (output_tx, _) = broadcast::channel(256);
                {
                    let mut machines = self.machines.lock().await;
                    if let Some(conn) = machines.get_mut(machine_id) {
                        let target_user_id = conn.user_id.clone();
                        let terminal = TerminalInfo {
                            id: terminal_id.clone(),
                            machine_id: machine_id.to_string(),
                            title: title.clone(),
                            cwd: cwd.clone(),
                            cols,
                            rows,
                            reachable: true,
                        };
                        conn.terminals.insert(terminal_id.clone(), terminal.clone());
                        conn.output_channels.insert(terminal_id.clone(), output_tx);

                        self.send_event(target_user_id, BrowserEvent::TerminalCreated { terminal });
                    }
                }

                // Persist to DB
                if let Ok(db_conn) = self.db.get() {
                    if let Err(e) = crate::db::terminal_sessions::insert(
                        &db_conn,
                        &terminal_id,
                        machine_id,
                        &title,
                        &cwd,
                        cols,
                        rows,
                    ) {
                        tracing::warn!("Failed to persist terminal session: {}", e);
                    }
                }

                // Resolve pending request
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Ok(PendingResult::TerminalCreated {
                        terminal_id,
                        title,
                        cwd,
                        cols,
                        rows,
                    }));
                }
            }
            MachineToHub::TerminalCreateError { request_id, error } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Err(error));
                }
            }
            MachineToHub::TerminalDestroyed { terminal_id } => {
                let mut machines = self.machines.lock().await;
                if let Some(conn) = machines.get_mut(machine_id) {
                    let target_user_id = conn.user_id.clone();
                    conn.terminals.remove(&terminal_id);
                    conn.output_channels.remove(&terminal_id);
                    conn.output_buffers.remove(&terminal_id);
                    conn.output_seqs.remove(&terminal_id);
                    // Persist to DB before terminal_id is moved into the event
                    if let Ok(db_conn) = self.db.get() {
                        if let Err(e) = crate::db::terminal_sessions::mark_destroyed(&db_conn, &terminal_id) {
                            tracing::warn!("Failed to mark terminal session as destroyed: {}", e);
                        }
                    }
                    self.send_event(
                        target_user_id,
                        BrowserEvent::TerminalDestroyed {
                            machine_id: machine_id.to_string(),
                            terminal_id,
                        },
                    );
                    return;
                }
            }
            MachineToHub::TerminalOutput { terminal_id, data } => {
                self.handle_terminal_output(machine_id, &terminal_id, data.into_bytes().into())
                    .await;
            }
            MachineToHub::FsListResult {
                request_id,
                entries,
            } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Ok(PendingResult::FsListResult { entries }));
                }
            }
            MachineToHub::FsListError { request_id, error } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Err(error));
                }
            }
            MachineToHub::ExistingTerminals { terminals } => {
                tracing::info!(
                    "Machine {} reported {} existing terminals",
                    machine_id,
                    terminals.len()
                );

                let reported_ids: HashSet<String> =
                    terminals.iter().map(|t| t.id.clone()).collect();

                // Get persisted terminals for this machine (if any)
                let persisted = self
                    .persisted_terminals
                    .lock()
                    .await
                    .remove(machine_id)
                    .unwrap_or_default();
                let persisted_ids: HashSet<String> =
                    persisted.iter().map(|t| t.id.clone()).collect();

                let mut machines = self.machines.lock().await;
                if let Some(conn) = machines.get_mut(machine_id) {
                    let target_user_id = conn.user_id.clone();

                    // 1. Terminals reported by machine
                    for terminal in terminals {
                        let (output_tx, _) = broadcast::channel(256);
                        conn.terminals.insert(terminal.id.clone(), terminal.clone());
                        conn.output_channels.insert(terminal.id.clone(), output_tx);

                        if let Ok(db_conn) = self.db.get() {
                            if persisted_ids.contains(&terminal.id) {
                                // Update metadata from machine (machine is ground truth)
                                if let Err(e) = crate::db::terminal_sessions::update_metadata(
                                    &db_conn,
                                    &terminal.id,
                                    &terminal.title,
                                    &terminal.cwd,
                                    terminal.cols,
                                    terminal.rows,
                                ) {
                                    tracing::warn!("Failed to update terminal session metadata: {}", e);
                                }
                            } else {
                                // New terminal — insert to DB
                                if let Err(e) = crate::db::terminal_sessions::insert(
                                    &db_conn,
                                    &terminal.id,
                                    machine_id,
                                    &terminal.title,
                                    &terminal.cwd,
                                    terminal.cols,
                                    terminal.rows,
                                ) {
                                    tracing::warn!("Failed to persist terminal session on reconnect: {}", e);
                                }
                            }
                        }

                        if persisted_ids.contains(&terminal.id) {
                            // Was persisted, now reachable again
                            self.send_event(
                                target_user_id.clone(),
                                BrowserEvent::TerminalReachableChanged {
                                    machine_id: machine_id.to_string(),
                                    terminal_id: terminal.id.clone(),
                                    reachable: true,
                                },
                            );
                        } else {
                            // Brand new terminal
                            self.send_event(
                                target_user_id.clone(),
                                BrowserEvent::TerminalCreated { terminal },
                            );
                        }
                    }

                    // 2. Persisted terminals NOT reported by machine — they died
                    for old_terminal in &persisted {
                        if !reported_ids.contains(&old_terminal.id) {
                            if let Ok(db_conn) = self.db.get() {
                                if let Err(e) = crate::db::terminal_sessions::mark_destroyed(
                                    &db_conn,
                                    &old_terminal.id,
                                ) {
                                    tracing::warn!("Failed to mark stale terminal session as destroyed: {}", e);
                                }
                            }
                            self.send_event(
                                target_user_id.clone(),
                                BrowserEvent::TerminalDestroyed {
                                    machine_id: machine_id.to_string(),
                                    terminal_id: old_terminal.id.clone(),
                                },
                            );
                        }
                    }
                }
            }
            MachineToHub::ForegroundProcessResult {
                request_id,
                has_foreground_process,
                process_name,
            } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Ok(PendingResult::ForegroundProcessResult {
                        has_foreground_process,
                        process_name,
                    }));
                }
            }
            MachineToHub::Pong => {}
            MachineToHub::ResourceStats { stats } => {
                let mut machines = self.machines.lock().await;
                if let Some(conn) = machines.get_mut(machine_id) {
                    let target_user_id = conn.user_id.clone();
                    conn.latest_stats = Some(stats.clone());
                    self.send_event(
                        target_user_id,
                        BrowserEvent::MachineStats {
                            machine_id: machine_id.to_string(),
                            stats,
                        },
                    );
                    return;
                }
            }
            MachineToHub::AttachDied { attach_id, reason: _ } => {
                // The attach's tmux client died (shell exited / session
                // killed / tmux crashed). The hub's WS handler will see its
                // outbound channel close shortly anyway because the machine
                // also reaps the attach; we eagerly drop the routing entry
                // so no late frames get queued for it.
                // The actual WS close happens when the per-WS task notices
                // the channel is empty AND the Sender has been dropped.
                // Dropping the WsSender via unregister_attach achieves both.
                self.unregister_attach(&attach_id).await;
            }
            MachineToHub::TerminalDied { terminal_id, .. } => {
                self.handle_terminal_destroyed_internal(machine_id, &terminal_id)
                    .await;
            }
            MachineToHub::TerminalResized {
                terminal_id,
                cols,
                rows,
            } => {
                let updated = {
                    let mut machines = self.machines.lock().await;
                    machines.get_mut(machine_id).and_then(|conn| {
                        let target_user_id = conn.user_id.clone();
                        conn.terminals.get_mut(&terminal_id).map(|terminal| {
                            terminal.cols = cols;
                            terminal.rows = rows;
                            (target_user_id, terminal.clone())
                        })
                    })
                };
                if let Some((target_user_id, terminal)) = updated {
                    self.send_event(target_user_id, BrowserEvent::TerminalResized { terminal });
                }
            }
        }
    }

    async fn unregister_attach(&self, _attach_id: &str) {
        // The router lives on AppState, not on MachineManager. The hub's
        // ws.rs handler is responsible for `state.router.unregister(...)`
        // when its per-WS task exits. AttachDied here is informational —
        // the WS task will exit naturally once the AttachOutput stream
        // stops. Future improvement: wire the router into MachineManager
        // so we can proactively drop the route when AttachDied arrives.
    }

    async fn handle_terminal_destroyed_internal(&self, machine_id: &str, terminal_id: &str) {
        // Mirrors the bookkeeping done for `MachineToHub::TerminalDestroyed`
        // — drop our local terminal record + persistence + browser event.
        let target_user_id = {
            let mut machines = self.machines.lock().await;
            if let Some(conn) = machines.get_mut(machine_id) {
                conn.terminals.remove(terminal_id);
                conn.output_channels.remove(terminal_id);
                conn.output_buffers.remove(terminal_id);
                conn.output_seqs.remove(terminal_id);
                if let Ok(db_conn) = self.db.get() {
                    if let Err(e) =
                        crate::db::terminal_sessions::mark_destroyed(&db_conn, terminal_id)
                    {
                        tracing::warn!("Failed to mark terminal session as destroyed: {}", e);
                    }
                }
                conn.user_id.clone()
            } else {
                None
            }
        };
        self.send_event(
            target_user_id,
            BrowserEvent::TerminalDestroyed {
                machine_id: machine_id.to_string(),
                terminal_id: terminal_id.to_string(),
            },
        );
    }

    pub async fn handle_terminal_output(&self, machine_id: &str, terminal_id: &str, bytes: Bytes) {
        let mut machines = self.machines.lock().await;
        if let Some(conn) = machines.get_mut(machine_id) {
            let byte_count = bytes.len() as u64;
            let buf = conn
                .output_buffers
                .entry(terminal_id.to_string())
                .or_insert_with(Vec::new);
            buf.extend_from_slice(&bytes);
            if buf.len() > OUTPUT_BUFFER_SIZE {
                let drain_to = buf.len() - OUTPUT_BUFFER_SIZE;
                buf.drain(..drain_to);
            }
            let seq = conn
                .output_seqs
                .entry(terminal_id.to_string())
                .or_insert(0);
            *seq = seq.saturating_add(byte_count);
            if let Some(tx) = conn.output_channels.get(terminal_id) {
                let _ = tx.send(bytes);
            }
        }
    }

    pub fn register_device(&self, user_id: &str, device_id: &str) {
        let mut mode_by_user = self.mode.lock().unwrap();
        let mode = mode_by_user
            .entry(user_id.to_string())
            .or_insert_with(new_mode_state);
        *mode
            .connected_devices
            .entry(device_id.to_string())
            .or_insert(0) += 1;

        // Restore control leases that were released when the device disconnected,
        // as long as no other device has claimed them since.
        let mut restored_machines = Vec::new();
        if let Some(machines) = mode.released_leases.remove(device_id) {
            for machine_id in machines {
                if !mode.control_leases.contains_key(&machine_id) {
                    mode.control_leases
                        .insert(machine_id.clone(), device_id.to_string());
                    restored_machines.push(machine_id);
                }
            }
        }
        drop(mode_by_user);

        for machine_id in restored_machines {
            self.send_event(
                Some(user_id.to_string()),
                BrowserEvent::ModeChanged {
                    machine_id,
                    controller_device_id: Some(device_id.to_string()),
                },
            );
        }
    }

    pub fn unregister_device(&self, user_id: &str, device_id: &str) {
        let mut mode_by_user = self.mode.lock().unwrap();
        if let Some(mode) = mode_by_user.get_mut(user_id) {
            let mut release_control = false;

            if let Some(count) = mode.connected_devices.get_mut(device_id) {
                if *count > 1 {
                    *count -= 1;
                } else {
                    mode.connected_devices.remove(device_id);
                    release_control = true;
                }
            }

            if release_control {
                let released_machines: Vec<_> = mode
                    .control_leases
                    .iter()
                    .filter_map(|(machine_id, controller_device_id)| {
                        if controller_device_id == device_id {
                            Some(machine_id.clone())
                        } else {
                            None
                        }
                    })
                    .collect();

                // Stash released leases so they can be restored if the device reconnects
                if !released_machines.is_empty() {
                    mode.released_leases
                        .insert(device_id.to_string(), released_machines.clone());
                }

                for machine_id in released_machines {
                    mode.control_leases.remove(&machine_id);
                    self.send_event(
                        Some(user_id.to_string()),
                        BrowserEvent::ModeChanged {
                            machine_id,
                            controller_device_id: None,
                        },
                    );
                }
            }

            if mode.connected_devices.is_empty()
                && mode.control_leases.is_empty()
                && mode.released_leases.is_empty()
            {
                mode_by_user.remove(user_id);
            }
        }
    }

    pub fn schedule_unregister_device(
        self: &Arc<Self>,
        user_id: String,
        device_id: String,
        grace_period: Duration,
    ) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(grace_period).await;
            manager.unregister_device(&user_id, &device_id);
        });
    }

    pub fn request_control(&self, user_id: &str, machine_id: &str, device_id: &str) {
        self.mode
            .lock()
            .unwrap()
            .entry(user_id.to_string())
            .or_insert_with(new_mode_state)
            .control_leases
            .insert(machine_id.to_string(), device_id.to_string());
        self.send_event(
            Some(user_id.to_string()),
            BrowserEvent::ModeChanged {
                machine_id: machine_id.to_string(),
                controller_device_id: Some(device_id.to_string()),
            },
        );
    }

    pub fn release_control(&self, user_id: &str, machine_id: &str, device_id: &str) {
        let mut mode_by_user = self.mode.lock().unwrap();
        if let Some(mode) = mode_by_user.get_mut(user_id) {
            // Always clear from released_leases so an explicit release is not
            // accidentally restored on reconnect — even if the grace-period
            // disconnect already removed it from control_leases.
            if let Some(stashed) = mode.released_leases.get_mut(device_id) {
                stashed.retain(|mid| mid != machine_id);
                if stashed.is_empty() {
                    mode.released_leases.remove(device_id);
                }
            }

            if mode
                .control_leases
                .get(machine_id)
                .map(|value| value.as_str())
                == Some(device_id)
            {
                mode.control_leases.remove(machine_id);
                self.send_event(
                    Some(user_id.to_string()),
                    BrowserEvent::ModeChanged {
                        machine_id: machine_id.to_string(),
                        controller_device_id: None,
                    },
                );
            }
            if mode.connected_devices.is_empty()
                && mode.control_leases.is_empty()
                && mode.released_leases.is_empty()
            {
                mode_by_user.remove(user_id);
            }
        }
    }

    pub fn is_controller(&self, user_id: &str, machine_id: &str, device_id: &str) -> bool {
        self.mode.lock().unwrap().get(user_id).and_then(|mode| {
            mode.control_leases
                .get(machine_id)
                .map(|value| value.as_str())
        }) == Some(device_id)
    }

    pub fn get_controller(&self, user_id: &str, machine_id: &str) -> Option<String> {
        self.mode
            .lock()
            .unwrap()
            .get(user_id)
            .and_then(|mode| mode.control_leases.get(machine_id).cloned())
    }

    pub fn get_control_leases(&self, user_id: &str) -> Vec<ControlLeaseSnapshot> {
        self.mode
            .lock()
            .unwrap()
            .get(user_id)
            .map(|mode| {
                mode.control_leases
                    .iter()
                    .map(|(machine_id, controller_device_id)| ControlLeaseSnapshot {
                        machine_id: machine_id.clone(),
                        controller_device_id: Some(controller_device_id.clone()),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn get_machine_stats(&self, machine_id: &str) -> Option<tc_protocol::ResourceStats> {
        self.machines
            .lock()
            .await
            .get(machine_id)
            .and_then(|c| c.latest_stats.clone())
    }

    pub async fn snapshot_for_user(&self, user_id: &str) -> BrowserStateSnapshot {
        let snapshot_seq = self.next_event_seq.load(Ordering::Acquire);
        let machines = self.machines.lock().await;
        let visible: Vec<_> = machines
            .values()
            .filter(|conn| connection_visible_to(conn, user_id))
            .collect();
        let visible_machine_ids: HashSet<_> =
            visible.iter().map(|conn| conn.info.id.as_str()).collect();

        let machine_stats = visible
            .iter()
            .filter_map(|conn| {
                conn.latest_stats.clone().map(|stats| MachineStatsSnapshot {
                    machine_id: conn.info.id.clone(),
                    stats,
                })
            })
            .collect();

        let mut all_machines: Vec<MachineInfo> =
            visible.iter().map(|conn| conn.info.clone()).collect();
        let mut all_terminals: Vec<TerminalInfo> = visible
            .iter()
            .flat_map(|conn| conn.terminals.values().cloned())
            .collect();

        // Include persisted terminals from offline machines owned by this user
        // Clone persisted terminal data and release lock before DB queries
        let persisted_snapshot: Vec<(String, Vec<TerminalInfo>)> = {
            let persisted = self.persisted_terminals.lock().await;
            persisted
                .iter()
                .filter(|(mid, _)| !visible_machine_ids.contains(mid.as_str()))
                .map(|(mid, terms)| (mid.clone(), terms.clone()))
                .collect()
        };

        for (machine_id, terminals) in &persisted_snapshot {
            if let Ok(conn) = self.db.get() {
                if let Ok(Some(machine_row)) =
                    crate::db::machines::find_machine_by_id(&conn, machine_id)
                {
                    if machine_row.user_id == user_id {
                        all_machines.push(MachineInfo {
                            id: machine_row.id,
                            name: machine_row.name,
                            os: machine_row.os.unwrap_or_default(),
                            home_dir: machine_row.home_dir.unwrap_or_default(),
                        });
                        all_terminals.extend(terminals.iter().cloned());
                    }
                }
            }
        }

        BrowserStateSnapshot {
            snapshot_seq,
            machines: all_machines,
            terminals: all_terminals,
            machine_stats,
            control_leases: self
                .get_control_leases(user_id)
                .into_iter()
                .filter(|lease| visible_machine_ids.contains(lease.machine_id.as_str()))
                .collect(),
        }
    }

    fn send_event(&self, target_user_id: Option<String>, event: BrowserEvent) {
        let seq = self.next_event_seq.fetch_add(1, Ordering::AcqRel) + 1;
        let envelope = EventEnvelope {
            seq,
            target_user_id,
            event,
        };
        {
            let mut history = self.event_history.lock().unwrap();
            history.push_back(envelope.clone());
            if history.len() > EVENT_HISTORY_LIMIT {
                history.pop_front();
            }
        }
        let _ = self.event_tx.send(envelope);
    }

    /// Flush the current event sequence to the database
    pub fn flush_event_seq(&self) {
        let seq = self.next_event_seq.load(Ordering::Acquire);
        if let Ok(conn) = self.db.get() {
            if let Err(e) = crate::db::hub_state::set(&conn, "next_event_seq", &seq.to_string()) {
                tracing::warn!("Failed to flush event sequence to DB: {}", e);
            }
        }
    }

    /// Start the background task that periodically flushes event sequence
    pub fn start_seq_flush_task(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;
                manager.flush_event_seq();
            }
        });
    }

    async fn register_pending(
        &self,
        request_id: &str,
    ) -> oneshot::Receiver<Result<PendingResult, String>> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.to_string(), tx);
        rx
    }

    async fn remove_pending(&self, request_id: &str) {
        self.pending.lock().await.remove(request_id);
    }

    fn build_event_subscription(&self, user_id: Option<&str>, after_seq: u64) -> EventSubscription {
        let rx = self.event_tx.subscribe();
        let history = self.event_history.lock().unwrap();
        let requires_resync = history_has_gap_after_seq(&history, after_seq);
        let replay = if requires_resync {
            Vec::new()
        } else {
            history
                .iter()
                .filter(|envelope| envelope.seq > after_seq && event_visible_to(envelope, user_id))
                .map(|envelope| BrowserEventEnvelope {
                    seq: envelope.seq,
                    event: envelope.event.clone(),
                })
                .collect()
        };

        EventSubscription {
            replay,
            receiver: rx,
            requires_resync,
        }
    }

    #[cfg(test)]
    async fn pending_count_for_tests(&self) -> usize {
        self.pending.lock().await.len()
    }
}

fn new_mode_state() -> ModeState {
    ModeState {
        control_leases: HashMap::new(),
        connected_devices: HashMap::new(),
        released_leases: HashMap::new(),
    }
}

fn connection_visible_to(conn: &MachineConnection, user_id: &str) -> bool {
    conn.user_id
        .as_deref()
        .map(|owner| owner == user_id)
        .unwrap_or(true)
}

fn event_visible_to(envelope: &EventEnvelope, user_id: Option<&str>) -> bool {
    match envelope.target_user_id.as_deref() {
        Some(target_user_id) => user_id == Some(target_user_id),
        None => true,
    }
}

fn history_has_gap_after_seq(history: &VecDeque<EventEnvelope>, after_seq: u64) -> bool {
    if after_seq == 0 || history.is_empty() {
        return false;
    }

    let Some(oldest_seq) = history.front().map(|envelope| envelope.seq) else {
        return false;
    };

    after_seq.saturating_add(1) < oldest_seq
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> crate::db::DbPool {
        let pool = crate::db::create_pool(":memory:").unwrap();
        {
            let conn = pool.get().unwrap();
            crate::db::init_db(&conn).unwrap();
        }
        pool
    }

    fn machine(id: &str) -> MachineInfo {
        MachineInfo {
            id: id.to_string(),
            name: format!("machine-{id}"),
            os: "linux".to_string(),
            home_dir: "/tmp".to_string(),
        }
    }

    fn terminal(machine_id: &str, id: &str) -> TerminalInfo {
        TerminalInfo {
            id: id.to_string(),
            machine_id: machine_id.to_string(),
            title: format!("Terminal {id}"),
            cwd: "/tmp".to_string(),
            cols: 80,
            rows: 24,
            reachable: true,
        }
    }

    fn stats() -> tc_protocol::ResourceStats {
        tc_protocol::ResourceStats {
            cpu_percent: 12.5,
            memory_total: 1024,
            memory_used: 512,
            disks: vec![tc_protocol::DiskInfo {
                mount_point: "/".to_string(),
                total_bytes: 2048,
                used_bytes: 1024,
            }],
        }
    }

    #[tokio::test]
    async fn manager_filters_machines_and_terminals_by_user() {
        let manager = MachineManager::new(test_db());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .register_machine(machine("machine-b"), Some("user-b".to_string()))
            .await;

        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;
        manager
            .handle_machine_message(
                "machine-b",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-b", "term-b")],
                },
            )
            .await;

        let visible_machines = manager.list_machines_for_user("user-a").await;
        assert_eq!(visible_machines.len(), 1);
        assert_eq!(visible_machines[0].id, "machine-a");

        let visible_terminals = manager.list_terminals_for_user("user-a", None).await;
        assert_eq!(visible_terminals.len(), 1);
        assert_eq!(visible_terminals[0].id, "term-a");

        assert!(
            manager
                .user_can_access_terminal("user-a", "machine-a", "term-a")
                .await
        );
        assert!(
            !manager
                .user_can_access_terminal("user-a", "machine-b", "term-b")
                .await
        );
    }

    #[test]
    fn mode_state_is_scoped_per_user_and_machine() {
        let manager = MachineManager::new(test_db());

        manager.request_control("user-a", "machine-a", "device-a");
        manager.request_control("user-a", "machine-b", "device-b");
        manager.request_control("user-b", "machine-c", "device-c");

        assert_eq!(
            manager.get_controller("user-a", "machine-a"),
            Some("device-a".to_string())
        );
        assert_eq!(
            manager.get_controller("user-a", "machine-b"),
            Some("device-b".to_string())
        );
        assert_eq!(
            manager.get_controller("user-b", "machine-c"),
            Some("device-c".to_string())
        );
        assert!(manager.is_controller("user-a", "machine-a", "device-a"));
        assert!(!manager.is_controller("user-a", "machine-a", "device-b"));
        assert!(manager.is_controller("user-a", "machine-b", "device-b"));

        manager.release_control("user-a", "machine-a", "device-a");

        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
        assert_eq!(
            manager.get_controller("user-a", "machine-b"),
            Some("device-b".to_string())
        );
        assert_eq!(
            manager.get_controller("user-b", "machine-c"),
            Some("device-c".to_string())
        );
    }

    #[test]
    fn unregistering_a_device_releases_its_machine_control() {
        let manager = MachineManager::new(test_db());

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        manager.unregister_device("user-a", "device-a");

        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
    }

    #[tokio::test]
    async fn scheduled_disconnect_releases_control_after_grace_period() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        manager.schedule_unregister_device(
            "user-a".to_string(),
            "device-a".to_string(),
            Duration::from_millis(10),
        );

        tokio::time::sleep(Duration::from_millis(25)).await;

        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
    }

    #[tokio::test]
    async fn reconnect_before_scheduled_disconnect_keeps_control() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        manager.schedule_unregister_device(
            "user-a".to_string(),
            "device-a".to_string(),
            Duration::from_millis(20),
        );

        tokio::time::sleep(Duration::from_millis(5)).await;
        manager.register_device("user-a", "device-a");
        tokio::time::sleep(Duration::from_millis(30)).await;

        assert_eq!(
            manager.get_controller("user-a", "machine-a"),
            Some("device-a".to_string())
        );
    }

    #[tokio::test]
    async fn snapshot_for_user_includes_visible_state_and_sequence_watermark() {
        let manager = MachineManager::new(test_db());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .register_machine(machine("machine-b"), Some("user-b".to_string()))
            .await;

        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;
        manager
            .handle_machine_message("machine-a", MachineToHub::ResourceStats { stats: stats() })
            .await;
        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        let snapshot = manager.snapshot_for_user("user-a").await;

        assert_eq!(snapshot.machines.len(), 1);
        assert_eq!(snapshot.machines[0].id, "machine-a");
        assert_eq!(snapshot.terminals.len(), 1);
        assert_eq!(snapshot.terminals[0].id, "term-a");
        assert_eq!(snapshot.machine_stats.len(), 1);
        assert_eq!(snapshot.machine_stats[0].machine_id, "machine-a");
        assert_eq!(snapshot.control_leases.len(), 1);
        assert_eq!(snapshot.control_leases[0].machine_id, "machine-a");
        assert_eq!(
            snapshot.control_leases[0].controller_device_id.as_deref(),
            Some("device-a")
        );
        assert!(snapshot.snapshot_seq > 0);
    }

    #[tokio::test]
    async fn resize_terminal_updates_snapshot_state_and_emits_terminal_resized_event() {
        let manager = MachineManager::new(test_db());

        let (_conn_id, mut cmd_rx) = manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;

        let snapshot = manager.snapshot_for_user("user-a").await;
        let mut subscription = manager.subscribe_events_after("user-a", snapshot.snapshot_seq);

        manager
            .resize_terminal("machine-a", "term-a", 132, 40)
            .await
            .unwrap();

        let sent_command = cmd_rx.recv().await.unwrap();
        assert!(matches!(
            sent_command,
            HubToMachine::TerminalResize {
                terminal_id,
                cols: 132,
                rows: 40,
            } if terminal_id == "term-a"
        ));

        let updated_snapshot = manager.snapshot_for_user("user-a").await;
        assert_eq!(updated_snapshot.terminals.len(), 1);
        assert_eq!(updated_snapshot.terminals[0].cols, 132);
        assert_eq!(updated_snapshot.terminals[0].rows, 40);

        let envelope = subscription.receiver.recv().await.unwrap();
        assert!(matches!(
            envelope.event,
            BrowserEvent::TerminalResized { terminal }
                if terminal.id == "term-a" && terminal.cols == 132 && terminal.rows == 40
        ));
    }

    #[tokio::test]
    async fn subscribe_events_after_replays_only_newer_events_for_the_user() {
        let manager = MachineManager::new(test_db());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;

        let snapshot = manager.snapshot_for_user("user-a").await;
        manager.request_control("user-a", "machine-a", "device-a");

        let subscription = manager.subscribe_events_after("user-a", snapshot.snapshot_seq);

        assert_eq!(subscription.replay.len(), 1);
        assert!(subscription.replay[0].seq > snapshot.snapshot_seq);
        assert!(matches!(
            subscription.replay[0].event,
            BrowserEvent::ModeChanged {
                machine_id: _,
                controller_device_id: Some(_),
            }
        ));
    }

    #[tokio::test]
    async fn create_terminal_cleans_pending_request_when_machine_is_missing() {
        let manager = MachineManager::new(test_db());

        let error = manager
            .create_terminal("missing-machine", "/tmp", 80, 24, None)
            .await
            .unwrap_err();

        assert!(error.contains("not found"));
        assert_eq!(manager.pending_count_for_tests().await, 0);
    }

    #[tokio::test]
    async fn create_terminal_cleans_pending_request_when_machine_receiver_is_gone() {
        let manager = MachineManager::new(test_db());

        let (_conn_id, cmd_rx) = manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        drop(cmd_rx);

        let error = manager
            .create_terminal("machine-a", "/tmp", 80, 24, None)
            .await
            .unwrap_err();

        assert_eq!(error, "Machine disconnected");
        assert_eq!(manager.pending_count_for_tests().await, 0);
    }

    #[tokio::test]
    async fn list_directory_cleans_pending_request_when_machine_is_missing() {
        let manager = MachineManager::new(test_db());

        let error = manager
            .list_directory("missing-machine", "/tmp")
            .await
            .unwrap_err();

        assert!(error.contains("not found"));
        assert_eq!(manager.pending_count_for_tests().await, 0);
    }

    #[tokio::test]
    async fn subscribe_events_after_requests_resync_when_history_has_a_gap() {
        let manager = MachineManager::new(test_db());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;

        for index in 0..1050 {
            manager.request_control("user-a", "machine-a", &format!("device-{index}"));
        }

        let subscription = manager.subscribe_events_after("user-a", 1);

        assert!(subscription.requires_resync);
        assert!(subscription.replay.is_empty());
    }

    #[tokio::test]
    async fn startup_loads_persisted_terminals_as_unreachable() {
        let pool = test_db();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, provider, provider_id, display_name, role, created_at) VALUES ('user-a', 'test', 'test', 'Test', 'user', 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES ('machine-a', 'user-a', 'Machine A', 'hash', 'offline', 0)",
                [],
            ).unwrap();
            crate::db::terminal_sessions::insert(&conn, "term-a", "machine-a", "bash", "/home", 80, 24).unwrap();
        }

        let manager = MachineManager::new(pool);
        let snapshot = manager.snapshot_for_user("user-a").await;

        assert_eq!(snapshot.terminals.len(), 1);
        assert_eq!(snapshot.terminals[0].id, "term-a");
        assert!(!snapshot.terminals[0].reachable);
    }

    fn seed_machine(pool: &crate::db::DbPool, user_id: &str, machine_id: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO users (id, provider, provider_id, display_name, role, created_at) VALUES (?1, 'test', ?1, 'Test', 'user', 0)",
            rusqlite::params![user_id],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES (?1, ?2, ?1, 'hash', 'offline', 0)",
            rusqlite::params![machine_id, user_id],
        ).unwrap();
    }

    #[tokio::test]
    async fn terminal_created_is_persisted_to_db() {
        let pool = test_db();
        seed_machine(&pool, "user-a", "machine-a");
        let manager = MachineManager::new(pool.clone());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;

        let conn = pool.get().unwrap();
        let active = crate::db::terminal_sessions::find_active_by_machine(&conn, "machine-a").unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "term-a");
    }

    #[tokio::test]
    async fn terminal_destroyed_is_persisted_to_db() {
        let pool = test_db();
        seed_machine(&pool, "user-a", "machine-a");
        let manager = MachineManager::new(pool.clone());

        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::TerminalDestroyed {
                    terminal_id: "term-a".to_string(),
                },
            )
            .await;

        let conn = pool.get().unwrap();
        let active = crate::db::terminal_sessions::find_active_by_machine(&conn, "machine-a").unwrap();
        assert!(active.is_empty());
    }

    #[tokio::test]
    async fn machine_disconnect_keeps_terminals_unreachable() {
        let pool = test_db();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, provider, provider_id, display_name, role, created_at) VALUES ('user-a', 'test', 'test', 'Test', 'user', 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES ('machine-a', 'user-a', 'Machine A', 'hash', 'offline', 0)",
                [],
            ).unwrap();
        }
        let manager = MachineManager::new(pool);

        let (conn_id, _cmd_rx) = manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;

        manager.unregister_machine("machine-a", &conn_id).await;

        let snapshot = manager.snapshot_for_user("user-a").await;
        assert_eq!(snapshot.terminals.len(), 1);
        assert_eq!(snapshot.terminals[0].id, "term-a");
        assert!(!snapshot.terminals[0].reachable);
    }

    #[tokio::test]
    async fn event_sequence_is_persisted_and_recovered() {
        let pool = test_db();

        // First lifecycle: generate some events
        {
            let manager = MachineManager::new(pool.clone());
            manager
                .register_machine(machine("machine-a"), Some("user-a".to_string()))
                .await;
            for i in 0..150 {
                manager.request_control("user-a", "machine-a", &format!("device-{}", i));
            }
            manager.flush_event_seq();
        }

        // Second lifecycle: should recover with +200 offset
        let manager = MachineManager::new(pool);
        let snapshot = manager.snapshot_for_user("user-a").await;
        assert!(snapshot.snapshot_seq >= 350);
    }

    #[tokio::test]
    async fn reconcile_marks_persisted_terminals_as_reachable() {
        let pool = test_db();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, provider, provider_id, display_name, role, created_at) VALUES ('user-a', 'test', 'test', 'Test', 'user', 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES ('machine-a', 'user-a', 'Machine A', 'hash', 'offline', 0)",
                [],
            ).unwrap();
            crate::db::terminal_sessions::insert(&conn, "term-a", "machine-a", "bash", "/home", 80, 24).unwrap();
        }

        let manager = MachineManager::new(pool.clone());

        // Machine reconnects and reports the same terminal
        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal("machine-a", "term-a")],
                },
            )
            .await;

        let snapshot = manager.snapshot_for_user("user-a").await;
        assert_eq!(snapshot.terminals.len(), 1);
        assert_eq!(snapshot.terminals[0].id, "term-a");
        assert!(snapshot.terminals[0].reachable);
    }

    #[tokio::test]
    async fn reconcile_destroys_terminals_missing_from_machine() {
        let pool = test_db();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, provider, provider_id, display_name, role, created_at) VALUES ('user-a', 'test', 'test', 'Test', 'user', 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES ('machine-a', 'user-a', 'Machine A', 'hash', 'offline', 0)",
                [],
            ).unwrap();
            crate::db::terminal_sessions::insert(&conn, "term-a", "machine-a", "bash", "/home", 80, 24).unwrap();
        }

        let manager = MachineManager::new(pool.clone());

        // Machine reconnects but does NOT report term-a
        manager
            .register_machine(machine("machine-a"), Some("user-a".to_string()))
            .await;
        manager
            .handle_machine_message(
                "machine-a",
                MachineToHub::ExistingTerminals {
                    terminals: vec![],
                },
            )
            .await;

        let snapshot = manager.snapshot_for_user("user-a").await;
        assert!(snapshot.terminals.is_empty());

        let conn = pool.get().unwrap();
        let active = crate::db::terminal_sessions::find_active_by_machine(&conn, "machine-a").unwrap();
        assert!(active.is_empty());
    }

    #[tokio::test]
    async fn full_persistence_cycle_hub_restart_and_reconnect() {
        let pool = test_db();

        // Set up DB records needed for snapshot_for_user
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, provider, provider_id, display_name, role, created_at) VALUES ('user-a', 'test', 'test', 'Test', 'user', 0)",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO machines (id, user_id, name, machine_secret_hash, status, created_at) VALUES ('machine-a', 'user-a', 'Machine A', 'hash', 'offline', 0)",
                [],
            ).unwrap();
        }

        // Phase 1: Normal operation — create terminal
        {
            let manager = MachineManager::new(pool.clone());
            let (_conn_id, _cmd_rx) = manager
                .register_machine(machine("machine-a"), Some("user-a".to_string()))
                .await;
            manager
                .handle_machine_message(
                    "machine-a",
                    MachineToHub::ExistingTerminals {
                        terminals: vec![terminal("machine-a", "term-a")],
                    },
                )
                .await;

            let snapshot = manager.snapshot_for_user("user-a").await;
            assert_eq!(snapshot.terminals.len(), 1);
            assert!(snapshot.terminals[0].reachable);

            manager.flush_event_seq();
        }
        // MachineManager dropped — simulates hub restart

        // Phase 2: Hub restarts — terminals should be unreachable
        {
            let manager = MachineManager::new(pool.clone());
            let snapshot = manager.snapshot_for_user("user-a").await;
            assert_eq!(snapshot.terminals.len(), 1);
            assert_eq!(snapshot.terminals[0].id, "term-a");
            assert!(!snapshot.terminals[0].reachable);

            // Phase 3: Machine reconnects with the same terminal
            manager
                .register_machine(machine("machine-a"), Some("user-a".to_string()))
                .await;
            manager
                .handle_machine_message(
                    "machine-a",
                    MachineToHub::ExistingTerminals {
                        terminals: vec![terminal("machine-a", "term-a")],
                    },
                )
                .await;

            let snapshot = manager.snapshot_for_user("user-a").await;
            assert_eq!(snapshot.terminals.len(), 1);
            assert!(snapshot.terminals[0].reachable);
        }
    }

    #[tokio::test]
    async fn reconnect_after_grace_period_restores_control() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        // Grace period expires → control released
        manager.schedule_unregister_device(
            "user-a".to_string(),
            "device-a".to_string(),
            Duration::from_millis(10),
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);

        // Device reconnects → control restored
        manager.register_device("user-a", "device-a");
        assert_eq!(
            manager.get_controller("user-a", "machine-a"),
            Some("device-a".to_string())
        );
    }

    #[tokio::test]
    async fn reconnect_does_not_restore_lease_claimed_by_another_device() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        // Grace period expires → control released
        manager.schedule_unregister_device(
            "user-a".to_string(),
            "device-a".to_string(),
            Duration::from_millis(10),
        );
        tokio::time::sleep(Duration::from_millis(25)).await;

        // Another device claims control before device-a reconnects
        manager.register_device("user-a", "device-b");
        manager.request_control("user-a", "machine-a", "device-b");

        // device-a reconnects — should NOT override device-b's control
        manager.register_device("user-a", "device-a");
        assert_eq!(
            manager.get_controller("user-a", "machine-a"),
            Some("device-b".to_string())
        );
    }

    #[tokio::test]
    async fn explicit_release_prevents_reconnect_restore() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        // Simulate beforeunload beacon: explicit release
        manager.release_control("user-a", "machine-a", "device-a");
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);

        // Grace period also fires (both can happen)
        manager.unregister_device("user-a", "device-a");

        // Device reconnects — should NOT restore explicitly released control
        manager.register_device("user-a", "device-a");
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
    }

    #[tokio::test]
    async fn explicit_release_after_grace_period_prevents_restore() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");

        // Grace period expires → control released, lease stashed
        manager.schedule_unregister_device(
            "user-a".to_string(),
            "device-a".to_string(),
            Duration::from_millis(10),
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);

        // Explicit release arrives (e.g. delayed beforeunload beacon)
        // even though control_leases no longer has the entry
        manager.release_control("user-a", "machine-a", "device-a");

        // Device reconnects — should NOT restore because of the explicit release
        manager.register_device("user-a", "device-a");
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
    }

    #[tokio::test]
    async fn reconnect_restores_multiple_leases() {
        let manager = Arc::new(MachineManager::new(test_db()));

        manager.register_device("user-a", "device-a");
        manager.request_control("user-a", "machine-a", "device-a");
        manager.request_control("user-a", "machine-b", "device-a");

        manager.unregister_device("user-a", "device-a");
        assert_eq!(manager.get_controller("user-a", "machine-a"), None);
        assert_eq!(manager.get_controller("user-a", "machine-b"), None);

        manager.register_device("user-a", "device-a");
        assert_eq!(
            manager.get_controller("user-a", "machine-a"),
            Some("device-a".to_string())
        );
        assert_eq!(
            manager.get_controller("user-a", "machine-b"),
            Some("device-a".to_string())
        );
    }

    // ── Terminal output byte-sequence resume protocol ────────────────

    async fn setup_terminal_for_output(manager: &MachineManager, machine_id: &str, terminal_id: &str) {
        manager
            .register_machine(machine(machine_id), None)
            .await;
        manager
            .handle_machine_message(
                machine_id,
                MachineToHub::ExistingTerminals {
                    terminals: vec![terminal(machine_id, terminal_id)],
                },
            )
            .await;
    }

    #[tokio::test]
    async fn subscribe_from_none_returns_full_replay_at_current_seq() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"hello"))
            .await;

        let sub = manager
            .subscribe_terminal_output_from("m", "t", None)
            .await
            .expect("subscribe should succeed");
        assert_eq!(sub.mode, AttachMode::Full);
        assert_eq!(sub.seq, 5);
        assert_eq!(sub.replay.as_slice(), b"hello");
    }

    #[tokio::test]
    async fn subscribe_from_current_seq_returns_empty_delta() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"hello"))
            .await;

        let sub = manager
            .subscribe_terminal_output_from("m", "t", Some(5))
            .await
            .unwrap();
        assert_eq!(sub.mode, AttachMode::Delta);
        assert_eq!(sub.seq, 5);
        assert!(sub.replay.is_empty());
    }

    #[tokio::test]
    async fn subscribe_from_midpoint_returns_tail_delta() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"hello"))
            .await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"world"))
            .await;

        let sub = manager
            .subscribe_terminal_output_from("m", "t", Some(5))
            .await
            .unwrap();
        assert_eq!(sub.mode, AttachMode::Delta);
        assert_eq!(sub.seq, 10);
        assert_eq!(sub.replay.as_slice(), b"world");
    }

    #[tokio::test]
    async fn subscribe_from_stale_seq_returns_reset() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        // Write 128KB to overflow the 64KB buffer
        let chunk = vec![b'a'; 128 * 1024];
        manager
            .handle_terminal_output("m", "t", Bytes::from(chunk))
            .await;

        let sub = manager
            .subscribe_terminal_output_from("m", "t", Some(0))
            .await
            .unwrap();
        assert_eq!(sub.mode, AttachMode::Reset);
        assert_eq!(sub.seq, 128 * 1024);
        // Reset delivers only what's still in the capped buffer
        assert_eq!(sub.replay.len(), 64 * 1024);
    }

    #[tokio::test]
    async fn subscribe_from_future_seq_returns_reset() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"hello"))
            .await;

        // Client claims it saw past the current seq — conservative recovery: reset.
        let sub = manager
            .subscribe_terminal_output_from("m", "t", Some(999))
            .await
            .unwrap();
        assert_eq!(sub.mode, AttachMode::Reset);
        assert_eq!(sub.seq, 5);
        assert_eq!(sub.replay.as_slice(), b"hello");
    }

    #[tokio::test]
    async fn output_seq_increments_by_byte_count_across_chunks() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"abc"))
            .await;
        manager
            .handle_terminal_output("m", "t", Bytes::from_static(b"defgh"))
            .await;

        let sub = manager
            .subscribe_terminal_output_from("m", "t", None)
            .await
            .unwrap();
        assert_eq!(sub.seq, 8);
    }

    #[tokio::test]
    async fn subscribe_from_unknown_terminal_returns_error() {
        let manager = MachineManager::new(test_db());
        manager
            .register_machine(machine("m"), None)
            .await;
        let result = manager
            .subscribe_terminal_output_from("m", "missing", None)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn subscribe_from_none_returns_empty_replay_when_no_output_yet() {
        let manager = MachineManager::new(test_db());
        setup_terminal_for_output(&manager, "m", "t").await;
        // No bytes written yet
        let sub = manager
            .subscribe_terminal_output_from("m", "t", None)
            .await
            .unwrap();
        assert_eq!(sub.mode, AttachMode::Full);
        assert_eq!(sub.seq, 0);
        assert!(sub.replay.is_empty());
    }
}
