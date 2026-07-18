import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  TerminalInfo,
  Bookmark,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutMode,
  WorkspaceLayoutNode,
  WorkspaceScrollableLayout,
} from "@webmux/shared";
import { AppTitleBar } from "./AppTitleBar.web";
import { WorkbenchHeader } from "./WorkbenchHeader.web";
import { TerminalWorkspace } from "./TerminalWorkspace.web";
import { MobileWorkbench } from "./MobileWorkbench.web";
import { MachineOnboardingDialog } from "./OnboardingView.web";
import { Terminal as TerminalIcon } from "lucide-react";
import {
  createBookmark,
  createTerminal,
  destroyTerminal,
  checkForegroundProcess,
  createWorkspaceGroup,
  deleteWorkspaceGroup,
  assignTerminalWorkspaceGroup,
  eventsWsUrl,
  getBootstrap,
  listBookmarks,
  requestControl,
  reorderWorkspaceGroups,
  releaseControl,
  saveWorkspaceLayout,
} from "@/lib/api";
import {
  estimateInitialTerminalDimensions,
  estimateMobileInitialTerminalDimensions,
} from "@/lib/terminalViewModel";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
  shouldResyncForEnvelope,
} from "@/lib/bootstrapState";
import { getPersistentDeviceId } from "@/lib/deviceId";
import { colors } from "@/lib/colors";
import { useIsMobile, useVisualViewportHeight } from "@/lib/hooks";
import { isEditableShortcutTarget, type PrefixActionId } from "@/lib/prefixKey";
import { PrefixKeyProvider, usePrefixKey } from "@/lib/prefixKeyContext";
import { CheatSheetOverlay } from "./CheatSheetOverlay.web";
import {
  createInitialMainLayout,
  mainLayoutReducer,
} from "@/lib/mainLayoutReducer";
import {
  storePendingControlRelease,
  takePendingControlRelease,
} from "@/lib/unloadControlRelease";
import { TerminalPreviewMuxProvider } from "@/lib/terminalPreviewMuxReact";
import { createTerminalReconnectController } from "@/lib/terminalReconnect";

const OnboardingView = lazy(() =>
  import("./OnboardingView.web").then((module) => ({
    default: module.OnboardingView,
  })),
);
const StatusBar = lazy(() =>
  import("./StatusBar").then((module) => ({ default: module.StatusBar })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const ConfirmDialog = lazy(() =>
  import("./ConfirmDialog").then((module) => ({ default: module.ConfirmDialog })),
);

const STATUS_BAR_KEY = "webmux:show-status-bar";

// Prefix actions owned by TerminalCanvas (workspace-owned actions are
// registered by TerminalWorkspace).
const CANVAS_PREFIX_ACTIONS: PrefixActionId[] = [
  "newTerminal",
  "cheatSheet",
  "sessionSwitcher",
  "switchHost",
  "commandPalette",
  "copyMode",
];

interface CreateTerminalOptions {
  selectWorkpath?: boolean;
  workspaceGroupId?: string | null;
}

interface DestroyTerminalOptions {
  keepWorkspaceOpen?: boolean;
  afterAccepted?: () => void;
}

type DestroyTerminalRequestResult = "accepted" | "pending";

function useViewportWidth() {
  const [w, setW] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

function useStatusBarPref() {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STATUS_BAR_KEY) === "1";
  });
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STATUS_BAR_KEY) setVisible(e.newValue === "1");
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return visible;
}

function upsertTerminalInfo(
  terminals: TerminalInfo[],
  terminal: TerminalInfo,
): TerminalInfo[] {
  const index = terminals.findIndex((item) => item.id === terminal.id);
  if (index === -1) return [...terminals, terminal];
  const next = terminals.slice();
  next[index] = terminal;
  return next;
}

function upsertWorkspaceGroup(
  groups: WorkspaceGroupInfo[],
  group: WorkspaceGroupInfo,
): WorkspaceGroupInfo[] {
  const index = groups.findIndex((item) => item.id === group.id);
  const next =
    index === -1
      ? [...groups, group]
      : groups.map((item) => (item.id === group.id ? group : item));
  return next.sort(
    (a, b) =>
      a.machine_id.localeCompare(b.machine_id) ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name),
  );
}

