//! The desktop app as the machine that stays on.
//!
//! The app does not run the hub itself. It runs the bundled `offdesk-hub
//! service install`, which installs the hub and the node as login services,
//! registers this machine, and mints the sign-in link — exactly what
//! `curl offdesk.dev/install | sh` does, from binaries that ship inside the
//! app. Quitting the app changes nothing: the services are launchd's (or
//! systemd's), and `offdesk-hub link` in a terminal prints the same link.
//!
//! What the app adds is the PATH. The services inherit the environment of
//! whatever ran `service install`, so leading it with the directory the
//! sidecars live in is what lets a Mac with no Homebrew find tmux.

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const STORE_FILE: &str = "desktop.json";
const HUB_PORT: u16 = 4317;

// ── The first-run answer ──────────────────────────────────────────

#[derive(Default, Serialize, Deserialize)]
struct Store {
    role: Option<String>,
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(STORE_FILE))
        .map_err(|e| format!("no config directory: {e}"))
}

/// `"hub"`, `"client"`, or nothing — which is the first-run question.
#[tauri::command]
pub fn desktop_role<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    let path = store_path(&app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Store>(&raw).ok()?.role
}

#[tauri::command]
pub fn set_desktop_role<R: Runtime>(app: AppHandle<R>, role: String) -> Result<(), String> {
    if !matches!(role.as_str(), "hub" | "client") {
        return Err(format!("`{role}` is not a role; hub or client"));
    }
    let path = store_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create {parent:?}: {e}"))?;
    }
    let json =
        serde_json::to_string_pretty(&Store { role: Some(role) }).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("failed to write {path:?}: {e}"))
}

// ── Where the binaries are ────────────────────────────────────────

/// The hub binary, and the directory to lead PATH with when it came from
/// beside this app. Sidecars sit next to the executable (Contents/MacOS in
/// the bundle, target/debug under `tauri dev`); a machine set up by the
/// install script has them on PATH or in ~/.local/bin, which is enough for
/// development without sidecars.
fn hub_binary() -> Result<(PathBuf, Option<PathBuf>), String> {
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        let beside = dir.join("offdesk-hub");
        if beside.is_file() {
            return Ok((beside, Some(dir)));
        }
    }
    // `tauri dev` has no sidecars. The crates built in this checkout are the
    // version this app expects; the one the install script left on PATH may
    // be older. Debug builds only.
    #[cfg(debug_assertions)]
    {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let triple = format!(
            "{}-{}",
            std::env::consts::ARCH,
            if cfg!(target_os = "macos") { "apple-darwin" } else { "unknown-linux-gnu" }
        );
        // Whichever was built most recently: `--target` builds land under
        // target/<triple>, plain ones under target/{debug,release}.
        let newest = [
            root.join("target").join(&triple).join("release/offdesk-hub"),
            root.join("target/release/offdesk-hub"),
            root.join("target/debug/offdesk-hub"),
        ]
        .into_iter()
        .filter(|path| path.is_file())
        .max_by_key(|path| path.metadata().and_then(|m| m.modified()).ok());
        if let Some(path) = newest {
            let dir = path.parent().map(Path::to_path_buf);
            return Ok((path, dir));
        }
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local").join("bin"));
    }
    dirs.into_iter()
        .map(|dir| dir.join("offdesk-hub"))
        .find(|candidate| candidate.is_file())
        .map(|found| (found, None))
        .ok_or_else(|| {
            "offdesk-hub is not bundled with this app and not installed on this machine".to_string()
        })
}

fn prepend_path(dir: Option<&Path>, existing: Option<&str>) -> String {
    match (dir, existing.filter(|p| !p.is_empty())) {
        (Some(dir), Some(existing)) => format!("{}:{existing}", dir.display()),
        (Some(dir), None) => dir.display().to_string(),
        (None, existing) => existing.unwrap_or_default().to_string(),
    }
}

fn hub_command(args: &[&str], base_url: Option<&str>) -> Result<Command, String> {
    let (binary, dir) = hub_binary()?;
    let mut command = Command::new(binary);
    command
        .args(args)
        .env(
            "PATH",
            prepend_path(dir.as_deref(), std::env::var("PATH").ok().as_deref()),
        )
        // clap reads a boolean flag's env as "true" / "false"; a "1" is an
        // error before the hub does anything.
        .env("OFFDESK_NO_OPEN", "true");
    if let Some(base_url) = base_url.map(str::trim).filter(|url| !url.is_empty()) {
        command.env("OFFDESK_BASE_URL", base_url);
    }
    Ok(command)
}

