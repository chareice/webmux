use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const TMUX_SOCKET: &str = "webmux";
const TMUX_PREFIX: &str = "wmx_";

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

pub struct TmuxAttach {
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub master: Box<dyn MasterPty + Send>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PaneInfo {
    /// Live pane title; `None` when tmux has no real title (empty or the
    /// untouched hostname default).
    pub title: Option<String>,
    /// `pane_current_path`; `None` when tmux didn't report one.
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedSession {
    title: String,
    cwd: String,
    cols: u16,
    rows: u16,
}

/// Lightweight metadata holder for tmux-backed terminals.
///
/// The new architecture spawns one `tmux attach` subprocess per browser
/// (see `crate::attach::AttachManager`). PtyManager is no longer in the
/// byte-streaming path: it just creates / destroys tmux sessions, persists
/// their metadata to disk, and answers metadata queries.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
}

impl PtyManager {
    /// Construct a new PtyManager. Panics if tmux is not available — see
    /// `webmux-node start` for the user-facing check that fails fast on
    /// missing tmux. tmux is mandatory in this build.
    pub fn new() -> Self {
        if !check_tmux_available() {
            panic!(
                "tmux not found in PATH. webmux-node requires tmux. \
                 Install tmux via your package manager and try again."
            );
        }
        ensure_tmux_config();
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_terminal(
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

        // tmux initializes every pane title to the host name. With
        // set-titles-string "#T", that metadata would otherwise be emitted
        // as OSC 0 to each attached client and mistaken for an application
        // title. Start empty; a real OSC 0/2 from the pane can still replace
        // it normally.
        let _ = tmux_cmd().args(clear_pane_title_args(&tmux_name)).status();

        // Pin the window size to "manual" *after* the session exists, so
        // browser attaches with different viewport sizes don't tug the
        // window. The session's size is whatever new-session set it to;
        // controller-driven `tmux resize-window` calls from AttachResize
        // are the only thing that changes it from now on.
        //
        // (We can't put `set -g window-size manual` in the config file —
        // tmux 3.3a's server crashes during startup if window-size is
        // manual but no client has yet established a base size.)
        let _ = tmux_cmd()
            .args([
                "-L",
                TMUX_SOCKET,
                "set-option",
                "-t",
                &tmux_name,
                "window-size",
                "manual",
            ])
            .status();

        // Forward selected environment variables into the tmux session.
        for var in &["CLAUDE_CODE_NO_FLICKER"] {
            if let Ok(val) = std::env::var(var) {
                let _ = tmux_cmd()
                    .args([
                        "-L",
                        TMUX_SOCKET,
                        "set-environment",
                        "-t",
                        &tmux_name,
                        var,
                        &val,
                    ])
                    .status();
            }
        }

        let info = SessionInfo {
            id: id.to_string(),
            title: String::new(),
            cwd: cwd.to_string(),
            cols,
            rows,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .insert(id.to_string(), info.clone());

        self.persist();
        Ok(info)
    }

    pub fn destroy_terminal(&self, id: &str) -> Result<(), String> {
        let removed = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .remove(id);
        if removed.is_some() {
            tmux_kill_session(id);
            self.persist();
            Ok(())
        } else {
            Err(format!("Terminal {} not found", id))
        }
    }

    /// Send a string to the terminal as if the user typed it. Used to
    /// replay startup_command after terminal creation. Goes through
    /// `tmux send-keys`, so we don't need a long-lived PTY here.
    pub fn write_to_terminal(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let text = std::str::from_utf8(data)
            .map_err(|e| format!("write_to_terminal expects UTF-8 data: {}", e))?;

        let name = tmux_session_name(id);
        // Send literal text first (-l prevents key-name interpretation),
        // then any embedded carriage returns become Enter via send-keys C-m.
        // For startup_command the caller passes "<cmd>\r" — we split on \r
        // so the trailing newline becomes a real Enter.
        let mut parts = text.split('\r');
        if let Some(first) = parts.next() {
            if !first.is_empty() {
                let status = tmux_cmd()
                    .args(["-L", TMUX_SOCKET, "send-keys", "-l", "-t", &name, first])
                    .status()
                    .map_err(|e| format!("Failed to run tmux send-keys: {}", e))?;
                if !status.success() {
                    return Err(format!("tmux send-keys failed (exit {})", status));
                }
            }
        }
        for chunk in parts {
            // Each split boundary represents one '\r' — press Enter.
            let _ = tmux_cmd()
                .args(["-L", TMUX_SOCKET, "send-keys", "-t", &name, "C-m"])
                .status();
            if !chunk.is_empty() {
                let _ = tmux_cmd()
                    .args(["-L", TMUX_SOCKET, "send-keys", "-l", "-t", &name, chunk])
                    .status();
            }
        }
        Ok(())
    }

    /// Check if a terminal has a foreground process running (not just a shell).
    /// Returns (has_foreground_process, process_name).
    pub fn check_foreground_process(&self, id: &str) -> (bool, Option<String>) {
        if !self
            .sessions
            .lock()
            .map(|s| s.contains_key(id))
            .unwrap_or(false)
        {
            return (false, None);
        }

        let tmux_name = tmux_session_name(id);
        let output = tmux_cmd()
            .args([
                "-L",
                TMUX_SOCKET,
                "list-panes",
                "-t",
                &tmux_name,
                "-f",
                "#{pane_active}",
                "-F",
                "#{pane_current_command}",
            ])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let cmd = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if cmd.is_empty() || is_shell_name(&cmd) {
                    (false, None)
                } else {
                    (true, Some(cmd))
                }
            }
            _ => (false, None),
        }
    }

