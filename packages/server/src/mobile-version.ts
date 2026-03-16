import type { MobileVersionConfig } from './app.js'

interface GitHubRelease {
  tag_name: string
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

interface CachedVersion {
  latestVersion: string
  downloadUrl: string | undefined
  fetchedAt: number
}

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let cachedVersion: CachedVersion | null = null

function parseVersionFromTag(tag: string): string {
  // Strips leading 'v' from tag (e.g. "v1.2.3" → "1.2.3")
  return tag.replace(/^v/, '')
}

function findApkAssetUrl(assets: GitHubRelease['assets']): string | undefined {
  const apk = assets.find(
    (a) => a.name.endsWith('.apk') && a.name.startsWith('webmux'),
  )
  return apk?.browser_download_url
}

async function fetchLatestGitHubRelease(
  repo: string,
): Promise<CachedVersion | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'webmux-server',
        },
      },
    )

    if (!response.ok) {
      return null
    }

    const release = (await response.json()) as GitHubRelease
    const version = parseVersionFromTag(release.tag_name)
    const downloadUrl = findApkAssetUrl(release.assets)

    return {
      latestVersion: version,
      downloadUrl,
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * Create a resolver that returns the latest mobile version info.
 *
 * Priority:
 * 1. Manual override via env vars (latestVersion / downloadUrl in staticConfig)
 * 2. Cached GitHub release info (auto-fetched every 10 minutes)
 *
 * minVersion always comes from the static config (env var), since it's a policy
 * decision rather than something that can be auto-detected.
 */
export function createMobileVersionResolver(
  githubRepo: string | undefined,
  staticConfig: MobileVersionConfig | undefined,
) {
  return async (): Promise<{
    latestVersion: string | null
    downloadUrl: string | null
    minVersion: string | null
  }> => {
    // If manual override is set, use it directly
    if (staticConfig?.latestVersion) {
      return {
        latestVersion: staticConfig.latestVersion,
        downloadUrl: staticConfig.downloadUrl ?? null,
        minVersion: staticConfig.minVersion ?? null,
      }
    }

    // Try to fetch from GitHub
    if (githubRepo) {
      const now = Date.now()
      const cacheExpired =
        !cachedVersion || now - cachedVersion.fetchedAt > CACHE_TTL_MS

      if (cacheExpired) {
        const fresh = await fetchLatestGitHubRelease(githubRepo)
        if (fresh) {
          cachedVersion = fresh
        }
      }

      if (cachedVersion) {
        return {
          latestVersion: cachedVersion.latestVersion,
          downloadUrl: staticConfig?.downloadUrl ?? cachedVersion.downloadUrl ?? null,
          minVersion: staticConfig?.minVersion ?? null,
        }
      }
    }

    // Fallback
    return {
      latestVersion: null,
      downloadUrl: null,
      minVersion: staticConfig?.minVersion ?? null,
    }
  }
}
