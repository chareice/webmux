use serde::Deserialize;
use std::os::unix::fs::PermissionsExt;
use tracing::debug;

const GITHUB_REPO: &str = "chareice/webmux";
const BINARY_NAME: &str = "webmux-node-linux-x64";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Parse a semver string "X.Y.Z" into a tuple, stripping a leading 'v' if present.
fn parse_semver(s: &str) -> Option<(u32, u32, u32)> {
    let s = s.trim_start_matches('v');
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}

/// Check for a newer release on GitHub.
///
/// Returns `Some((tag, download_url))` when a newer version is available,
/// `None` when already up-to-date.
pub async fn check_for_update() -> Result<Option<(String, String)>, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");

    let client = reqwest::Client::builder()
        .user_agent("webmux-node")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API returned status {}",
            resp.status()
        ));
    }

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {e}"))?;

    let current = parse_semver(CURRENT_VERSION)
        .ok_or_else(|| format!("Cannot parse current version: {CURRENT_VERSION}"))?;
    let latest = parse_semver(&release.tag_name)
        .ok_or_else(|| format!("Cannot parse release tag: {}", release.tag_name))?;

    debug!("Current version: {current:?}, latest: {latest:?}");

    if latest <= current {
        return Ok(None);
    }

    // Find the matching binary asset
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == BINARY_NAME)
        .ok_or_else(|| {
            format!(
                "Release {} has no asset named \"{BINARY_NAME}\"",
                release.tag_name
            )
        })?;

    Ok(Some((
        release.tag_name.clone(),
        asset.browser_download_url.clone(),
    )))
}

/// Download the binary from `download_url` and atomically replace the current executable.
pub async fn perform_update(download_url: &str, tag: &str) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Cannot determine current executable path: {e}"))?;

    let tmp_path = current_exe.with_extension("update-tmp");

    let client = reqwest::Client::builder()
        .user_agent("webmux-node")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Download returned status {}",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download body: {e}"))?;

    // Write to a temp file next to the current binary
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    // Set executable permissions
    std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Failed to set permissions: {e}"))?;

    // Atomic rename
    std::fs::rename(&tmp_path, &current_exe)
        .map_err(|e| format!("Failed to replace binary: {e}"))?;

    let version = tag.trim_start_matches('v');
    debug!("Successfully updated to {version}");
    Ok(())
}
