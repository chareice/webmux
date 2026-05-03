export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

export interface AndroidUpdate {
  version: string;
  tagName: string;
  releaseUrl: string;
  apkName: string;
  apkUrl: string;
}

const APK_PREFERENCE = ["universal", "arm64-v8a", "armeabi-v7a", "x86_64"];

export function compareAppVersions(tagOrVersion: string, currentVersion: string): number {
  const next = parseVersion(tagOrVersion);
  const current = parseVersion(currentVersion);
  const length = Math.max(next.length, current.length);
  for (let index = 0; index < length; index++) {
    const diff = (next[index] ?? 0) - (current[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function findAndroidApkAsset(
  release: GitHubRelease,
): GitHubReleaseAsset | null {
  const apks = release.assets.filter((asset) => asset.name.endsWith(".apk"));
  for (const preferred of APK_PREFERENCE) {
    const match = apks.find((asset) => asset.name.includes(preferred));
    if (match) return match;
  }
  return apks[0] ?? null;
}

export function getNewerAndroidRelease(
  release: GitHubRelease,
  currentVersion: string,
): AndroidUpdate | null {
  if (!release.tag_name.startsWith("app-v")) return null;
  if (compareAppVersions(release.tag_name, currentVersion) <= 0) return null;

  const asset = findAndroidApkAsset(release);
  if (!asset) return null;

  return {
    version: release.tag_name.replace(/^app-v/, ""),
    tagName: release.tag_name,
    releaseUrl: release.html_url,
    apkName: asset.name,
    apkUrl: asset.browser_download_url,
  };
}

export function findLatestNewerAndroidRelease(
  releases: GitHubRelease[],
  currentVersion: string,
): AndroidUpdate | null {
  return (
    releases
      .map((release) => getNewerAndroidRelease(release, currentVersion))
      .filter((update): update is AndroidUpdate => update !== null)
      .sort((a, b) => compareAppVersions(b.tagName, a.tagName))[0] ?? null
  );
}

export async function fetchLatestAndroidUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AndroidUpdate | null> {
  const response = await fetchImpl(
    "https://api.github.com/repos/chareice/webmux/releases?per_page=20",
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Update check failed with HTTP ${response.status}`);
  }
  return findLatestNewerAndroidRelease(
    (await response.json()) as GitHubRelease[],
    currentVersion,
  );
}

function parseVersion(tagOrVersion: string): number[] {
  return tagOrVersion
    .replace(/^app-v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