fn run(mut command: Command, what: &str) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|e| format!("could not run {what}: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    // On the terminal that started the app (a dev run, or a shell), so a
    // failure can be read in full rather than as its last line.
    eprintln!(
        "[offdesk] {what} failed ({}): {:?}\n{stderr}",
        output.status,
        command.get_program()
    );
    // clap's complaint about `--json` means the hub on this machine predates
    // this app. Say that, not "try --help".
    if stderr.contains("unexpected argument '--json'") {
        return Err(
            "the offdesk-hub on this machine is older than this app and cannot answer it; \
             update it (curl -fsSL https://offdesk.dev/install | sh) or use the bundled app"
                .into(),
        );
    }
    // clap puts the reason on its first line and "try --help" on its last;
    // an `error:` line wins, otherwise the last thing said.
    let lines = || stderr.lines().chain(stdout.lines()).map(str::trim).filter(|line| !line.is_empty());
    let reason = lines()
        .find(|line| line.starts_with("error"))
        .or_else(|| lines().next_back())
        .unwrap_or("it failed without saying why")
        .trim_start_matches("error:")
        .trim()
        .to_string();
    Err(format!("{what}: {reason}"))
}

// ── Status ────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct HubStatus {
    /// The hub role exists on macOS and Linux; Windows is a client only.
    pub supported: bool,
    /// The binaries are beside this app, so the role can be taken here.
    pub bundled: bool,
    pub hub_installed: bool,
    pub node_installed: bool,
    /// Something answers on the hub's port on this machine.
    pub listening: bool,
}

fn service_files(home: &Path) -> (PathBuf, PathBuf) {
    if cfg!(target_os = "macos") {
        let agents = home.join("Library").join("LaunchAgents");
        (
            agents.join("dev.offdesk.hub.plist"),
            agents.join("dev.offdesk.node.plist"),
        )
    } else {
        let units = home.join(".config").join("systemd").join("user");
        (
            units.join("offdesk-hub.service"),
            units.join("offdesk-node.service"),
        )
    }
}

#[tauri::command]
pub fn hub_status() -> HubStatus {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let (hub, node) = service_files(&home);
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("offdesk-hub").is_file()))
        .unwrap_or(false);
    HubStatus {
        supported: cfg!(any(target_os = "macos", target_os = "linux")),
        bundled,
        hub_installed: hub.is_file(),
        node_installed: node.is_file(),
        listening: TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], HUB_PORT)),
            Duration::from_millis(500),
        )
        .is_ok(),
    }
}

// ── The link, and taking the role ─────────────────────────────────

/// What `offdesk-hub link --json` prints.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct HubLink {
    /// The hub's address as a phone would type it.
    pub url: String,
    /// The sign-in link; null when the hub signs in through GitHub or Google.
    pub link: Option<String>,
    /// The short form the QR code carries.
    pub short: Option<String>,
    /// Addresses a phone might reach this machine at, best first.
    pub candidates: Vec<Candidate>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct Candidate {
    pub interface: String,
    pub address: String,
}

fn parse_link(stdout: &str) -> Result<HubLink, String> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('{'))
        .ok_or_else(|| "offdesk-hub link printed no JSON".to_string())?;
    serde_json::from_str(line).map_err(|e| format!("offdesk-hub link printed something else: {e}"))
}

pub fn read_link(base_url: Option<&str>) -> Result<HubLink, String> {
    let stdout = run(
        hub_command(&["link", "--json"], base_url)?,
        "offdesk-hub link",
    )?;
    parse_link(&stdout)
}

