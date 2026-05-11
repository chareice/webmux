#[cfg(desktop)]
mod oauth;
#[cfg(desktop)]
mod tray;

#[cfg(any(desktop, mobile))]
use tauri::Manager;

// On mobile we wrap a remote URL (webmux mobile-web). This ensures the
// Android client always tracks production features instead of needing a
// parallel native UI tree. The URL is whatever the user has configured;
// for now we hard-code the production hub but read an override at compile
// time to ease internal dogfooding.
#[cfg(mobile)]
const MOBILE_HUB_URL: &str = match option_env!("WEBMUX_MOBILE_HUB_URL") {
    Some(value) => value,
    None => "https://webmux.nas.chareice.site",
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = configure_desktop(builder);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            setup_desktop(app)?;
            #[cfg(mobile)]
            setup_mobile(app)?;
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
fn configure_desktop<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

    let shortcut = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::SHIFT),
        Code::Backquote,
    );

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![oauth::start_oauth_listener])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(shortcut)
                .expect("failed to register shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
}

#[cfg(desktop)]
fn setup_desktop(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app.handle())?;

    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_clone.hide();
            }
        });
    }

    Ok(())
}

#[cfg(mobile)]
fn setup_mobile(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Point the WebView at the hub URL instead of the bundled SPA. The
    // bundled assets are still used by the desktop build; on mobile they
    // are only needed as a launch shell, replaced immediately. Using
    // navigate() instead of eval() avoids a JS round-trip.
    if let Some(window) = app.get_webview_window("main") {
        let url = MOBILE_HUB_URL
            .parse::<tauri::Url>()
            .map_err(|e| format!("invalid WEBMUX_MOBILE_HUB_URL {MOBILE_HUB_URL}: {e}"))?;
        window.navigate(url)?;
    }
    Ok(())
}
