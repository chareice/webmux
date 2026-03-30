use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::state::AppState;

/// GET /ws/qr/{session_id} — WebSocket endpoint for QR login polling (no auth required)
pub async fn ws_qr_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_qr_ws(socket, state, session_id))
}

async fn handle_qr_ws(socket: WebSocket, state: AppState, session_id: String) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register this sender in the QR hub
    let registered = {
        let mut hub = state.qr_hub.write().await;
        hub.register(session_id.clone(), tx.clone())
    };

    if !registered {
        // Another WebSocket is already connected for this session
        let msg = serde_json::json!({ "type": "error", "message": "Session already connected" });
        let _ = ws_sink
            .send(Message::Text(msg.to_string().into()))
            .await;
        let _ = ws_sink.close().await;
        return;
    }

    // Validate session exists and is pending
    let session = {
        let db = state.db.clone();
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.get().ok()?;
            crate::db::qr_login_sessions::find_qr_session(&conn, &sid).ok()?
        })
        .await
        .ok()
        .flatten()
    };

    let expires_at = match session {
        Some(s) if s.status == "pending" => s.expires_at,
        _ => {
            let msg = serde_json::json!({ "type": "error", "message": "Invalid or expired session" });
            let _ = ws_sink
                .send(Message::Text(msg.to_string().into()))
                .await;
            let _ = ws_sink.close().await;
            // Cleanup hub
            let mut hub = state.qr_hub.write().await;
            hub.remove(&session_id);
            return;
        }
    };

    // Calculate remaining time until expiry
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let remaining_ms = (expires_at - now_ms).max(0) as u64;
    let expiry_duration = std::time::Duration::from_millis(remaining_ms);

    // Spawn writer task: forwards messages from rx to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Wait loop: hub message, expiry timeout, or client disconnect
    let expiry_sleep = tokio::time::sleep(expiry_duration);
    tokio::pin!(expiry_sleep);

    loop {
        tokio::select! {
            _ = &mut expiry_sleep => {
                // Session expired
                let msg = serde_json::json!({ "type": "expired" }).to_string();
                let _ = tx.send(msg);
                info!("QR session {} expired", session_id);
                break;
            }
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        info!("QR WebSocket client disconnected for session {}", session_id);
                        break;
                    }
                    Some(Err(e)) => {
                        warn!("QR WebSocket error for session {}: {}", session_id, e);
                        break;
                    }
                    _ => {
                        // Ignore other messages from client
                        continue;
                    }
                }
            }
        }
    }

    // Cleanup: remove from hub
    {
        let mut hub = state.qr_hub.write().await;
        hub.remove(&session_id);
    }

    drop(tx);
    let _ = write_task.await;
}
