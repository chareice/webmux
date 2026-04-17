use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    response::Response,
    routing::get,
    Router,
};
use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tc_protocol::{
    decode_attach_output_frame, BrowserEventEnvelope, HubToMachine, MachineToHub,
};
use tokio::sync::mpsc;

use crate::attach_router::WsSender;
use crate::auth;
use crate::db;
use crate::AppState;

const DEVICE_DISCONNECT_GRACE_PERIOD: Duration = Duration::from_secs(10);

fn schedule_device_disconnect_cleanup(
    state: &AppState,
    session_user_id: Option<&str>,
    device_id: &str,
) {
    if let (Some(user_id), false) = (session_user_id, device_id.is_empty()) {
        state.manager.schedule_unregister_device(
            user_id.to_string(),
            device_id.to_string(),
            DEVICE_DISCONNECT_GRACE_PERIOD,
        );
    }
}

// ── Browser ↔ Hub terminal WebSocket ──

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "input")]
    Input { data: String },
    #[serde(rename = "command_input")]
    CommandInput { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "image_paste")]
    ImagePaste {
        data: String,
        mime: String,
        filename: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "error")]
    Error { message: String },
}

fn client_message_allowed(
    message: &ClientMessage,
    device_id: &str,
    is_controller: bool,
    is_authenticated: bool,
) -> bool {
    if !is_authenticated {
        return true;
    }

    if device_id.is_empty() {
        return false;
    }

    match message {
        ClientMessage::Input { .. }
        | ClientMessage::CommandInput { .. }
        | ClientMessage::Resize { .. }
        | ClientMessage::ImagePaste { .. } => is_controller,
    }
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    Path((machine_id, terminal_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").map(|s| s.as_str());
    let user_id =
        token.and_then(|t| auth::verify_bearer_token(t, &state.db, &state.jwt_secret).ok());

    if user_id.is_none() && !state.dev_mode {
        return Response::builder()
            .status(401)
            .body(axum::body::Body::from("Unauthorized"))
            .unwrap();
    }

    if let Some(user_id) = user_id.as_deref() {
        if !state
            .manager
            .user_can_access_terminal(user_id, &machine_id, &terminal_id)
            .await
        {
            return Response::builder()
                .status(404)
                .body(axum::body::Body::from("Terminal not found"))
                .unwrap();
        }
    }

    let device_id = params.get("device_id").cloned().unwrap_or_default();
    ws.on_upgrade(move |socket| {
        handle_terminal_ws(socket, machine_id, terminal_id, device_id, user_id, state)
    })
}

async fn handle_terminal_ws(
    socket: WebSocket,
    machine_id: String,
    terminal_id: String,
    device_id: String,
    user_id: Option<String>,
    state: AppState,
) {
    let (mut sender, mut receiver) = socket.split();
    let attach_id = uuid::Uuid::new_v4().to_string();

    // Look up the terminal's intended dimensions so the new tmux attach
    // opens at the right size from the start.
    let (cols, rows) = state
        .manager
        .terminal_dimensions(&machine_id, &terminal_id)
        .await
        .unwrap_or((120, 36));

    // Register the attach in the router BEFORE asking the machine to open
    // it, so any AttachOutput that arrives can be routed immediately.
    let (out_tx, mut out_rx) = mpsc::channel::<Bytes>(64);
    state
        .router
        .register(
            attach_id.clone(),
            machine_id.clone(),
            terminal_id.clone(),
            WsSender(out_tx),
        )
        .await;

    if let Err(e) = state
        .manager
        .send_to_machine(
            &machine_id,
            HubToMachine::OpenAttach {
                attach_id: attach_id.clone(),
                terminal_id: terminal_id.clone(),
                cols,
                rows,
            },
        )
        .await
    {
        let msg = serde_json::to_string(&ServerMessage::Error { message: e }).unwrap();
        let _ = sender.send(Message::Text(msg.into())).await;
        state.router.unregister(&attach_id).await;
        return;
    }

    // Outbound: forward bytes from out_rx to the WS as binary frames.
    // No coalescing needed — bytes are already chunked at PTY read size.
    let mut send_task = tokio::spawn(async move {
        while let Some(chunk) = out_rx.recv().await {
            if sender
                .send(Message::Binary(chunk.to_vec().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Inbound: forward browser input to the machine, routed by attach_id.
    let manager = state.manager.clone();
    let mid = machine_id.clone();
    let tid_for_in = terminal_id.clone();
    let did = device_id.clone();
    let uid = user_id.clone();
    let aid_for_in = attach_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        let can_control = uid
                            .as_deref()
                            .map(|user_id| manager.is_controller(user_id, &mid, &did))
                            .unwrap_or(true);

                        if !client_message_allowed(&client_msg, &did, can_control, uid.is_some()) {
                            continue;
                        }

                        let to_send = match client_msg {
                            ClientMessage::Input { data }
                            | ClientMessage::CommandInput { data } => {
                                Some(HubToMachine::AttachInput {
                                    attach_id: aid_for_in.clone(),
                                    data,
                                })
                            }
                            ClientMessage::Resize { cols, rows } => {
                                // Optimistically update the hub-side terminal
                                // record + emit TerminalResized so any
                                // listTerminals call right after a resize
                                // sees the new size without waiting for the
                                // machine round-trip. The machine's actual
                                // TerminalResized reply (after tmux applies
                                // it) will reaffirm or correct this.
                                manager
                                    .apply_optimistic_resize(&mid, &tid_for_in, cols, rows)
                                    .await;
                                Some(HubToMachine::AttachResize {
                                    attach_id: aid_for_in.clone(),
                                    cols,
                                    rows,
                                })
                            }
                            ClientMessage::ImagePaste {
                                data,
                                mime,
                                filename,
                            } => Some(HubToMachine::AttachImagePaste {
                                attach_id: aid_for_in.clone(),
                                data,
                                mime,
                                filename,
                            }),
                        };
                        if let Some(msg) = to_send {
                            let _ = manager.send_to_machine(&mid, msg).await;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse client message: {}", e);
                    }
                },
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => {},
        _ = &mut recv_task => {},
    }
    // Dropping a JoinHandle does NOT cancel the spawned task. Abort the
    // loser so it can't keep the WS half it owns alive after cleanup.
    send_task.abort();
    recv_task.abort();

    // Cleanup: tell the machine to close the attach + drop our routing entry.
    let _ = state
        .manager
        .send_to_machine(
            &machine_id,
            HubToMachine::CloseAttach {
                attach_id: attach_id.clone(),
            },
        )
        .await;
    state.router.unregister(&attach_id).await;
}

// ── Machine → Hub registration WebSocket ──

async fn machine_ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_machine_ws(socket, state))
}

async fn handle_machine_ws(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // First message must be Register
    let (machine_id, conn_id) = match receiver.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<MachineToHub>(&text) {
                Ok(MachineToHub::Register {
                    machine_id,
                    machine_secret,
                    name,
                    os,
                    home_dir,
                }) => {
                    let machine_owner =
                        match authenticate_machine(&state, &machine_id, &machine_secret).await {
                            Ok(user_id) => user_id,
                            Err(()) => {
                                // Send auth failure and close
                                let auth_result = HubToMachine::AuthResult {
                                    ok: false,
                                    message: Some("Invalid machine credentials".to_string()),
                                };
                                let msg = serde_json::to_string(&auth_result).unwrap();
                                let _ = sender.send(Message::Text(msg.into())).await;
                                let _ = sender.send(Message::Close(None)).await;
                                return;
                            }
                        };

                    // Send auth success
                    let auth_result = HubToMachine::AuthResult {
                        ok: true,
                        message: None,
                    };
                    let msg = serde_json::to_string(&auth_result).unwrap();
                    let _ = sender.send(Message::Text(msg.into())).await;

                    // Update machine info in DB
                    if let Ok(conn) = state.db.get() {
                        let _ = db::machines::update_machine_status(&conn, &machine_id, "online");
                        let _ = db::machines::update_machine_info(
                            &conn,
                            &machine_id,
                            Some(&os),
                            Some(&home_dir),
                        );
                    }

                    let info = tc_protocol::MachineInfo {
                        id: machine_id.clone(),
                        name,
                        os,
                        home_dir,
                    };
                    let (conn_id, mut cmd_rx) =
                        state.manager.register_machine(info, machine_owner).await;
                    tracing::info!("Machine {} registered (conn={})", machine_id, &conn_id[..8]);

                    // Spawn task to forward commands from Hub to Machine
                    let mut send_task = tokio::spawn(async move {
                        while let Some(cmd) = cmd_rx.recv().await {
                            let text = serde_json::to_string(&cmd).unwrap();
                            if sender.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    });

                    // Handle incoming messages from machine
                    let manager = state.manager.clone();
                    let router = state.router.clone();
                    let mid = machine_id.clone();
                    let mut recv_task = tokio::spawn(async move {
                        while let Some(Ok(msg)) = receiver.next().await {
                            match msg {
                                Message::Text(text) => {
                                    let Ok(machine_msg) =
                                        serde_json::from_str::<MachineToHub>(&text)
                                    else {
                                        continue;
                                    };
                                    // For AttachDied, also drop the per-attach
                                    // route here — MachineManager has no
                                    // access to the router, so without this
                                    // step the browser WS would stay open
                                    // with no more bytes flowing into it.
                                    if let MachineToHub::AttachDied { attach_id, .. } =
                                        &machine_msg
                                    {
                                        router.unregister(attach_id).await;
                                    }
                                    manager.handle_machine_message(&mid, machine_msg).await;
                                }
                                Message::Binary(data) => {
                                    match decode_attach_output_frame(&data) {
                                        Ok((attach_id, payload)) => {
                                            if let Some(sender) =
                                                router.lookup_sender(&attach_id).await
                                            {
                                                // Never let a single slow browser
                                                // backpressure the entire machine→hub
                                                // recv loop. Drop on Full; treat
                                                // Closed as "browser is gone, the
                                                // upcoming CloseAttach will reach
                                                // the machine."
                                                use tokio::sync::mpsc::error::TrySendError;
                                                match sender.0.try_send(payload) {
                                                    Ok(()) => {}
                                                    Err(TrySendError::Full(_)) => {
                                                        tracing::warn!(
                                                            attach_id = %attach_id,
                                                            "dropping attach output: browser channel full"
                                                        );
                                                    }
                                                    Err(TrySendError::Closed(_)) => {
                                                        tracing::debug!(
                                                            attach_id = %attach_id,
                                                            "dropping attach output: browser channel closed"
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                        Err(error) => {
                                            tracing::warn!(
                                                "Failed to decode attach output frame: {}",
                                                error
                                            );
                                        }
                                    }
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    });

                    tokio::select! {
                        _ = &mut send_task => {},
                        _ = &mut recv_task => {},
                    }
                    // JoinHandle drop doesn't cancel; abort the loser so it
                    // doesn't keep half the WS alive after the other side
                    // already gave up.
                    send_task.abort();
                    recv_task.abort();

                    (machine_id, conn_id)
                }
                _ => return,
            }
        }
        _ => return,
    };

    // Machine disconnected — cleanup (only if this connection is still current)
    if let Ok(conn) = state.db.get() {
        let _ = db::machines::update_machine_status(&conn, &machine_id, "offline");
    }
    state
        .manager
        .unregister_machine(&machine_id, &conn_id)
        .await;
    let dropped = state.router.drop_machine(&machine_id).await;
    if !dropped.is_empty() {
        tracing::info!(
            "dropped {} attach routing entries for offline machine {}",
            dropped.len(),
            machine_id
        );
    }
    tracing::info!(
        "Machine {} disconnected (conn={})",
        machine_id,
        &conn_id[..8]
    );
}

/// Authenticate a machine by checking its secret against the DB hash.
/// In dev mode, allows empty secrets or machines not in DB.
async fn authenticate_machine(
    state: &AppState,
    machine_id: &str,
    machine_secret: &str,
) -> Result<Option<String>, ()> {
    // In dev mode, allow unauthenticated machines
    if state.dev_mode && machine_secret.is_empty() {
        return Ok(None);
    }

    let conn = match state.db.get() {
        Ok(c) => c,
        Err(_) => return if state.dev_mode { Ok(None) } else { Err(()) },
    };

    match db::machines::find_machine_by_id(&conn, machine_id) {
        Ok(Some(machine)) => {
            if auth::verify_password(machine_secret, &machine.machine_secret_hash).unwrap_or(false)
            {
                Ok(Some(machine.user_id))
            } else {
                Err(())
            }
        }
        Ok(None) => {
            // Machine not in DB — allow in dev mode
            if state.dev_mode {
                Ok(None)
            } else {
                Err(())
            }
        }
        Err(_) => {
            if state.dev_mode {
                Ok(None)
            } else {
                Err(())
            }
        }
    }
}

// ── Browser events WebSocket ──

async fn events_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").map(|s| s.as_str());
    let user_id =
        token.and_then(|t| auth::verify_bearer_token(t, &state.db, &state.jwt_secret).ok());

    if user_id.is_none() && !state.dev_mode {
        return Response::builder()
            .status(401)
            .body(axum::body::Body::from("Unauthorized"))
            .unwrap();
    }

    let device_id = params.get("device_id").cloned().unwrap_or_default();
    let after_seq = params
        .get("after_seq")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    ws.on_upgrade(move |socket| handle_events(socket, user_id, device_id, after_seq, state))
}

async fn handle_events(
    socket: WebSocket,
    user_id: Option<String>,
    device_id: String,
    after_seq: u64,
    state: AppState,
) {
    let session_user_id = user_id.clone();

    if let (Some(user_id), false) = (session_user_id.as_deref(), device_id.is_empty()) {
        state.manager.register_device(user_id, &device_id);
    }

    let (mut sender, mut receiver) = socket.split();
    let subscription = if let Some(user_id) = session_user_id.as_deref() {
        state.manager.subscribe_events_after(user_id, after_seq)
    } else {
        state.manager.subscribe_public_events_after(after_seq)
    };
    if subscription.requires_resync {
        schedule_device_disconnect_cleanup(&state, session_user_id.as_deref(), &device_id);
        return;
    }
    let replay = subscription.replay;
    let mut rx = subscription.receiver;
    let event_user_id = session_user_id.clone();
    let lag_device_id = device_id.clone();

    // Task: forward events to browser
    let send_task = tokio::spawn(async move {
        for envelope in replay {
            let msg = serde_json::to_string(&envelope).unwrap();
            if sender.send(Message::Text(msg.into())).await.is_err() {
                return;
            }
        }

        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    if let Some(target_user_id) = envelope.target_user_id.as_deref() {
                        if event_user_id.as_deref() != Some(target_user_id) {
                            continue;
                        }
                    }
                    let msg = serde_json::to_string(&BrowserEventEnvelope {
                        seq: envelope.seq,
                        event: envelope.event,
                    })
                    .unwrap();
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(
                        "Events stream lagged by {} messages for device {}, forcing resync",
                        skipped,
                        if lag_device_id.is_empty() {
                            "<unknown>"
                        } else {
                            &lag_device_id
                        }
                    );
                    break;
                }
            }
        }
    });

    // Task: detect client disconnect
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    schedule_device_disconnect_cleanup(&state, session_user_id.as_deref(), &device_id);
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ws/machine", get(machine_ws_handler))
        .route(
            "/ws/terminal/{machine_id}/{terminal_id}",
            get(terminal_ws_handler),
        )
        .route("/ws/events", get(events_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watcher_cannot_send_command_input() {
        assert!(!client_message_allowed(
            &ClientMessage::CommandInput {
                data: "echo nope\r".to_string(),
            },
            "watcher-device",
            false,
            true,
        ));
    }

    #[test]
    fn controller_can_send_command_input() {
        assert!(client_message_allowed(
            &ClientMessage::CommandInput {
                data: "echo ok\r".to_string(),
            },
            "controller-device",
            true,
            true,
        ));
    }

    #[test]
    fn authenticated_sessions_without_device_id_cannot_send_terminal_input() {
        assert!(!client_message_allowed(
            &ClientMessage::Input {
                data: "ls\r".to_string(),
            },
            "",
            false,
            true,
        ));
    }

    #[test]
    fn unauthenticated_dev_sessions_can_still_send_terminal_input() {
        assert!(client_message_allowed(
            &ClientMessage::Input {
                data: "ls\r".to_string(),
            },
            "",
            false,
            false,
        ));
    }
}
