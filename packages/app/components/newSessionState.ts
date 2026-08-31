// Shared state for the new-session flows (desktop NewSessionDialog panel and
// the mobile NewSessionSheet bottom sheet): remembered-defaults seeding,
// agent/model/machine/cwd/auto-run selection, model options from live
// sessions + the persisted cache, recent-cwd rows, bookmark loading, and the
// submit path that persists the choices before calling onCreate. Extracted
// so both surfaces validate and prefill identically instead of drifting.

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentKind,
  AgentSessionInfo,
  Bookmark,
  MachineInfo,
  TerminalInfo,
} from "@offdesk/shared";
import { listBookmarks } from "@/lib/api";
import {
  modelsForAgentKind,
  readLastCwd,
  readSessionDefaults,
  writeLastCwd,
  writeSessionDefaults,
} from "@/lib/sessionDefaults";
import type { SessionKind } from "./AgentBadge.web";

export const NEW_SESSION_AGENT_KINDS: AgentKind[] = [
  "claude",
  "codex",
  "grok",
  "kimi",
];

export interface NewSessionRequest {
  kind: SessionKind;
  machineId: string;
  cwd: string;
  autoRun: boolean;
  /** null = agent default model (no model_id sent). */
  modelId: string | null;
}

export interface NewSessionStateInput {
  machines: MachineInfo[];
  /** machineId → online (has stats or a reachable terminal). */
  machineOnline: Record<string, boolean>;
  isControllerFor: (machineId: string) => boolean;
  /** Machine preselected when the surface opens (the active machine). */
  initialMachineId: string | null;
  initialCwd: string | null;
  /** Existing sessions/terminals feed the recent-cwd row and, for agent
   *  kinds, the model dropdown (newest sessions carry the freshest list). */
  agentSessions: AgentSessionInfo[];
  terminals: TerminalInfo[];
  onCreate: (request: NewSessionRequest) => void;
}

export function useNewSessionState({
  machines,
  machineOnline,
  isControllerFor,
  initialMachineId,
  initialCwd,
  agentSessions,
  terminals,
  onCreate,
}: NewSessionStateInput) {
  // Remembered defaults do the work: the remembered agent/model are
  // preselected, so submitting takes zero decisions.
  const [remembered] = useState(() => readSessionDefaults(window.localStorage));
  const [kind, setKind] = useState<SessionKind>(remembered.agentKind);
  const [modelId, setModelId] = useState<string | null>(remembered.modelId);
  const [machineId, setMachineId] = useState<string | null>(
    initialMachineId ?? machines[0]?.id ?? null,
  );
  const [cwd, setCwd] = useState(
    () =>
      (machineId && readLastCwd(window.localStorage, machineId)) ||
      initialCwd ||
      "",
  );
  const [autoRun, setAutoRun] = useState<boolean | null>(remembered.autoRun);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const machine = machines.find((item) => item.id === machineId) ?? null;
  const online = machineId !== null && (machineOnline[machineId] ?? false);
  const onlineMachines = machines.filter((item) => machineOnline[item.id]);
  const effectiveAutoRun = autoRun ?? !(machine?.production ?? false);
  const isAgent = kind !== "terminal";
  const canCreate =
    machineId !== null &&
    online &&
    cwd.trim() !== "" &&
    isControllerFor(machineId);

  const modelOptions = useMemo(
    () =>
      isAgent ? modelsForAgentKind(window.localStorage, kind, agentSessions) : [],
    [isAgent, kind, agentSessions],
  );

  // Recent cwds for the selected machine: newest agent sessions first, then
  // terminals, deduped; the current input value and bookmarked paths drop out
  // so nothing renders twice.
  const recentCwds = useMemo(() => {
    if (!machineId) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (value: string) => {
      if (value && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    };
    for (const session of [...agentSessions]
      .filter((session) => session.machine_id === machineId)
      .sort((a, b) => b.created_at_ms - a.created_at_ms)) {
      push(session.cwd);
    }
    for (const terminal of terminals) {
      if (terminal.machine_id === machineId) push(terminal.cwd);
    }
    return out.filter((value) => value !== cwd.trim()).slice(0, 5);
  }, [agentSessions, terminals, machineId, cwd]);

  const visibleBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => !recentCwds.includes(bookmark.path)),
    [bookmarks, recentCwds],
  );

  // Agent switch: the remembered model only makes sense for the remembered
  // agent; other kinds start on their default model.
  const selectKind = useCallback(
    (candidate: SessionKind) => {
      setKind(candidate);
      setModelId(candidate === remembered.agentKind ? remembered.modelId : null);
    },
    [remembered],
  );

  // Machine switch: re-seed the cwd from that machine's remembered/home
  // directory.
  const selectMachine = useCallback(
    (id: string) => {
      setMachineId(id);
      const target = machines.find((item) => item.id === id);
      setCwd(readLastCwd(window.localStorage, id) || target?.home_dir || "");
    },
    [machines],
  );

  useEffect(() => {
    if (!machineId) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    listBookmarks(machineId)
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch(() => {
        if (!cancelled) setBookmarks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const submit = useCallback(() => {
    if (!canCreate || machineId === null) return;
    const trimmedCwd = cwd.trim();
    // Remember the choices for the next create (and the instant-create ＋).
    writeSessionDefaults(window.localStorage, {
      agentKind: kind,
      modelId: isAgent ? modelId : remembered.modelId,
      autoRun: isAgent ? effectiveAutoRun : remembered.autoRun,
    });
    writeLastCwd(window.localStorage, machineId, trimmedCwd);
    onCreate({
      kind,
      machineId,
      cwd: trimmedCwd,
      autoRun: effectiveAutoRun,
      modelId: isAgent ? modelId : null,
    });
  }, [
    canCreate,
    machineId,
    cwd,
    kind,
    isAgent,
    modelId,
    effectiveAutoRun,
    remembered,
    onCreate,
  ]);

  return {
    kind,
    selectKind,
    modelId,
    setModelId,
    machineId,
    selectMachine,
    machine,
    onlineMachines,
    cwd,
    setCwd,
    effectiveAutoRun,
    setAutoRun,
    isAgent,
    canCreate,
    modelOptions,
    recentCwds,
    visibleBookmarks,
    submit,
  };
}
