//! The web UI, baked into the binary.
//!
//! Compiled in only with the `embed-ui` feature, which release builds turn on
//! after the frontend is built. Without it — a plain `cargo build`, a `cargo
//! check` in CI — nothing here exists and the hub serves the UI from disk as
//! it always has.

use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../../packages/app/dist"]
struct Assets;

/// True when a bundle was actually baked in. An empty dist directory compiles
/// fine and would otherwise serve a hub with no UI and no explanation.
pub fn is_populated() -> bool {
    Assets::get("index.html").is_some()
}

/// Serve an embedded file, falling back to index.html for client-side routes —
/// the same rule the on-disk service uses: anything under `/_expo/` or with a
/// dot in its last segment is an asset and 404s honestly rather than being
/// answered with HTML.
pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = Assets::get(path) {
        return respond(path, file.data.into_owned());
    }

    let looks_like_asset = path.starts_with("_expo/")
        || path
            .rsplit('/')
            .next()
            .is_some_and(|segment| segment.contains('.'));
    if looks_like_asset {
        return StatusCode::NOT_FOUND.into_response();
    }

    match Assets::get("index.html") {
        Some(index) => respond("index.html", index.data.into_owned()),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn respond(path: &str, body: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(body));
    if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    if let Some(value) = super::cache_control_for_static(&response) {
        response.headers_mut().insert(header::CACHE_CONTROL, value);
    }
    response
}
