use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tc_protocol::{encode_attach_output_frame, DirEntry, HubToMachine, MachineToHub};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::attach::{AttachEvent, AttachManager};
use crate::pty::{tmux_resize_window, PtyManager};
use crate::session_watcher::SessionWatcher;
use crate::stats::should_emit_stats;
use crate::zellij::NativeZellijManager;

const HUB_OUTBOUND_CAPACITY: usize = 256;

enum OutboundHubMessage {
    Json(MachineToHub),
    AttachOutput { attach_id: String, data: Bytes },
}

pub struct HubConnection {
    pub machine_id: String,
    pub machine_name: String,
    pub machine_secret: String,
    pub hub_url: String,
    pub pty_manager: Arc<PtyManager>,
    pub native_zellij_manager: Arc<NativeZellijManager>,
}

impl HubConnection {
    /// Connect to the Hub and handle messages. Reconnects on failure.
    pub async fn run(&self) {
        loop {
            tracing::info!("Connecting to Hub at {}", self.hub_url);
            match self.connect_once().await {
                Ok(()) => tracing::info!("Hub connection closed"),
                Err(e) => tracing::error!("Hub connection error: {}", e),
            }
            tracing::info!("Reconnecting in 3 seconds...");
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    }

    async fn connect_once(&self) -> Result<(), String> {
        let (ws_stream, _) = connect_async(&self.hub_url)
            .await
            .map_err(|e| format!("WebSocket connect failed: {}", e))?;

        let (mut ws_tx, mut ws_rx) = ws_stream.split();

        // Send registration with real machine_secret
        let register = MachineToHub::Register {
            machine_id: self.machine_id.clone(),
            machine_secret: self.machine_secret.clone(),
            name: self.machine_name.clone(),
            os: std::env::consts::OS.to_string(),
            home_dir: dirs_home(),
        };
        let msg = serde_json::to_string(&register).unwrap();
        ws_tx
            .send(Message::Text(msg.into()))
            .await
            .map_err(|e| format!("Send failed: {}", e))?;

        // Wait for AuthResult before proceeding
        let auth_timeout = tokio::time::Duration::from_secs(10);
        let auth_result = tokio::time::timeout(auth_timeout, async {
            while let Some(Ok(msg)) = ws_rx.next().await {
                if let Message::Text(text) = msg {
                    if let Ok(hub_msg) = serde_json::from_str::<HubToMachine>(&text) {
                        return Some(hub_msg);
                    }
                }
            }
            None
        })
        .await;

        match auth_result {
            Ok(Some(HubToMachine::AuthResult { ok: true, .. })) => {
                tracing::info!("Machine authenticated successfully");
            }
            Ok(Some(HubToMachine::AuthResult { ok: false, message })) => {
                return Err(format!(
                    "Authentication failed: {}",
                    message.unwrap_or_else(|| "unknown reason".to_string())
                ));
            }
            Ok(Some(_)) => {
                return Err(
                    "Expected AuthResult as first message from hub, got something else".to_string(),
                );
            }
            Ok(None) => {
                return Err("Connection closed before receiving AuthResult".to_string());
            }
            Err(_) => {
                return Err("Timed out waiting for AuthResult from hub".to_string());
            }
        }

        // Channel for sending messages to Hub
        let (send_tx, mut send_rx) = mpsc::channel::<OutboundHubMessage>(HUB_OUTBOUND_CAPACITY);

        let pty = self.pty_manager.clone();
        let attach_mgr = Arc::new(AttachManager::new());

        // Start the session watcher so terminals that die while no browser
        // is attached still get reported back to the hub.
        let (deaths_tx, mut deaths_rx) = mpsc::unbounded_channel();
        let _watcher =
            SessionWatcher::start(pty.clone(), deaths_tx, std::time::Duration::from_secs(5));
        let send_tx_for_deaths = send_tx.clone();
        tokio::spawn(async move {
            while let Some(death) = deaths_rx.recv().await {
                let _ = send_tx_for_deaths
                    .send(OutboundHubMessage::Json(MachineToHub::TerminalDied {
                        terminal_id: death.terminal_id,
                        reason: "tmux session vanished".into(),
                    }))
                    .await;
            }
        });

        // Report existing terminals (recovered from tmux after restart). The
        // hub builds its terminal records from this list; per-attach byte
        // streams are established on-demand when browsers connect, so there
        // is no scrollback or background subscription to set up here.
        let existing = pty.list_terminals();
        if !existing.is_empty() {
            let terminals: Vec<tc_protocol::TerminalInfo> = existing
                .iter()
                .map(|s| tc_protocol::TerminalInfo {
                    id: s.id.clone(),
                    machine_id: self.machine_id.clone(),
                    title: s.title.clone(),
                    cwd: s.cwd.clone(),
                    cols: s.cols,
                    rows: s.rows,
                    reachable: true,
                })
                .collect();
            tracing::info!("Reporting {} existing terminals to hub", terminals.len());
            let _ = send_tx
                .send(OutboundHubMessage::Json(MachineToHub::ExistingTerminals {
                    terminals,
                }))
                .await;
        }

        // Task: periodically send resource stats
        let send_tx_stats = send_tx.clone();
        let mut stats_task = tokio::spawn(async move {
            let mut collector = crate::stats::StatsCollector::new();
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            let mut last_sent = None;
            let mut silent_intervals = 0;
            // Initial CPU reading needs a warmup tick
            interval.tick().await;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            loop {
                interval.tick().await;
                let stats = collector.collect();
                if !should_emit_stats(last_sent.as_ref(), &stats, silent_intervals) {
                    silent_intervals = silent_intervals.saturating_add(1);
                    continue;
                }
                if send_tx_stats
                    .send(OutboundHubMessage::Json(MachineToHub::ResourceStats {
                        stats: stats.clone(),
                    }))
                    .await
                    .is_err()
                {
                    break;
                }
                last_sent = Some(stats);
                silent_intervals = 0;
            }
        });

        // Task: forward send_tx messages to WebSocket, with periodic WS ping
        let mut send_task = tokio::spawn(async move {
            let mut ping_interval = tokio::time::interval(Duration::from_secs(30));
            ping_interval.tick().await; // skip immediate first tick
            loop {
                tokio::select! {
                    msg = send_rx.recv() => {
                        match msg {
                            Some(OutboundHubMessage::Json(msg)) => {
                                let text = serde_json::to_string(&msg).unwrap();
                                if ws_tx.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            Some(OutboundHubMessage::AttachOutput { attach_id, data }) => {
                                let frame = encode_attach_output_frame(&attach_id, &data);
                                if ws_tx.send(Message::Binary(frame.into())).await.is_err() {
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    _ = ping_interval.tick() => {
                        if ws_tx.send(Message::Ping(vec![].into())).await.is_err() {
                            tracing::warn!("WS ping failed, connection likely dead");
                            break;
                        }
                    }
                }
            }
        });

        // Task: receive Hub messages with read timeout
        let pty_recv = pty.clone();
        let send_tx_recv = send_tx.clone();
        let attach_mgr_recv = attach_mgr.clone();
        let native_zellij_recv = self.native_zellij_manager.clone();
        let mut recv_task = tokio::spawn(async move {
            loop {
                match tokio::time::timeout(Duration::from_secs(90), ws_rx.next()).await {
                    Ok(Some(Ok(msg))) => match msg {
                        Message::Text(text) => {
                            if let Ok(hub_msg) = serde_json::from_str::<HubToMachine>(&text) {
                                handle_hub_message(
                                    hub_msg,
                                    &pty_recv,
                                    &send_tx_recv,
                                    &attach_mgr_recv,
                                    &native_zellij_recv,
                                )
                                .await;
                            }
                        }
                        Message::Ping(_) => {
                            // tungstenite auto-responds to WS pings
                        }
                        Message::Close(_) => break,
                        _ => {}
                    },
                    Ok(Some(Err(_))) => break,
                    Ok(None) => break,
                    Err(_) => {
                        tracing::warn!("No message from Hub for 90s, reconnecting");
                        break;
                    }
                }
            }
        });

        tokio::select! {
            _ = &mut send_task => {},
            _ = &mut recv_task => {},
            _ = &mut stats_task => {},
        }

        // Abort all tasks to ensure full cleanup
        send_task.abort();
        recv_task.abort();
        stats_task.abort();

        // Kill every per-attach tmux client we spawned for this hub
        // connection — when hub comes back, browsers will reattach freshly.
        attach_mgr.close_all().await;
        // _watcher is dropped here, aborting the polling task.
        drop(_watcher);

        Ok(())
    }
}

async fn handle_hub_message(
    msg: HubToMachine,
    pty: &Arc<PtyManager>,
    send_tx: &mpsc::Sender<OutboundHubMessage>,
    attach_mgr: &Arc<AttachManager>,
    native_zellij: &Arc<NativeZellijManager>,
) {
    match msg {
        HubToMachine::CreateTerminal {
            request_id,
            cwd,
            cols,
            rows,
            startup_command,
            ..
        } => {
            let terminal_id = uuid::Uuid::new_v4().to_string();
            match pty.create_terminal(&terminal_id, &cwd, cols, rows) {
                Ok(info) => {
                    let _ = send_tx
                        .send(OutboundHubMessage::Json(MachineToHub::TerminalCreated {
                            request_id,
                            terminal_id: info.id.clone(),
                            title: info.title,
                            cwd: info.cwd,
                            cols: info.cols,
                            rows: info.rows,
                        }))
                        .await;

                    // Output forwarding is now per-attach: nothing to wire
                    // here. The first browser to attach drives an OpenAttach,
                    // which spawns a fresh `tmux attach` whose bytes flow back
                    // as AttachOutput.

                    // Execute startup command after shell is ready
                    if let Some(cmd) = startup_command {
                        if !cmd.is_empty() {
                            let pty_clone = pty.clone();
                            let tid = terminal_id.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                                let cmd_with_cr = format!("{}\r", cmd);
                                let _ = pty_clone.write_to_terminal(&tid, cmd_with_cr.as_bytes());
                            });
                        }
                    }
                }
                Err(e) => {
                    let _ = send_tx
                        .send(OutboundHubMessage::Json(
                            MachineToHub::TerminalCreateError {
                                request_id,
                                error: e,
                            },
                        ))
                        .await;
                }
            }
        }
        HubToMachine::DestroyTerminal { terminal_id } => {
            let _ = pty.destroy_terminal(&terminal_id);
            let _ = send_tx
                .send(OutboundHubMessage::Json(MachineToHub::TerminalDestroyed {
                    terminal_id,
                }))
                .await;
        }
        HubToMachine::FsListDir { request_id, path } => {
            let resolved = expand_tilde(&path);
            match read_directory(&resolved) {
                Ok(entries) => {
                    let _ = send_tx
                        .send(OutboundHubMessage::Json(MachineToHub::FsListResult {
                            request_id,
                            entries,
                        }))
                        .await;
                }
                Err(e) => {
                    let _ = send_tx
                        .send(OutboundHubMessage::Json(MachineToHub::FsListError {
                            request_id,
                            error: e,
                        }))
                        .await;
                }
            }
        }
        HubToMachine::AuthResult { ok, message } => {
            if ok {
                tracing::info!("Machine authenticated successfully");
            } else {
                tracing::error!(
                    "Machine authentication failed: {}",
                    message.unwrap_or_default()
                );
            }
        }
        HubToMachine::CheckForegroundProcess {
            request_id,
            terminal_id,
        } => {
            let (has_fg, process_name) = pty.check_foreground_process(&terminal_id);
            let _ = send_tx
                .send(OutboundHubMessage::Json(
                    MachineToHub::ForegroundProcessResult {
                        request_id,
                        has_foreground_process: has_fg,
                        process_name,
                    },
                ))
                .await;
        }
        HubToMachine::Ping => {
            let _ = send_tx
                .send(OutboundHubMessage::Json(MachineToHub::Pong))
                .await;
        }
        HubToMachine::OpenAttach {
            attach_id,
            terminal_id,
            cols,
            rows,
        } => {
            let mut events_rx = attach_mgr
                .open(attach_id.clone(), terminal_id, cols, rows)
                .await;
            let send_tx = send_tx.clone();
            tokio::spawn(async move {
                while let Some(ev) = events_rx.recv().await {
                    match ev {
                        AttachEvent::Output(bytes) => {
                            if send_tx
                                .send(OutboundHubMessage::AttachOutput {
                                    attach_id: attach_id.clone(),
                                    data: bytes,
                                })
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        AttachEvent::Died(reason) => {
                            let _ = send_tx
                                .send(OutboundHubMessage::Json(MachineToHub::AttachDied {
                                    attach_id: attach_id.clone(),
                                    reason: reason.to_string(),
                                }))
                                .await;
                            break;
                        }
                    }
                }
            });
        }
        HubToMachine::CloseAttach { attach_id } => {
            attach_mgr.close(&attach_id).await;
        }
        HubToMachine::AttachInput { attach_id, data } => {
            attach_mgr
                .write_input(&attach_id, Bytes::from(data.into_bytes()))
                .await;
        }
        HubToMachine::AttachResize {
            attach_id,
            cols,
            rows,
        } => {
            // Resolve attach → session, then call `tmux resize-window`.
            // Together with `window-size manual` in tmux.conf this is the
            // single source of truth for window sizing.
            if let Some(session_id) = attach_mgr.session_of(&attach_id).await {
                tracing::info!(
                    attach_id = %attach_id,
                    session_id = %session_id,
                    cols,
                    rows,
                    "AttachResize: resizing tmux window"
                );
                tmux_resize_window(&session_id, cols, rows);
                let _ = send_tx
                    .send(OutboundHubMessage::Json(MachineToHub::TerminalResized {
                        terminal_id: session_id,
                        cols,
                        rows,
                    }))
                    .await;
            }
        }
        HubToMachine::AttachImagePaste {
            attach_id,
            data,
            mime,
            filename,
        } => {
            // Reuse the existing image-paste pipeline (decode → save tmp →
            // bracketed paste path), routing the resulting bytes to this
            // attach's PTY instead of writing terminal-wide.
            if let Some(session_id) = attach_mgr.session_of(&attach_id).await {
                match handle_image_paste(pty, &session_id, &data, &mime, &filename) {
                    Ok(paste_str) => {
                        attach_mgr
                            .write_input(&attach_id, Bytes::from(paste_str.into_bytes()))
                            .await;
                    }
                    Err(e) => {
                        tracing::warn!("image_paste failed for attach {}: {}", attach_id, e);
                    }
                }
            }
        }
        HubToMachine::EnsureNativeZellij {
            request_id,
            user_id,
        } => match native_zellij.ensure_for_user(&user_id).await {
            Ok(status) => {
                let _ = send_tx
                    .send(OutboundHubMessage::Json(MachineToHub::NativeZellijReady {
                        request_id,
                        status,
                    }))
                    .await;
            }
            Err(error) => {
                let _ = send_tx
                    .send(OutboundHubMessage::Json(MachineToHub::NativeZellijError {
                        request_id,
                        error,
                    }))
                    .await;
            }
        },
    }
}

fn handle_image_paste(
    pty: &Arc<PtyManager>,
    terminal_id: &str,
    base64_data: &str,
    _mime: &str,
    filename: &str,
) -> Result<String, String> {
    use std::io::Write;

    // Decode base64
    let data = base64_decode(base64_data).map_err(|e| format!("Base64 decode failed: {}", e))?;

    // Save to temp file
    let tmp_dir = std::env::temp_dir();
    let path = tmp_dir.join(filename);
    let mut file =
        std::fs::File::create(&path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    let path_str = path.to_string_lossy().to_string();

    // Inject path into PTY stdin with bracketed paste
    let paste_data = format!("\x1b[200~{}\x1b[201~", path_str);
    pty.write_to_terminal(terminal_id, paste_data.as_bytes())?;

    Ok(path_str)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base64 decoder
    let table: Vec<u8> =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".to_vec();
    let mut output = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in input.as_bytes() {
        if byte == b'=' || byte == b'\n' || byte == b'\r' || byte == b' ' {
            continue;
        }
        let val = table
            .iter()
            .position(|&b| b == byte)
            .ok_or_else(|| format!("Invalid base64 char: {}", byte as char))?
            as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(output)
}

fn read_directory(path: &str) -> Result<Vec<DirEntry>, String> {
    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result: Vec<DirEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(DirEntry { name, path, is_dir })
        })
        .collect();

    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(result)
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        path.replacen('~', &home, 1)
    } else {
        path.to_string()
    }
}

fn dirs_home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}