function replaceMachineWorkspaceGroups(
  groups: WorkspaceGroupInfo[],
  machineId: string,
  nextGroups: WorkspaceGroupInfo[],
): WorkspaceGroupInfo[] {
  const otherGroups = groups.filter((group) => group.machine_id !== machineId);
  return [...otherGroups, ...nextGroups].sort(
    (a, b) =>
      a.machine_id.localeCompare(b.machine_id) ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name),
  );
}

function upsertWorkspaceLayoutInfo(
  layouts: WorkspaceLayoutInfo[],
  layout: WorkspaceLayoutInfo,
): WorkspaceLayoutInfo[] {
  const index = layouts.findIndex(
    (item) =>
      item.machine_id === layout.machine_id && item.group_key === layout.group_key,
  );
  const next =
    index === -1
      ? [...layouts, layout]
      : layouts.map((item) =>
          item.machine_id === layout.machine_id &&
          item.group_key === layout.group_key
            ? layout
            : item,
        );
  return next.sort(
    (a, b) =>
      a.machine_id.localeCompare(b.machine_id) ||
      a.group_key.localeCompare(b.group_key),
  );
}

export function TerminalCanvas() {
  return (
    <PrefixKeyProvider>
      <TerminalCanvasInner />
    </PrefixKeyProvider>
  );
}

