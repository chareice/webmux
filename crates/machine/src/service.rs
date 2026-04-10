use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const SERVICE_NAME: &str = "webmux-node";

/// Render a systemd user service unit file.
fn render_service_unit(
    name: &str,
    home_dir: &str,
    exe_path: &str,
    path_env: &str,
) -> String {
    format!(
        r#"[Unit]
Description=Webmux Node ({name})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exe_path} start
Restart=always
RestartSec=10
KillMode=process
Environment=HOME={home_dir}
Environment=PATH={path_env}
WorkingDirectory={home_dir}

[Install]
WantedBy=default.target
"#
    )
}

/// Install and start the node as a systemd user service.
pub fn install(name: &str, _no_auto_upgrade: bool) -> Result<(), String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_str = home_dir.to_string_lossy().to_string();

    let exe_path = std::env::current_exe()
        .map_err(|e| format!("failed to determine current executable path: {e}"))?
        .to_string_lossy()
        .to_string();

    let path_env = std::env::var("PATH").unwrap_or_default();

    let unit = render_service_unit(name, &home_str, &exe_path, &path_env);

    let unit_path = service_unit_path(&home_str);
    let unit_dir = PathBuf::from(&unit_path)
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "cannot determine service directory".to_string())?;

    fs::create_dir_all(&unit_dir)
        .map_err(|e| format!("failed to create service directory: {e}"))?;

    // Set directory permissions to 0o700
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o700);
        fs::set_permissions(&unit_dir, perms)
            .map_err(|e| format!("failed to set directory permissions: {e}"))?;
    }

    fs::write(&unit_path, &unit)
        .map_err(|e| format!("failed to write service unit: {e}"))?;

    run_systemctl(&["--user", "daemon-reload"])?;
    run_systemctl(&["--user", "enable", SERVICE_NAME])?;
    run_systemctl(&["--user", "restart", SERVICE_NAME])?;

    // Enable lingering so the service starts at boot without a login session
    if let Some(username) = whoami() {
        let _ = run_command("loginctl", &["enable-linger", &username]);
    }

    Ok(())
}

/// Stop and remove the systemd user service.
pub fn uninstall() -> Result<(), String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "cannot determine home directory".to_string())?;
    let home_str = home_dir.to_string_lossy().to_string();
    let unit_path = service_unit_path(&home_str);

    let _ = run_systemctl(&["--user", "stop", SERVICE_NAME]);
    let _ = run_systemctl(&["--user", "disable", SERVICE_NAME]);

    if PathBuf::from(&unit_path).exists() {
        fs::remove_file(&unit_path)
            .map_err(|e| format!("failed to remove service file: {e}"))?;
    }

    let _ = run_systemctl(&["--user", "daemon-reload"]);
    Ok(())
}

/// Show systemd service status (inherits stdio so the user sees the output).
pub fn status() {
    let _ = Command::new("systemctl")
        .args(["--user", "status", SERVICE_NAME])
        .status();
}

/// Check whether the service is active. Returns the status string (e.g. "active")
/// or `None` if the service is not installed / inactive.
pub fn is_active() -> Option<String> {
    let output = Command::new("systemctl")
        .args(["--user", "is-active", SERVICE_NAME])
        .output()
        .ok()?;
    let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Some(status)
    } else {
        // Return the status even if not "active" (e.g. "inactive", "failed")
        if !status.is_empty() {
            Some(status)
        } else {
            None
        }
    }
}

/// Return the path to the systemd user service unit file.
pub fn service_unit_path(home_dir: &str) -> String {
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
