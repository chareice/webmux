use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;

/// Static mobile version configuration from environment variables.
#[derive(Debug, Clone, Default)]
pub struct MobileVersionConfig {
    pub latest_version: Option<String>,
    pub download_url: Option<String>,
    pub min_version: Option<String>,
}

/// Resolved mobile version info returned to clients.
#[derive(Debug, Clone)]
pub struct MobileVersionInfo {
    pub latest_version: Option<String>,
    pub download_url: Option<String>,
    pub min_version: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedVersion {
    latest_version: String,
    download_url: Option<String>,
    fetched_at: u64,
}

const CACHE_TTL_MS: u64 = 10 * 60 * 1000; // 10 minutes

/// A resolver that returns the latest mobile version info,
/// using env overrides first, then GitHub releases as fallback.
pub struct MobileVersionResolver {
    github_repo: Option<String>,
    static_config: MobileVersionConfig,
    cached: Arc<RwLock<Option<CachedVersion>>>,
    http_client: reqwest::Client,
}

impl MobileVersionResolver {
    pub fn new(
        github_repo: Option<String>,
        static_config: MobileVersionConfig,
    ) -> Self {
        Self {
            github_repo,
            static_config,
            cached: Arc::new(RwLock::new(None)),
            http_client: reqwest::Client::new(),
        }
    }

    pub async fn resolve(&self) -> MobileVersionInfo {
        // If manual override is set, use it directly
        if self.static_config.latest_version.is_some() {
            return MobileVersionInfo {
                latest_version: self.static_config.latest_version.clone(),
                download_url: self.static_config.download_url.clone(),
                min_version: self.static_config.min_version.clone(),
            };
        }

        // Try to fetch from GitHub
        if let Some(ref repo) = self.github_repo {
            let now = now_millis();
            let cache_expired = {
                let cached = self.cached.read().await;
                cached
                    .as_ref()
                    .map(|c| now - c.fetched_at > CACHE_TTL_MS)
                    .unwrap_or(true)
            };

            if cache_expired {
                if let Some(fresh) = fetch_latest_github_release(
                    &self.http_client,
                    repo,
                )
                .await
                {
                    let mut cached = self.cached.write().await;
                    *cached = Some(fresh);
                }
            }

            let cached = self.cached.read().await;
            if let Some(ref c) = *cached {
                return MobileVersionInfo {
                    latest_version: Some(c.latest_version.clone()),
                    download_url: self
                        .static_config
                        .download_url
                        .clone()
                        .or_else(|| c.download_url.clone()),
                    min_version: self.static_config.min_version.clone(),
                };
            }
        }

        // Fallback
        MobileVersionInfo {
            latest_version: None,
            download_url: None,
            min_version: self.static_config.min_version.clone(),
        }
    }
}

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

async fn fetch_latest_github_release(
    client: &reqwest::Client,
    repo: &str,
) -> Option<CachedVersion> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        repo
    );

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "webmux-server")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        warn!(
            "GitHub releases API returned status {} for {}",
            resp.status(),
            repo
        );
        return None;
    }

    let release: GitHubRelease = resp.json().await.ok()?;
    let version = parse_version_from_tag(&release.tag_name);
    let download_url = find_apk_asset_url(&release.assets);

    Some(CachedVersion {
        latest_version: version,
        download_url,
        fetched_at: now_millis(),
    })
}

fn parse_version_from_tag(tag: &str) -> String {
    tag.strip_prefix('v').unwrap_or(tag).to_string()
}

fn find_apk_asset_url(assets: &[GitHubAsset]) -> Option<String> {
    assets
        .iter()
        .find(|a| a.name.ends_with(".apk") && a.name.starts_with("webmux"))
        .map(|a| a.browser_download_url.clone())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
