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
import type { TerminalInfo, Bookmark } from "@webmux/shared";
import { AppTitleBar } from "./AppTitleBar.web";
import { Rail } from "./Rail.web";
import { WorkbenchHeader } from "./WorkbenchHeader.web";
import { TerminalGridCard } from "./TerminalGridCard.web";
import { ExpandedTerminal } from "./ExpandedTerminal.web";
import { MobileWorkbench } from "./MobileWorkbench.web";
import { Terminal as TerminalIcon } from "lucide-react";
import {
  createBookmark,
  createTerminal,
  deleteBookmark,
  destroyTerminal,
  checkForegroundProcess,
  eventsWsUrl,
  getBootstrap,
  listBookmarks,
  requestControl,
  releaseControl,
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
import { useShortcuts } from "@/lib/shortcuts";
import {
  createInitialMainLayout,
  mainLayoutReducer,
} from "@/lib/mainLayoutReducer";
import {
  storePendingControlRelease,
  takePendingControlRelease,
} from "@/lib/unloadControlRelease";
import { nativeZellijRoute } from "@/lib/nativeZellij";
import { TerminalPreviewMuxProvider } from "@/lib/terminalPreviewMuxReact";

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

export function TerminalCanvas() {
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

  const tight = viewportWidth < 820;
  // Desktop rail: open by default, auto-collapsed in tight mode so it doesn't
  // steal content width. Tapping the open-rail chevron in the header reopens.
  const [railOpen, setRailOpen] = useState(!tight);
  useEffect(() => {
    setRailOpen(!tight);
  }, [tight]);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);
  const lastSeqRef = useRef(0);

  const [closeConfirmation, setCloseConfirmation] = useState<
    | { terminal: TerminalInfo; processName: string }
    | null
  >(null);

  const machines = browserState.machines;
  const terminals = browserState.terminals;
  const machineStats = browserState.machineStats;
  const controlLeases = browserState.controlLeases;

  const isMachineController = useCallback(
    (machineId: string) =>
      deviceId !== null && controlLeases[machineId] === deviceId,
    [controlLeases, deviceId],
  );
  const isActiveController = activeMachineId
    ? isMachineController(activeMachineId)
    : false;

  const openNativeZellij = useCallback((machineId: string) => {
    window.location.href = nativeZellijRoute(machineId);
  }, []);

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
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
            dispatchLayout({
              type: "TERMINAL_DESTROYED",
              terminalId: envelope.event.terminal_id,
            });
            if (zoomedTerminalIdRef.current === envelope.event.terminal_id) {
              window.history.pushState(null, "", window.location.pathname);
            }
          }
          return next;
        });
        if (needsResync) ws.close();
      } catch {
        /* ignore malformed events */
      }
    };

    ws.onclose = () => {
      reconnectTimer = setTimeout(() => {
        setBootstrapReady(false);
        setReconnectGeneration((value) => value + 1);
      }, 1000);
    };

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        ws.readyState !== WebSocket.OPEN &&
        ws.readyState !== WebSocket.CONNECTING
      ) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        setBootstrapReady(false);
        setReconnectGeneration((value) => value + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
    layout.selectedWorkpathId === "all"
      ? null
      : bookmarks.find((b) => b.id === layout.selectedWorkpathId) ?? null;

  const scopedTerminals = useMemo<TerminalInfo[]>(() => {
    if (!activeMachine) return [];
    const hostTerminals = terminals.filter(
      (t) => t.machine_id === activeMachine.id,
    );
    if (layout.selectedWorkpathId === "all") return hostTerminals;
    if (!scopeBookmark) return [];
    return hostTerminals.filter((t) => t.cwd === scopeBookmark.path);
  }, [terminals, activeMachine, layout.selectedWorkpathId, scopeBookmark]);

  const expandedTerminal = layout.zoomedTerminalId
    ? terminals.find((t) => t.id === layout.zoomedTerminalId) ?? null
    : null;

  const workpathLabelByMachineAndCwd = useMemo(() => {
    const m = new Map<string, string>();
    for (const bm of bookmarks) m.set(`${bm.machine_id}::${bm.path}`, bm.label);
    return m;
  }, [bookmarks]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string, startupCommand?: string) => {
      if (!deviceId) return;
      if (!isMachineController(machineId)) return;
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
      );
      const match = bookmarks.find(
        (b) => b.machine_id === machineId && b.path === cwd,
      );
      dispatchLayout({
        type: "TERMINAL_CREATED",
        terminalId: newTerminal.id,
        workpathId: match?.id ?? "all",
      });
      window.history.pushState(null, "", `#/t/${newTerminal.id}`);
    },
    [deviceId, isMachineController, bookmarks, isMobile, viewportHeight],
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
    async (terminal: TerminalInfo) => {
      if (!deviceId) return;
      if (!isMachineController(terminal.machine_id)) return;
      try {
        const result = await checkForegroundProcess(
          terminal.machine_id,
          terminal.id,
        );
        if (result.has_foreground_process) {
          setCloseConfirmation({
            terminal,
            processName: result.process_name ?? "unknown",
          });
          return;
        }
      } catch {
        /* fall through */
      }
      await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
    },
    [deviceId, isMachineController],
  );

  const confirmClosePending = useCallback(async () => {
    if (!closeConfirmation || !deviceId) return;
    const { terminal } = closeConfirmation;
    setCloseConfirmation(null);
    await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
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

  const handleCloseZoomedTerminal = useCallback(async () => {
    if (!layout.zoomedTerminalId) return;
    const t = terminals.find((x) => x.id === layout.zoomedTerminalId);
    if (t) await handleDestroyTerminal(t);
  }, [layout.zoomedTerminalId, terminals, handleDestroyTerminal]);

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
    await handleCreateTerminal(scopeBookmark.machine_id, scopeBookmark.path);
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

  const handleRemoveBookmark = useCallback(
    async (id: string) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      dispatchLayout({ type: "WORKPATH_DELETED", workpathId: id });
      if (id.startsWith("local-")) return;
      try {
        await deleteBookmark(id);
      } catch {
        /* optimistic removal */
      }
    },
    [],
  );

  const handleSelectWorkpathByIndex = useCallback(
    (index: number) => {
      if (index === 0) {
        handleSelectWorkpath("all");
        return;
      }
      const list = bookmarks.filter((b) => b.machine_id === activeMachineId);
      const target = list[index - 1];
      if (target) handleSelectWorkpath(target.id);
    },
    [bookmarks, activeMachineId, handleSelectWorkpath],
  );

  const currentWorkpathTerminals = useCallback(
    (): TerminalInfo[] => scopedTerminals,
    [scopedTerminals],
  );

  useShortcuts({
    newTerminal: isActiveController ? handleNewTerminalFromHeader : undefined,
    closeTab: handleCloseZoomedTerminal,
    nextTab: () => {
      const s = currentWorkpathTerminals();
      if (s.length <= 1) return;
      const idx = s.findIndex((t) => t.id === layout.zoomedTerminalId);
      const next = (idx === -1 ? 0 : idx + 1) % s.length;
      handleZoomTerminal(s[next].id);
    },
    prevTab: () => {
      const s = currentWorkpathTerminals();
      if (s.length <= 1) return;
      const idx = s.findIndex((t) => t.id === layout.zoomedTerminalId);
      const prev = idx === -1 ? 0 : (idx - 1 + s.length) % s.length;
      handleZoomTerminal(s[prev].id);
    },
    selectAll: () => handleSelectWorkpath("all"),
    selectTab: handleSelectWorkpathByIndex,
    toggleNav: () => setRailOpen((v) => !v),
  });

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

  const scopeLabel =
    layout.selectedWorkpathId === "all"
      ? "All"
      : scopeBookmark?.label ?? "Workpath";

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
              onOpenTerminal={handleZoomTerminal}
              onNewTerminal={handleNewTerminalFromHeader}
              onRequestControl={handleRequestControl}
              onReleaseControl={handleReleaseControl}
              onOpenSettings={() => setShowSettings(true)}
            />
          ) : (
            <>
              {/* Rail (drawer on tight screens) */}
              {railOpen && (
                <Rail
                  width={tight ? Math.min(viewportWidth - 40, 260) : 248}
                  machines={machines}
                  activeMachineId={activeMachineId}
                  controlLeases={controlLeases}
                  deviceId={deviceId}
                  machineStats={machineStats}
                  bookmarks={bookmarks}
                  terminals={terminals}
                  selectedWorkpathId={layout.selectedWorkpathId}
                  canCreateTerminal={isActiveController}
                  addDirectoryOpen={addDirectoryOpen}
                  onSelectMachine={(id) => {
                    setActiveMachineId(id);
                    if (tight) setRailOpen(false);
                  }}
                  onSelectWorkpath={(id) => {
                    handleSelectWorkpath(id);
                    if (tight) setRailOpen(false);
                  }}
                  onOpenAddDirectory={() => setAddDirectoryOpen(true)}
                  onCloseAddDirectory={() => setAddDirectoryOpen(false)}
                  onConfirmAddDirectory={handleConfirmAddDirectory}
                  onRemoveBookmark={handleRemoveBookmark}
                  onOpenNativeZellij={openNativeZellij}
                  onOpenSettings={() => setShowSettings(true)}
                  onCollapse={() => setRailOpen(false)}
                />
              )}
              {tight && railOpen && (
                <div
                  onClick={() => setRailOpen(false)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0, 0, 0, 0.4)",
                    zIndex: 5,
                  }}
                />
              )}

            {/* Main — header + grid */}
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
                hostName={activeMachine?.name ?? "webmux"}
                isController={isActiveController}
                terminalCount={scopedTerminals.length}
                stats={activeStats}
                viewportWidth={viewportWidth}
                canCreateTerminal={isActiveController}
                railOpen={railOpen}
                onOpenRail={() => setRailOpen(true)}
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
                <div
                  data-testid="workbench-grid"
                  style={{
                    flex: 1,
                    overflow: "auto",
                    padding: 14,
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(340px, 1fr))",
                    gridAutoRows: "minmax(220px, 38vh)",
                    gap: 12,
                  }}
                >
                  {scopedTerminals.map((t) => (
                    <TerminalGridCard
                      key={t.id}
                      terminal={t}
                      isController={isMachineController(t.machine_id)}
                      workpathLabel={
                        layout.selectedWorkpathId === "all"
                          ? workpathLabelByMachineAndCwd.get(
                              `${t.machine_id}::${t.cwd}`,
                            )
                          : undefined
                      }
                      onExpand={handleZoomTerminal}
                      onDestroy={handleDestroyTerminal}
                    />
                  ))}
                </div>
              )}
            </main>
          </>
        )}
        </div>

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

        {expandedTerminal && (
          <ExpandedTerminal
            terminal={expandedTerminal}
            siblings={
              scopedTerminals.length > 0 ? scopedTerminals : [expandedTerminal]
            }
            isController={isMachineController(expandedTerminal.machine_id)}
            deviceId={deviceId ?? ""}
            isMobile={isMobile}
            onClose={handleUnzoom}
            onPick={handleZoomTerminal}
            onDestroy={handleDestroyTerminal}
            onRequestControl={handleRequestControl}
            onReleaseControl={handleReleaseControl}
          />
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
