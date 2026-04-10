use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

const OUTPUT_BUFFER_SIZE: usize = 64 * 1024;
const BROADCAST_CAPACITY: usize = 256;

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    info: SessionInfo,
    output_tx: broadcast::Sender<Vec<u8>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn detect_login_shell() -> String {
        let user = std::env::var("USER").unwrap_or_default();
        if !user.is_empty() {
            if let Ok(output) = std::process::Command::new("getent")
                .args(["passwd", &user])
                .output()
            {
                if let Ok(line) = String::from_utf8(output.stdout) {
                    if let Some(shell) = line.trim().rsplit(':').next() {
                        if !shell.is_empty() && std::path::Path::new(shell).exists() {
                            return shell.to_string();
                        }
                    }
                }
            }
        }
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }

    pub fn create_terminal(&self, id: &str, cwd: &str, cols: u16, rows: u16) -> Result<SessionInfo, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        // Expand ~ to home directory
        let resolved_cwd = if cwd.starts_with("~/") || cwd == "~" {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
            cwd.replacen('~', &home, 1)
        } else {
            cwd.to_string()
        };

        let shell_path = Self::detect_login_shell();
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&resolved_cwd);

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        drop(pair.slave);

        let info = SessionInfo {
            id: id.to_string(),
            title: format!("Terminal {}", &id[..8.min(id.len())]),
            cwd: cwd.to_string(),
            cols,
            rows,
        };

        let (output_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let output_buffer = Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_SIZE)));

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let tx_clone = output_tx.clone();
        let buf_clone = output_buffer.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        {
                            let mut buffer = buf_clone.lock().unwrap();
                            buffer.extend_from_slice(&data);
                            if buffer.len() > OUTPUT_BUFFER_SIZE {
                                let drain_to = buffer.len() - OUTPUT_BUFFER_SIZE;
                                buffer.drain(..drain_to);
                            }
                        }
                        let _ = tx_clone.send(data);
                    }
                    Err(_) => break,
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            writer,
            info: info.clone(),
            output_tx,
            output_buffer,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id.to_string(), session);

        Ok(info)
    }

    pub fn destroy_terminal(&self, id: &str) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .remove(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;
        Ok(())
    }

    pub fn resize_terminal(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let session = sessions.get_mut(id).ok_or_else(|| format!("Terminal {} not found", id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize: {}", e))?;

        session.info.cols = cols;
        session.info.rows = rows;
        Ok(())
    }

    pub fn write_to_terminal(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let session = sessions.get_mut(id).ok_or_else(|| format!("Terminal {} not found", id))?;

        session.writer.write_all(data).map_err(|e| format!("Failed to write: {}", e))?;
        session.writer.flush().map_err(|e| format!("Failed to flush: {}", e))?;
        Ok(())
    }

    /// Subscribe to terminal output. Returns (buffered_output, receiver).
    pub fn subscribe(&self, id: &str) -> Result<(Vec<u8>, broadcast::Receiver<Vec<u8>>), String> {
        let sessions = self.sessions.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let session = sessions.get(id).ok_or_else(|| format!("Terminal {} not found", id))?;

        let buffer = session.output_buffer.lock().unwrap().clone();
        let rx = session.output_tx.subscribe();
        Ok((buffer, rx))
    }

    pub fn list_terminals(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}
