use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub server_url: String,
    pub agent_id: String,
    pub agent_secret: String,
    pub name: String,
}

/// Returns `~/.webmux`
pub fn credentials_dir() -> PathBuf {
    let home = dirs::home_dir().expect("cannot determine home directory");
    home.join(".webmux")
}

/// Returns `~/.webmux/credentials.json`
pub fn credentials_path() -> PathBuf {
    credentials_dir().join("credentials.json")
}

/// Load credentials from disk. Returns `None` when the file does not exist
/// or contains invalid data.
pub fn load_credentials() -> Option<Credentials> {
    let path = credentials_path();
    if !path.exists() {
        return None;
    }

    let raw = fs::read_to_string(&path).ok()?;
    let creds: Credentials = serde_json::from_str(&raw).ok()?;

    if creds.server_url.is_empty()
        || creds.agent_id.is_empty()
        || creds.agent_secret.is_empty()
        || creds.name.is_empty()
    {
        return None;
    }

    Some(creds)
}

/// Persist credentials to disk, creating the directory with `0o700` and the
/// file with `0o600` permissions.
pub fn save_credentials(creds: &Credentials) {
    let dir = credentials_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).expect("failed to create credentials directory");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                .expect("failed to set credentials directory permissions");
        }
    }

    let json = serde_json::to_string_pretty(&creds).expect("failed to serialize credentials");
    let content = format!("{json}\n");
    let path = credentials_path();

    fs::write(&path, content).expect("failed to write credentials file");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .expect("failed to set credentials file permissions");
    }
}
