//! Resolve the trusted setup page without asking a not-yet-loaded WebView
//! for its URL. These are Tauri's mobile custom-protocol origins; Android's
//! scheme follows the configured `useHttpsScheme` value.
use tauri::{utils::config::WindowConfig, Url, WebviewUrl};

pub fn setup_url(config: &WindowConfig, android: bool) -> Result<Url, String> {
    let WebviewUrl::App(path) = &config.url else {
        return Err("the setup screen must use bundled App assets".into());
    };
    let origin = if android {
        if config.use_https_scheme {
            "https://tauri.localhost/"
        } else {
            "http://tauri.localhost/"
        }
    } else {
        "tauri://localhost/"
    };
    let base = Url::parse(origin).map_err(|e| e.to_string())?;
    if path.to_str() == Some("index.html") {
        return Ok(base);
    }
    let url = base
        .join(&path.to_string_lossy())
        .map_err(|e| e.to_string())?;
    if url.scheme() != base.scheme()
        || url.host_str() != base.host_str()
        || url.port() != base.port()
    {
        return Err("the setup screen must stay on the App's local origin".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shipped_mobile_configs_resolve_without_a_running_webview() {
        for (raw, android, expected) in [
            (
                include_str!("../tauri.android.conf.json"),
                true,
                "http://tauri.localhost/",
            ),
            (
                include_str!("../tauri.ios.conf.json"),
                false,
                "tauri://localhost/",
            ),
        ] {
            let config: serde_json::Value = serde_json::from_str(raw).unwrap();
            let window: WindowConfig =
                serde_json::from_value(config["app"]["windows"][0].clone()).unwrap();
            assert_eq!(setup_url(&window, android).unwrap().as_str(), expected);
        }
    }

    #[test]
    fn respects_android_https_and_preserves_ios_custom_protocol() {
        let config = WindowConfig {
            use_https_scheme: true,
            ..Default::default()
        };
        assert_eq!(
            setup_url(&config, true).unwrap().as_str(),
            "https://tauri.localhost/"
        );
        assert_eq!(
            setup_url(&config, false).unwrap().as_str(),
            "tauri://localhost/"
        );
    }

    #[test]
    fn never_returns_to_a_remote_hub() {
        let mut config = WindowConfig {
            url: WebviewUrl::External(Url::parse("https://hub.example.com/").unwrap()),
            ..Default::default()
        };
        assert!(setup_url(&config, true).is_err());
        config.url = WebviewUrl::App("https://hub.example.com/".into());
        assert!(setup_url(&config, true).is_err());
    }
}
