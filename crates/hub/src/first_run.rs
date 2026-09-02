//! Getting into a hub that has no OAuth app behind it.
//!
//! A hub someone starts on their own machine has no GitHub or Google
//! credentials, and therefore no way to sign in at all — the alternative on
//! offer was `OFFDESK_DEV_MODE=true`, which signs in anyone who opens the URL
//! and is not something to put in front of a shell on your machines.
//!
//! So the hub prints a link with a signed session in it, the way jupyter and
//! syncthing do. The frontend already reads `?token=`, stores it and strips it
//! from the address bar, so this is the existing session mechanism handed over
//! on the terminal rather than a second way to authenticate.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};

use crate::db::{self, DbPool};

/// Where the database lives when nobody said. The offdesk config directory
/// is where the agent and the CLI keep theirs, so one place holds all of it,
/// and starting the hub from a different shell does not start a different
/// hub. A `./offdesk.db` in the current directory is honoured first: that was
/// the old default, and silently abandoning it would look like data loss.
pub fn database_path(configured: Option<&str>) -> String {
    if let Some(path) = configured.map(str::trim).filter(|p| !p.is_empty()) {
        return path.to_string();
    }
    let legacy = Path::new("offdesk.db");
    if legacy.exists() {
        tracing::info!("using ./offdesk.db from the current directory (pass --database to move it)");
        return legacy.display().to_string();
    }
    let dir = offdesk_protocol::config_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir.join("hub.db").display().to_string()
}

const LOCAL_PROVIDER: &str = "local";
const LOCAL_PROVIDER_ID: &str = "owner";

/// The signing key, kept next to the database so sessions — and any link
/// printed by an earlier run — survive a restart.
///
/// Returns the key and whether it was generated now, because a hub that just
/// invented its own secret is a hub nobody has ever signed into.
pub fn jwt_secret(database_path: &str) -> (String, bool) {
    if let Ok(configured) = std::env::var("JWT_SECRET") {
        if !configured.trim().is_empty() {
            return (configured, false);
        }
    }

    let path = secret_path(database_path);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return (existing, false);
        }
    }

    let secret = generate_secret();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, &secret) {
        Ok(()) => {
            restrict(&path);
            tracing::info!("generated a signing key at {}", path.display());
        }
        Err(error) => tracing::warn!(
            "could not write {} ({error}); sessions will not survive a restart",
            path.display()
        ),
    }
    (secret, true)
}

fn secret_path(database_path: &str) -> PathBuf {
    let db = Path::new(database_path);
    let dir = db.parent().filter(|p| !p.as_os_str().is_empty());
    match dir {
        Some(dir) => dir.join("jwt_secret"),
        None => PathBuf::from("jwt_secret"),
    }
}

#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &Path) {}

