use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

const OUTPUT_BUFFER_SIZE: usize = 64 * 1024;
const BROADCAST_CAPACITY: usize = 256;
const TMUX_SOCKET: &str = "webmux";
const TMUX_PREFIX: &str = "wmx_";

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    info: SessionInfo,
    output_tx: broadcast::Sender<Vec<u8>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
    tmux_backed: bool,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedSession {
    title: String,
    cwd: String,
    cols: u16,
    rows: u16,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    use_tmux: bool,
}

impl PtyManager {
    pub fn new() -> Self {
        let use_tmux = check_tmux_available();
        if use_tmux {
            tracing::info!("tmux available — terminal sessions will persist across restarts");
            ensure_tmux_config();
        } else {
            tracing::warn!("tmux not found — terminal sessions will NOT persist across restarts");
        }
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            use_tmux,
        }
    }

    // ── Public API ──────────────────────────────────────────────────

    pub fn create_terminal(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, String> {
        if self.use_tmux {
            self.create_terminal_tmux(id, cwd, cols, rows)
        } else {
            self.create_terminal_direct(id, cwd, cols, rows)
        }
    }

    pub fn destroy_terminal(&self, id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .remove(id)
            .ok_or_else(|| format!("Terminal {} not found", id))?;

        if session.tmux_backed {
            tmux_kill_session(id);
            self.persist();
        }
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

        if session.tmux_backed {
            tmux_resize(id, cols, rows);
        }

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

    pub fn subscribe(
        &self,
        id: &str,
    ) -> Result<(Vec<u8>, broadcast::Receiver<Vec<u8>>), String> {
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

    fn clear_output_buffer(&self, id: &str) {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get(id) {
                session.output_buffer.lock().unwrap().clear();
            }
        }
    }

    pub fn list_terminals(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }

    /// Recover existing tmux sessions from a previous run.
    /// Returns recovered SessionInfo list for reporting to the hub.
    pub fn recover_sessions(&self) -> Vec<SessionInfo> {
        if !self.use_tmux {
            return vec![];
        }

        let persisted = load_sessions_file();
        if persisted.is_empty() {
            return vec![];
        }

        let alive = tmux_list_sessions();
        let mut recovered = vec![];

        for (id, meta) in &persisted {
            let tmux_name = tmux_session_name(id);
            if !alive.contains(&tmux_name) {
                tracing::info!("tmux session {} gone (shell exited), cleaning up", tmux_name);
                continue;
            }

            match self.attach_to_tmux(id, &meta.title, &meta.cwd, meta.cols, meta.rows) {
                Ok(info) => {
                    tracing::info!("Recovered terminal {} (tmux {})", id, tmux_name);
                    recovered.push(info);
                }
                Err(e) => {
                    tracing::error!("Failed to recover terminal {}: {}", id, e);
                }
            }
        }

        // Rewrite file to drop dead sessions
        self.persist();
        recovered
    }

    // ── tmux-backed terminal ────────────────────────────────────────

    fn create_terminal_tmux(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, String> {
        let tmux_name = tmux_session_name(id);
        let resolved_cwd = resolve_cwd(cwd);
        let shell = detect_login_shell();

        let status = tmux_cmd()
            .args([
                "-L",
                TMUX_SOCKET,
                "new-session",
                "-d",
                "-s",
                &tmux_name,
                "-x",
                &cols.to_string(),
                "-y",
                &rows.to_string(),
                "-c",
                &resolved_cwd,
                &shell,
            ])
            .status()
            .map_err(|e| format!("Failed to run tmux: {}", e))?;

        if !status.success() {
            return Err(format!("tmux new-session failed (exit {})", status));
        }

        // Forward selected environment variables into the tmux session
        for var in &["CLAUDE_CODE_NO_FLICKER"] {
            if let Ok(val) = std::env::var(var) {
                let _ = tmux_cmd()
                    .args(["-L", TMUX_SOCKET, "set-environment", "-t", &tmux_name, var, &val])
                    .status();
            }
        }

        let title = format!("Terminal {}", &id[..8.min(id.len())]);
        let info = self.attach_to_tmux(id, &title, cwd, cols, rows)?;

        // Discard initial tmux screen capture, then trigger a fresh prompt.
        // The browser subscribes after create_terminal returns, so it will
        // only see the clean Ctrl+L response via live forwarding.
        std::thread::sleep(std::time::Duration::from_millis(150));
        self.clear_output_buffer(&info.id);
        let _ = self.write_to_terminal(&info.id, b"\x0c");

        self.persist();
        Ok(info)
    }

    /// Open a PTY running `tmux attach` and wire up I/O forwarding.
    fn attach_to_tmux(
        &self,
        id: &str,
        title: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, String> {
        let tmux_name = tmux_session_name(id);

        // Detach any stale clients from previous runs before attaching
        let _ = tmux_cmd()
            .args(["-L", TMUX_SOCKET, "detach-client", "-s", &tmux_name, "-a"])
            .status();

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        let mut cmd = CommandBuilder::new("tmux");
        cmd.args(["-L", TMUX_SOCKET, "attach-session", "-t", &tmux_name]);
        // Ensure TERM is set for the attach process
        let term = std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string());
        cmd.env("TERM", term);

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn tmux attach: {}", e))?;
        drop(pair.slave);

        let info = SessionInfo {
            id: id.to_string(),
            title: title.to_string(),
            cwd: cwd.to_string(),
            cols,
            rows,
        };

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let (output_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let output_buffer = Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_SIZE)));

        spawn_reader_thread(reader, output_tx.clone(), output_buffer.clone());

        let session = PtySession {
            master: pair.master,
            writer,
            info: info.clone(),
            output_tx,
            output_buffer,
            tmux_backed: true,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id.to_string(), session);

        Ok(info)
    }

    // ── Direct PTY (fallback when tmux unavailable) ─────────────────

    fn create_terminal_direct(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        let resolved_cwd = resolve_cwd(cwd);
        let shell = detect_login_shell();
        let mut cmd = CommandBuilder::new(&shell);
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

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get reader: {}", e))?;

        let (output_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let output_buffer = Arc::new(Mutex::new(Vec::with_capacity(OUTPUT_BUFFER_SIZE)));

        spawn_reader_thread(reader, output_tx.clone(), output_buffer.clone());

        let session = PtySession {
            master: pair.master,
            writer,
            info: info.clone(),
            output_tx,
            output_buffer,
            tmux_backed: false,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id.to_string(), session);

        Ok(info)
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let sessions = self.sessions.lock().unwrap();
        let map: HashMap<String, PersistedSession> = sessions
            .iter()
            .filter(|(_, s)| s.tmux_backed)
            .map(|(id, s)| {
                (
                    id.clone(),
                    PersistedSession {
                        title: s.info.title.clone(),
                        cwd: s.info.cwd.clone(),
                        cols: s.info.cols,
                        rows: s.info.rows,
                    },
                )
            })
            .collect();
        drop(sessions);

        let path = sessions_file_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&map) {
            let _ = std::fs::write(&path, json);
        }
    }
}

