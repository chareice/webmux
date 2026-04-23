use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
    process::Stdio,
};

use sha2::{Digest, Sha256};
use tc_protocol::{NativeZellijStatus, NativeZellijUnavailableReason};
use tokio::process::Command;

const DEFAULT_LISTEN_IP: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8082;
const DEFAULT_WEBMUX_ZELLIJ_CONFIG: &str = "show_startup_tips false\nshow_release_notes false\n";

#[derive(Debug, Clone)]
pub struct NativeZellijManager {
    public_base_url: Option<String>,
    listen_ip: String,
    port: u16,
    cert_path: Option<String>,
    key_path: Option<String>,
}

impl NativeZellijManager {
    pub fn from_env() -> Self {
        Self {
            public_base_url: std::env::var("WEBMUX_ZELLIJ_PUBLIC_BASE_URL")
                .ok()
                .map(|value| value.trim_end_matches('/').to_string())
                .filter(|value| !value.is_empty()),
            listen_ip: std::env::var("WEBMUX_ZELLIJ_LISTEN_IP")
                .ok()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_LISTEN_IP.to_string()),
            port: std::env::var("WEBMUX_ZELLIJ_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(DEFAULT_PORT),
            cert_path: std::env::var("WEBMUX_ZELLIJ_CERT")
                .ok()
                .filter(|value| !value.is_empty()),
            key_path: std::env::var("WEBMUX_ZELLIJ_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
        }
    }

    pub async fn ensure_for_user(&self, user_id: &str) -> Result<NativeZellijStatus, String> {
        if !binary_available().await {
            return Ok(NativeZellijStatus::Unavailable {
                reason: NativeZellijUnavailableReason::MissingBinary,
                instructions: "Install zellij on this machine and restart webmux-node.".into(),
            });
        }

        let Some(base_url) = self.public_base_url.clone() else {
            return Ok(NativeZellijStatus::Unavailable {
                reason: NativeZellijUnavailableReason::PublicBaseUrlMissing,
                instructions:
                    "Set WEBMUX_ZELLIJ_PUBLIC_BASE_URL so webmux can open Native Zellij.".into(),
            });
        };

        if self.requires_tls() && (self.cert_path.is_none() || self.key_path.is_none()) {
            return Ok(NativeZellijStatus::Unavailable {
                reason: NativeZellijUnavailableReason::MissingTlsConfig,
                instructions:
                    "Set WEBMUX_ZELLIJ_CERT and WEBMUX_ZELLIJ_KEY before exposing Zellij over the network.".into(),
            });
        }

        match self.ensure_web_server_running().await {
            Ok(()) => {}
            Err(EnsureWebServerError::WebClientUnavailable) => {
                return Ok(NativeZellijStatus::Unavailable {
                    reason: NativeZellijUnavailableReason::WebClientUnavailable,
                    instructions:
                        "Install a Zellij build with web client support on this machine.".into(),
                });
            }
            Err(EnsureWebServerError::StartFailed(error)) => {
                return Ok(NativeZellijStatus::Unavailable {
                    reason: NativeZellijUnavailableReason::WebServerStartFailed,
                    instructions: error,
                });
            }
        }

        let session_name = managed_session_name(user_id);
        let login_token = create_login_token().await?;

        Ok(NativeZellijStatus::Ready {
            session_name: session_name.clone(),
            session_path: format!("/{session_name}"),
            base_url,
            login_token,
        })
    }

    fn requires_tls(&self) -> bool {
        self.listen_ip != DEFAULT_LISTEN_IP
    }

    async fn ensure_web_server_running(&self) -> Result<(), EnsureWebServerError> {
        if probe_web_server(status_probe_url(&self.listen_ip, self.port, self.requires_tls())).await
        {
            return Ok(());
        }

        let mut args = vec![
            "web".to_string(),
            "--start".to_string(),
            "--ip".to_string(),
            self.listen_ip.clone(),
            "--port".to_string(),
            self.port.to_string(),
        ];
        if let Some(cert_path) = &self.cert_path {
            args.push("--cert".to_string());
            args.push(cert_path.clone());
        }
        if let Some(key_path) = &self.key_path {
            args.push("--key".to_string());
            args.push(key_path.clone());
        }

        spawn_zellij(args)
            .await
            .map_err(EnsureWebServerError::StartFailed)?;

        if !wait_for_web_server(status_probe_url(&self.listen_ip, self.port, self.requires_tls())).await
        {
            let status = run_zellij(["web".to_string(), "--status".to_string()])
                .await
                .unwrap_or_else(|error| CommandOutput {
                    stdout: String::new(),
                    stderr: error,
                    status: std::process::Command::new("false").status().unwrap(),
                });
            if mentions_missing_web_capability(&status.stdout, &status.stderr) {
                return Err(EnsureWebServerError::WebClientUnavailable);
            }
            return Err(EnsureWebServerError::StartFailed(
                "Zellij web server did not become reachable after startup.".into(),
            ));
        }

        Ok(())
    }
}

#[derive(Debug)]
enum EnsureWebServerError {
    WebClientUnavailable,
    StartFailed(String),
}

pub fn managed_session_name(user_id: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(user_id.as_bytes()));
    format!("webmux-user-{}", &digest[..12])
}

async fn binary_available() -> bool {
    match Command::new("zellij").arg("--version").output().await {
        Ok(output) => output.status.success(),
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(_) => false,
    }
}

