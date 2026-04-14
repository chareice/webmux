export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type OS = "macos" | "windows" | "linux" | "unknown";

export function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

const DOWNLOAD_FILENAMES: Record<OS, string | null> = {
  macos: "webmux.dmg",
  windows: "webmux.msi",
  linux: "webmux.AppImage",
  unknown: null,
};

export function getDesktopDownloadUrl(
  repo: string,
  tag: string,
): string | null {
  const os = detectOS();
  const filename = DOWNLOAD_FILENAMES[os];
  if (!filename) return null;
  return `https://github.com/${repo}/releases/download/${tag}/${filename}`;
}

export function getDesktopReleasesUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest`;
}
