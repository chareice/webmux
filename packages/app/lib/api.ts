import type {
  User,
  BrowserStateSnapshot,
  MachineInfo,
  TerminalInfo,
  DirEntry,
  Bookmark,
  ResourceStats,
} from "@webmux/shared";

let _baseUrl = "";
let _token: string | null = null;

export function configure(baseUrl: string, token: string | null) {
  _baseUrl = baseUrl;
  _token = token;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

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
export const getMe = () => request<User>("GET", "/api/auth/me");
export const devLogin = () =>
  request<{ token: string }>("GET", "/api/auth/dev");

// Machines
export const listMachines = () =>
  request<MachineInfo[]>("GET", "/api/machines");
export const getBootstrap = () =>
  request<BrowserStateSnapshot>("GET", "/api/bootstrap");

// Terminals
export const listTerminals = () =>
  request<TerminalInfo[]>("GET", "/api/terminals");
export const createTerminal = (
  machineId: string,
  cwd: string,
  deviceId?: string,
) =>
  request<TerminalInfo>("POST", `/api/machines/${machineId}/terminals`, {
    cwd,
    device_id: deviceId,
  });
export const destroyTerminal = (
  machineId: string,
  terminalId: string,
  deviceId?: string,
) =>
  request<void>(
    "DELETE",
    `/api/machines/${machineId}/terminals/${terminalId}${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
  );
export const checkForegroundProcess = (
  machineId: string,
  terminalId: string,
) =>
  request<{ has_foreground_process: boolean; process_name: string | null }>(
    "GET",
    `/api/machines/${machineId}/terminals/${terminalId}/foreground-process`,
  );

// Directory
export const listDirectory = (machineId: string, path: string) =>
  request<DirEntry[]>(
    "GET",
    `/api/machines/${machineId}/fs/list?path=${encodeURIComponent(path)}`,
  );

// Bookmarks
export const listBookmarks = (machineId: string) =>
  request<Bookmark[]>("GET", `/api/machines/${machineId}/bookmarks`);
export const createBookmark = (
  machineId: string,
  path: string,
  label: string,
) =>
  request<Bookmark>("POST", `/api/machines/${machineId}/bookmarks`, {
    path,
    label,
  });
export const deleteBookmark = (bookmarkId: string) =>
  request<void>("DELETE", `/api/bookmarks/${bookmarkId}`);

// Registration
export const createRegistrationToken = (name: string) =>
  request<{ token: string; expires_at: number }>("POST", "/api/machines/register-token", { name });

// Device ID
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('tc-device-id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('tc-device-id', id);
  }
  return id;
}

// Mode
export const getMode = (machineId: string) =>
  request<{ controller_device_id: string | null }>(
    "GET",
    `/api/mode?machine_id=${encodeURIComponent(machineId)}`,
  );
export const requestControl = (machineId: string, deviceId: string) =>
  request<{ controller_device_id: string | null }>("POST", "/api/mode/control", {
    machine_id: machineId,
    device_id: deviceId,
  });
export const releaseControl = (machineId: string, deviceId: string) =>
  request<{ controller_device_id: string | null }>("POST", "/api/mode/release", {
    machine_id: machineId,
    device_id: deviceId,
  });

// Machine Stats
export const getMachineStats = (machineId: string) =>
  request<ResourceStats>("GET", `/api/machines/${machineId}/stats`);

// Settings
export const getSettings = () =>
  request<{ settings: Record<string, string> }>("GET", "/api/settings");
export const updateSettings = (settings: Record<string, string>) =>
  request<{ settings: Record<string, string> }>("PUT", "/api/settings", { settings });

// WebSocket URLs
export function terminalWsUrl(
  machineId: string,
  terminalId: string,
  deviceId?: string,
): string {
  const base = _baseUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (_token) params.set("token", _token);
  if (deviceId) params.set("device_id", deviceId);
  const qs = params.toString();
  return `${base}/ws/terminal/${machineId}/${terminalId}${qs ? '?' + qs : ''}`;
}

export function eventsWsUrl(deviceId?: string, afterSeq?: number): string {
  const base = _baseUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (_token) params.set("token", _token);
  if (deviceId) params.set("device_id", deviceId);
  if (afterSeq && afterSeq > 0) params.set("after_seq", String(afterSeq));
  const qs = params.toString();
  return `${base}/ws/events${qs ? '?' + qs : ''}`;
}
