use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, oneshot};
use tc_protocol::{BrowserEvent, DirEntry, HubToMachine, MachineInfo, MachineToHub, TerminalInfo};

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

/// A connected machine
struct MachineConnection {
    /// Unique connection ID (changes on reconnect)
    pub conn_id: String,
    pub info: MachineInfo,
    /// Send commands to this machine
    pub cmd_tx: mpsc::UnboundedSender<HubToMachine>,
    /// Terminal IDs hosted on this machine
    pub terminals: HashMap<String, TerminalInfo>,
    /// Terminal output subscribers: terminal_id -> broadcast sender
    pub output_channels: HashMap<String, broadcast::Sender<Vec<u8>>>,
    /// Terminal output buffers for replay on new subscriber
    pub output_buffers: HashMap<String, Vec<u8>>,
}

pub struct MachineManager {
    machines: Arc<Mutex<HashMap<String, MachineConnection>>>,
    /// Pending request/response tracking
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    /// Browser events broadcast
    event_tx: broadcast::Sender<BrowserEvent>,
}

impl MachineManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            machines: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<BrowserEvent> {
        self.event_tx.subscribe()
    }

    /// Register a machine connection. Returns (conn_id, cmd_receiver).
    pub async fn register_machine(
        &self,
        info: MachineInfo,
    ) -> (String, mpsc::UnboundedReceiver<HubToMachine>) {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let machine_id = info.id.clone();
        let conn_id = uuid::Uuid::new_v4().to_string();

        let conn = MachineConnection {
            conn_id: conn_id.clone(),
            info: info.clone(),
            cmd_tx,
            terminals: HashMap::new(),
            output_channels: HashMap::new(),
            output_buffers: HashMap::new(),
        };

        self.machines.lock().await.insert(machine_id, conn);

        let _ = self.event_tx.send(BrowserEvent::MachineOnline { machine: info });

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
                let _ = self.event_tx.send(BrowserEvent::TerminalDestroyed {
                    machine_id: machine_id.to_string(),
                    terminal_id: terminal_id.clone(),
                });
            }
            let _ = self.event_tx.send(BrowserEvent::MachineOffline {
                machine_id: machine_id.to_string(),
            });
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

    /// Send a create terminal command to a machine and wait for the response
    pub async fn create_terminal(
        &self,
        machine_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalInfo, String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        // Register pending request
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.clone(), tx);

        // Send command to machine
        {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
            conn.cmd_tx
                .send(HubToMachine::CreateTerminal {
                    request_id: request_id.clone(),
                    cwd: cwd.to_string(),
                    cols,
                    rows,
                })
                .map_err(|_| "Machine disconnected".to_string())?;
        }

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
    pub async fn destroy_terminal(&self, machine_id: &str, terminal_id: &str) -> Result<(), String> {
        let machines = self.machines.lock().await;
        let conn = machines
            .get(machine_id)
            .ok_or_else(|| format!("Machine {} not found", machine_id))?;
        conn.cmd_tx
            .send(HubToMachine::DestroyTerminal {
                terminal_id: terminal_id.to_string(),
            })
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
        let machines = self.machines.lock().await;
        let conn = machines
            .get(machine_id)
            .ok_or_else(|| format!("Machine {} not found", machine_id))?;
        conn.cmd_tx
            .send(HubToMachine::TerminalInput {
                terminal_id: terminal_id.to_string(),
                data: data.to_string(),
            })
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
        let machines = self.machines.lock().await;
        let conn = machines
            .get(machine_id)
            .ok_or_else(|| format!("Machine {} not found", machine_id))?;
        conn.cmd_tx
            .send(HubToMachine::TerminalResize {
                terminal_id: terminal_id.to_string(),
                cols,
                rows,
            })
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
        let machines = self.machines.lock().await;
        let conn = machines
            .get(machine_id)
            .ok_or_else(|| format!("Machine {} not found", machine_id))?;
        conn.cmd_tx
            .send(HubToMachine::ImagePaste {
                terminal_id: terminal_id.to_string(),
                data: data.to_string(),
                mime: mime.to_string(),
                filename: filename.to_string(),
            })
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

        {
            let machines = self.machines.lock().await;
            let conn = machines
                .get(machine_id)
                .ok_or_else(|| format!("Machine {} not found", machine_id))?;
            conn.cmd_tx
                .send(HubToMachine::FsListDir {
                    request_id: request_id.clone(),
                    path: path.to_string(),
                })
                .map_err(|_| "Machine disconnected".to_string())?;
        }

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

                        let _ = self.event_tx.send(BrowserEvent::TerminalCreated { terminal });
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
                {
                    let mut machines = self.machines.lock().await;
                    if let Some(conn) = machines.get_mut(machine_id) {
                        conn.terminals.remove(&terminal_id);
                        conn.output_channels.remove(&terminal_id);
                        conn.output_buffers.remove(&terminal_id);
                    }
                }
                let _ = self.event_tx.send(BrowserEvent::TerminalDestroyed {
                    machine_id: machine_id.to_string(),
                    terminal_id,
                });
            }
            MachineToHub::TerminalOutput { terminal_id, data } => {
                let mut machines = self.machines.lock().await;
                if let Some(conn) = machines.get_mut(machine_id) {
                    let bytes = data.into_bytes();
                    // Buffer output for replay
                    let buf = conn
                        .output_buffers
                        .entry(terminal_id.clone())
                        .or_insert_with(Vec::new);
                    buf.extend_from_slice(&bytes);
                    if buf.len() > OUTPUT_BUFFER_SIZE {
                        let drain_to = buf.len() - OUTPUT_BUFFER_SIZE;
                        buf.drain(..drain_to);
                    }
                    // Broadcast to subscribers
                    if let Some(tx) = conn.output_channels.get(&terminal_id) {
                        let _ = tx.send(bytes);
                    }
                }
            }
            MachineToHub::FsListResult { request_id, entries } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Ok(PendingResult::FsListResult { entries }));
                }
            }
            MachineToHub::FsListError { request_id, error } => {
                if let Some(tx) = self.pending.lock().await.remove(&request_id) {
                    let _ = tx.send(Err(error));
                }
            }
            MachineToHub::Pong => {}
        }
    }
}
