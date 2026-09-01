export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Detect whether the Tauri WebView is running on a mobile OS so we can
// take the same auth path the plain mobile-web flow uses, instead of the
// desktop loopback-OAuth path that needs `start_oauth_listener`.
export function isTauriMobile(): boolean {
  if (!isTauri()) return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua);
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
  macos: "offdesk.dmg",
  windows: "offdesk.msi",
  linux: "offdesk.AppImage",
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
