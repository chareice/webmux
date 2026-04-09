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

    // Get reader from PTY
    let reader = match state.take_reader(&terminal_id) {
        Ok(r) => r,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMessage::Error { message: e }).unwrap();
            let _ = sender.send(Message::Text(msg.into())).await;
            return;
        }
    };

    // Channel for PTY output -> WebSocket
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(32);

    // Blocking thread to read PTY output
    let _read_handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Task: forward PTY output to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let text = String::from_utf8_lossy(&data).to_string();
            let msg = serde_json::to_string(&ServerMessage::Output { data: text }).unwrap();
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
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

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/terminal/{id}", get(ws_handler))
}
