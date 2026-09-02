//! Which hub the mobile app talks to, chosen at runtime.
//!
//! The WebView loads the hub itself, so the hub's origin is also the origin
//! that gets plugin access (notifications, clipboard, opening links). Baking
//! that origin in at build time is what made the app un-rebuildable for anyone
//! but the person who published it, so both come from one value the user
//! supplies on first launch and we keep on disk. Tauri's `add_capability` lets
//! us grant exactly that origin and nothing else.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Runtime, Url};

use crate::hub_url;

/// A hub URL baked in at build time. Optional, and there is no default: it
/// only saves the first-launch step for someone building their own APK.
const PRESET_HUB_URL: Option<&str> = option_env!("OFFDESK_MOBILE_HUB_URL");

const STORE_FILE: &str = "hub.json";

/// Long enough for a phone waking its Wi-Fi, short enough that a wrong
/// address does not look like a hang.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Where the app returns to when it has no hub — the bundled setup screen.
/// Captured at startup rather than reconstructed, because the local origin
/// differs by platform (`tauri://localhost`, `http://tauri.localhost`).
pub struct ShellUrl(pub Url);

#[derive(Default, Serialize, Deserialize)]
struct Store {
    hub_url: Option<String>,
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(STORE_FILE))
        .map_err(|e| format!("no config directory: {e}"))
}

/// `None` when the user has never made a choice. Distinct from a stored
/// choice of "no hub", which is what forgetting one leaves behind.
fn read_store<R: Runtime>(app: &AppHandle<R>) -> Option<Store> {
    let path = store_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_store<R: Runtime>(app: &AppHandle<R>, store: &Store) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create {parent:?}: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path:?}: {e}"))
}

/// The hub to load on launch: what the user chose, else the build-time preset.
pub fn configured_hub_url<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    match read_store(app) {
        // Any stored choice wins over the preset, including the empty one that
        // "switch hub" leaves behind — otherwise a preset build would silently
        // reconnect to the preset on the next launch.
        Some(store) => store.hub_url,
        None => PRESET_HUB_URL.map(str::to_string),
    }
    .map(|url| url.trim().to_string())
    .filter(|url| !url.is_empty())
}

/// The hub the setup screen should offer to retry. Only ever called from
/// that screen, and only reached when the hub did not load — a hub that
/// loads replaces this UI entirely.
#[tauri::command]
pub fn mobile_hub_url<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    configured_hub_url(&app)
}

/// Grant the hub's origin the plugin access the web UI needs, and only that
/// origin. Capabilities can be added but never removed, so this is called once
/// per hub per process — switching hubs goes back through the setup screen.
pub fn grant_and_load<R: Runtime>(app: &AppHandle<R>, hub_url: &str) -> Result<(), String> {
    let url = hub_url::parse(hub_url)?;
    reachable(&url)?;

    app.add_capability(
        CapabilityBuilder::new("mobile-hub")
            .local(false)
            .window("main")
            .remote(format!("{}/*", hub_url::origin(&url)))
            .permission("core:default")
            .permission("notification:default")
            .permission("shell:allow-open")
            .permission("opener:default")
            .permission("clipboard-manager:allow-read-text")
            .permission("clipboard-manager:allow-write-text")
            .permission("process:default")
            // The hub's own sign-in page offers "Scan code": the camera reads
            // the link the hub's page shows, so nothing is typed on a phone.
            .permission("barcode-scanner:allow-scan")
            .permission("barcode-scanner:allow-cancel")
            .permission("barcode-scanner:allow-request-permissions")
            .permission("barcode-scanner:allow-check-permissions")
            // Lets the hub's own UI hand the app back to the setup screen.
            // Deliberately not `allow-set-mobile-hub-url`: a hub may offer to
            // let go of the app, but must not be able to point it somewhere
            // else without the user typing the address.
            .permission("allow-clear-mobile-hub-url"),
    )
    .map_err(|e| format!("failed to grant {url} plugin access: {e}"))?;

    let window = app
        .get_webview_window("main")
        .ok_or("the main window is missing")?;
    window
        .navigate(url)
        .map_err(|e| format!("failed to open the hub: {e}"))
}

/// Save the hub the user typed and open it. Local only — see the capability
/// files: the setup screen may call this, a hub may not.
#[tauri::command]
pub fn set_mobile_hub_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<String, String> {
    let parsed = hub_url::parse(&url)?;
    // What gets remembered is the hub — its origin. A link scanned off the
    // hub's page can carry `?token=…`, which the web UI reads, stores and
    // strips on first load; it is spent then, not kept in the app's config
    // to be replayed on every launch.
    let normalized = hub_url::origin(&parsed);

    // Reach it before committing to it. Storing first and navigating second
    // is how a typo becomes unrecoverable: the WebView shows its own error
    // page, the setup screen is gone, and the only way back — "switch hub" —
    // lives in a UI that is not loading. The app has no address bar to save
    // you.
    reachable(&parsed)?;

    write_store(
        &app,
        &Store {
            hub_url: Some(normalized.clone()),
        },
    )?;
    grant_and_load(&app, parsed.as_str())?;
    Ok(normalized)
}

/// A TCP connect, which is all this needs to be: it separates "that address
/// is wrong, still typing" from "the hub answered something odd", and the
/// second is a problem the hub's own page can explain.
fn reachable(url: &Url) -> Result<(), String> {
    use std::net::{TcpStream, ToSocketAddrs};

    let host = url.host_str().ok_or("that address has no host")?;
    let port = url
        .port_or_known_default()
        .ok_or("that address has no port")?;

    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("Could not find {host}. Check the address, and that you are on the same network."))?;

    let mut last = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(_) => return Ok(()),
            Err(error) => last = Some(error),
        }
    }
    Err(match last {
        Some(_) => format!("Nothing answered at {host}:{port}. Is the hub running, and are you on the same network?"),
        None => format!("Could not find {host}."),
    })
}

/// Forget the hub and return to the setup screen. The origin we granted keeps
/// its access until the process ends — capabilities cannot be revoked — which
/// is why this goes back to the local screen rather than loading anything else.
#[tauri::command]
pub fn clear_mobile_hub_url<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    write_store(&app, &Store::default())?;

    let shell = app
        .try_state::<ShellUrl>()
        .ok_or("the setup screen's address was not recorded at startup")?
        .0
        .clone();
    let window = app
        .get_webview_window("main")
        .ok_or("the main window is missing")?;
    window
        .navigate(shell)
        .map_err(|e| format!("failed to open the setup screen: {e}"))
}
