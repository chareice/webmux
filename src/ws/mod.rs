use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::Response,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::AppState;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "input")]
    Input { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "take_control")]
    TakeControl,
    #[serde(rename = "release_control")]
    ReleaseControl,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "output")]
    Output { data: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "connected")]
    Connected {
        client_id: String,
        active_client: Option<String>,
    },
    #[serde(rename = "control_changed")]
    ControlChanged { active_client: Option<String> },
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, id, state))
}

async fn handle_socket(socket: WebSocket, terminal_id: String, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let client_id = Uuid::new_v4().to_string();

    // Subscribe to terminal output broadcast
    let (buffer, mut output_rx) = match state.subscribe(&terminal_id) {
        Ok(r) => r,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMessage::Error { message: e }).unwrap();
            let _ = sender.send(Message::Text(msg.into())).await;
            return;
        }
    };

    // Subscribe to control change events
    let mut event_rx = state.subscribe_events();

    // If no active client, first connection becomes active automatically
    let current_active = state.get_active_client(&terminal_id);
    if current_active.is_none() {
        let _ = state.take_control(&terminal_id, &client_id);
    }

    // Send connection info
    let active = state.get_active_client(&terminal_id);
    let msg = serde_json::to_string(&ServerMessage::Connected {
        client_id: client_id.clone(),
        active_client: active,
    })
    .unwrap();
    if sender.send(Message::Text(msg.into())).await.is_err() {
        return;
    }

    // Send buffered output
    if !buffer.is_empty() {
        let text = String::from_utf8_lossy(&buffer).to_string();
        let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
        if sender.send(Message::Text(msg.into())).await.is_err() {
            return;
        }
    }

    // Task: forward PTY output + control events to WebSocket
    let tid_send = terminal_id.clone();
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = output_rx.recv() => {
                    match result {
                        Ok(data) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
                            if sender.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
                result = event_rx.recv() => {
                    match result {
                        Ok(event) => {
                            // Only forward control_changed events for this terminal
                            if let crate::pty::TerminalEvent::ControlChanged { terminal_id: tid, active_client } = &event {
                                if tid == &tid_send {
                                    let msg = serde_json::to_string(&ServerMessage::ControlChanged {
                                        active_client: active_client.clone(),
                                    }).unwrap();
                                    if sender.send(Message::Text(msg.into())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
            }
        }
    });

    // Task: receive WebSocket input, enforce control
    let state_clone = state.clone();
    let tid_recv = terminal_id.clone();
    let cid_recv = client_id.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        match client_msg {
                            ClientMessage::Input { data } => {
                                if state_clone.is_active_client(&tid_recv, &cid_recv) {
                                    let _ = state_clone
                                        .write_to_terminal(&tid_recv, data.as_bytes());
                                }
                            }
                            ClientMessage::Resize { cols, rows } => {
                                if state_clone.is_active_client(&tid_recv, &cid_recv) {
                                    let _ =
                                        state_clone.resize_terminal(&tid_recv, cols, rows);
                                }
                            }
                            ClientMessage::TakeControl => {
                                let _ = state_clone.take_control(&tid_recv, &cid_recv);
                            }
                            ClientMessage::ReleaseControl => {
                                state_clone.release_control(&tid_recv, &cid_recv);
                            }
                        }
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

    // Release control when disconnecting
    state.release_control(&terminal_id, &client_id);
}

async fn events_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_events(socket, state))
}

async fn handle_events(socket: WebSocket, state: AppState) {
    let (mut sender, _receiver) = socket.split();
    let mut rx = state.subscribe_events();

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
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ws/terminal/{id}", get(ws_handler))
        .route("/ws/events", get(events_handler))
}
