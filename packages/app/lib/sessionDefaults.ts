// Remembered session-creation defaults, persisted in localStorage so "开会话"
// is one click instead of a four-decision form:
// - per-user last-used { agentKind, modelId, autoRun } (autoRun null = the
//   machine default, i.e. off on PROD machines)
// - per-machine last cwd (used to prefill the directory row)
// - per-agent-kind cache of last-seen available_models, so the create panel's
//   model dropdown has options even before any live session is selected
//
// Storage is injected (same pattern as viewOnlyLock) to stay testable under
// the node vitest environment.

import type { AgentKind, AgentModelInfo } from "@webmux/shared";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SessionDefaultKind = AgentKind | "terminal";

export interface SessionDefaults {
  agentKind: SessionDefaultKind;
  modelId: string | null;
  /** null = machine default (!production). */
  autoRun: boolean | null;
}

const SESSION_DEFAULTS_KEY = "webmux:session-defaults";
const LAST_CWD_PREFIX = "webmux:last-cwd:";
const MODEL_CACHE_KEY = "webmux:agent-models";

const KNOWN_KINDS: SessionDefaultKind[] = [
  "claude",
  "codex",
  "grok",
  "kimi",
  "terminal",
];

/** First-ever use falls back to kimi / agent default model / machine default. */
export const FALLBACK_SESSION_DEFAULTS: SessionDefaults = {
  agentKind: "kimi",
  modelId: null,
  autoRun: null,
};

export function readSessionDefaults(storage: KeyValueStorage): SessionDefaults {
  try {
    const raw = storage.getItem(SESSION_DEFAULTS_KEY);
    if (!raw) return FALLBACK_SESSION_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<SessionDefaults>;
    return {
      agentKind: KNOWN_KINDS.includes(parsed.agentKind as SessionDefaultKind)
        ? (parsed.agentKind as SessionDefaultKind)
        : FALLBACK_SESSION_DEFAULTS.agentKind,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : null,
      autoRun: typeof parsed.autoRun === "boolean" ? parsed.autoRun : null,
    };
  } catch {
    return FALLBACK_SESSION_DEFAULTS;
  }
}

export function writeSessionDefaults(
  storage: KeyValueStorage,
  defaults: SessionDefaults,
): void {
  try {
    storage.setItem(SESSION_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    /* ignore unavailable browser storage */
  }
}

export function readLastCwd(
  storage: KeyValueStorage,
  machineId: string,
): string | null {
  try {
    const value = storage.getItem(`${LAST_CWD_PREFIX}${machineId}`);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

export function writeLastCwd(
  storage: KeyValueStorage,
  machineId: string,
  cwd: string,
): void {
  try {
    storage.setItem(`${LAST_CWD_PREFIX}${machineId}`, cwd);
  } catch {
    /* ignore unavailable browser storage */
  }
}

function isModelList(value: unknown): value is AgentModelInfo[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as AgentModelInfo).model_id === "string" &&
        typeof (item as AgentModelInfo).name === "string",
    )
  );
}

export function readModelCache(
  storage: KeyValueStorage,
): Partial<Record<AgentKind, AgentModelInfo[]>> {
  try {
    const raw = storage.getItem(MODEL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<AgentKind, AgentModelInfo[]>> = {};
    for (const kind of ["claude", "codex", "grok", "kimi"] as AgentKind[]) {
      const value = parsed[kind];
      if (isModelList(value) && value.length > 0) out[kind] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Cache a session's advertised models for its agent kind. Empty lists mean
 * "unsupported" and never overwrite a known-good list. */
export function recordSessionModels(
  storage: KeyValueStorage,
  agentKind: AgentKind,
  availableModels: AgentModelInfo[] | undefined | null,
): void {
  if (!availableModels || availableModels.length === 0) return;
  try {
    const cache = readModelCache(storage);
    cache[agentKind] = availableModels;
    storage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore unavailable browser storage */
  }
}

/** Models for the dropdown: live sessions win, then the persisted cache. */
export function modelsForAgentKind(
  storage: KeyValueStorage,
  kind: AgentKind,
  sessions: { agent_kind: AgentKind; available_models?: AgentModelInfo[] | null }[],
): AgentModelInfo[] {
  // Newest sessions carry the freshest list; callers pass newest-first.
  for (const session of sessions) {
    if (
      session.agent_kind === kind &&
      session.available_models &&
      session.available_models.length > 0
    ) {
      return session.available_models;
    }
  }
  return readModelCache(storage)[kind] ?? [];
}
