use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const SERVICE_NAME: &str = "webmux-node";

// ── Shared helpers ─────────────────────────────────────────────────

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

// ── Linux (systemd) ───────────────────────────────────────────────

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

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

    fn run_systemctl(args: &[&str]) -> Result<(), String> {
        run_command("systemctl", args)
    }

    pub fn service_file_path(home_dir: &str) -> String {
        let mut p = PathBuf::from(home_dir);
        p.push(".config");
        p.push("systemd");
        p.push("user");
        p.push(format!("{SERVICE_NAME}.service"));
        p.to_string_lossy().to_string()
    }

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

        let unit_path = service_file_path(&home_str);
        let unit_dir = PathBuf::from(&unit_path)
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "cannot determine service directory".to_string())?;

        fs::create_dir_all(&unit_dir)
            .map_err(|e| format!("failed to create service directory: {e}"))?;

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

        if let Some(username) = whoami() {
            let _ = run_command("loginctl", &["enable-linger", &username]);
        }

        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        let home_dir = dirs::home_dir()
            .ok_or_else(|| "cannot determine home directory".to_string())?;
        let home_str = home_dir.to_string_lossy().to_string();
        let unit_path = service_file_path(&home_str);

        let _ = run_systemctl(&["--user", "stop", SERVICE_NAME]);
        let _ = run_systemctl(&["--user", "disable", SERVICE_NAME]);

        if PathBuf::from(&unit_path).exists() {
            fs::remove_file(&unit_path)
                .map_err(|e| format!("failed to remove service file: {e}"))?;
        }

        let _ = run_systemctl(&["--user", "daemon-reload"]);
        Ok(())
    }

    pub fn status() {
        let _ = Command::new("systemctl")
            .args(["--user", "status", SERVICE_NAME])
            .status();
    }

    pub fn is_active() -> Option<String> {
        let output = Command::new("systemctl")
            .args(["--user", "is-active", SERVICE_NAME])
            .output()
            .ok()?;
        let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() {
            Some(status)
        } else if !status.is_empty() {
            Some(status)
        } else {
            None
        }
    }
}

// ── macOS (launchd) ───────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    const LABEL: &str = "com.webmux.node";

    fn render_plist(home_dir: &str, exe_path: &str, path_env: &str) -> String {
        let log_dir = format!("{home_dir}/Library/Logs/webmux");
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe_path}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>{home_dir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>{home_dir}</string>
        <key>PATH</key>
        <string>{path_env}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{log_dir}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/stderr.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
"#
        )
    }

    fn plist_path(home_dir: &str) -> PathBuf {
        PathBuf::from(home_dir)
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{LABEL}.plist"))
    }

    pub fn service_file_path(home_dir: &str) -> String {
        plist_path(home_dir).to_string_lossy().to_string()
    }

    pub fn install(_name: &str, _no_auto_upgrade: bool) -> Result<(), String> {
        let home_dir = dirs::home_dir()
            .ok_or_else(|| "cannot determine home directory".to_string())?;
        let home_str = home_dir.to_string_lossy().to_string();

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("failed to determine current executable path: {e}"))?
            .to_string_lossy()
            .to_string();

        let path_env = std::env::var("PATH").unwrap_or_default();
        let plist = render_plist(&home_str, &exe_path, &path_env);

        // Create log directory
        let log_dir = PathBuf::from(&home_str).join("Library").join("Logs").join("webmux");
        fs::create_dir_all(&log_dir)
            .map_err(|e| format!("failed to create log directory: {e}"))?;

        let plist_file = plist_path(&home_str);
        let plist_dir = plist_file
            .parent()
            .ok_or_else(|| "cannot determine LaunchAgents directory".to_string())?;

        fs::create_dir_all(plist_dir)
            .map_err(|e| format!("failed to create LaunchAgents directory: {e}"))?;

        // Unload existing service if present
        if plist_file.exists() {
            let _ = run_command("launchctl", &["unload", &plist_file.to_string_lossy()]);
        }

        fs::write(&plist_file, &plist)
            .map_err(|e| format!("failed to write plist: {e}"))?;

        run_command("launchctl", &["load", "-w", &plist_file.to_string_lossy()])?;

        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        let home_dir = dirs::home_dir()
            .ok_or_else(|| "cannot determine home directory".to_string())?;
        let home_str = home_dir.to_string_lossy().to_string();
        let plist_file = plist_path(&home_str);

        if plist_file.exists() {
            let _ = run_command("launchctl", &["unload", &plist_file.to_string_lossy()]);
            fs::remove_file(&plist_file)
                .map_err(|e| format!("failed to remove plist: {e}"))?;
        }

        Ok(())
    }

    pub fn status() {
        let _ = Command::new("launchctl")
            .args(["list", LABEL])
            .status();
    }

    pub fn is_active() -> Option<String> {
        let output = Command::new("launchctl")
            .args(["list", LABEL])
            .output()
            .ok()?;
        if output.status.success() {
            Some("active".to_string())
        } else {
            None
        }
    }
}

// ── Public API (delegates to platform module) ─────────────────────

pub fn install(name: &str, no_auto_upgrade: bool) -> Result<(), String> {
    platform::install(name, no_auto_upgrade)
}

pub fn uninstall() -> Result<(), String> {
    platform::uninstall()
}

pub fn status() {
    platform::status();
}

pub fn is_active() -> Option<String> {
    platform::is_active()
}

pub fn service_file_path(home_dir: &str) -> String {
    platform::service_file_path(home_dir)
}
