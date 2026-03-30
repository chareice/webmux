use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const SERVICE_NAME: &str = "webmux-node";

/// Render a systemd unit file.
pub fn render_service_unit(
    agent_name: &str,
    home_dir: &str,
    cli_path: &str,
    auto_upgrade: bool,
    path_env: &str,
) -> String {
    let auto_upgrade_val = if auto_upgrade { "1" } else { "0" };
    format!(
        r#"[Unit]
Description=Webmux Node ({agent_name})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={cli_path} start
Restart=always
RestartSec=10
Environment=WEBMUX_AGENT_SERVICE=1
Environment=WEBMUX_AGENT_AUTO_UPGRADE={auto_upgrade_val}
Environment=WEBMUX_AGENT_NAME={agent_name}
Environment=HOME={home_dir}
Environment=PATH={path_env}
WorkingDirectory={home_dir}

[Install]
WantedBy=default.target
"#
    )
}

pub struct InstallServiceOptions {
    pub agent_name: String,
    pub auto_upgrade: bool,
}

/// Install and start the agent as a systemd user service. The Rust binary is
/// the service executable itself (no Node.js or managed releases needed).
pub fn install_service(options: &InstallServiceOptions) -> Result<(), String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_str = home_dir.to_string_lossy().to_string();

    let cli_path = std::env::current_exe()
        .map_err(|e| format!("failed to determine current executable path: {e}"))?
        .to_string_lossy()
        .to_string();

    let path_env = std::env::var("PATH").unwrap_or_default();

    let unit = render_service_unit(
        &options.agent_name,
        &home_str,
        &cli_path,
        options.auto_upgrade,
        &path_env,
    );

    let unit_path = service_path(&home_str);
    let unit_dir = PathBuf::from(&unit_path)
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "cannot determine service directory".to_string())?;

    fs::create_dir_all(&unit_dir)
        .map_err(|e| format!("failed to create service directory: {e}"))?;
    fs::write(&unit_path, &unit)
        .map_err(|e| format!("failed to write service unit: {e}"))?;

    run_systemctl(&["--user", "daemon-reload"])?;
    run_systemctl(&["--user", "enable", SERVICE_NAME])?;
    run_systemctl(&["--user", "restart", SERVICE_NAME])?;

    // Enable lingering so the service starts at boot without a login session
    let username = whoami();
    if let Some(user) = username {
        let _ = run_command("loginctl", &["enable-linger", &user]);
    }

    Ok(())
}

/// Stop and remove the systemd user service.
pub fn uninstall_service() -> Result<(), String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_str = home_dir.to_string_lossy().to_string();
    let unit_path = service_path(&home_str);

    let _ = run_systemctl(&["--user", "stop", SERVICE_NAME]);
    let _ = run_systemctl(&["--user", "disable", SERVICE_NAME]);

    if PathBuf::from(&unit_path).exists() {
        fs::remove_file(&unit_path)
            .map_err(|e| format!("failed to remove service file: {e}"))?;
    }

    let _ = run_systemctl(&["--user", "daemon-reload"]);
    Ok(())
}

/// Read installed service configuration from the unit file.
pub struct InstalledServiceConfig {
    pub auto_upgrade: bool,
}

pub fn read_installed_service_config() -> Option<InstalledServiceConfig> {
    let home_dir = dirs::home_dir()?;
    let home_str = home_dir.to_string_lossy().to_string();
    let unit_path = service_path(&home_str);

    let unit = fs::read_to_string(&unit_path).ok()?;

    let auto_upgrade = if let Some(pos) = unit.find("WEBMUX_AGENT_AUTO_UPGRADE=") {
        let rest = &unit[pos + "WEBMUX_AGENT_AUTO_UPGRADE=".len()..];
        !rest.starts_with('0')
    } else {
        true
    };

    Some(InstalledServiceConfig { auto_upgrade })
}

/// Show systemd service status (runs `systemctl --user status webmux-agent` with
/// inherited stdio).
pub fn show_service_status() {
    let _ = Command::new("systemctl")
        .args(["--user", "status", SERVICE_NAME])
        .status();
}

/// Check whether the service is active. Returns the status string (e.g. "active")
/// or `None` if the service is not installed.
pub fn is_service_active() -> Option<String> {
    let output = Command::new("systemctl")
        .args(["--user", "is-active", SERVICE_NAME])
        .output()
        .ok()?;
    let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Some(status)
    } else {
        None
    }
}

pub fn service_path(home_dir: &str) -> String {
    let mut p = PathBuf::from(home_dir);
    p.push(".config");
    p.push("systemd");
    p.push("user");
    p.push(format!("{SERVICE_NAME}.service"));
    p.to_string_lossy().to_string()
}

fn run_systemctl(args: &[&str]) -> Result<(), String> {
    run_command("systemctl", args)
}

fn run_command(cmd: &str, args: &[&str]) -> Result<(), String> {
    let status = Command::new(cmd)
        .args(args)
        .status()
        .map_err(|e| format!("failed to execute {cmd}: {e}"))?;

    if !status.success() {
        return Err(format!("{cmd} exited with status {status}"));
    }
    Ok(())
}

fn whoami() -> Option<String> {
    let output = Command::new("whoami").output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}