function TerminalCanvasInner() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [layout, dispatchLayout] = useReducer(
    mainLayoutReducer,
    undefined,
    createInitialMainLayout,
  );
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewportHeight();
  const viewportWidth = useViewportWidth();
  const rootHeight: string =
    viewportHeight !== null ? `${viewportHeight}px` : "100dvh";

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const lastSeqRef = useRef(0);
  const keepWorkspaceOpenDestroyedTerminalIdsRef = useRef(new Set<string>());
  const [workspaceAnchorTerminal, setWorkspaceAnchorTerminal] =
    useState<TerminalInfo | null>(null);

  const [closeConfirmation, setCloseConfirmation] = useState<
    | {
        terminal: TerminalInfo;
        processName: string;
        options?: DestroyTerminalOptions;
      }
    | null
  >(null);

  const machines = browserState.machines;
  const terminals = browserState.terminals;
  const workspaceGroups = browserState.workspaceGroups;
  const workspaceLayouts = browserState.workspaceLayouts;
  const machineStats = browserState.machineStats;
  const controlLeases = browserState.controlLeases;
  const workspaceLayoutsRef = useRef(workspaceLayouts);
  useEffect(() => {
    workspaceLayoutsRef.current = workspaceLayouts;
  }, [workspaceLayouts]);

  const isMachineController = useCallback(
    (machineId: string) =>
      deviceId !== null && controlLeases[machineId] === deviceId,
    [controlLeases, deviceId],
  );
  const isActiveController = activeMachineId
    ? isMachineController(activeMachineId)
    : false;

  const statusBarVisible = useStatusBarPref();

  // ---- device id, bootstrap, events WS ----

  useEffect(() => {
    let cancelled = false;
    void getPersistentDeviceId().then((id) => {
      if (!cancelled) setDeviceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    lastSeqRef.current = browserState.lastSeq;
  }, [browserState.lastSeq]);

  useEffect(() => {
    if (machines.length === 0) {
      if (activeMachineId !== null) setActiveMachineId(null);
      return;
    }
    const stillExists =
      activeMachineId && machines.some((m) => m.id === activeMachineId);
    if (!stillExists) setActiveMachineId(machines[0].id);
  }, [machines, activeMachineId]);

  // Load bookmarks per machine, with a synthetic ~ fallback so the rail is
  // never empty when the server returns no workpaths. Matches the prior
  // behaviour in WorkpathPanel.
  useEffect(() => {
    if (machines.length === 0) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      machines.map((m) => {
        const fallback: Bookmark[] = [
          {
            id: "local-home",
            machine_id: m.id,
            path: m.home_dir || "/",
            label: "~",
            sort_order: 0,
          },
        ];
        return listBookmarks(m.id)
          .then((bms) => (bms.length > 0 ? bms : fallback))
          .catch(() => fallback);
      }),
    ).then((all) => {
      if (!cancelled) setBookmarks(all.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [machines, terminals.length]);

  // URL hash <-> zoom-state sync.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/t/")) {
      const id = hash.slice(4);
      if (id) dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: id });
    }
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/t/")) {
        dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: hash.slice(4) });
      } else {
        dispatchLayout({ type: "UNZOOM" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!deviceId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setBootstrapReady(false);

    getBootstrap()
      .then((snapshot) => {
        if (cancelled) return;
        lastSeqRef.current = snapshot.snapshot_seq;
        setBrowserState(applyBootstrapSnapshot(snapshot));
        setBootstrapReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        retryTimer = setTimeout(() => {
          setReconnectGeneration((value) => value + 1);
        }, 1000);
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [deviceId, reconnectGeneration]);

  // Re-request control after a same-tab reload clears pending releases.
  useEffect(() => {
    if (!deviceId) return;
    const pending = takePendingControlRelease(window.sessionStorage);
    if (pending.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(
      pending.map((machineId) => requestControl(machineId, deviceId)),
    ).finally(() => {
      if (!cancelled) setReconnectGeneration((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    // Just remember which machines the user was controlling so the next boot
    // can re-assert via `requestControl` as a belt-and-suspenders. Do NOT
    // send `releaseControlKeepalive` here: the hub already auto-releases on
    // WS disconnect (after a 10s grace period — see
    // `DEVICE_DISCONNECT_GRACE_PERIOD` in crates/hub/src/ws.rs) and restores
    // the lease when the same device reconnects. A beacon-fired release
    // races the reconnect and can wipe `released_leases` before restore
    // runs, leaving the user stuck in "viewing" after a reload.
    const stashControlled = () => {
      const ids = Object.entries(controlLeases)
        .filter(([, cid]) => cid === deviceId)
        .map(([machineId]) => machineId);
      storePendingControlRelease(window.sessionStorage, ids);
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      stashControlled();
    };
    window.addEventListener("beforeunload", stashControlled);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", stashControlled);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [controlLeases, deviceId]);

  const zoomedTerminalIdRef = useRef<string | null>(layout.zoomedTerminalId);
  useEffect(() => {
    zoomedTerminalIdRef.current = layout.zoomedTerminalId;
  }, [layout.zoomedTerminalId]);

  useEffect(() => {
    if (!bootstrapReady || !deviceId) return;
    const ws = new WebSocket(eventsWsUrl(deviceId, lastSeqRef.current));
    let disposed = false;

    const reconnect = () => {
      if (disposed) return;
      setBootstrapReady(false);
      setReconnectGeneration((value) => value + 1);
    };

    const reconnectController = createTerminalReconnectController<
      ReturnType<typeof setTimeout>
    >({
      delayMs: 1000,
      openReadyState: WebSocket.OPEN,
      onReconnect: reconnect,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timerId) => window.clearTimeout(timerId),
    });

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        let needsResync = false;
        setBrowserState((prev) => {
          if (shouldResyncForEnvelope(prev, envelope)) {
            needsResync = true;
            return prev;
          }
          const next = applyBrowserEventEnvelope(prev, envelope);
          if (
            next !== prev &&
            envelope.event?.type === "terminal_destroyed"
          ) {
            const keepWorkspaceOpen =
              keepWorkspaceOpenDestroyedTerminalIdsRef.current.delete(
                envelope.event.terminal_id,
              );
            if (!keepWorkspaceOpen) {
              dispatchLayout({
                type: "TERMINAL_DESTROYED",
                terminalId: envelope.event.terminal_id,
              });
            }
            if (zoomedTerminalIdRef.current === envelope.event.terminal_id) {
              window.history.replaceState(null, "", window.location.pathname);
            }
          }
          return next;
        });
        if (needsResync) ws.close();
      } catch {
        /* ignore malformed events */
      }
    };

    ws.onopen = () => {
      reconnectController.handleSocketOpen();
    };

    ws.onclose = () => {
      if (disposed) return;
      reconnectController.scheduleReconnect();
    };

    const onVisibility = () => {
      reconnectController.handleVisibilityChange(
        document.visibilityState,
        ws.readyState,
      );
    };
    const onPageShow = () => {
      reconnectController.handleVisibilityChange("visible", ws.readyState);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      reconnectController.cancelReconnect();
      ws.onclose = null;
      ws.close();
    };
  }, [bootstrapReady, deviceId]);

  // ---- handlers ----

  const activeMachine = activeMachineId
    ? machines.find((m) => m.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;

  const scopeBookmark =
    layout.selectedWorkpathId === "all" || !activeMachine
      ? null
      : bookmarks.find(
          (b) =>
            b.id === layout.selectedWorkpathId &&
            b.machine_id === activeMachine.id,
        ) ?? null;

  useEffect(() => {
    if (layout.selectedWorkpathId === "all" || !activeMachine) return;
    const selectedExistsOnActiveMachine = bookmarks.some(
      (bookmark) =>
        bookmark.id === layout.selectedWorkpathId &&
        bookmark.machine_id === activeMachine.id,
    );
    if (!selectedExistsOnActiveMachine) {
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" });
    }
  }, [activeMachine, bookmarks, layout.selectedWorkpathId]);

  const scopedTerminals = useMemo<TerminalInfo[]>(() => {
    if (!activeMachine) return [];
    return terminals.filter((t) => t.machine_id === activeMachine.id);
  }, [terminals, activeMachine]);

  const activeMachineWorkspaceGroups = useMemo<WorkspaceGroupInfo[]>(() => {
    if (!activeMachine) return [];
    return workspaceGroups.filter((group) => group.machine_id === activeMachine.id);
  }, [workspaceGroups, activeMachine]);

  const activeMachineWorkspaceLayouts = useMemo<WorkspaceLayoutInfo[]>(() => {
    if (!activeMachine) return [];
    return workspaceLayouts.filter(
      (layout) => layout.machine_id === activeMachine.id,
    );
  }, [workspaceLayouts, activeMachine]);

  const expandedTerminal = layout.zoomedTerminalId
    ? terminals.find((t) => t.id === layout.zoomedTerminalId) ?? null
    : null;
  const workspaceTerminal = useMemo(() => {
    if (expandedTerminal) return expandedTerminal;
    if (workspaceAnchorTerminal?.machine_id === activeMachine?.id)
      return workspaceAnchorTerminal;
    return scopedTerminals[0] ?? null;
  }, [
    expandedTerminal,
    workspaceAnchorTerminal,
    activeMachine,
    scopedTerminals,
  ]);

  useEffect(() => {
    if (expandedTerminal) {
      setWorkspaceAnchorTerminal(expandedTerminal);
    }
  }, [expandedTerminal]);

  const handleCreateTerminal = useCallback(
    async (
      machineId: string,
      cwd: string,
      startupCommand?: string,
      options: CreateTerminalOptions = {},
    ) => {
      if (!deviceId) return null;
      if (!isMachineController(machineId)) return null;
      // Estimate initial cols/rows from the current viewport so the tmux
      // session is born at roughly the size it will be displayed at.
      // Without this the server defaults to 80x24 and TUIs (notably Claude
      // Code / Ink) paint their welcome banner narrow; a later manual fit
      // cannot repaint that static content.
      const viewportHeightPx = viewportHeight ?? window.innerHeight;
      const { cols, rows } = isMobile
        ? estimateMobileInitialTerminalDimensions(
            window.innerWidth,
            viewportHeightPx,
          )
        : estimateInitialTerminalDimensions(window.innerWidth, viewportHeightPx);
      const newTerminal = await createTerminal(
        machineId,
        cwd,
        deviceId,
        startupCommand,
        cols,
        rows,
        options.workspaceGroupId ?? null,
      );
      setBrowserState((prev) => ({
        ...prev,
        terminals: upsertTerminalInfo(prev.terminals, newTerminal),
      }));
      if (options.selectWorkpath === false) {
        dispatchLayout({
          type: "ZOOM_TERMINAL",
          terminalId: newTerminal.id,
        });
      } else {
        dispatchLayout({
          type: "TERMINAL_CREATED",
          terminalId: newTerminal.id,
          workpathId:
            bookmarks.find((b) => b.machine_id === machineId && b.path === cwd)
              ?.id ?? layout.selectedWorkpathId,
        });
      }
      window.history.pushState(null, "", `#/t/${newTerminal.id}`);
      return newTerminal;
    },
    [
      deviceId,
      isMachineController,
      bookmarks,
      isMobile,
      layout.selectedWorkpathId,
      viewportHeight,
    ],
  );

  const handleRequestControl = useCallback(
    async (machineId: string) => {
      if (!deviceId) return;
      const next = await requestControl(machineId, deviceId);
      setBrowserState((prev) => ({
        ...prev,
        controlLeases: next.controller_device_id
          ? {
              ...prev.controlLeases,
              [machineId]: next.controller_device_id,
            }
          : prev.controlLeases,
      }));
    },
    [deviceId],
  );

  const handleReleaseControl = useCallback(
    async (machineId: string) => {
      if (!deviceId) return;
      const next = await releaseControl(machineId, deviceId);
      setBrowserState((prev) => ({
        ...prev,
        controlLeases: next.controller_device_id
          ? {
              ...prev.controlLeases,
              [machineId]: next.controller_device_id,
            }
          : Object.fromEntries(
              Object.entries(prev.controlLeases).filter(
                ([key]) => key !== machineId,
              ),
            ),
      }));
    },
    [deviceId],
  );

  const handleDestroyTerminal = useCallback(
    async (
      terminal: TerminalInfo,
      options: DestroyTerminalOptions = {},
    ): Promise<DestroyTerminalRequestResult> => {
      if (!deviceId) return "pending";
      if (!isMachineController(terminal.machine_id)) return "pending";
      try {
        const result = await checkForegroundProcess(
          terminal.machine_id,
          terminal.id,
        );
        if (result.has_foreground_process) {
          setCloseConfirmation({
            terminal,
            processName: result.process_name ?? "unknown",
            options,
          });
          return "pending";
        }
      } catch {
        /* fall through */
      }
      if (options.keepWorkspaceOpen) {
        keepWorkspaceOpenDestroyedTerminalIdsRef.current.add(terminal.id);
        setWorkspaceAnchorTerminal(terminal);
      }
      try {
        await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
      } catch (error) {
        keepWorkspaceOpenDestroyedTerminalIdsRef.current.delete(terminal.id);
        throw error;
      }
      return "accepted";
    },
    [deviceId, isMachineController],
  );

  const confirmClosePending = useCallback(async () => {
    if (!closeConfirmation || !deviceId) return;
    const { terminal, options } = closeConfirmation;
    setCloseConfirmation(null);
    if (options?.keepWorkspaceOpen) {
      keepWorkspaceOpenDestroyedTerminalIdsRef.current.add(terminal.id);
      setWorkspaceAnchorTerminal(terminal);
    }
    try {
      await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
    } catch (error) {
      keepWorkspaceOpenDestroyedTerminalIdsRef.current.delete(terminal.id);
      throw error;
    }
    options?.afterAccepted?.();
  }, [closeConfirmation, deviceId]);

  const handleZoomTerminal = useCallback((id: string) => {
    dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: id });
    window.history.pushState(null, "", `#/t/${id}`);
  }, []);

  const handleUnzoom = useCallback(() => {
    dispatchLayout({ type: "UNZOOM" });
    window.history.pushState(null, "", window.location.pathname);
  }, []);

  const handleSelectWorkpath = useCallback(
    (id: string) => {
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: id });
      if (window.location.hash.startsWith("#/t/")) {
        window.history.pushState(null, "", window.location.pathname);
      }
    },
    [],
  );

  const handleSplitWorkspacePane = useCallback(
    async (terminal: TerminalInfo) => {
      return handleCreateTerminal(terminal.machine_id, terminal.cwd, undefined, {
        selectWorkpath: false,
        workspaceGroupId: terminal.workspace_group_id ?? null,
      });
    },
    [handleCreateTerminal],
  );

  const handleCreateWorkspacePane = useCallback(
    async (input: {
      machineId: string;
      cwd: string;
      workspaceGroupId: string | null;
    }) => {
      return handleCreateTerminal(input.machineId, input.cwd, undefined, {
        selectWorkpath: false,
        workspaceGroupId: input.workspaceGroupId,
      });
    },
    [handleCreateTerminal],
  );

  const handleCreateWorkspaceGroup = useCallback(
    async (machineId: string, name: string) => {
      const group = await createWorkspaceGroup(machineId, name);
      setBrowserState((prev) => ({
        ...prev,
        workspaceGroups: upsertWorkspaceGroup(prev.workspaceGroups, group),
      }));
      // Default new groups to scrollable mode so the DB row is created with the right layout_mode.
      await handleSaveWorkspaceLayout(machineId, group.id, null, "scrollable", { columns: [] });
      return group;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleReorderWorkspaceGroups = useCallback(
    async (machineId: string, groupIds: string[]) => {
      const groups = await reorderWorkspaceGroups(machineId, groupIds);
      setBrowserState((prev) => ({
        ...prev,
        workspaceGroups: replaceMachineWorkspaceGroups(
          prev.workspaceGroups,
          machineId,
          groups,
        ),
      }));
      return groups;
    },
    [],
  );

  const handleDeleteWorkspaceGroup = useCallback(
    async (machineId: string, groupId: string) => {
      await deleteWorkspaceGroup(machineId, groupId);
      setBrowserState((prev) => ({
        ...prev,
        workspaceGroups: prev.workspaceGroups.filter(
          (group) => !(group.machine_id === machineId && group.id === groupId),
        ),
        workspaceLayouts: prev.workspaceLayouts.filter(
          (layout) =>
            !(layout.machine_id === machineId && layout.group_key === groupId),
        ),
        terminals: prev.terminals.map((terminal) =>
          terminal.machine_id === machineId &&
          terminal.workspace_group_id === groupId
            ? { ...terminal, workspace_group_id: null }
            : terminal,
        ),
      }));
    },
    [],
  );

  const handleSaveWorkspaceLayout = useCallback(
    async (
      machineId: string,
      groupKey: string,
      root: WorkspaceLayoutNode | null,
      mode: WorkspaceLayoutMode | null,
      scrollable: WorkspaceScrollableLayout | null,
    ) => {
      const baseUpdatedAt =
        workspaceLayoutsRef.current.find(
          (layout) =>
            layout.machine_id === machineId && layout.group_key === groupKey,
        )?.updated_at ?? null;
      const saved = await saveWorkspaceLayout(
        machineId,
        groupKey,
        root,
        baseUpdatedAt,
        mode,
        scrollable,
      );
      setBrowserState((prev) => ({
        ...prev,
        workspaceLayouts: (() => {
          const next = upsertWorkspaceLayoutInfo(prev.workspaceLayouts, saved);
          workspaceLayoutsRef.current = next;
          return next;
        })(),
      }));
      return saved;
    },
    [],
  );

  const handleAssignWorkspaceGroup = useCallback(
    async (terminal: TerminalInfo, workspaceGroupId: string | null) => {
      const updated = await assignTerminalWorkspaceGroup(
        terminal.machine_id,
        terminal.id,
        workspaceGroupId,
      );
      setBrowserState((prev) => ({
        ...prev,
        terminals: upsertTerminalInfo(prev.terminals, updated),
      }));
    },
    [],
  );

  const handleNewTerminalFromHeader = useCallback(async () => {
    if (!activeMachine || !deviceId) return;
    if (!isMachineController(activeMachine.id)) return;
    if (layout.selectedWorkpathId === "all" || !scopeBookmark) {
      await handleCreateTerminal(
        activeMachine.id,
        activeMachine.home_dir || "~",
      );
      return;
    }
    await handleCreateTerminal(activeMachine.id, scopeBookmark.path);
  }, [
    activeMachine,
    deviceId,
    isMachineController,
    handleCreateTerminal,
    layout.selectedWorkpathId,
    scopeBookmark,
  ]);

  const handleConfirmAddDirectory = useCallback(
    async (machineId: string, path: string) => {
      const parts = path.replace(/\/+$/, "").split("/");
      const label = parts[parts.length - 1] || path;
      try {
        const bm = await createBookmark(machineId, path, label);
        setBookmarks((prev) => [...prev, bm]);
      } catch {
        setBookmarks((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            machine_id: machineId,
            path,
            label,
            sort_order: prev.length,
          },
        ]);
      }
    },
    [],
  );

  // ---- prefix-key shortcut engine (⌃B) ----
  // The engine singleton lives in PrefixKeyProvider; this window listener is
  // the only place keydowns enter it. Workspace-owned actions (splits, pane
  // focus, group tabs, zoom/close pane, literal ⌃B) are registered by
  // TerminalWorkspace into the same dispatcher.
  const prefixKey = usePrefixKey();
  const prefixKeyRef = useRef(prefixKey);
  useEffect(() => {
    prefixKeyRef.current = prefixKey;
  }, [prefixKey]);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  const canvasPrefixActionsRef = useRef<
    Partial<Record<PrefixActionId, () => void>>
  >({});
  canvasPrefixActionsRef.current = {
    newTerminal: isActiveController
      ? () => void handleNewTerminalFromHeader()
      : undefined,
    cheatSheet: () => setCheatSheetOpen((open) => !open),
    // TODO(later phases): session switcher, host switcher, command palette,
    // copy mode. Registered as no-ops so armed + key is swallowed, not typed.
    sessionSwitcher: () => {},
    switchHost: () => {},
    commandPalette: () => {},
    copyMode: () => {},
  };

  useEffect(() => {
    for (const action of CANVAS_PREFIX_ACTIONS) {
      prefixKeyRef.current.setActionHandler(action, () =>
        canvasPrefixActionsRef.current[action]?.(),
      );
    }
    return () => {
      for (const action of CANVAS_PREFIX_ACTIONS) {
        prefixKeyRef.current.clearActionHandler(action);
      }
    };
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const onKeydown = (event: KeyboardEvent) => {
      const insideTerminal =
        event.target instanceof Element &&
        Boolean(event.target.closest(".xterm"));
      if (!insideTerminal && isEditableShortcutTarget(event.target)) return;
      const result = prefixKeyRef.current.handleKeydown(event);
      if (result.type === "pass") return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isMobile]);

  // Esc unzooms the expanded view, unless focus is inside xterm (which needs
  // Esc for its own bindings — the expanded overlay handles that case).
  useEffect(() => {
    if (!layout.zoomedTerminalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
      ) {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".xterm")) return;
        dispatchLayout({ type: "UNZOOM" });
        window.history.pushState(null, "", window.location.pathname);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout.zoomedTerminalId]);

  // ---- render ----

  const scopeLabel = useMemo(() => {
    if (layout.selectedWorkpathId === "all" || !activeMachine) return "All";
    return (
      bookmarks.find(
        (b) =>
          b.id === layout.selectedWorkpathId && b.machine_id === activeMachine.id,
      )?.label ?? "All"
    );
  }, [layout.selectedWorkpathId, activeMachine, bookmarks]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: rootHeight,
        width: "100vw",
        overflow: "hidden",
        background: colors.bg0,
      }}
    >
      <AppTitleBar isMobile={isMobile} />

      <TerminalPreviewMuxProvider deviceId={deviceId}>
        <div
          style={{
            display: "flex",
            flex: 1,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {showSettings ? (
            <Suspense fallback={null}>
              <SettingsPage onClose={() => setShowSettings(false)} />
            </Suspense>
          ) : machines.length === 0 ? (
            <Suspense fallback={null}>
              <OnboardingView />
            </Suspense>
          ) : isMobile ? (
            <MobileWorkbench
              machines={machines}
              activeMachineId={activeMachineId}
              controlLeases={controlLeases}
              deviceId={deviceId}
              machineStats={machineStats}
              bookmarks={bookmarks}
              terminals={terminals}
              selectedWorkpathId={layout.selectedWorkpathId}
              canCreateTerminal={isActiveController}
              onSelectMachine={setActiveMachineId}
              onSelectWorkpath={handleSelectWorkpath}
              onAddWorkpath={handleConfirmAddDirectory}
              onOpenTerminal={handleZoomTerminal}
              onNewTerminal={handleNewTerminalFromHeader}
              onRequestControl={handleRequestControl}
              onReleaseControl={handleReleaseControl}
              onOpenSettings={() => setShowSettings(true)}
            />
          ) : (
            <main
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                background: colors.bg0,
              }}
            >
              <WorkbenchHeader
                scopeLabel={scopeLabel}
                machines={machines}
                activeMachineId={activeMachineId}
                controlLeases={controlLeases}
                deviceId={deviceId}
                machineStats={machineStats}
                terminals={terminals}
                isController={isActiveController}
                terminalCount={scopedTerminals.length}
                stats={activeStats}
                viewportWidth={viewportWidth}
                canCreateTerminal={isActiveController}
                onSelectMachine={setActiveMachineId}
                onOpenSettings={() => setShowSettings(true)}
                onOpenAddMachine={() => setAddMachineOpen(true)}
                onNewTerminal={
                  isActiveController ? handleNewTerminalFromHeader : undefined
                }
                onReleaseControl={
                  isActiveController && activeMachine
                    ? () => handleReleaseControl(activeMachine.id)
                    : undefined
                }
                onRequestControl={
                  !isActiveController && activeMachine
                    ? () => handleRequestControl(activeMachine.id)
                    : undefined
                }
              />

              {scopedTerminals.length === 0 ? (
                <EmptyState
                  scopeLabel={scopeLabel}
                  canCreate={isActiveController}
                  onNewTerminal={handleNewTerminalFromHeader}
                />
              ) : (
                <TerminalWorkspace
                  terminal={workspaceTerminal!}
                  siblings={
                    scopedTerminals.length > 0
                      ? scopedTerminals
                      : workspaceTerminal
                        ? [workspaceTerminal]
                        : []
                  }
                  workspaceGroups={activeMachineWorkspaceGroups}
                  workspaceLayouts={activeMachineWorkspaceLayouts}
                  isController={isMachineController(workspaceTerminal!.machine_id)}
                  deviceId={deviceId ?? ""}
                  isMobile={isMobile}
                  onClose={handleUnzoom}
                  onPick={handleZoomTerminal}
                  onDestroy={handleDestroyTerminal}
                  onSplit={handleSplitWorkspacePane}
                  onCreatePane={handleCreateWorkspacePane}
                  onCreateGroup={handleCreateWorkspaceGroup}
                  onReorderGroups={handleReorderWorkspaceGroups}
                  onDeleteGroup={handleDeleteWorkspaceGroup}
                  onSaveWorkspaceLayout={handleSaveWorkspaceLayout}
                  onAssignGroup={handleAssignWorkspaceGroup}
                  onRequestControl={handleRequestControl}
                  onReleaseControl={handleReleaseControl}
                />
              )}
            </main>
          )}
        </div>

        {isMobile && layout.zoomedTerminalId && workspaceTerminal && (
          <TerminalWorkspace
            terminal={workspaceTerminal}
            siblings={
              scopedTerminals.length > 0
                ? scopedTerminals
                : workspaceTerminal
                  ? [workspaceTerminal]
                  : []
            }
            workspaceGroups={activeMachineWorkspaceGroups}
            workspaceLayouts={activeMachineWorkspaceLayouts}
            isController={isMachineController(workspaceTerminal.machine_id)}
            deviceId={deviceId ?? ""}
            isMobile={true}
            onClose={handleUnzoom}
            onPick={handleZoomTerminal}
            onDestroy={handleDestroyTerminal}
            onSplit={handleSplitWorkspacePane}
            onCreatePane={handleCreateWorkspacePane}
            onCreateGroup={handleCreateWorkspaceGroup}
            onReorderGroups={handleReorderWorkspaceGroups}
            onDeleteGroup={handleDeleteWorkspaceGroup}
            onSaveWorkspaceLayout={handleSaveWorkspaceLayout}
            onAssignGroup={handleAssignWorkspaceGroup}
            onRequestControl={handleRequestControl}
            onReleaseControl={handleReleaseControl}
          />
        )}

        {statusBarVisible && machines.length > 0 && (
          <Suspense fallback={null}>
            <StatusBar
              machines={machines}
              activeMachineId={activeMachineId}
              onSelectMachine={setActiveMachineId}
              machineStats={machineStats}
              isMobile={isMobile}
              isController={isActiveController}
              onRequestControl={handleRequestControl}
              onReleaseControl={handleReleaseControl}
            />
          </Suspense>
        )}

        {addMachineOpen && (
          <MachineOnboardingDialog onClose={() => setAddMachineOpen(false)} />
        )}

        {!isMobile && prefixKey.armed && (
          <div
            data-testid="prefix-armed-indicator"
            style={{
              position: "fixed",
              right: 16,
              bottom: 16,
              zIndex: 60,
              padding: "4px 10px",
              borderRadius: 6,
              background: colors.accent,
              color: "#120904",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              pointerEvents: "none",
            }}
          >
            ⌃B
          </div>
        )}

        {cheatSheetOpen && (
          <CheatSheetOverlay onClose={() => setCheatSheetOpen(false)} />
        )}

        {closeConfirmation && (
          <Suspense fallback={null}>
            <ConfirmDialog
              open
              title="Close terminal?"
              message={`"${closeConfirmation.processName}" is still running in this terminal. Closing the terminal will terminate it.`}
              confirmLabel="Close terminal"
              cancelLabel="Cancel"
              variant="danger"
              onConfirm={confirmClosePending}
              onCancel={() => setCloseConfirmation(null)}
            />
          </Suspense>
        )}
      </TerminalPreviewMuxProvider>
    </div>
  );
}

function EmptyState({
  scopeLabel,
  canCreate,
  onNewTerminal,
}: {
  scopeLabel: string;
  canCreate: boolean;
  onNewTerminal: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.fg3,
        fontSize: 14,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <TerminalIcon size={40} style={{ opacity: 0.35 }} />
        <div style={{ marginTop: 12 }}>
          {scopeLabel === "All"
            ? "No terminals yet"
            : `No terminals in ${scopeLabel}`}
        </div>
        {canCreate && (
          <button
            data-testid="empty-new-terminal"
            onClick={onNewTerminal}
            style={{
              marginTop: 14,
              background: colors.accent,
              color: "#120904",
              border: "none",
              borderRadius: 999,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Start terminal
          </button>
        )}
      </div>
    </div>
  );
}
