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

use crate::api::AppState;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "input")]
    Input { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "output")]
    Output { data: String },
    #[serde(rename = "error")]
    Error { message: String },
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

    // Subscribe to terminal output broadcast
    let (buffer, mut rx) = match state.subscribe(&terminal_id) {
        Ok(r) => r,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMessage::Error { message: e }).unwrap();
            let _ = sender.send(Message::Text(msg.into())).await;
            return;
        }
    };

    // Send buffered output first (replay history)
    if !buffer.is_empty() {
        let text = String::from_utf8_lossy(&buffer).to_string();
        let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
        if sender.send(Message::Text(msg.into())).await.is_err() {
            return;
        }
    }

    // Task: forward broadcast output to WebSocket
    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(data) => {
                    let text = String::from_utf8_lossy(&data).to_string();
                    let msg =
                        serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });

    // Task: forward WebSocket input to PTY
    let state_clone = state.clone();
    let terminal_id_clone = terminal_id.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        match client_msg {
                            ClientMessage::Input { data } => {
                                let _ = state_clone
                                    .write_to_terminal(&terminal_id_clone, data.as_bytes());
                            }
                            ClientMessage::Resize { cols, rows } => {
                                let _ = state_clone
                                    .resize_terminal(&terminal_id_clone, cols, rows);
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