// ── Free helpers ────────────────────────────────────────────────────

fn spawn_reader_thread(
    reader: Box<dyn Read + Send>,
    output_tx: broadcast::Sender<Vec<u8>>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
) {
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    {
                        let mut buffer = output_buffer.lock().unwrap();
                        buffer.extend_from_slice(&data);
                        if buffer.len() > OUTPUT_BUFFER_SIZE {
                            let drain_to = buffer.len() - OUTPUT_BUFFER_SIZE;
                            buffer.drain(..drain_to);
                        }
                    }
                    let _ = output_tx.send(data);
                }
                Err(_) => break,
            }
        }
    });
}

/// Create a tmux Command with TERM set and our config file.
fn tmux_cmd() -> std::process::Command {
    let mut cmd = std::process::Command::new("tmux");
    if std::env::var("TERM").is_err() {
        cmd.env("TERM", "xterm-256color");
    }
    let config = tmux_config_path();
    if config.exists() {
        cmd.arg("-f").arg(&config);
    }
    cmd
}

fn webmux_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("webmux")
}

fn tmux_config_path() -> PathBuf {
    webmux_dir().join("tmux.conf")
}

fn osc52_script_path() -> PathBuf {
    webmux_dir().join("osc52copy.sh")
}

/// Build the tmux config string (extracted for testability).
fn build_tmux_config(osc52_script: &str) -> String {
    let mut config = String::from("\
set -g default-terminal \"xterm-256color\"
set -g status off
set -g prefix None
unbind C-b
set -g mouse on
set -s set-clipboard on
set -g history-limit 10000
");
    // Bind mouse drag-end to copy selection and emit OSC 52 via helper script.
    // tmux's built-in OSC 52 emission is unreliable, so we pipe the selection
    // through a script that writes the OSC 52 sequence to the pane's TTY.
    // tmux expands #{pane_tty} at execution time and passes it as an argument.
    config.push_str(&format!(
        "bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel '{} #{{pane_tty}}'\n",
        osc52_script
    ));
    config.push_str(&format!(
        "bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel '{} #{{pane_tty}}'\n",
        osc52_script
    ));
    for var in &["CLAUDE_CODE_NO_FLICKER"] {
        if let Ok(val) = std::env::var(var) {
            config.push_str(&format!("set-environment -g {} \"{}\"\n", var, val));
        }
    }
    config
}

const OSC52_SCRIPT: &str = "#!/bin/sh\nDATA=$(base64 -w0)\nprintf \"\\033]52;c;%s\\a\" \"$DATA\" > \"$1\"\n";

/// Write a minimal tmux config and the OSC 52 helper script.
fn ensure_tmux_config() {
    let dir = webmux_dir();
    let _ = std::fs::create_dir_all(&dir);

    let script_path = osc52_script_path();
    let _ = std::fs::write(&script_path, OSC52_SCRIPT);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));
    }

    let config = build_tmux_config(script_path.to_str().unwrap_or("osc52copy.sh"));
    let _ = std::fs::write(tmux_config_path(), config);
}

