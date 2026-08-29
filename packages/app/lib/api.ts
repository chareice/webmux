import type {
  User,
  BrowserStateSnapshot,
  MachineInfo,
  TerminalInfo,
  DirEntry,
  Bookmark,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutNode,
  ResourceStats,
  AgentKind,
  AgentEvent,
  AgentSessionInfo,
} from "@webmux/shared";

import { generateDeviceId } from "./deviceIdShared";

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

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// Auth
export const getMe = () => request<User>("GET", "/api/auth/me");
export const devLogin = () =>
  request<{ token: string }>("GET", "/api/auth/dev");

// API Tokens
export interface ApiToken {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}
export interface CreatedApiToken {
  id: string;
  name: string;
  token: string;
  created_at: number;
}
export const listApiTokens = () =>
  request<ApiToken[]>("GET", "/api/auth/api-tokens");
export const createApiToken = (name: string) =>
  request<CreatedApiToken>("POST", "/api/auth/api-tokens", { name });
export const deleteApiToken = (id: string) =>
  request<void>("DELETE", `/api/auth/api-tokens/${id}`);

// Machines
export const listMachines = () =>
  request<MachineInfo[]>("GET", "/api/machines");
export const getBootstrap = () =>
  request<BrowserStateSnapshot>("GET", "/api/bootstrap");
export const putFocus = (terminalId: string, machineId: string) =>
  request<void>("PUT", "/api/focus", {
    terminal_id: terminalId,
    machine_id: machineId,
  });

// Terminals
export const listTerminals = () =>
  request<TerminalInfo[]>("GET", "/api/terminals");