async fn create_login_token() -> Result<String, String> {
    let output = run_zellij(["web".to_string(), "--create-token".to_string()]).await?;
    if !output.is_success() {
        return Err(format!(
            "Failed to create Zellij login token: {}",
            output.describe()
        ));
    }

    parse_created_token(&output.stdout).ok_or_else(|| {
        format!(
            "Zellij did not print a login token in the expected format: {}",
            output.stdout.trim()
        )
    })
}

#[derive(Debug)]
struct CommandOutput {
    stdout: String,
    stderr: String,
    status: std::process::ExitStatus,
}

impl CommandOutput {
    fn is_success(&self) -> bool {
        self.status.success()
    }

    fn describe(&self) -> String {
        let stderr = self.stderr.trim();
        let stdout = self.stdout.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }
        if !stdout.is_empty() {
            return stdout.to_string();
        }
        format!("process exited with {}", self.status)
    }
}

async fn run_zellij<I, S>(args: I) -> Result<CommandOutput, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = zellij_command()?;
    let output = command
        .args(args)
        .output()
        .await
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => "zellij is not installed".to_string(),
            _ => format!("Failed to run zellij: {error}"),
        })?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status,
    })
}

async fn spawn_zellij<I, S>(args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = zellij_command()?;
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => "zellij is not installed".to_string(),
            _ => format!("Failed to start zellij: {error}"),
        })
}

fn zellij_command() -> Result<Command, String> {
    let config_file = ensure_default_config_file()?;
    let mut command = Command::new("zellij");
    command.env("ZELLIJ_CONFIG_FILE", config_file);
    Ok(command)
}

fn ensure_default_config_file() -> Result<PathBuf, String> {
    let Some(config_dir) = dirs::config_dir() else {
        return Err("Failed to locate a config directory for Zellij.".into());
    };
    ensure_config_file_at(&config_dir)
}

fn ensure_config_file_at(config_root: &Path) -> Result<PathBuf, String> {
    let zellij_config_dir = config_root.join("zellij");
    std::fs::create_dir_all(&zellij_config_dir).map_err(|error| {
        format!(
            "Failed to create Zellij config directory at {}: {error}",
            zellij_config_dir.display()
        )
    })?;

    let config_file = zellij_config_dir.join("config.kdl");
    let should_write_defaults = match std::fs::metadata(&config_file) {
        Ok(metadata) => metadata.len() == 0,
        Err(error) if error.kind() == ErrorKind::NotFound => true,
        Err(error) => {
            return Err(format!(
                "Failed to inspect Zellij config file at {}: {error}",
                config_file.display()
            ))
        }
    };
    if should_write_defaults {
        std::fs::write(&config_file, DEFAULT_WEBMUX_ZELLIJ_CONFIG).map_err(|error| {
            format!(
                "Failed to create Zellij config file at {}: {error}",
                config_file.display()
            )
        })?;
    }

    Ok(config_file)
}

fn parse_created_token(stdout: &str) -> Option<String> {
    stdout.lines().rev().find_map(|line| {
        let (_label, value) = line.split_once(':')?;
        let token = value.trim();
        (!token.is_empty()).then(|| token.to_string())
    })
}

fn mentions_missing_web_capability(stdout: &str, stderr: &str) -> bool {
    let combined = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    combined.contains("compiled without")
        || combined.contains("no-web")
        || combined.contains("unrecognized")
        || combined.contains("unknown subcommand")
}

fn status_probe_ip(listen_ip: &str) -> &str {
    if listen_ip == "0.0.0.0" {
        "127.0.0.1"
    } else {
        listen_ip
    }
}

fn status_probe_url(listen_ip: &str, port: u16, use_tls: bool) -> String {
    let scheme = if use_tls { "https" } else { "http" };
    format!("{scheme}://{}:{port}", status_probe_ip(listen_ip))
}

async fn probe_web_server(url: String) -> bool {
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client.get(url).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn wait_for_web_server(url: String) -> bool {
    for _ in 0..20 {
        if probe_web_server(url.clone()).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    false
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        ensure_config_file_at, parse_created_token, status_probe_ip, status_probe_url,
    };

    #[test]
    fn parse_created_token_extracts_last_named_token() {
        let stdout = "Created token successfully\n\ntoken_7: abc-123-token";
        assert_eq!(parse_created_token(stdout).as_deref(), Some("abc-123-token"));
    }

    #[test]
    fn status_probe_ip_uses_loopback_for_wildcard_binding() {
        assert_eq!(status_probe_ip("0.0.0.0"), "127.0.0.1");
        assert_eq!(status_probe_ip("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn status_probe_url_matches_tls_mode() {
        assert_eq!(
            status_probe_url("0.0.0.0", 8443, true),
            "https://127.0.0.1:8443"
        );
        assert_eq!(
            status_probe_url("127.0.0.1", 8082, false),
            "http://127.0.0.1:8082"
        );
    }

    #[test]
    fn ensure_config_file_at_creates_missing_default_config() {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let config_root = std::env::temp_dir().join(format!(
            "webmux-zellij-config-{unique_id}-{}",
            std::process::id()
        ));

        let config_file =
            ensure_config_file_at(&config_root).expect("config file should be created");

        assert_eq!(config_file, config_root.join("zellij").join("config.kdl"));
        assert!(config_file.exists());
        let contents = std::fs::read_to_string(&config_file).expect("config file should be readable");
        assert!(contents.contains("show_startup_tips false"));
        assert!(contents.contains("show_release_notes false"));

        std::fs::remove_dir_all(&config_root).expect("temp config should be removed");
    }
}
