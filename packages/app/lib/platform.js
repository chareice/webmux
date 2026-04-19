export function isTauri() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac"))
        return "macos";
    if (ua.includes("win"))
        return "windows";
    if (ua.includes("linux"))
        return "linux";
    return "unknown";
}
const DOWNLOAD_FILENAMES = {
    macos: "webmux.dmg",
    windows: "webmux.msi",
    linux: "webmux.AppImage",
    unknown: null,
};
export function getDesktopDownloadUrl(repo, tag) {
    const os = detectOS();
    const filename = DOWNLOAD_FILENAMES[os];
    if (!filename)
        return null;
    return `https://github.com/${repo}/releases/download/${tag}/${filename}`;
}
export function getDesktopReleasesUrl(repo) {
    return `https://github.com/${repo}/releases/latest`;
}
