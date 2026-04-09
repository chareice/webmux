use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

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
    info: TerminalInfo,
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

        // Drop slave after spawning - we only need the master side
        drop(pair.slave);

        let id = Uuid::new_v4().to_string();
        let info = TerminalInfo {
            id: id.clone(),
            title: format!("Terminal {}", &id[..8]),
            cwd: cwd.to_string(),
            cols,
            rows,
        };

        let session = PtySession {
            master: pair.master,
            info: info.clone(),
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id, session);

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

        let mut writer = session
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;

        writer
            .write_all(data)
            .map_err(|e| format!("Failed to write: {}", e))?;

        Ok(())
    }

    pub fn take_reader(
        &self,
        id: &str,
    ) -> Result<Box<dyn Read + Send>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        session
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))
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
    fn test_write_and_read_terminal() {
        let manager = PtyManager::new();
        let info = manager.create_terminal("/tmp", 80, 24).unwrap();

        // Get reader before writing
        let mut reader = manager.take_reader(&info.id).unwrap();

        // Write to terminal
        manager
            .write_to_terminal(&info.id, b"echo hello\n")
            .unwrap();

        // Read output (with timeout)
        let mut buf = [0u8; 1024];
        thread::sleep(Duration::from_millis(200));
        let n = reader.read(&mut buf).unwrap();
        assert!(n > 0);
    }
}
