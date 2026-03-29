use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server_url: String,
    pub api_token: String,
}

/// Returns the path to the config file: ~/.config/webmux/config.toml
pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .expect("Could not determine config directory")
        .join("webmux")
        .join("config.toml")
}

/// Loads config from file, with env var overrides for WEBMUX_SERVER_URL and WEBMUX_API_TOKEN.
pub fn load_config() -> Option<Config> {
    let path = config_path();
    let content = fs::read_to_string(&path).ok()?;
    let mut config: Config = toml::from_str(&content).ok()?;

    if let Ok(url) = std::env::var("WEBMUX_SERVER_URL") {
        config.server_url = url;
    }
    if let Ok(token) = std::env::var("WEBMUX_API_TOKEN") {
        config.api_token = token;
    }

    Some(config)
}

/// Saves config to file, creating the directory if needed. Sets file permissions to 0o600.
pub fn save_config(config: &Config) -> io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content =
        toml::to_string_pretty(config).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(&path, &content)?;

    // Set file permissions to 0o600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

/// Loads config or exits with a helpful error message.
pub fn require_config() -> Config {
    load_config().unwrap_or_else(|| {
        eprintln!(
            "Error: Not logged in. Run `webmux login --server <URL> --token <TOKEN>` first."
        );
        eprintln!(
            "Alternatively, set WEBMUX_SERVER_URL and WEBMUX_API_TOKEN environment variables."
        );
        std::process::exit(1);
    })
}
