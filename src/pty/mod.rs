use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use uuid::Uuid;

const OUTPUT_BUFFER_SIZE: usize = 64 * 1024; // 64KB scrollback buffer
const BROADCAST_CAPACITY: usize = 256;

#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    info: TerminalInfo,
    output_tx: broadcast::Sender<Vec<u8>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
    // Virtual terminal screen for reading parsed content
    screen: Arc<Mutex<vt100::Parser>>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum TerminalEvent {
    #[serde(rename = "created")]
    Created { terminal: TerminalInfo },
    #[serde(rename = "destroyed")]
    Destroyed { id: String },
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    event_tx: broadcast::Sender<TerminalEvent>,
}

impl PtyManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(64);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    pub fn create_terminal(&self, cwd: &str, cols: u16, rows: u16) -> Result<TerminalInfo, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.cwd(cwd);

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        drop(pair.slave);

        let id = Uuid::new_v4().to_string();
        let info = TerminalInfo {
            id: id.clone(),
            title: format!("Terminal {}", &id[..8]),
            cwd: cwd.to_string(),
            cols,
            rows,
        };

        let (output_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let output_buffer = Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_SIZE)));
        let screen = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 0)));

        // Take writer before spawning reader thread
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        // Spawn reader thread to broadcast PTY output
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let tx_clone = output_tx.clone();
        let buf_clone = output_buffer.clone();
        let screen_clone = screen.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        // Append to ring buffer
                        {
                            let mut buffer = buf_clone.lock().unwrap();
                            buffer.extend_from_slice(&data);
                            if buffer.len() > OUTPUT_BUFFER_SIZE {
                                let drain_to = buffer.len() - OUTPUT_BUFFER_SIZE;
                                buffer.drain(..drain_to);
                            }
                        }
                        // Feed virtual terminal screen
                        {
                            let mut parser = screen_clone.lock().unwrap();
                            parser.process(&data);
                        }
                        // Broadcast (ignore if no receivers)
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
            screen,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id, session);

        let _ = self.event_tx.send(TerminalEvent::Created {
            terminal: info.clone(),
        });

        Ok(info)
    }

    pub fn list_terminals(&self) -> Vec<TerminalInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }

    pub fn destroy_terminal(&self, id: &str) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .remove(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        let _ = self.event_tx.send(TerminalEvent::Destroyed {
            id: id.to_string(),
        });

        Ok(())
    }

    pub fn resize_terminal(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

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
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| format!("Failed to write: {}", e))?;

        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush: {}", e))?;

        Ok(())
    }

    /// Subscribe to terminal output. Returns (buffered_output, receiver).
    /// The buffered output contains all recent output for replay.
    pub fn subscribe(&self, id: &str) -> Result<(Vec<u8>, broadcast::Receiver<Vec<u8>>), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let session = sessions
            .get(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        let buffer = session.output_buffer.lock().unwrap().clone();
        let rx = session.output_tx.subscribe();

        Ok((buffer, rx))
    }

    /// Read the last N lines from the terminal screen.
    pub fn read_screen(&self, id: &str, last_n_lines: Option<usize>) -> Result<Vec<String>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let session = sessions
            .get(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        let parser = session.screen.lock().unwrap();
        let screen = parser.screen();
        let cols = screen.size().1;

        let mut lines: Vec<String> = screen
            .rows(0, cols)
            .map(|row| row.trim_end().to_string())
            .collect();

        // Trim trailing empty lines
        while matches!(lines.last(), Some(l) if l.is_empty()) {
            lines.pop();
        }

        if let Some(n) = last_n_lines {
            let start = lines.len().saturating_sub(n);
            lines = lines[start..].to_vec();
        }

        Ok(lines)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<TerminalEvent> {
        self.event_tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_create_terminal() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        assert_eq!(info.cwd, "/tmp");
        assert_eq!(info.cols, 80);
        assert_eq!(info.rows, 24);
        assert!(!info.id.is_empty());
    }

    #[test]
    fn test_list_terminals() {
        let manager = PtyManager::new();
        assert_eq!(manager.list_terminals().len(), 0);

        manager.create_terminal("/tmp", 80, 24).unwrap();
        assert_eq!(manager.list_terminals().len(), 1);

        manager.create_terminal("/tmp", 80, 24).unwrap();
        assert_eq!(manager.list_terminals().len(), 2);
    }

    #[test]
    fn test_destroy_terminal() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        assert_eq!(manager.list_terminals().len(), 1);
        manager.destroy_terminal(&info.id).unwrap();
        assert_eq!(manager.list_terminals().len(), 0);
    }

    #[test]
    fn test_destroy_nonexistent_terminal() {
        let manager = PtyManager::new();
        assert!(manager.destroy_terminal("nonexistent").is_err());
    }

    #[test]
    fn test_resize_terminal() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        manager.resize_terminal(&info.id, 120, 40).unwrap();

        let terminals = manager.list_terminals();
        let updated = terminals.iter().find(|t| t.id == info.id).unwrap();
        assert_eq!(updated.cols, 120);
        assert_eq!(updated.rows, 40);
    }

    #[test]
    fn test_subscribe_and_write() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        let (buffer, mut rx) = manager.subscribe(&info.id).unwrap();

        // Wait a moment for shell prompt to arrive
        thread::sleep(Duration::from_millis(300));

        // Buffer should have some shell prompt
        let buffer2 = manager
            .sessions
            .lock()
            .unwrap()
            .get(&info.id)
            .unwrap()
            .output_buffer
            .lock()
            .unwrap()
            .clone();
        assert!(!buffer2.is_empty() || !buffer.is_empty());

        // Write to terminal and check broadcast
        manager
            .write_to_terminal(&info.id, b"echo test\n")
            .unwrap();

        thread::sleep(Duration::from_millis(200));

        // Should receive something via broadcast
        let mut received = false;
        while let Ok(_data) = rx.try_recv() {
            received = true;
        }
        assert!(received);
    }

    #[test]
    fn test_multiple_subscribers() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        let (_buf1, mut rx1) = manager.subscribe(&info.id).unwrap();
        let (_buf2, mut rx2) = manager.subscribe(&info.id).unwrap();

        manager
            .write_to_terminal(&info.id, b"echo multi\n")
            .unwrap();

        thread::sleep(Duration::from_millis(200));

        // Both subscribers should receive data
        let mut rx1_got = false;
        let mut rx2_got = false;
        while let Ok(_) = rx1.try_recv() {
            rx1_got = true;
        }
        while let Ok(_) = rx2.try_recv() {
            rx2_got = true;
        }
        assert!(rx1_got);
        assert!(rx2_got);
    }

    #[test]
    fn test_read_screen() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        // Wait for shell prompt
        thread::sleep(Duration::from_millis(500));

        // Write a command and wait for output
        manager
            .write_to_terminal(&info.id, b"echo SCREEN_TEST_OUTPUT\n")
            .unwrap();

        thread::sleep(Duration::from_millis(1000));

        let lines = manager.read_screen(&info.id, None).unwrap();
        assert!(!lines.is_empty(), "Screen should have content");

        let content = lines.join("\n");
        assert!(
            content.contains("SCREEN_TEST_OUTPUT"),
            "Screen content should contain test output, got: {}",
            content
        );
    }

    #[test]
    fn test_read_screen_last_n_lines() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        thread::sleep(Duration::from_millis(500));

        manager
            .write_to_terminal(&info.id, b"echo line1; echo line2; echo line3\n")
            .unwrap();

        thread::sleep(Duration::from_millis(1000));

        let all = manager.read_screen(&info.id, None).unwrap();
        assert!(all.len() >= 3, "Should have at least 3 lines, got {}", all.len());

        let last_2 = manager.read_screen(&info.id, Some(2)).unwrap();
        assert_eq!(last_2.len(), 2);
    }
}
