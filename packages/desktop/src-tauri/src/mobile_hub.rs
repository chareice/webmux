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

/// Grant the hub's origin the plugin access the web UI needs, and only that
/// origin. Capabilities can be added but never removed, so this is called once
/// per hub per process — switching hubs goes back through the setup screen.
pub fn grant_and_load<R: Runtime>(app: &AppHandle<R>, hub_url: &str) -> Result<(), String> {
    let url = hub_url::parse(hub_url)?;

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
    let normalized = parsed.as_str().trim_end_matches('/').to_string();

    write_store(
        &app,
        &Store {
            hub_url: Some(normalized.clone()),
        },
    )?;
    grant_and_load(&app, &normalized)?;
    Ok(normalized)
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