export const createTerminal = (
  machineId: string,
  cwd: string,
  deviceId?: string,
  startupCommand?: string,
  cols?: number,
  rows?: number,
  workspaceGroupId?: string | null,
) =>
  request<TerminalInfo>("POST", `/api/machines/${machineId}/terminals`, {
    cwd,
    device_id: deviceId,
    ...(startupCommand ? { startup_command: startupCommand } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(rows !== undefined ? { rows } : {}),
    ...(workspaceGroupId ? { workspace_group_id: workspaceGroupId } : {}),
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

// Workspace tabs
export const listWorkspaceGroups = (machineId: string) =>
  request<WorkspaceGroupInfo[]>(
    "GET",
    `/api/machines/${machineId}/workspace-groups`,
  );
export const createWorkspaceGroup = (machineId: string, name: string) =>
  request<WorkspaceGroupInfo>(
    "POST",
    `/api/machines/${machineId}/workspace-groups`,
    { name },
  );
export const reorderWorkspaceGroups = (machineId: string, groupIds: string[]) =>
  request<WorkspaceGroupInfo[]>(
    "PUT",
    `/api/machines/${machineId}/workspace-groups/order`,
    { group_ids: groupIds },
  );
export const deleteWorkspaceGroup = (machineId: string, groupId: string) =>
  request<void>(
    "DELETE",
    `/api/machines/${machineId}/workspace-groups/${groupId}`,
  );
export const renameWorkspaceGroup = (
  machineId: string,
  groupId: string,
  name: string,
) =>
  request<WorkspaceGroupInfo>(
    "PATCH",
    `/api/machines/${machineId}/workspace-groups/${groupId}`,
    { name },
  );
export const assignTerminalWorkspaceGroup = (
  machineId: string,
  terminalId: string,
  workspaceGroupId: string | null,
) =>
  request<TerminalInfo>(
    "PUT",
    `/api/machines/${machineId}/terminals/${terminalId}/workspace-group`,
    { workspace_group_id: workspaceGroupId },
  );
export const saveWorkspaceLayout = (
  machineId: string,
  groupKey: string,
  root: WorkspaceLayoutNode | null,
  baseUpdatedAt: number | null,
) =>
  request<WorkspaceLayoutInfo>(
    "PUT",
    `/api/machines/${machineId}/workspace-layouts`,
    {
      group_key: groupKey,
      root,
      base_updated_at: baseUpdatedAt ?? -1,
    },
  );

// Registration
export const createRegistrationToken = (name: string) =>
  request<{ token: string; expires_at: number }>("POST", "/api/machines/register-token", { name });

// Device ID
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('tc-device-id');
  if (!id) {
    id = generateDeviceId();
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
export function releaseControlKeepalive(
  machineId: string,
  deviceId: string,
): void {
  if (!_token) {
    return;
  }

  const body = JSON.stringify({
    machine_id: machineId,
    device_id: deviceId,
  });
  const url =
    `${_baseUrl}/api/mode/release-beacon?token=${encodeURIComponent(_token)}`;
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const queued = navigator.sendBeacon(
      url,
      new Blob([body], { type: "application/json" }),
    );
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
export const getMachineStats = (machineId: string) =>
  request<ResourceStats>("GET", `/api/machines/${machineId}/stats`);

// Agent Sessions
export interface AgentSessionEventsPage {
  events: { seq: number; event: AgentEvent }[];
  last_seq: number;
}
export const createAgentSession = (
  machineId: string,
  args: {
    agentKind: AgentKind;
    cwd: string;
    autoRun?: boolean;
    workspaceGroupId?: string | null;
  },
  deviceId?: string,
) =>
  request<AgentSessionInfo>(
    "POST",
    `/api/machines/${machineId}/agent-sessions`,
    {
      agent_kind: args.agentKind,
      cwd: args.cwd,
      device_id: deviceId,
      // Omit auto_run when unset so the hub default (!machine.production) applies.
      ...(args.autoRun !== undefined ? { auto_run: args.autoRun } : {}),
      ...(args.workspaceGroupId
        ? { workspace_group_id: args.workspaceGroupId }
        : {}),
    },
  );
export const promptAgentSession = (
  machineId: string,
  sessionId: string,
  text: string,
  deviceId?: string,
) =>
  request<void>(
    "POST",
    `/api/machines/${machineId}/agent-sessions/${sessionId}/prompt`,
    { text, device_id: deviceId },
  );
export const answerAgentSession = (
  machineId: string,
  sessionId: string,
  args: { requestId: string; optionId?: string; text?: string },
  deviceId?: string,
) =>
  request<void>(
    "POST",
    `/api/machines/${machineId}/agent-sessions/${sessionId}/answer`,
    {
      request_id: args.requestId,
      option_id: args.optionId,
      text: args.text,
      device_id: deviceId,
    },
  );
export const cancelAgentSession = (
  machineId: string,
  sessionId: string,
  deviceId?: string,
) =>
  request<void>(
    "POST",
    `/api/machines/${machineId}/agent-sessions/${sessionId}/cancel${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
  );
export const resumeAgentSession = (
  machineId: string,
  sessionId: string,
  deviceId?: string,
) =>
  request<AgentSessionInfo>(
    "POST",
    `/api/machines/${machineId}/agent-sessions/${sessionId}/resume${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
  );
export const destroyAgentSession = (
  machineId: string,
  sessionId: string,
  deviceId?: string,
) =>
  request<void>(
    "DELETE",
    `/api/machines/${machineId}/agent-sessions/${sessionId}${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
  );
export const getAgentSessionEvents = (
  machineId: string,
  sessionId: string,
  fromSeq: number,
  limit?: number,
) =>
  request<AgentSessionEventsPage>(
    "GET",
    `/api/machines/${machineId}/agent-sessions/${sessionId}/events?from_seq=${fromSeq}${limit !== undefined ? `&limit=${limit}` : ""}`,
  );
export const putAgentSessionSeen = (sessionId: string, lastSeenSeq: number) =>
  request<{ last_seen_seq: number }>(
    "PUT",
    `/api/agent-sessions/${sessionId}/seen`,
    { last_seen_seq: lastSeenSeq },
  );

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

export function terminalPreviewsWsUrl(deviceId?: string): string {
  const base = _baseUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (_token) params.set("token", _token);
  if (deviceId) params.set("device_id", deviceId);
  const qs = params.toString();
  return `${base}/ws/terminal-previews${qs ? '?' + qs : ''}`;
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
