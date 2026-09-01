//! Reading a hub address the way a person types it.
//!
//! Only used by the mobile app, but kept free of Tauri and of `cfg(mobile)`
//! so `cargo test` can reach it on any host.

use tauri::Url;

/// Accepts what someone would type into a phone. A bare host gets `https://`.
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
        format!("https://{trimmed}")
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
