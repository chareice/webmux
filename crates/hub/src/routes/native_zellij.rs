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
    ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
};
use serde::Serialize;
use std::io::BufReader;
use tc_protocol::NativeZellijStatus;
use tokio_tungstenite::{
    connect_async, connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, Message as UpstreamMessage},
    Connector,
};

use crate::{
    auth::{self, AuthUser},
    AppState,
};

const PROXY_AUTH_COOKIE_NAME: &str = "webmux_proxy_auth";

#[derive(Debug, Clone, Serialize, PartialEq)]
struct NativeZellijBootstrapResponse {
    status: NativeZellijStatus,
    proxy_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct AuthorizedNativeZellij {
    user_id: String,
    session_name: String,
    base_url: String,
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
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
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

    let proxy_auth_token = extract_authorization_bearer(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing bearer token".to_string()))?;
    let proxy_auth_cookie =
        build_proxy_auth_cookie(&machine_id, &proxy_auth_token, !state.dev_mode)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;

    let mut response = Json(NativeZellijBootstrapResponse { status, proxy_url }).into_response();
    response
        .headers_mut()
        .append(header::SET_COOKIE, proxy_auth_cookie);
    Ok(response)
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
    let ready = match authenticate_proxy_request(&state, &machine_id, &headers).await {
        Ok(ready) => ready,
        Err(response) => return response,
    };
    if !ws_proxy_path_allowed(&path, &ready.session_name) {
        return (
            StatusCode::NOT_FOUND,
            "Native Zellij path not found".to_string(),
        )
            .into_response();
    }

    let upstream_url = build_upstream_ws_url(&ready.base_url, &path, uri.query());
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
    if let Some(cookie) = forwarded_cookie_header(&headers) {
        match HeaderValue::from_str(&cookie) {
            Ok(cookie) => {
                request.headers_mut().insert(header::COOKIE, cookie);
            }
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("Invalid cookie header for Native Zellij proxy: {error}"),
                )
                    .into_response();
            }
        }
    }

    ws.on_upgrade(move |socket| {
        proxy_websocket(
            socket,
            request,
            state.native_zellij_allow_insecure_tls,
            state.native_zellij_ca_cert_pem.clone(),
        )
    })
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
    let ready = match authenticate_proxy_request(&state, &machine_id, &headers).await {
        Ok(ready) => ready,
        Err(response) => return response,
    };
    if !http_proxy_path_allowed(&path, &ready.session_name) {
        return (
            StatusCode::NOT_FOUND,
            "Native Zellij path not found".to_string(),
        )
            .into_response();
    }

    let upstream_url = build_upstream_http_url(&ready.base_url, &path, query);
    let client = match build_upstream_http_client(&state) {
        Ok(client) => client,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create Native Zellij proxy client: {error}"),
            )
                .into_response();
        }
    };

    let mut request = client.request(method, upstream_url);
    if let Some(cookie) = forwarded_cookie_header(&headers) {
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
        response.headers_mut().append(name.clone(), value.clone());
    }

    for value in response_headers.get_all(header::SET_COOKIE).iter() {
        if let Some(rewritten) = rewrite_set_cookie(value, &machine_id, state.dev_mode) {
            response.headers_mut().append(header::SET_COOKIE, rewritten);
        }
    }

    response
}

async fn proxy_websocket(
    browser_socket: WebSocket,
    upstream_request: http::Request<()>,
    allow_insecure_tls: bool,
    ca_cert_pem: Option<std::sync::Arc<Vec<u8>>>,
) {
    let upstream =
        connect_upstream_websocket(upstream_request, allow_insecure_tls, ca_cert_pem).await;
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
    allow_insecure_tls: bool,
    ca_cert_pem: Option<std::sync::Arc<Vec<u8>>>,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        http::Response<Option<Vec<u8>>>,
    ),
    String,
> {
    if upstream_request.uri().scheme_str() == Some("wss") {
        if allow_insecure_tls {
            let tls = insecure_upstream_tls_config();
            return connect_async_tls_with_config(
                upstream_request,
                None,
                false,
                Some(Connector::Rustls(std::sync::Arc::new(tls))),
            )
            .await
            .map_err(|error| error.to_string());
        }

        if let Some(ca_cert_pem) = ca_cert_pem {
            let tls = upstream_tls_config_with_ca(ca_cert_pem.as_ref())?;
            return connect_async_tls_with_config(
                upstream_request,
                None,
                false,
                Some(Connector::Rustls(std::sync::Arc::new(tls))),
            )
            .await
            .map_err(|error| error.to_string());
        }
    }

    connect_async(upstream_request)
        .await
        .map_err(|error| error.to_string())
}

