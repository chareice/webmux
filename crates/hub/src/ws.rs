use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    response::Response,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tc_protocol::{HubToMachine, MachineToHub};

use crate::auth;
use crate::db;
use crate::AppState;

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
    #[serde(rename = "output")]
    Output { data: String },
    #[serde(rename = "error")]
    Error { message: String },
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    Path((machine_id, terminal_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    // Auth check for browser WebSocket
    let token = params.get("token").map(|s| s.as_str());
    let authed = match token {
        Some(t) => auth::verify_bearer_token(t, &state.db, &state.jwt_secret).is_ok(),
        None => false,
    };

    if !authed && !state.dev_mode {
        return Response::builder()
            .status(401)
            .body(axum::body::Body::from("Unauthorized"))
            .unwrap();
    }

    let device_id = params.get("device_id").cloned().unwrap_or_default();
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, machine_id, terminal_id, device_id, state))
}

async fn handle_terminal_ws(
    socket: WebSocket,
    machine_id: String,
    terminal_id: String,
    device_id: String,
    state: AppState,
) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to terminal output from the machine
    let (buffer, mut output_rx) = match state
        .manager
        .subscribe_terminal_output(&machine_id, &terminal_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMessage::Error { message: e }).unwrap();
            let _ = sender.send(Message::Text(msg.into())).await;
            return;
        }
    };

    // Send buffered output for replay
    if !buffer.is_empty() {
        let text = String::from_utf8_lossy(&buffer).to_string();
        let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
        if sender.send(Message::Text(msg.into())).await.is_err() {
            return;
        }
    }

    // Task: forward terminal output to browser (coalesced in 8ms windows)
    let send_task = tokio::spawn(async move {
        let mut batch = Vec::<u8>::new();
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(8));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                result = output_rx.recv() => {
                    match result {
                        Ok(data) => batch.extend_from_slice(&data),
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            // Flush remaining
                            if !batch.is_empty() {
                                let text = String::from_utf8_lossy(&batch).to_string();
                                let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
                                let _ = sender.send(Message::Text(msg.into())).await;
                            }
                            break;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }

                _ = tick.tick(), if !batch.is_empty() => {
                    let text = String::from_utf8_lossy(&batch).to_string();
                    let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
                    batch.clear();
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Task: forward browser input to machine
    let manager = state.manager.clone();
    let mid = machine_id.clone();
    let tid = terminal_id.clone();
    let did = device_id;
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => match client_msg {
                        ClientMessage::Input { data } => {
                            if did.is_empty() || manager.is_controller(&did) {
                                let _ = manager.send_input(&mid, &tid, &data).await;
                            }
                        }
                        ClientMessage::CommandInput { data } => {
                            // CommandInput always bypasses mode check
                            let _ = manager.send_input(&mid, &tid, &data).await;
                        }
                        ClientMessage::Resize { cols, rows } => {
                            if did.is_empty() || manager.is_controller(&did) {
                                let _ = manager.resize_terminal(&mid, &tid, cols, rows).await;
                            }
                        }
                        ClientMessage::ImagePaste {
                            data,
                            mime,
                            filename,
                        } => {
                            let _ = manager
                                .send_image_paste(&mid, &tid, &data, &mime, &filename)
                                .await;
                        }
                    },
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
        _ = send_task => {},
        _ = recv_task => {},
    }
}

// ── Machine → Hub registration WebSocket ──

async fn machine_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
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
                    // Authenticate machine via DB
                    let auth_ok = authenticate_machine(&state, &machine_id, &machine_secret).await;

                    if !auth_ok {
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
                    let (conn_id, mut cmd_rx) = state.manager.register_machine(info).await;
                    tracing::info!(
                        "Machine {} registered (conn={})",
                        machine_id,
                        &conn_id[..8]
                    );

                    // Spawn task to forward commands from Hub to Machine
                    let send_task = tokio::spawn(async move {
                        while let Some(cmd) = cmd_rx.recv().await {
                            let text = serde_json::to_string(&cmd).unwrap();
                            if sender.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                    });

                    // Handle incoming messages from machine
                    let manager = state.manager.clone();
                    let mid = machine_id.clone();
                    let recv_task = tokio::spawn(async move {
                        while let Some(Ok(msg)) = receiver.next().await {
                            match msg {
                                Message::Text(text) => {
                                    if let Ok(machine_msg) =
                                        serde_json::from_str::<MachineToHub>(&text)
                                    {
                                        manager
                                            .handle_machine_message(&mid, machine_msg)
                                            .await;
                                    }
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    });

                    tokio::select! {
                        _ = send_task => {},
                        _ = recv_task => {},
                    }

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
    tracing::info!(
        "Machine {} disconnected (conn={})",
        machine_id,
        &conn_id[..8]
    );
}

/// Authenticate a machine by checking its secret against the DB hash.
/// In dev mode, allows empty secrets or machines not in DB.
async fn authenticate_machine(state: &AppState, machine_id: &str, machine_secret: &str) -> bool {
    // In dev mode, allow unauthenticated machines
    if state.dev_mode && machine_secret.is_empty() {
        return true;
    }

    let conn = match state.db.get() {
        Ok(c) => c,
        Err(_) => return state.dev_mode,
    };

    match db::machines::find_machine_by_id(&conn, machine_id) {
        Ok(Some(machine)) => {
            auth::verify_password(machine_secret, &machine.machine_secret_hash).unwrap_or(false)
        }
        Ok(None) => {
            // Machine not in DB — allow in dev mode
            state.dev_mode
        }
        Err(_) => state.dev_mode,
    }
}

// ── Browser events WebSocket ──

async fn events_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    // Auth check for browser WebSocket
    let token = params.get("token").map(|s| s.as_str());
    let authed = match token {
        Some(t) => auth::verify_bearer_token(t, &state.db, &state.jwt_secret).is_ok(),
        None => false,
    };

    if !authed && !state.dev_mode {
        return Response::builder()
            .status(401)
            .body(axum::body::Body::from("Unauthorized"))
            .unwrap();
    }

    let device_id = params.get("device_id").cloned().unwrap_or_default();
    ws.on_upgrade(move |socket| handle_events(socket, device_id, state))
}

async fn handle_events(socket: WebSocket, device_id: String, state: AppState) {
    if !device_id.is_empty() {
        state.manager.register_device(&device_id);
    }

    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.manager.subscribe_events();

    // Task: forward events to browser
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let msg = serde_json::to_string(&event).unwrap();
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
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

    if !device_id.is_empty() {
        state.manager.unregister_device(&device_id);
    }
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
