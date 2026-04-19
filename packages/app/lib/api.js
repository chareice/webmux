import { generateDeviceId } from "./deviceIdShared";
let _baseUrl = "";
let _token = null;
export function configure(baseUrl, token) {
    _baseUrl = baseUrl;
    _token = token;
}
async function request(method, path, body) {
    const headers = {
        "Content-Type": "application/json",
    };
    if (_token)
        headers["Authorization"] = `Bearer ${_token}`;
    const url = `${_baseUrl}${path}`;
    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
}
// Auth
export const getMe = () => request("GET", "/api/auth/me");
export const devLogin = () => request("GET", "/api/auth/dev");
// Machines
export const listMachines = () => request("GET", "/api/machines");
export const getBootstrap = () => request("GET", "/api/bootstrap");
// Terminals
export const listTerminals = () => request("GET", "/api/terminals");
export const createTerminal = (machineId, cwd, deviceId, startupCommand) => request("POST", `/api/machines/${machineId}/terminals`, {
    cwd,
    device_id: deviceId,
    ...(startupCommand ? { startup_command: startupCommand } : {}),
});
export const destroyTerminal = (machineId, terminalId, deviceId) => request("DELETE", `/api/machines/${machineId}/terminals/${terminalId}${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`);
export const checkForegroundProcess = (machineId, terminalId) => request("GET", `/api/machines/${machineId}/terminals/${terminalId}/foreground-process`);
// Directory
export const listDirectory = (machineId, path) => request("GET", `/api/machines/${machineId}/fs/list?path=${encodeURIComponent(path)}`);
// Bookmarks
export const listBookmarks = (machineId) => request("GET", `/api/machines/${machineId}/bookmarks`);
export const createBookmark = (machineId, path, label) => request("POST", `/api/machines/${machineId}/bookmarks`, {
    path,
    label,
});
export const deleteBookmark = (bookmarkId) => request("DELETE", `/api/bookmarks/${bookmarkId}`);
// Registration
export const createRegistrationToken = (name) => request("POST", "/api/machines/register-token", { name });
// Device ID
export function getDeviceId() {
    if (typeof window === 'undefined')
        return '';
    let id = sessionStorage.getItem('tc-device-id');
    if (!id) {
        id = generateDeviceId();
        sessionStorage.setItem('tc-device-id', id);
    }
    return id;
}
// Mode
export const getMode = (machineId) => request("GET", `/api/mode?machine_id=${encodeURIComponent(machineId)}`);
export const requestControl = (machineId, deviceId) => request("POST", "/api/mode/control", {
    machine_id: machineId,
    device_id: deviceId,
});
export const releaseControl = (machineId, deviceId) => request("POST", "/api/mode/release", {
    machine_id: machineId,
    device_id: deviceId,
});
export function releaseControlKeepalive(machineId, deviceId) {
    if (!_token) {
        return;
    }
    const body = JSON.stringify({
        machine_id: machineId,
        device_id: deviceId,
    });
    const url = `${_baseUrl}/api/mode/release-beacon?token=${encodeURIComponent(_token)}`;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const queued = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (queued) {
            return;
        }
    }
    void fetch(url, {
        method: "POST",
        keepalive: true,
        headers: {
            "Content-Type": "application/json",
        },
        body,
    }).catch(() => {
        /* ignore unload races */
    });
}
// Machine Stats
export const getMachineStats = (machineId) => request("GET", `/api/machines/${machineId}/stats`);
// Settings
export const getSettings = () => request("GET", "/api/settings");
export const updateSettings = (settings) => request("PUT", "/api/settings", { settings });
// WebSocket URLs
export function terminalWsUrl(machineId, terminalId, deviceId) {
    const base = _baseUrl.replace(/^http/, "ws");
    const params = new URLSearchParams();
    if (_token)
        params.set("token", _token);
    if (deviceId)
        params.set("device_id", deviceId);
    const qs = params.toString();
    return `${base}/ws/terminal/${machineId}/${terminalId}${qs ? '?' + qs : ''}`;
}
export function eventsWsUrl(deviceId, afterSeq) {
    const base = _baseUrl.replace(/^http/, "ws");
    const params = new URLSearchParams();
    if (_token)
        params.set("token", _token);
    if (deviceId)
        params.set("device_id", deviceId);
    if (afterSeq && afterSeq > 0)
        params.set("after_seq", String(afterSeq));
    const qs = params.toString();
    return `${base}/ws/events${qs ? '?' + qs : ''}`;
}
