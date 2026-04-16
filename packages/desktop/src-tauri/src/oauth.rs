use axum::{extract::Query, response::Html, routing::get, Router};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

#[derive(Deserialize)]
struct CallbackParams {
    token: Option<String>,
}

/// Start a one-shot loopback HTTP server for OAuth callback.
/// Returns the port number so the frontend can construct the redirect URL.
#[tauri::command]
pub async fn start_oauth_listener(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind loopback listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?
        .port();

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let router = Router::new().route(
            "/callback",
            get(|Query(params): Query<CallbackParams>| async move {
                if let Some(token) = params.token {
                    let _ = app_handle.emit("oauth-token", token);
                }
                Html(
                    r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>webmux</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#faf9f5">
<div style="text-align:center">
<h2>Login successful</h2>
<p style="color:#666">You can close this tab and return to webmux.</p>
</div>
</body>
</html>"#,
                )
            }),
        );

        // Serve exactly one request, then stop
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                // Keep alive for a short time so the browser can receive the response
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            })
            .await;
    });

    Ok(port)
}
