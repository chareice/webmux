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

// True when the page was served from the app's own bundled assets (or the dev
// server) rather than by a hub. The mobile app starts on a bundled screen and
// then navigates to whichever hub the user chose, so "am I in Tauri" and "do I
// know my hub" are different questions.
export function isBundledOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  return (
    protocol === "tauri:" ||
    hostname === "tauri.localhost" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
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
