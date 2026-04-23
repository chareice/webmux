use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Json, Response},
    routing::{any, get},
    Router,
};
use futures::{SinkExt, StreamExt};
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, SignatureScheme,
};
use serde::Serialize;
use tc_protocol::NativeZellijStatus;
use tokio_tungstenite::{
    connect_async, connect_async_tls_with_config, tungstenite::{client::IntoClientRequest, Message as UpstreamMessage},
    Connector,
};

use crate::{auth::AuthUser, AppState};

#[derive(Debug, Clone, Serialize, PartialEq)]
struct NativeZellijBootstrapResponse {
    status: NativeZellijStatus,
    proxy_url: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/machines/{machine_id}/native-zellij",
            get(get_native_zellij_bootstrap),
        )
        .route(
            "/api/machines/{machine_id}/native-zellij/proxy/ws/{*path}",
            get(native_zellij_proxy_ws),
        )
        .route(
            "/api/machines/{machine_id}/native-zellij/proxy",
            any(native_zellij_proxy_root),
        )
        .route(
            "/api/machines/{machine_id}/native-zellij/proxy/{*path}",
            any(native_zellij_proxy_path),
        )
}

async fn get_native_zellij_bootstrap(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(machine_id): Path<String>,
) -> Result<Json<NativeZellijBootstrapResponse>, (StatusCode, String)> {
    if !state
        .manager
        .user_can_access_machine(&auth_user.user_id, &machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()));
    }

    let status = state
        .manager
        .ensure_native_zellij(&machine_id, &auth_user.user_id)
        .await
        .map_err(|error| (StatusCode::BAD_GATEWAY, error))?;

    let proxy_url = match &status {
        NativeZellijStatus::Ready {
            session_path,
            login_token,
            ..
        } => Some(build_proxy_url(&machine_id, session_path, login_token)),
        NativeZellijStatus::Unavailable { .. } => None,
    };

    Ok(Json(NativeZellijBootstrapResponse { status, proxy_url }))
}

async fn native_zellij_proxy_root(
    State(state): State<AppState>,
    Path(machine_id): Path<String>,
    method: Method,
    headers: HeaderMap,
    uri: Uri,
    body: Bytes,
) -> Response {
    proxy_http_request(
        state,
        machine_id,
        String::new(),
        method,
        headers,
        uri.query(),
        body,
    )
    .await
}

async fn native_zellij_proxy_path(
    State(state): State<AppState>,
    Path((machine_id, path)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
    uri: Uri,
    body: Bytes,
) -> Response {
    proxy_http_request(state, machine_id, path, method, headers, uri.query(), body).await
}

async fn native_zellij_proxy_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((machine_id, path)): Path<(String, String)>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let Some(base_url) = ready_base_url(&state, &machine_id).await else {
        return (
            StatusCode::CONFLICT,
            "Native Zellij is not ready for this machine".to_string(),
        )
            .into_response();
    };

    let upstream_url = build_upstream_ws_url(&base_url, &path, uri.query());
    let mut request = match upstream_url.into_client_request() {
        Ok(request) => request,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to prepare upstream websocket request: {error}"),
            )
                .into_response();
        }
    };
    if let Some(cookie) = headers.get(header::COOKIE) {
        request.headers_mut().insert(header::COOKIE, cookie.clone());
    }

    ws.on_upgrade(move |socket| proxy_websocket(socket, request))
}

async fn proxy_http_request(
    state: AppState,
    machine_id: String,
    path: String,
    method: Method,
    headers: HeaderMap,
    query: Option<&str>,
    body: Bytes,
) -> Response {
    let Some(base_url) = ready_base_url(&state, &machine_id).await else {
        return (
            StatusCode::CONFLICT,
            "Native Zellij is not ready for this machine".to_string(),
        )
            .into_response();
    };

    let upstream_url = build_upstream_http_url(&base_url, &path, query);
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create proxy client: {error}"),
            )
                .into_response();
        }
    };

    let mut request = client.request(method, upstream_url);
    if let Some(cookie) = headers.get(header::COOKIE).and_then(|value| value.to_str().ok()) {
        request = request.header(header::COOKIE, cookie);
    }
    if let Some(content_type) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    {
        request = request.header(header::CONTENT_TYPE, content_type);
    }

    let upstream = match request.body(body.to_vec()).send().await {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to reach Native Zellij upstream: {error}"),
            )
                .into_response();
        }
    };

    let status = upstream.status();
    let response_headers = upstream.headers().clone();
    let content_type = response_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let response_bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read Native Zellij upstream response: {error}"),
            )
                .into_response();
        }
    };

    let body = rewrite_proxy_body(&machine_id, &path, content_type.as_deref(), response_bytes);
    let mut response = Response::builder()
        .status(status)
        .body(Body::from(body))
        .unwrap();

    for (name, value) in response_headers.iter() {
        if name == header::CONTENT_LENGTH || name.as_str().eq_ignore_ascii_case("x-frame-options") {
            continue;
        }
        if name == header::SET_COOKIE {
            continue;
        }
        response
            .headers_mut()
            .append(name.clone(), value.clone());
    }

    for value in response_headers.get_all(header::SET_COOKIE).iter() {
        if let Some(rewritten) = rewrite_set_cookie(value, &machine_id) {
            response.headers_mut().append(header::SET_COOKIE, rewritten);
        }
    }

    response
}

