use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tc_protocol::{
    BrowserEvent, BrowserEventEnvelope, BrowserStateSnapshot, ControlLeaseSnapshot, DirEntry,
    HubToMachine, MachineInfo, MachineStatsSnapshot, MachineToHub, TerminalInfo,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

struct ModeState {
    control_leases: HashMap<String, String>,
    connected_devices: HashSet<String>,
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
}

const OUTPUT_BUFFER_SIZE: usize = 64 * 1024;
const EVENT_HISTORY_LIMIT: usize = 1024;

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
    pub output_channels: HashMap<String, broadcast::Sender<Vec<u8>>>,
    /// Terminal output buffers for replay on new subscriber
    pub output_buffers: HashMap<String, Vec<u8>>,
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
}

impl MachineManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            machines: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            event_history: Arc::new(std::sync::Mutex::new(VecDeque::with_capacity(
                EVENT_HISTORY_LIMIT,
            ))),
            next_event_seq: AtomicU64::new(0),
            mode: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<EventEnvelope> {
        self.event_tx.subscribe()
    }

    pub fn subscribe_events_after(
        &self,
        user_id: &str,
        after_seq: u64,
    ) -> (
        Vec<BrowserEventEnvelope>,
        broadcast::Receiver<EventEnvelope>,
    ) {
        let rx = self.event_tx.subscribe();
        let replay = self
            .event_history
            .lock()
            .unwrap()
            .iter()
            .filter(|envelope| {
                envelope.seq > after_seq && event_visible_to(envelope, Some(user_id))
            })
            .map(|envelope| BrowserEventEnvelope {
                seq: envelope.seq,
                event: envelope.event.clone(),
            })
            .collect();

        (replay, rx)
    }

    pub fn subscribe_public_events_after(
        &self,
        after_seq: u64,
    ) -> (
        Vec<BrowserEventEnvelope>,
        broadcast::Receiver<EventEnvelope>,
    ) {
        let rx = self.event_tx.subscribe();
        let replay = self
            .event_history
            .lock()
            .unwrap()
            .iter()
            .filter(|envelope| envelope.seq > after_seq && event_visible_to(envelope, None))
            .map(|envelope| BrowserEventEnvelope {
                seq: envelope.seq,
                event: envelope.event.clone(),
            })
            .collect();

        (replay, rx)
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
            latest_stats: None,
        };

        self.machines.lock().await.insert(machine_id, conn);

        self.send_event(user_id, BrowserEvent::MachineOnline { machine: info });

        (conn_id, cmd_rx)
    }

    /// Unregister a machine when it disconnects. Only removes if conn_id matches.
    pub async fn unregister_machine(&self, machine_id: &str, conn_id: &str) {
        let mut machines = self.machines.lock().await;
        // Only remove if this is still the same connection (not replaced by a reconnect)
        let should_remove = machines
            .get(machine_id)
            .map(|c| c.conn_id == conn_id)
            .unwrap_or(false);
        if !should_remove {
            return;
        }
        if let Some(conn) = machines.remove(machine_id) {
            // Notify browsers about each terminal being destroyed
            for terminal_id in conn.terminals.keys() {
                self.send_event(
                    conn.user_id.clone(),
                    BrowserEvent::TerminalDestroyed {
                        machine_id: machine_id.to_string(),
                        terminal_id: terminal_id.clone(),
                    },
                );
            }
            self.send_event(
                conn.user_id,
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
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.clone(), tx);

        // Send command to machine
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::CreateTerminal {
                request_id: request_id.clone(),
                cwd: cwd.to_string(),
                cols,
                rows,
                startup_command,
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;

        // Wait for response with timeout
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Timeout waiting for terminal creation".to_string())?
            .map_err(|_| "Machine disconnected".to_string())?;

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
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
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

    /// Send input to a terminal
    pub async fn send_input(
        &self,
        machine_id: &str,
        terminal_id: &str,
        data: &str,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
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

    /// Resize a terminal
    pub async fn resize_terminal(
        &self,
        machine_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let cmd_tx = {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::TerminalResize {
                terminal_id: terminal_id.to_string(),
                cols,
                rows,
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;
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
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
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

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.clone(), tx);

        let cmd_tx = {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
            conn.cmd_tx.clone()
        };
        cmd_tx
            .send(HubToMachine::FsListDir {
                request_id: request_id.clone(),
                path: path.to_string(),
            })
            .await
            .map_err(|_| "Machine disconnected".to_string())?;

        let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Timeout".to_string())?
            .map_err(|_| "Machine disconnected".to_string())?;

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
    ) -> Result<(Vec<u8>, broadcast::Receiver<Vec<u8>>), String> {
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
        Ok((buffer, tx.subscribe()))
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
                        };
                        conn.terminals.insert(terminal_id.clone(), terminal.clone());
                        conn.output_channels.insert(terminal_id.clone(), output_tx);

                        self.send_event(target_user_id, BrowserEvent::TerminalCreated { terminal });
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
                self.handle_terminal_output(machine_id, &terminal_id, data.into_bytes())
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
                let mut machines = self.machines.lock().await;
                if let Some(conn) = machines.get_mut(machine_id) {
                    let target_user_id = conn.user_id.clone();
                    for terminal in terminals {
                        let (output_tx, _) = broadcast::channel(256);
                        conn.terminals.insert(terminal.id.clone(), terminal.clone());
                        conn.output_channels.insert(terminal.id.clone(), output_tx);
                        self.send_event(
                            target_user_id.clone(),
                            BrowserEvent::TerminalCreated { terminal },
                        );
                    }
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
        }
    }

    pub async fn handle_terminal_output(
        &self,
        machine_id: &str,
        terminal_id: &str,
        bytes: Vec<u8>,
    ) {
        let mut machines = self.machines.lock().await;
        if let Some(conn) = machines.get_mut(machine_id) {
            let buf = conn
                .output_buffers
                .entry(terminal_id.to_string())
                .or_insert_with(Vec::new);
            buf.extend_from_slice(&bytes);
            if buf.len() > OUTPUT_BUFFER_SIZE {
                let drain_to = buf.len() - OUTPUT_BUFFER_SIZE;
                buf.drain(..drain_to);
            }
            if let Some(tx) = conn.output_channels.get(terminal_id) {
                let _ = tx.send(bytes);
            }
        }
    }

    pub fn register_device(&self, user_id: &str, device_id: &str) {
        self.mode
            .lock()
            .unwrap()
            .entry(user_id.to_string())
            .or_insert_with(new_mode_state)
            .connected_devices
            .insert(device_id.to_string());
    }

    pub fn unregister_device(&self, user_id: &str, device_id: &str) {
        let mut mode_by_user = self.mode.lock().unwrap();
        if let Some(mode) = mode_by_user.get_mut(user_id) {
            mode.connected_devices.remove(device_id);
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
            if mode.connected_devices.is_empty() && mode.control_leases.is_empty() {
                mode_by_user.remove(user_id);
            }
        }
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
            if mode.connected_devices.is_empty() && mode.control_leases.is_empty() {
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

        BrowserStateSnapshot {
            snapshot_seq,
            machines: visible.iter().map(|conn| conn.info.clone()).collect(),
            terminals: visible
                .iter()
                .flat_map(|conn| conn.terminals.values().cloned())
                .collect(),
            machine_stats,
            control_leases: self
                .get_control_leases(user_id)
                .into_iter()
                .filter(|lease| visible_machine_ids.contains(lease.machine_id.as_str()))
                .collect(),
        }
    }

    fn send_event(&self, target_user_id: Option<String>, event: BrowserEvent) {
        let envelope = EventEnvelope {
            seq: self.next_event_seq.fetch_add(1, Ordering::AcqRel) + 1,
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
}

fn new_mode_state() -> ModeState {
    ModeState {
        control_leases: HashMap::new(),
        connected_devices: HashSet::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let manager = MachineManager::new();

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
        let manager = MachineManager::new();

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

    #[tokio::test]
    async fn snapshot_for_user_includes_visible_state_and_sequence_watermark() {
        let manager = MachineManager::new();

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
    async fn subscribe_events_after_replays_only_newer_events_for_the_user() {
        let manager = MachineManager::new();

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

        let (replay, _rx) = manager.subscribe_events_after("user-a", snapshot.snapshot_seq);

        assert_eq!(replay.len(), 1);
        assert!(replay[0].seq > snapshot.snapshot_seq);
        assert!(matches!(
            replay[0].event,
            BrowserEvent::ModeChanged {
                machine_id: _,
                controller_device_id: Some(_),
            }
        ));
    }
}
