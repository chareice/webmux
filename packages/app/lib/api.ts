import type {
  User,
  MachineInfo,
  TerminalInfo,
  DirEntry,
  Bookmark,
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

// Terminals
export const listTerminals = () =>
  request<TerminalInfo[]>("GET", "/api/terminals");
export const createTerminal = (machineId: string, cwd: string) =>
  request<TerminalInfo>("POST", `/api/machines/${machineId}/terminals`, {
    cwd,
  });
export const destroyTerminal = (machineId: string, terminalId: string) =>
  request<void>(
    "DELETE",
    `/api/machines/${machineId}/terminals/${terminalId}`,
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

// WebSocket URLs
export function terminalWsUrl(
  machineId: string,
  terminalId: string,
): string {
  const base = _baseUrl.replace(/^http/, "ws");
  const params = _token ? `?token=${encodeURIComponent(_token)}` : "";
  return `${base}/ws/terminal/${machineId}/${terminalId}${params}`;
}

export function eventsWsUrl(): string {
  const base = _baseUrl.replace(/^http/, "ws");
  const params = _token ? `?token=${encodeURIComponent(_token)}` : "";
  return `${base}/ws/events${params}`;
}