async fn ready_base_url(state: &AppState, machine_id: &str) -> Option<String> {
    match state.manager.native_zellij_status(machine_id).await {
        Some(NativeZellijStatus::Ready { base_url, .. }) => Some(base_url),
        _ => None,
    }
}

async fn proxy_websocket(
    browser_socket: WebSocket,
    upstream_request: http::Request<()>,
) {
    let upstream = connect_upstream_websocket(upstream_request).await;
    let Ok((upstream_socket, _)) = upstream else {
        return;
    };

    let (mut browser_tx, mut browser_rx) = browser_socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream_socket.split();

    let browser_to_upstream = async {
        while let Some(Ok(message)) = browser_rx.next().await {
            match message {
                Message::Text(text) => {
                    if upstream_tx
                        .send(UpstreamMessage::Text(text.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Binary(bytes) => {
                    if upstream_tx
                        .send(UpstreamMessage::Binary(bytes.to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Ping(bytes) => {
                    if upstream_tx
                        .send(UpstreamMessage::Ping(bytes.to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Pong(bytes) => {
                    if upstream_tx
                        .send(UpstreamMessage::Pong(bytes.to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Message::Close(_) => {
                    let _ = upstream_tx.send(UpstreamMessage::Close(None)).await;
                    break;
                }
            }
        }
    };

    let upstream_to_browser = async {
        while let Some(message) = upstream_rx.next().await {
            match message {
                Ok(UpstreamMessage::Text(text)) => {
                    if browser_tx
                        .send(Message::Text(text.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(UpstreamMessage::Binary(bytes)) => {
                    if browser_tx.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(UpstreamMessage::Ping(bytes)) => {
                    if browser_tx.send(Message::Ping(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(UpstreamMessage::Pong(bytes)) => {
                    if browser_tx.send(Message::Pong(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(UpstreamMessage::Close(_)) => {
                    let _ = browser_tx.send(Message::Close(None)).await;
                    break;
                }
                Ok(UpstreamMessage::Frame(_)) => {}
                Err(_) => break,
            }
        }
    };

    tokio::select! {
        _ = browser_to_upstream => {}
        _ = upstream_to_browser => {}
    }
}

async fn connect_upstream_websocket(
    upstream_request: http::Request<()>,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        http::Response<Option<Vec<u8>>>,
    ),
    tokio_tungstenite::tungstenite::Error,
> {
    if upstream_request.uri().scheme_str() == Some("wss") {
        let tls = insecure_upstream_tls_config();
        return connect_async_tls_with_config(
            upstream_request,
            None,
            false,
            Some(Connector::Rustls(std::sync::Arc::new(tls))),
        )
        .await;
    }

    connect_async(upstream_request).await
}

fn insecure_upstream_tls_config() -> ClientConfig {
    ClientConfig::builder_with_provider(rustls::crypto::aws_lc_rs::default_provider().into())
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs default provider should support safe protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(NoCertificateVerification))
        .with_no_client_auth()
}

fn build_proxy_url(machine_id: &str, session_path: &str, login_token: &str) -> String {
    format!(
        "{}{}#webmux_login_token={}",
        build_proxy_base_path(machine_id),
        session_path,
        urlencoding::encode(login_token)
    )
}

fn build_proxy_base_path(machine_id: &str) -> String {
    format!("/api/machines/{machine_id}/native-zellij/proxy")
}

fn build_upstream_http_url(base_url: &str, path: &str, query: Option<&str>) -> String {
    let mut url = if path.is_empty() {
        base_url.to_string()
    } else {
        format!("{}/{}", base_url.trim_end_matches('/'), path)
    };
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

fn build_upstream_ws_url(base_url: &str, path: &str, query: Option<&str>) -> String {
    let ws_base = base_url
        .trim_end_matches('/')
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let mut url = format!("{ws_base}/ws/{path}");
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

fn rewrite_proxy_body(
    machine_id: &str,
    path: &str,
    content_type: Option<&str>,
    body: bytes::Bytes,
) -> Vec<u8> {
    if matches!(content_type, Some(value) if value.starts_with("text/html")) {
        return rewrite_html_base(machine_id, String::from_utf8_lossy(&body).as_ref()).into_bytes();
    }
    if path == "assets/auth.js"
        && matches!(
            content_type,
            Some(value) if value.starts_with("application/javascript") || value.starts_with("text/javascript")
        )
    {
        return rewrite_auth_js(String::from_utf8_lossy(&body).as_ref()).into_bytes();
    }

    body.to_vec()
}

fn rewrite_html_base(machine_id: &str, html: &str) -> String {
    html.replacen(
        "<base href=\"/\" />",
        &format!("<base href=\"{}/\" />", build_proxy_base_path(machine_id)),
        1,
    )
}

fn rewrite_auth_js(auth_js: &str) -> String {
    let mut output = auth_js.replacen(
        "import { getBaseUrl } from \"./utils.js\";\n",
        "import { getBaseUrl } from \"./utils.js\";\n\nfunction getTokenFromHash() {\n    const rawHash = window.location.hash.startsWith(\"#\") ? window.location.hash.slice(1) : window.location.hash;\n    const params = new URLSearchParams(rawHash);\n    const token = params.get(\"webmux_login_token\");\n    if (!token) {\n        return null;\n    }\n    return { token, remember: true };\n}\n",
        1,
    );
    output = output.replace(
        "        let result = await getSecurityToken();",
        "        let result = getTokenFromHash();\n        if (!result) {\n            result = await getSecurityToken();\n        }",
    );
    output
}

fn rewrite_set_cookie(cookie: &HeaderValue, machine_id: &str) -> Option<HeaderValue> {
    let raw = cookie.to_str().ok()?;
    let scoped_path = format!("Path={}/", build_proxy_base_path(machine_id));
    let mut parts = raw
        .split(';')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.eq_ignore_ascii_case("secure"))
        .collect::<Vec<_>>();

    let mut has_path = false;
    for part in &mut parts {
        if part.to_ascii_lowercase().starts_with("path=") {
            *part = scoped_path.clone();
            has_path = true;
        }
    }
    if !has_path {
        parts.push(scoped_path);
    }

    HeaderValue::from_str(&parts.join("; ")).ok()
}

#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
            SignatureScheme::ED448,
        ]
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::{
        build_proxy_url, insecure_upstream_tls_config, rewrite_auth_js, rewrite_html_base,
        rewrite_set_cookie,
    };

    #[test]
    fn build_proxy_url_keeps_login_token_in_hash() {
        let url = build_proxy_url("machine-a", "/webmux-user-aaaa", "token with space");
        assert_eq!(
            url,
            "/api/machines/machine-a/native-zellij/proxy/webmux-user-aaaa#webmux_login_token=token%20with%20space"
        );
    }

    #[test]
    fn rewrite_html_base_points_assets_back_through_proxy() {
        let html = "<html><head><base href=\"/\" /></head></html>";
        let rewritten = rewrite_html_base("machine-a", html);
        assert!(rewritten.contains(
            "<base href=\"/api/machines/machine-a/native-zellij/proxy/\" />"
        ));
    }

    #[test]
    fn rewrite_auth_js_uses_hash_token_before_prompting() {
        let source = "import { getBaseUrl } from \"./utils.js\";\nasync function waitForSecurityToken() {\n    while (true) {\n        let result = await getSecurityToken();\n        if (result) {\n            return result;\n        }\n    }\n}\n";
        let rewritten = rewrite_auth_js(source);
        assert!(rewritten.contains("getTokenFromHash()"));
        assert!(rewritten.contains("result = getTokenFromHash();"));
    }

    #[test]
    fn rewrite_set_cookie_scopes_session_to_machine_proxy_path() {
        let cookie = HeaderValue::from_static(
            "session_token=abc; HttpOnly; SameSite=Strict; Secure; Path=/",
        );
        let rewritten = rewrite_set_cookie(&cookie, "machine-a").unwrap();
        let value = rewritten.to_str().unwrap();
        assert!(value.contains(
            "Path=/api/machines/machine-a/native-zellij/proxy/"
        ));
        assert!(!value.to_ascii_lowercase().contains("secure"));
    }

    #[test]
    fn insecure_upstream_tls_config_builds_without_global_provider_setup() {
        let _config = insecure_upstream_tls_config();
    }
}
