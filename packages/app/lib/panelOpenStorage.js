export const PANEL_OPEN_KEY = "webmux:panel-open";
// Persists the workpath-panel open/closed state across reloads. Falls back
// to the caller-supplied default if storage is unavailable (Tauri WebView
// in some configs, private mode, throwing localStorage stub) or the value
// is malformed.
export function readPanelOpen(defaultValue) {
    try {
        const raw = (globalThis.localStorage ?? null)?.getItem(PANEL_OPEN_KEY);
        if (raw === "true")
            return true;
        if (raw === "false")
            return false;
        return defaultValue;
    }
    catch {
        return defaultValue;
    }
}
export function writePanelOpen(value) {
    try {
        globalThis.localStorage?.setItem(PANEL_OPEN_KEY, value ? "true" : "false");
    }
    catch {
        /* storage unavailable — silently drop */
    }
}
