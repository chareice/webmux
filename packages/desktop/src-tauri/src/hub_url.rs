//! Reading a hub address the way a person types it.
//!
//! Only used by the mobile app, but kept free of Tauri and of `cfg(mobile)`
//! so `cargo test` can reach it on any host.

use tauri::Url;

/// Accepts what someone would type into a phone. A bare address gets a
/// scheme: `http` for a hub on this network, `https` for anything else.
pub fn parse(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter your hub's address".into());
    }
    // Test the scheme before touching the rest: trimming a trailing slash
    // first turns "https://" into the perfectly valid "https://https".
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        // Guessing https for `192.168.1.4:4317` fails on a TLS handshake that
        // was never going to happen: a hub at home is plain http, which is
        // what docs/setup-lan.md sets up. Parse once with a placeholder
        // scheme to see the host, then pick.
        let probe: Url = format!("http://{trimmed}")
            .parse()
            .map_err(|_| format!("`{input}` is not a URL"))?;
        let local = probe.host_str().is_some_and(is_local_address);
        format!("{}://{trimmed}", if local { "http" } else { "https" })
    };

    let url: Url = with_scheme
        .parse()
        .map_err(|_| format!("`{input}` is not a URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("`{input}` is not an http(s) URL"));
    }
    if url.host_str().is_none() {
        return Err(format!("`{input}` has no host"));
    }
    Ok(url)
}

/// Loopback, RFC1918, link-local, unique-local, and the `.local` / `.internal`
/// suffixes — where a self-hosted hub lives.
///
/// `offdesk_protocol::local_host` answers the same question for the CLI and
/// the machine agent. It is twenty lines and this crate is deliberately
/// outside that workspace, so the mobile app carries its own copy rather than
/// the protocol crate's whole dependency tree.
fn is_local_address(host: &str) -> bool {
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(v6) => {
                let first = v6.segments()[0];
                v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
            }
        };
    }
    let lower = host.to_ascii_lowercase();
    lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.ends_with(".internal")
}

/// `scheme://host[:port]`. Capabilities are granted per origin, so whatever
/// path the address carried is dropped here rather than silently widening or
/// narrowing what the hub is allowed to do.
pub fn origin(url: &Url) -> String {
    match url.port() {
        Some(port) => format!(
            "{}://{}:{port}",
            url.scheme(),
            url.host_str().unwrap_or_default()
        ),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_host_becomes_https() {
        assert_eq!(
            parse("offdesk.example.com").unwrap().as_str(),
            "https://offdesk.example.com/"
        );
    }

    #[test]
    fn a_bare_address_on_this_network_is_http() {
        for input in ["192.168.1.223:4317", "10.0.2.2:4317", "nas.local", "localhost:4317"] {
            let url = parse(input).unwrap();
            assert_eq!(url.scheme(), "http", "{input} should be http");
        }
    }

    #[test]
    fn an_explicit_scheme_still_wins_over_the_guess() {
        assert_eq!(parse("https://192.168.1.223:4317").unwrap().scheme(), "https");
        assert_eq!(parse("http://offdesk.example.com").unwrap().scheme(), "http");
    }

    #[test]
    fn an_explicit_scheme_is_kept() {
        assert_eq!(
            parse("http://10.0.2.2:4317").unwrap().as_str(),
            "http://10.0.2.2:4317/"
        );
    }

    #[test]
    fn trailing_slashes_and_spaces_are_ignored() {
        assert_eq!(
            parse("  https://hub.example.com/  ").unwrap().as_str(),
            "https://hub.example.com/"
        );
    }

    #[test]
    fn the_origin_drops_the_path_and_keeps_the_port() {
        assert_eq!(
            origin(&parse("https://example.com:8443/offdesk").unwrap()),
            "https://example.com:8443"
        );
    }

    #[test]
    fn the_origin_of_a_default_port_has_no_port() {
        assert_eq!(
            origin(&parse("https://example.com/").unwrap()),
            "https://example.com"
        );
    }

    #[test]
    fn junk_is_rejected() {
        for input in ["", "   ", "ftp://example.com", "https://"] {
            assert!(parse(input).is_err(), "{input} should be rejected");
        }
    }
}