fn build_upstream_http_client(state: &AppState) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if state.native_zellij_allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    } else if let Some(ca_cert_pem) = &state.native_zellij_ca_cert_pem {
        let certificate = reqwest::Certificate::from_pem(ca_cert_pem.as_ref())
            .map_err(|error| format!("Failed to load Native Zellij CA certificate: {error}"))?;
        builder = builder.add_root_certificate(certificate);
    }

    builder
        .build()
        .map_err(|error| format!("reqwest client build failed: {error}"))
}

fn upstream_tls_config_with_ca(ca_cert_pem: &[u8]) -> Result<ClientConfig, String> {
    let mut reader = BufReader::new(ca_cert_pem);
    let certs = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse Native Zellij CA certificate: {error}"))?;
    if certs.is_empty() {
        return Err("Native Zellij CA certificate file is empty".to_string());
    }

    let mut roots = RootCertStore::empty();
    let (added, _ignored) = roots.add_parsable_certificates(certs);
    if added == 0 {
        return Err(
            "Native Zellij CA certificate file did not contain a valid certificate".to_string(),
        );
    }

    Ok(
        ClientConfig::builder_with_provider(rustls::crypto::aws_lc_rs::default_provider().into())
            .with_safe_default_protocol_versions()
            .expect("aws-lc-rs default provider should support safe protocol versions")
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

fn insecure_upstream_tls_config() -> ClientConfig {
    ClientConfig::builder_with_provider(rustls::crypto::aws_lc_rs::default_provider().into())
        .with_safe_default_protocol_versions()
        .expect("aws-lc-rs default provider should support safe protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(NoCertificateVerification))
        .with_no_client_auth()
}

async fn authenticate_proxy_request(
    state: &AppState,
    machine_id: &str,
    headers: &HeaderMap,
) -> Result<AuthorizedNativeZellij, Response> {
    let token = extract_proxy_bearer_token(headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing authentication".to_string(),
        )
            .into_response()
    })?;
    let user_id = auth::verify_bearer_token(&token, &state.db, &state.jwt_secret)
        .map_err(|error| error.into_response())?;

    if !state
        .manager
        .user_can_access_machine(&user_id, machine_id)
        .await
    {
        return Err((StatusCode::NOT_FOUND, "Machine not found".to_string()).into_response());
    }

    let Some(status) = state
        .manager
        .native_zellij_status_for_user(&user_id, machine_id)
        .await
    else {
        return Err((
            StatusCode::CONFLICT,
            "Native Zellij is not ready for this machine".to_string(),
        )
            .into_response());
    };

    match status {
        NativeZellijStatus::Ready {
            session_name,
            base_url,
            ..
        } => Ok(AuthorizedNativeZellij {
            user_id,
            session_name,
            base_url,
        }),
        NativeZellijStatus::Unavailable { .. } => Err((
            StatusCode::CONFLICT,
            "Native Zellij is not ready for this machine".to_string(),
        )
            .into_response()),
    }
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

fn build_proxy_auth_cookie(
    machine_id: &str,
    bearer_token: &str,
    secure: bool,
) -> Result<HeaderValue, String> {
    let mut cookie = format!(
        "{PROXY_AUTH_COOKIE_NAME}={bearer_token}; Path={}/; HttpOnly; SameSite=Strict",
        build_proxy_base_path(machine_id)
    );
    if secure {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie)
        .map_err(|error| format!("Failed to build Native Zellij proxy auth cookie: {error}"))
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

fn extract_authorization_bearer(headers: &HeaderMap) -> Option<String> {
    let auth_header = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    auth_header
        .strip_prefix("Bearer ")
        .map(|token| token.to_string())
}

fn extract_proxy_bearer_token(headers: &HeaderMap) -> Option<String> {
    extract_authorization_bearer(headers).or_else(|| {
        headers
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|raw| extract_cookie_value(raw, PROXY_AUTH_COOKIE_NAME))
    })
}

fn extract_cookie_value(raw: &str, name: &str) -> Option<String> {
    raw.split(';').find_map(|part| {
        let (cookie_name, cookie_value) = part.trim().split_once('=')?;
        (cookie_name == name).then(|| cookie_value.to_string())
    })
}

fn forwarded_cookie_header(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let cookies = raw
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .filter(|part| !part.starts_with(&format!("{PROXY_AUTH_COOKIE_NAME}=")))
        .collect::<Vec<_>>();
    if cookies.is_empty() {
        None
    } else {
        Some(cookies.join("; "))
    }
}

fn http_proxy_path_allowed(path: &str, session_name: &str) -> bool {
    let normalized = path.trim_matches('/');
    normalized.is_empty()
        || normalized == "favicon.ico"
        || normalized == "manifest.json"
        || normalized.starts_with("assets/")
        || normalized == "session"
        || normalized.starts_with("info/")
        || normalized.starts_with("command/")
        || session_scoped_path_allowed(normalized, session_name)
}

fn ws_proxy_path_allowed(path: &str, session_name: &str) -> bool {
    let normalized = path.trim_matches('/');
    normalized == "control"
        || normalized == format!("terminal/{session_name}")
        || normalized.starts_with(&format!("terminal/{session_name}/"))
}

fn session_scoped_path_allowed(path: &str, session_name: &str) -> bool {
    path == session_name || path.starts_with(&format!("{session_name}/"))
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

fn rewrite_set_cookie(
    cookie: &HeaderValue,
    machine_id: &str,
    strip_secure: bool,
) -> Option<HeaderValue> {
    let raw = cookie.to_str().ok()?;
    let scoped_path = format!("Path={}/", build_proxy_base_path(machine_id));
    let mut parts = raw
        .split(';')
        .map(|part| part.trim().to_string())
        .filter(|part| !(strip_secure && part.eq_ignore_ascii_case("secure")))
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
    use std::sync::Arc;

    use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use tc_protocol::{HubToMachine, MachineInfo, MachineToHub, NativeZellijStatus};

    use super::{
        authenticate_proxy_request, build_proxy_auth_cookie, build_proxy_url,
        forwarded_cookie_header, http_proxy_path_allowed, insecure_upstream_tls_config,
        rewrite_auth_js, rewrite_html_base, rewrite_set_cookie, ws_proxy_path_allowed,
    };
    use crate::{
        attach_router::HubRouter, auth::sign_jwt, machine_manager::MachineManager, AppState,
    };

    fn machine(id: &str) -> MachineInfo {
        MachineInfo {
            id: id.to_string(),
            name: format!("machine-{id}"),
            os: "linux".to_string(),
            home_dir: "/tmp".to_string(),
        }
    }

    fn ready_status(session_name: &str) -> NativeZellijStatus {
        NativeZellijStatus::Ready {
            session_name: session_name.to_string(),
            session_path: format!("/{session_name}"),
            base_url: "https://node:8443".to_string(),
            login_token: "login-token".to_string(),
        }
    }

    fn test_state(dev_mode: bool) -> AppState {
        let pool = Pool::builder()
            .max_size(1)
            .build(SqliteConnectionManager::memory())
            .unwrap();
        let conn = pool.get().unwrap();
        crate::db::init_db(&conn).unwrap();
        crate::db::users::create_user(&conn, "user-a", "test", "user-a", "User A", None, "admin")
            .unwrap();
        crate::db::users::create_user(&conn, "user-b", "test", "user-b", "User B", None, "admin")
            .unwrap();
        drop(conn);

        AppState {
            manager: Arc::new(MachineManager::new(pool.clone())),
            router: Arc::new(HubRouter::new()),
            db: pool,
            jwt_secret: "test-secret".to_string(),
            base_url: "http://localhost:4317".to_string(),
            dev_mode,
            native_zellij_allow_insecure_tls: false,
            native_zellij_ca_cert_pem: None,
            github_client_id: None,
            github_client_secret: None,
            google_client_id: None,
            google_client_secret: None,
        }
    }

    async fn cache_ready_status(
        state: &AppState,
        machine_id: &str,
        machine_owner: &str,
        request_user_id: &str,
        status: NativeZellijStatus,
    ) {
        let (_conn_id, mut cmd_rx) = state
            .manager
            .register_machine(machine(machine_id), Some(machine_owner.to_string()))
            .await;

        let manager = state.manager.clone();
        let machine_id_owned = machine_id.to_string();
        let request_user_id_owned = request_user_id.to_string();
        let request = tokio::spawn(async move {
            manager
                .ensure_native_zellij(&machine_id_owned, &request_user_id_owned)
                .await
                .unwrap()
        });

        let request_id = match cmd_rx.recv().await.unwrap() {
            HubToMachine::EnsureNativeZellij {
                request_id,
                user_id,
            } => {
                assert_eq!(user_id, request_user_id);
                request_id
            }
            other => panic!("unexpected machine command: {other:?}"),
        };

        state
            .manager
            .handle_machine_message(
                machine_id,
                MachineToHub::NativeZellijReady {
                    request_id,
                    status: status.clone(),
                },
            )
            .await;

        assert_eq!(request.await.unwrap(), status);
    }

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
        assert!(
            rewritten.contains("<base href=\"/api/machines/machine-a/native-zellij/proxy/\" />")
        );
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
        let rewritten = rewrite_set_cookie(&cookie, "machine-a", true).unwrap();
        let value = rewritten.to_str().unwrap();
        assert!(value.contains("Path=/api/machines/machine-a/native-zellij/proxy/"));
        assert!(!value.to_ascii_lowercase().contains("secure"));
    }

    #[test]
    fn rewrite_set_cookie_preserves_secure_outside_dev_mode() {
        let cookie = HeaderValue::from_static(
            "session_token=abc; HttpOnly; SameSite=Strict; Secure; Path=/",
        );
        let rewritten = rewrite_set_cookie(&cookie, "machine-a", false).unwrap();
        let value = rewritten.to_str().unwrap().to_ascii_lowercase();
        assert!(value.contains("secure"));
    }

    #[test]
    fn build_proxy_auth_cookie_scopes_auth_to_machine_proxy_path() {
        let cookie = build_proxy_auth_cookie("machine-a", "jwt.token.value", true)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(cookie.contains("webmux_proxy_auth=jwt.token.value"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));
        assert!(cookie.contains("Secure"));
        assert!(cookie.contains("Path=/api/machines/machine-a/native-zellij/proxy/"));
    }

    #[test]
    fn forwarded_cookie_header_strips_proxy_auth_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static(
                "webmux_proxy_auth=jwt.token.value; zellij_session=abc; theme=dark",
            ),
        );

        let forwarded = forwarded_cookie_header(&headers).unwrap();

        assert_eq!(forwarded, "zellij_session=abc; theme=dark");
    }

    #[test]
    fn http_proxy_path_allows_required_zellij_routes_and_the_users_session_only() {
        assert!(http_proxy_path_allowed("", "webmux-user-aaaa"));
        assert!(http_proxy_path_allowed(
            "assets/auth.js",
            "webmux-user-aaaa"
        ));
        assert!(http_proxy_path_allowed("command/login", "webmux-user-aaaa"));
        assert!(http_proxy_path_allowed("session", "webmux-user-aaaa"));
        assert!(http_proxy_path_allowed("info/version", "webmux-user-aaaa"));
        assert!(http_proxy_path_allowed(
            "webmux-user-aaaa",
            "webmux-user-aaaa"
        ));
        assert!(http_proxy_path_allowed(
            "webmux-user-aaaa/plugins/status-bar",
            "webmux-user-aaaa"
        ));
        assert!(!http_proxy_path_allowed(
            "webmux-user-bbbb",
            "webmux-user-aaaa"
        ));
    }

    #[test]
    fn websocket_proxy_path_allows_control_and_the_users_terminal_only() {
        assert!(ws_proxy_path_allowed("control", "webmux-user-aaaa"));
        assert!(ws_proxy_path_allowed(
            "terminal/webmux-user-aaaa",
            "webmux-user-aaaa"
        ));
        assert!(!ws_proxy_path_allowed(
            "terminal/webmux-user-bbbb",
            "webmux-user-aaaa"
        ));
    }

    #[tokio::test]
    async fn authenticate_proxy_request_requires_proxy_auth() {
        let state = test_state(false);

        let error = authenticate_proxy_request(&state, "machine-a", &HeaderMap::new())
            .await
            .unwrap_err();

        assert_eq!(error.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authenticate_proxy_request_uses_cookie_auth_for_the_cached_user_session() {
        let state = test_state(false);
        cache_ready_status(
            &state,
            "machine-a",
            "user-a",
            "user-a",
            ready_status("webmux-user-aaaa"),
        )
        .await;

        let token = sign_jwt("user-a", &state.jwt_secret);
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("webmux_proxy_auth={token}; zellij_session=abc"))
                .unwrap(),
        );

        let ready = authenticate_proxy_request(&state, "machine-a", &headers)
            .await
            .unwrap();

        assert_eq!(ready.user_id, "user-a");
        assert_eq!(ready.session_name, "webmux-user-aaaa");
        assert_eq!(ready.base_url, "https://node:8443");
    }

    #[tokio::test]
    async fn authenticate_proxy_request_rejects_access_to_another_users_machine() {
        let state = test_state(false);
        cache_ready_status(
            &state,
            "machine-a",
            "user-a",
            "user-a",
            ready_status("webmux-user-aaaa"),
        )
        .await;

        let token = sign_jwt("user-b", &state.jwt_secret);
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );

        let error = authenticate_proxy_request(&state, "machine-a", &headers)
            .await
            .unwrap_err();

        assert_eq!(error.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn insecure_upstream_tls_config_builds_without_global_provider_setup() {
        let _config = insecure_upstream_tls_config();
    }
}