fn check_tmux_available() -> bool {
    tmux_cmd()
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn tmux_session_name(id: &str) -> String {
    format!("{}{}", TMUX_PREFIX, id)
}

fn sessions_file_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("webmux")
        .join("sessions.json")
}

fn load_sessions_file() -> HashMap<String, PersistedSession> {
    let path = sessions_file_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn tmux_list_sessions() -> Vec<String> {
    tmux_cmd()
        .args(["-L", TMUX_SOCKET, "list-sessions", "-F", "#{session_name}"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .map(|s| s.to_string())
                        .collect(),
                )
            } else {
                None
            }
        })
        .unwrap_or_default()
}

fn tmux_kill_session(id: &str) {
    let name = tmux_session_name(id);
    let _ = tmux_cmd()
        .args(["-L", TMUX_SOCKET, "kill-session", "-t", &name])
        .status();
}

fn tmux_resize(id: &str, cols: u16, rows: u16) {
    let name = tmux_session_name(id);
    let _ = tmux_cmd()
        .args([
            "-L",
            TMUX_SOCKET,
            "resize-window",
            "-t",
            &name,
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
        ])
        .status();
}

fn detect_login_shell() -> String {
    let user = std::env::var("USER").unwrap_or_default();
    if !user.is_empty() {
        if let Some(shell) = detect_shell_for_user(&user) {
            return shell;
        }
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

/// Query the system user database for the login shell.
/// Uses `dscl` on macOS, `getent` on Linux.
fn detect_shell_for_user(user: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("dscl")
            .args([".", "-read", &format!("/Users/{user}"), "UserShell"])
            .output()
            .ok()?;
        // Output format: "UserShell: /bin/zsh"
        let line = String::from_utf8(output.stdout).ok()?;
        let shell = line.trim().strip_prefix("UserShell:")?.trim();
        if !shell.is_empty() && std::path::Path::new(shell).exists() {
            return Some(shell.to_string());
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let output = std::process::Command::new("getent")
            .args(["passwd", user])
            .output()
            .ok()?;
        let line = String::from_utf8(output.stdout).ok()?;
        let shell = line.trim().rsplit(':').next()?;
        if !shell.is_empty() && std::path::Path::new(shell).exists() {
            return Some(shell.to_string());
        }
    }
    None
}

fn resolve_cwd(cwd: &str) -> String {
    if cwd.starts_with("~/") || cwd == "~" {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        cwd.replacen('~', &home, 1)
    } else {
        cwd.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmux_config_contains_mouse_and_clipboard() {
        let content = build_tmux_config("/tmp/osc52copy.sh");
        assert!(content.contains("set -g mouse on"), "missing mouse on");
        assert!(
            content.contains("set -s set-clipboard on"),
            "missing set-clipboard"
        );
        assert!(
            content.contains("set -g history-limit 10000"),
            "missing history-limit"
        );
        assert!(
            content.contains("copy-pipe-and-cancel '/tmp/osc52copy.sh #{pane_tty}'"),
            "missing osc52 copy binding"
        );
    }
}