/// The sign-in link and the phone code's contents, from the hub on this
/// machine. Errors when there is no running hub here.
#[tauri::command]
pub async fn hub_link(base_url: Option<String>) -> Result<HubLink, String> {
    tauri::async_runtime::spawn_blocking(move || read_link(base_url.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Make this machine the hub: install the hub and node services, register
/// this machine, and return the link. `base_url` is the address the person
/// picked for their phone; none means the hub's own pick.
#[tauri::command]
pub async fn hub_install(base_url: Option<String>) -> Result<HubLink, String> {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return Err("the hub runs on macOS and Linux; on Windows this app is a client".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        run(
            hub_command(&["service", "install"], base_url.as_deref())?,
            "offdesk-hub service install",
        )?;
        read_link(base_url.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop being the hub: remove both services. The database and the tmux
/// sessions are left where they are.
#[tauri::command]
pub async fn hub_uninstall() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (hub, dir) = hub_binary()?;
        let node = hub.with_file_name("offdesk-node");
        if node.is_file() {
            let mut command = Command::new(node);
            command.args(["service", "uninstall"]);
            let _ = run(command, "offdesk-node service uninstall");
        }
        let mut command = Command::new(hub);
        command.args(["service", "uninstall"]).env(
            "PATH",
            prepend_path(dir.as_deref(), std::env::var("PATH").ok().as_deref()),
        );
        run(command, "offdesk-hub service uninstall").map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sidecar_directory_leads_the_path() {
        assert_eq!(
            prepend_path(Some(Path::new("/app/MacOS")), Some("/usr/bin:/bin")),
            "/app/MacOS:/usr/bin:/bin"
        );
        assert_eq!(
            prepend_path(Some(Path::new("/app/MacOS")), Some("")),
            "/app/MacOS"
        );
        assert_eq!(prepend_path(None, Some("/usr/bin")), "/usr/bin");
    }

    #[test]
    fn the_hub_is_told_not_to_open_a_browser_in_words_clap_accepts() {
        let Ok(command) = hub_command(&["link", "--json"], Some("http://10.0.0.5:4317")) else {
            return; // no hub on this machine; nothing to inspect
        };
        let envs: Vec<(String, String)> = command
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().into_owned(), v?.to_string_lossy().into_owned())))
            .collect();
        assert!(envs.contains(&("OFFDESK_NO_OPEN".into(), "true".into())), "{envs:?}");
        assert!(envs.contains(&("OFFDESK_BASE_URL".into(), "http://10.0.0.5:4317".into())), "{envs:?}");
    }

    #[test]
    fn the_link_is_read_off_the_json_line() {
        let printed = "\n{\"url\":\"http://192.168.1.10:4317\",\"link\":\"http://192.168.1.10:4317/?token=abc\",\"short\":\"http://192.168.1.10:4317/?code=XYZ\",\"candidates\":[{\"interface\":\"en0\",\"address\":\"192.168.1.10\"}]}\n";
        let link = parse_link(printed).unwrap();
        assert_eq!(link.url, "http://192.168.1.10:4317");
        assert_eq!(
            link.link.as_deref(),
            Some("http://192.168.1.10:4317/?token=abc")
        );
        assert_eq!(
            link.candidates,
            vec![Candidate {
                interface: "en0".into(),
                address: "192.168.1.10".into()
            }]
        );
    }

    #[test]
    fn an_oauth_hub_has_no_link_and_that_is_not_an_error() {
        let link = parse_link(
            "{\"url\":\"https://hub.example.dev\",\"link\":null,\"short\":null,\"candidates\":[]}",
        )
        .unwrap();
        assert_eq!(link.link, None);
    }

    #[test]
    fn no_json_is_an_error_with_a_reason() {
        assert!(parse_link("Nothing is listening on 0.0.0.0:4317.")
            .unwrap_err()
            .contains("no JSON"));
    }

    #[test]
    fn the_service_files_are_where_each_platform_keeps_them() {
        let (hub, node) = service_files(Path::new("/home/me"));
        if cfg!(target_os = "macos") {
            assert!(hub.ends_with("Library/LaunchAgents/dev.offdesk.hub.plist"));
            assert!(node.ends_with("Library/LaunchAgents/dev.offdesk.node.plist"));
        } else {
            assert!(hub.ends_with(".config/systemd/user/offdesk-hub.service"));
            assert!(node.ends_with(".config/systemd/user/offdesk-node.service"));
        }
    }
}

#[cfg(all(test, debug_assertions))]
mod dev_tests {
    #[test]
    fn a_dev_build_finds_the_hub_this_checkout_built() {
        let (binary, dir) = super::hub_binary().expect("a hub");
        eprintln!("hub_binary -> {} (dir {:?})", binary.display(), dir);
        assert!(binary.to_string_lossy().contains("/target/"), "{}", binary.display());
    }
}