fn generate_secret() -> String {
    // uuid is already in the tree and its v4 is backed by getrandom, so two of
    // them is 256 bits of the same entropy a dedicated dependency would give.
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// The owner's session, created on demand. Returns `None` if the hub already
/// has users signed in through a provider — then this is somebody else's hub
/// and it is not this code's business to mint a session on it.
pub fn owner_session(pool: &DbPool, jwt_secret: &str) -> Option<String> {
    let conn = pool.get().ok()?;

    let user = match db::users::find_user_by_provider(&conn, LOCAL_PROVIDER, LOCAL_PROVIDER_ID) {
        Ok(Some(user)) => user,
        Ok(None) => {
            if db::users::count_users(&conn).unwrap_or(0) > 0 {
                return None;
            }
            let id = uuid::Uuid::new_v4().to_string();
            db::users::create_user(
                &conn,
                &id,
                LOCAL_PROVIDER,
                LOCAL_PROVIDER_ID,
                "owner",
                None,
                "admin",
            )
            .ok()?
        }
        Err(_) => return None,
    };

    Some(crate::auth::sign_jwt(&user.id, jwt_secret))
}

/// The address to hand someone, preferring what they configured, then the LAN
/// address a phone could actually use, and only then loopback.
pub fn reachable_base_url(base_url: &str, listen: &str) -> String {
    if std::env::var("OFFDESK_BASE_URL").is_ok_and(|value| !value.trim().is_empty()) {
        return base_url.trim_end_matches('/').to_string();
    }

    let port = listen
        .rsplit(':')
        .next()
        .and_then(|port| port.parse::<u16>().ok())
        .unwrap_or(4317);

    let bound_to_everything = listen.starts_with("0.0.0.0") || listen.starts_with("[::]");
    let host = if bound_to_everything {
        lan_address().map(|ip| ip.to_string())
    } else {
        listen.rsplit_once(':').map(|(host, _)| host.to_string())
    };

    format!("http://{}:{port}", host.unwrap_or_else(|| "localhost".into()))
}

/// The address a phone on this network can reach this machine at.
///
/// The obvious answer — the interface the default route leaves by — is wrong
/// on any machine running a VPN or a proxy in TUN mode: the default route
/// then goes through a virtual interface whose address (Clash and Surge use
/// 198.18.0.1, Tailscale 100.x) a phone on the Wi-Fi cannot reach, and a
/// browser on the machine itself is sent through the proxy, which answers
/// 502. So the interfaces are listed and a private address on a physical one
/// wins; the route only breaks ties, or stands in when there is no LAN at
/// all.
fn lan_address() -> Option<IpAddr> {
    pick_lan_address(interface_addresses(), route_address()).map(IpAddr::V4)
}

fn pick_lan_address(
    mut interfaces: Vec<(String, Ipv4Addr)>,
    route: Option<Ipv4Addr>,
) -> Option<Ipv4Addr> {
    // en0 before en5, eth0 before eth1: the first physical interface is the
    // one a laptop is usually on.
    interfaces.sort_by(|a, b| a.0.cmp(&b.0));
    let on_the_lan = |(name, ip): &(String, Ipv4Addr)| ip.is_private() && !is_virtual(name);

    if let Some(route) = route {
        if interfaces.iter().any(|c| c.1 == route && on_the_lan(c)) {
            return Some(route);
        }
    }
    if let Some((_, ip)) = interfaces.iter().find(|c| on_the_lan(c)) {
        return Some(*ip);
    }
    // No LAN. A tailnet address is still one a phone on the tailnet reaches;
    // a fake-IP gateway never is.
    if let Some(route) = route {
        if !route.is_loopback() && !route.is_link_local() && !is_benchmark_range(route) {
            return Some(route);
        }
    }
    interfaces
        .iter()
        .find(|(name, ip)| ip.is_private() && !name.starts_with("lo"))
        .map(|c| c.1)
}

/// Interfaces that do not lead to the Wi-Fi: tunnels, VM and container
/// bridges, Apple's peer-to-peer links.
fn is_virtual(name: &str) -> bool {
    [
        "lo", "utun", "tun", "tap", "wg", "tailscale", "docker", "br-", "bridge", "vmnet",
        "veth", "virbr", "awdl", "llw",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}

/// 198.18.0.0/15, reserved for benchmarking (RFC 2544) and therefore what
/// fake-IP proxies hand out; nothing on a real network answers there.
fn is_benchmark_range(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
}

/// The source address of the default route. No packet is sent: connecting a
/// UDP socket only asks the routing table which interface would be used.
fn route_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(SocketAddr::from(([1, 1, 1, 1], 80))).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

/// Every up interface's IPv4 address, by name.
#[cfg(unix)]
fn interface_addresses() -> Vec<(String, Ipv4Addr)> {
    use std::ffi::CStr;

    let mut found = Vec::new();
    let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills `list` with a linked list it owns. The list is
    // walked read-only, every pointer is null-checked before it is
    // dereferenced, and freeifaddrs releases it before returning.
    unsafe {
        if libc::getifaddrs(&mut list) != 0 {
            return found;
        }
        let mut cursor = list;
        while !cursor.is_null() {
            let entry = &*cursor;
            let is_up = entry.ifa_flags & (libc::IFF_UP as u32) != 0;
            if is_up
                && !entry.ifa_addr.is_null()
                && i32::from((*entry.ifa_addr).sa_family) == libc::AF_INET
            {
                let address = &*(entry.ifa_addr as *const libc::sockaddr_in);
                let ip = Ipv4Addr::from(u32::from_be(address.sin_addr.s_addr));
                let name = CStr::from_ptr(entry.ifa_name).to_string_lossy().into_owned();
                found.push((name, ip));
            }
            cursor = entry.ifa_next;
        }
        libc::freeifaddrs(list);
    }
    found
}

#[cfg(not(unix))]
fn interface_addresses() -> Vec<(String, Ipv4Addr)> {
    Vec::new()
}

/// Whether to open the sign-in link in a browser, which is only right when a
/// person is sitting at this machine watching this terminal. Not when output
/// is a file — that is the service, and it would pop a browser at every
/// login. Not over SSH — `open` would put a window on the far machine's
/// screen, not the one in front of the person. Not on a Linux box with no
/// display to open anything in.
pub fn should_open_browser(no_open: bool) -> bool {
    use std::io::IsTerminal;

    if no_open || !std::io::stdout().is_terminal() {
        return false;
    }
    if std::env::var_os("SSH_CONNECTION").is_some() || std::env::var_os("SSH_TTY").is_some() {
        return false;
    }
    if cfg!(target_os = "macos") {
        return true;
    }
    std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Best effort; the link is printed regardless, so a browser that does not
/// open is an inconvenience rather than a dead end.
pub fn open_in_browser(url: &str) {
    let (program, args): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("open", &[])
    } else {
        ("xdg-open", &[])
    };
    let result = std::process::Command::new(program)
        .args(args)
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Err(error) = result {
        tracing::debug!("could not open a browser with {program}: {error}");
    }
}

/// The sign-in link on its own, for opening; `sign_in_notice` prints it.
pub fn sign_in_link(pool: &DbPool, jwt_secret: &str, base_url: &str, listen: &str) -> Option<String> {
    let token = owner_session(pool, jwt_secret)?;
    Some(format!("{}/?token={token}", reachable_base_url(base_url, listen)))
}

/// What to print on startup. `None` when the hub has a way in already.
pub fn sign_in_notice(
    pool: &DbPool,
    jwt_secret: &str,
    base_url: &str,
    listen: &str,
    database_path: &str,
    has_oauth: bool,
    dev_mode: bool,
) -> Option<String> {
    if has_oauth || dev_mode {
        return None;
    }
    let link = sign_in_link(pool, jwt_secret, base_url, listen)?;
    let url = reachable_base_url(base_url, listen);
    let data_dir = Path::new(database_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| ".".into());

    Some(format!(
        "\n  offdesk is running at {url}\n  \
         data: {data_dir}\n\
         \n  Open this to sign in:\n\
         \n    {link}\n\
         \n  It signs you in as this hub's owner. Anyone who has the link can do\n  \
         the same, so keep it off shared terminals. Configure GitHub or Google\n  \
         sign-in to stop printing it — see docs/setup-public.md.\n\
         \n  This hub stops when this terminal does. To run it at login instead:\n\
         \n    offdesk-hub service install\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_database_path_is_used_verbatim() {
        assert_eq!(database_path(Some("/srv/hub.db")), "/srv/hub.db");
        assert_eq!(database_path(Some("  ")), database_path(None));
    }

    #[test]
    fn the_default_lives_in_the_config_directory() {
        let path = database_path(None);
        assert!(path.ends_with("hub.db") || path == "offdesk.db", "{path}");
    }

    #[test]
    fn a_configured_secret_is_never_replaced() {
        std::env::set_var("JWT_SECRET", "configured");
        let (secret, generated) = jwt_secret("/tmp/whatever.db");
        assert_eq!(secret, "configured");
        assert!(!generated);
        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    fn the_secret_sits_beside_the_database() {
        assert_eq!(
            secret_path("/app/data/offdesk.db"),
            PathBuf::from("/app/data/jwt_secret")
        );
        assert_eq!(secret_path("offdesk.db"), PathBuf::from("jwt_secret"));
    }

    #[test]
    fn a_generated_secret_is_long_enough_to_be_one() {
        let secret = generate_secret();
        assert_eq!(secret.len(), 64);
        assert_ne!(secret, generate_secret());
    }

    // One test for both: they set and clear the same environment variable,
    // and the test harness runs tests in parallel.
    #[test]
    fn an_explicit_base_url_wins_and_a_specific_bind_address_is_used_as_given() {
        std::env::set_var("OFFDESK_BASE_URL", "https://offdesk.example.com/");
        assert_eq!(
            reachable_base_url("https://offdesk.example.com/", "0.0.0.0:4317"),
            "https://offdesk.example.com"
        );
        std::env::remove_var("OFFDESK_BASE_URL");
        assert_eq!(
            reachable_base_url("http://localhost:4317", "127.0.0.1:4319"),
            "http://127.0.0.1:4319"
        );
    }

    #[test]
    fn a_proxy_tunnel_never_becomes_the_address() {
        let interfaces = vec![
            ("utun4".to_string(), Ipv4Addr::new(198, 18, 0, 1)),
            ("bridge100".to_string(), Ipv4Addr::new(192, 168, 64, 1)),
            ("en0".to_string(), Ipv4Addr::new(192, 168, 1, 23)),
            ("lo0".to_string(), Ipv4Addr::LOCALHOST),
        ];
        assert_eq!(
            pick_lan_address(interfaces, Some(Ipv4Addr::new(198, 18, 0, 1))),
            Some(Ipv4Addr::new(192, 168, 1, 23))
        );
    }

    #[test]
    fn the_route_wins_when_it_is_on_the_lan() {
        let interfaces = vec![
            ("en0".to_string(), Ipv4Addr::new(192, 168, 1, 23)),
            ("en5".to_string(), Ipv4Addr::new(10, 0, 0, 5)),
        ];
        assert_eq!(
            pick_lan_address(interfaces, Some(Ipv4Addr::new(10, 0, 0, 5))),
            Some(Ipv4Addr::new(10, 0, 0, 5))
        );
    }

    #[test]
    fn a_tailnet_is_kept_when_there_is_no_lan() {
        let interfaces = vec![("utun3".to_string(), Ipv4Addr::new(100, 100, 1, 2))];
        assert_eq!(
            pick_lan_address(interfaces, Some(Ipv4Addr::new(100, 100, 1, 2))),
            Some(Ipv4Addr::new(100, 100, 1, 2))
        );
    }

    #[test]
    fn a_fake_ip_gateway_is_never_kept() {
        let interfaces = vec![("utun4".to_string(), Ipv4Addr::new(198, 18, 0, 1))];
        assert_eq!(pick_lan_address(interfaces, Some(Ipv4Addr::new(198, 18, 0, 1))), None);
    }

    #[test]
    fn a_vm_bridge_is_the_last_resort() {
        let interfaces = vec![("bridge100".to_string(), Ipv4Addr::new(192, 168, 64, 1))];
        assert_eq!(
            pick_lan_address(interfaces, None),
            Some(Ipv4Addr::new(192, 168, 64, 1))
        );
    }

    #[test]
    fn this_machine_lists_its_interfaces() {
        assert!(interface_addresses().iter().any(|(_, ip)| ip.is_loopback()));
    }

    #[test]
    fn a_browser_is_never_opened_when_asked_not_to() {
        assert!(!should_open_browser(true));
    }

    #[test]
    fn a_browser_is_never_opened_over_ssh() {
        std::env::set_var("SSH_CONNECTION", "1.2.3.4 22 5.6.7.8 22");
        assert!(!should_open_browser(false));
        std::env::remove_var("SSH_CONNECTION");
    }

    #[test]
    fn oauth_or_dev_mode_means_no_notice() {
        let pool = crate::db::create_pool(":memory:").unwrap();
        assert!(sign_in_notice(&pool, "s", "b", "0.0.0.0:4317", "x.db", true, false).is_none());
        assert!(sign_in_notice(&pool, "s", "b", "0.0.0.0:4317", "x.db", false, true).is_none());
    }
}