    pub fn list_terminals(&self) -> Vec<SessionInfo> {
        self.sessions.lock().unwrap().values().cloned().collect()
    }

    /// Poll tmux for every pane's title and current path, mapped back to
    /// terminal ids.
    ///
    /// tmux holds the live pane title even when nobody is attached, so this
    /// sees rich OSC titles the per-attach scanner can't. One subprocess per
    /// call; a tmux failure (server down) yields an empty map, never a panic.
    pub fn pane_infos(&self) -> HashMap<String, PaneInfo> {
        let output = tmux_cmd()
            .args([
                "-L",
                TMUX_SOCKET,
                "list-panes",
                "-a",
                "-F",
                "#{session_name}\t#{pane_title}\t#{pane_current_path}",
            ])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                parse_pane_info(&String::from_utf8_lossy(&out.stdout), &current_hostname())
            }
            _ => HashMap::new(),
        }
    }

    /// Cheap "is this id still alive on the machine" check used by the
    /// session watcher's reconciliation loop.
    pub fn list_terminal_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Recover existing tmux sessions from a previous webmux-node run.
    /// Returns recovered SessionInfo list for reporting to the hub. The
    /// per-attach byte streams are established on-demand when browsers
    /// connect, so there is nothing more to wire up here than the metadata.
    pub fn recover_sessions(&self) -> Vec<SessionInfo> {
        let persisted = load_sessions_file();
        if persisted.is_empty() {
            return vec![];
        }

        let alive = tmux_list_sessions();
        let mut recovered = vec![];

        for (id, meta) in &persisted {
            let tmux_name = tmux_session_name(id);
            if !alive.contains(&tmux_name) {
                tracing::info!(
                    "tmux session {} gone (shell exited), cleaning up",
                    tmux_name
                );
                continue;
            }
            let info = SessionInfo {
                id: id.clone(),
                title: meta.title.clone(),
                cwd: meta.cwd.clone(),
                cols: meta.cols,
                rows: meta.rows,
            };
            self.sessions
                .lock()
                .unwrap()
                .insert(id.clone(), info.clone());
            recovered.push(info);
            tracing::info!("Recovered terminal {} (tmux {})", id, tmux_name);
        }

        // Rewrite file to drop dead sessions
        self.persist();
        recovered
    }

    fn persist(&self) {
        let sessions = self.sessions.lock().unwrap();
        let map: HashMap<String, PersistedSession> = sessions
            .iter()
            .map(|(id, info)| {
                (
                    id.clone(),
                    PersistedSession {
                        title: info.title.clone(),
                        cwd: info.cwd.clone(),
                        cols: info.cols,
                        rows: info.rows,
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

fn user_tmux_config_path() -> PathBuf {
    webmux_dir().join("tmux.user.conf")
}

fn osc52_script_path() -> PathBuf {
    webmux_dir().join("osc52copy.sh")
}

/// Build the tmux config string (extracted for testability).
fn build_tmux_config(osc52_script: &str, user_config: &str) -> String {
    let mut config = String::from(
        "\
set -g default-terminal \"xterm-256color\"
set -g status off
set -g prefix None
unbind C-b
set -g mouse on
set -s set-clipboard on
set -g allow-passthrough on
set -g set-titles on
set -g set-titles-string \"#T\"
set -g focus-events on
set -g history-limit 10000
bind -n WheelUpPane if -Ft= '#{mouse_any_flag}' 'send -M' 'if -Ft= \"#{pane_in_mode}\" \"send -M\" \"copy-mode -e\"'
bind -n MouseDrag1Pane if -Ft= '#{mouse_any_flag}' 'send -M' 'copy-mode -eM'
",
    );
    // Drag-select end is conditional on scroll position: back in history,
    // copy-pipe keeps copy-mode so the view doesn't jump to the bottom
    // (PR #223); at the bottom, copy-pipe-and-cancel exits copy-mode
    // immediately (no jump possible there).
    config.push_str(&format!(
        "bind-key -T copy-mode MouseDragEnd1Pane if -Ft= '#{{scroll_position}}' {{ send-keys -X copy-pipe '{} #{{pane_tty}}' }} {{ send-keys -X copy-pipe-and-cancel '{} #{{pane_tty}}' }}\n",
        osc52_script, osc52_script
    ));
    config.push_str(&format!(
        "bind-key -T copy-mode-vi MouseDragEnd1Pane if -Ft= '#{{scroll_position}}' {{ send-keys -X copy-pipe '{} #{{pane_tty}}' }} {{ send-keys -X copy-pipe-and-cancel '{} #{{pane_tty}}' }}\n",
        osc52_script, osc52_script
    ));
    for var in &["CLAUDE_CODE_NO_FLICKER"] {
        if let Ok(val) = std::env::var(var) {
            config.push_str(&format!("set-environment -g {} \"{}\"\n", var, val));
        }
    }
    config.push_str(&format!("source-file -q \"{}\"\n", user_config));
    config
}

const OSC52_SCRIPT: &str =
    "#!/bin/sh\nDATA=$(base64 -w0)\nprintf \"\\033]52;c;%s\\a\" \"$DATA\" > \"$1\"\n";

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

    let config_path = tmux_config_path();
    let user_config_path = user_tmux_config_path();
    let config = build_tmux_config(
        script_path.to_str().unwrap_or("osc52copy.sh"),
        user_config_path.to_str().unwrap_or("tmux.user.conf"),
    );
    let _ = std::fs::write(&config_path, config);

    // Reload config into any already-running tmux server so that bindings
    // (e.g. OSC 52 copy) take effect without killing existing sessions.
    let _ = tmux_cmd()
        .args([
            "-L",
            TMUX_SOCKET,
            "source-file",
            config_path.to_str().unwrap_or(""),
        ])
        .status();
}

pub fn check_tmux_available() -> bool {
    tmux_cmd()
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn tmux_session_name(id: &str) -> String {
    format!("{}{}", TMUX_PREFIX, id)
}

/// Parse `tmux list-panes -a -F '#{session_name}\t#{pane_title}\t#{pane_current_path}'`
/// output into terminal_id -> PaneInfo. tmux initializes an untouched pane
/// title to the machine hostname, so empty or hostname-equal titles count as
/// "no title" (the caller falls back to the foreground process name). The
/// path column may be missing or empty on older tmux — then there is simply
/// no cwd to report.
fn parse_pane_info(output: &str, hostname: &str) -> HashMap<String, PaneInfo> {
    let mut panes = HashMap::new();
    for line in output.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(session_name) = parts.next() else {
            continue;
        };
        let Some(terminal_id) = session_name.strip_prefix(TMUX_PREFIX) else {
            continue;
        };
        let title = parts
            .next()
            .map(str::trim)
            .filter(|title| !title.is_empty() && *title != hostname)
            .map(str::to_string);
        let cwd = parts
            .next()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string);
        if title.is_none() && cwd.is_none() {
            continue;
        }
        panes.insert(terminal_id.to_string(), PaneInfo { title, cwd });
    }
    panes
}

/// The machine hostname: $HOSTNAME first, the OS resolver as fallback.
/// Empty string when neither works, which disables the hostname filter.
fn current_hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            hostname::get()
                .ok()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default()
}

fn clear_pane_title_args(tmux_name: &str) -> [&str; 7] {
    ["-L", TMUX_SOCKET, "select-pane", "-t", tmux_name, "-T", ""]
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

pub fn tmux_list_sessions() -> Vec<String> {
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

/// Spawn a fresh `tmux attach` for the given session id.
///
/// Returns the attach's PTY writer, reader, and the child process handle.
/// Caller owns the lifecycle: drop / kill the child to detach. Used by
/// `crate::attach::AttachManager` to give each browser its own tmux client
/// view of the session.
pub fn spawn_tmux_attach(session_id: &str, cols: u16, rows: u16) -> Result<TmuxAttach, String> {
    let tmux_name = tmux_session_name(session_id);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open pty: {}", e))?;
    let portable_pty::PtyPair { slave, master } = pair;

    let mut cmd = CommandBuilder::new("tmux");
    cmd.args(["-L", TMUX_SOCKET, "attach-session", "-t", &tmux_name]);
    let term = std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string());
    cmd.env("TERM", term);

    let child = slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn tmux attach: {}", e))?;
    drop(slave);

    let writer = master
        .take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get reader: {}", e))?;

    Ok(TmuxAttach {
        writer,
        reader,
        child,
        master,
    })
}

/// Resize the tmux window for a session. With `window-size manual` set in
/// tmux.conf, this is the single source of truth for window sizing —
/// clients attaching/detaching no longer auto-resize.
pub fn tmux_resize_window(session_id: &str, cols: u16, rows: u16) {
    let name = tmux_session_name(session_id);
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

fn is_shell_name(cmd: &str) -> bool {
    matches!(
        cmd,
        "bash" | "zsh" | "fish" | "sh" | "dash" | "ksh" | "csh" | "tcsh" | "nu" | "nushell"
    )
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
        let content = build_tmux_config("/tmp/osc52copy.sh", "/tmp/tmux.user.conf");
        assert!(
            content.contains("set -g set-titles on"),
            "tmux must emit pane title changes to attached clients"
        );
        assert!(
            content.contains("set -g set-titles-string \"#T\""),
            "tmux client titles must contain only the pane title"
        );
        assert!(
            !content.contains("#S:#I:#W"),
            "tmux client titles must not add session or window decoration"
        );
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
            content.contains("copy-pipe '/tmp/osc52copy.sh #{pane_tty}'"),
            "missing osc52 copy binding that keeps tmux copy-mode active"
        );
        // Drag-select must enter copy-mode with scroll-exit (-e) plus -M
        // (mouse drag init), otherwise scrolling down can never leave it.
        assert!(
            content.contains(
                "bind -n MouseDrag1Pane if -Ft= '#{mouse_any_flag}' 'send -M' 'copy-mode -eM'"
            ),
            "missing MouseDrag1Pane override that enters copy-mode with -eM"
        );
        // MouseDragEnd1Pane must be conditional on #{scroll_position}: back
        // in history -> copy-pipe (stay, no jump to bottom); at the bottom ->
        // copy-pipe-and-cancel (copy and leave copy-mode immediately).
        for table in ["copy-mode", "copy-mode-vi"] {
            let binding = content
                .lines()
                .find(|l| l.starts_with(&format!("bind-key -T {} MouseDragEnd1Pane", table)))
                .unwrap_or_else(|| panic!("missing MouseDragEnd1Pane binding for {}", table));
            assert!(
                binding.contains("'#{scroll_position}'"),
                "{} MouseDragEnd1Pane must branch on #{{scroll_position}}",
                table
            );
            assert!(
                binding.contains("copy-pipe '/tmp/osc52copy.sh #{pane_tty}'"),
                "{} MouseDragEnd1Pane must keep a copy-pipe branch with the osc52 script",
                table
            );
            assert!(
                binding.contains("copy-pipe-and-cancel '/tmp/osc52copy.sh #{pane_tty}'"),
                "{} MouseDragEnd1Pane must have a copy-pipe-and-cancel branch with the osc52 script",
                table
            );
        }
        assert!(
            content.contains("WheelUpPane") && content.contains("copy-mode -e"),
            "missing scroll-to-copy-mode binding"
        );
        // window-size is set per-session in create_terminal (after new-session)
        // rather than via the global config, because tmux 3.3a's server
        // crashes during startup if `set -g window-size manual` is in the
        // config before any client has established a base size.
        assert!(
            !content.contains("window-size manual"),
            "window-size manual should NOT be in the global config"
        );
        assert!(
            content.contains("source-file -q \"/tmp/tmux.user.conf\""),
            "missing user config source"
        );
    }

    #[test]
    fn parse_pane_info_maps_sessions_back_to_terminal_ids() {
        let panes = parse_pane_info(
            "wmx_aaa\tfix the bug\t/home/user\nwmx_bbb\t✳ 了解项目\t/src\n",
            "dev",
        );
        assert_eq!(
            panes.get("aaa"),
            Some(&PaneInfo {
                title: Some("fix the bug".to_string()),
                cwd: Some("/home/user".to_string()),
            })
        );
        assert_eq!(
            panes.get("bbb"),
            Some(&PaneInfo {
                title: Some("✳ 了解项目".to_string()),
                cwd: Some("/src".to_string()),
            })
        );
    }

    #[test]
    fn parse_pane_info_skips_empty_and_hostname_titles() {
        let panes = parse_pane_info(
            "wmx_aaa\t\t/home/user\nwmx_bbb\tdev\t/dev\nwmx_ccc\treal title\t/tmp\n",
            "dev",
        );
        assert_eq!(
            panes.get("aaa"),
            Some(&PaneInfo {
                title: None,
                cwd: Some("/home/user".to_string()),
            })
        );
        assert_eq!(
            panes.get("bbb"),
            Some(&PaneInfo {
                title: None,
                cwd: Some("/dev".to_string()),
            })
        );
        assert_eq!(
            panes.get("ccc").and_then(|info| info.title.as_deref()),
            Some("real title")
        );
    }

    #[test]
    fn parse_pane_info_skips_malformed_lines_and_foreign_sessions() {
        let panes = parse_pane_info("no tab here\nother-session\ttitle\t/tmp\n\n", "dev");
        assert!(panes.is_empty());
    }

    #[test]
    fn parse_pane_info_tolerates_crlf() {
        let panes = parse_pane_info("wmx_aaa\tfix the bug\t/home/user\r\n", "dev");
        assert_eq!(
            panes.get("aaa"),
            Some(&PaneInfo {
                title: Some("fix the bug".to_string()),
                cwd: Some("/home/user".to_string()),
            })
        );
    }

    #[test]
    fn parse_pane_info_handles_a_missing_path_column() {
        let panes = parse_pane_info("wmx_aaa\tfix the bug\n", "dev");
        assert_eq!(
            panes.get("aaa"),
            Some(&PaneInfo {
                title: Some("fix the bug".to_string()),
                cwd: None,
            })
        );
    }

    #[test]
    fn parse_pane_info_skips_an_empty_path() {
        let panes = parse_pane_info("wmx_aaa\tfix the bug\t\n", "dev");
        assert_eq!(
            panes.get("aaa"),
            Some(&PaneInfo {
                title: Some("fix the bug".to_string()),
                cwd: None,
            })
        );
        // No title and no path at all → no entry.
        let panes = parse_pane_info("wmx_aaa\t\t\n", "dev");
        assert!(panes.is_empty());
    }

    #[test]
    fn is_shell_name_recognizes_shells() {
        assert!(is_shell_name("bash"));
        assert!(is_shell_name("zsh"));
        assert!(is_shell_name("fish"));
        assert!(is_shell_name("sh"));
        assert!(is_shell_name("dash"));
        assert!(is_shell_name("nu"));
        assert!(!is_shell_name("vim"));
        assert!(!is_shell_name("python"));
        assert!(!is_shell_name("cargo"));
        assert!(!is_shell_name("node"));
    }

    #[test]
    fn clear_pane_title_targets_the_new_sessions_active_pane() {
        assert_eq!(
            clear_pane_title_args("wmx_terminal-a"),
            [
                "-L",
                TMUX_SOCKET,
                "select-pane",
                "-t",
                "wmx_terminal-a",
                "-T",
                ""
            ]
        );
    }
}
