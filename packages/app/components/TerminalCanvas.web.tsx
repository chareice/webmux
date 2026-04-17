import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type { Bookmark, TerminalInfo } from "@webmux/shared";
import { Canvas } from "./Canvas.web";
import { NavColumn } from "./NavColumn.web";
import { AppTitleBar } from "./AppTitleBar.web";
import {
  createBookmark,
  createTerminal,
  deleteBookmark,
  destroyTerminal,
  checkForegroundProcess,
  eventsWsUrl,
  getBootstrap,
  getSettings,
  listBookmarks,
  requestControl,
  releaseControl,
  releaseControlKeepalive,
} from "@/lib/api";
import type { QuickCommand } from "./WorkpathOverlay.web";
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

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [layout, dispatchLayout] = useReducer(
    mainLayoutReducer,
    undefined,
    createInitialMainLayout,
  );
  const isMobile = useIsMobile();
  const viewportHeight = useVisualViewportHeight();
  // Track the real visual viewport so the layout shrinks when the mobile soft
  // keyboard opens. xterm's existing ResizeObserver handles the refit.
  const rootHeight: string = viewportHeight !== null ? `${viewportHeight}px` : "100dvh";
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const lastSeqRef = useRef(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);

  // Fetch quick-command settings once per session — the overlay used to
  // do this on its own mount, but it mounts/unmounts every time the rail
  // hover toggles. Lifted here so it's a single fetch shared by all
  // overlay instances.
  useEffect(() => {
    let cancelled = false;
    void getSettings()
      .then((res) => {
        if (cancelled) return;
        try {
          setQuickCommands(JSON.parse(res.settings.quick_commands || "[]"));
        } catch {
          /* malformed setting — leave empty */
        }
      })
      .catch(() => { /* settings unreachable — leave empty */ });
    return () => {
      cancelled = true;
    };
  }, []);
  const [closeConfirmation, setCloseConfirmation] = useState<
    | { terminal: TerminalInfo; processName: string }
    | null
  >(null);
  const machines = browserState.machines;
  const terminals = browserState.terminals;
  const machineStats = browserState.machineStats;
  const controlLeases = browserState.controlLeases;
  const isMachineController = useCallback(
    (machineId: string) => controlLeases[machineId] === deviceId,
    [controlLeases, deviceId],
  );
  const isActiveController = activeMachineId
    ? isMachineController(activeMachineId)
    : false;

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;

    void getPersistentDeviceId().then((id) => {
      if (!cancelled) {
        setDeviceId(id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    lastSeqRef.current = browserState.lastSeq;
  }, [browserState.lastSeq]);

  // Auto-select first machine as active, reset if selected machine goes offline
  useEffect(() => {
    if (machines.length === 0) {
      if (activeMachineId !== null) setActiveMachineId(null);
      return;
    }
    const stillExists = activeMachineId && machines.some((m) => m.id === activeMachineId);
    if (!stillExists) {
      setActiveMachineId(machines[0].id);
    }
  }, [machines, activeMachineId]);

  // Load bookmarks for the active machine. Re-fetch when terminals count
  // changes so counts in the rail stay fresh after add/delete.
  // When the API returns no bookmarks (or fails), inject a synthetic
  // `local-home` entry pointing at the machine's home dir so the rail and
  // overlay always have at least one workpath the user can open. Without
  // this fallback, a fresh machine would render an empty rail and break
  // workpath matching for terminals created from the prompt.
  useEffect(() => {
    if (!activeMachineId) {
      setBookmarks([]);
      return;
    }
    const machine = machines.find((m) => m.id === activeMachineId);
    const fallback: Bookmark[] = [
      {
        id: "local-home",
        machineId: activeMachineId,
        path: machine?.home_dir || "/",
        label: "~",
        sortOrder: 0,
      },
    ];
    let cancelled = false;
    listBookmarks(activeMachineId)
      .then((bms) => {
        if (!cancelled) setBookmarks(bms.length > 0 ? bms : fallback);
      })
      .catch(() => {
        if (!cancelled) setBookmarks(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMachineId, terminals.length, machines]);

  // Restore zoomed terminal from URL hash on first mount.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/t/")) {
      const id = hash.slice(4);
      if (id) dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: id });
    }
  }, []);

  // Handle browser back/forward.
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

  // Load initial data
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

  // On page load, if sessionStorage contains pending control releases it means
  // this is a same-tab reload (the beforeunload beacon already released on the
  // server). Re-request control so the user doesn't have to click again.
  useEffect(() => {
    if (!deviceId) return;

    let cancelled = false;
    const pendingMachineIds = takePendingControlRelease(window.sessionStorage);
    if (pendingMachineIds.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.allSettled(
      pendingMachineIds.map((machineId) => requestControl(machineId, deviceId)),
    ).finally(() => {
      if (!cancelled) {
        setReconnectGeneration((value) => value + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;

    const releaseControlledMachines = () => {
      const controlledMachineIds = Object.entries(controlLeases)
        .filter(([, controllerDeviceId]) => controllerDeviceId === deviceId)
        .map(([machineId]) => machineId);

      storePendingControlRelease(window.sessionStorage, controlledMachineIds);

      for (const machineId of controlledMachineIds) {
        releaseControlKeepalive(machineId, deviceId);
      }
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        return;
      }
      releaseControlledMachines();
    };

    window.addEventListener("beforeunload", releaseControlledMachines);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", releaseControlledMachines);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [controlLeases, deviceId]);

  // Events WebSocket for live updates.
  // Track the current zoomed terminal in a ref so the WS effect doesn't
  // need it as a dependency — without this the WS gets torn down and
  // reopened on every zoom/unzoom (and during reconnect flapping the
  // browser may miss events). Reading via ref keeps the effect's
  // identity stable while still seeing the latest value at message time.
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
        if (needsResync) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      reconnectTimer = setTimeout(() => {
        setBootstrapReady(false);
        setReconnectGeneration((value) => value + 1);
      }, 1000);
    };

    // When the tab becomes visible, check if the events WS is still alive.
    // Background tabs may have their WS silently closed by the browser or
    // network intermediaries, and setTimeout is throttled, so the normal
    // onclose reconnect timer may not have fired yet.
    const handleVisibilityChange = () => {
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
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Prevent the onclose handler from scheduling a spurious reconnect
      // when the effect is torn down intentionally.
      ws.onclose = null;
      ws.close();
    };
  }, [bootstrapReady, deviceId]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string, startupCommand?: string) => {
      if (!deviceId) return;
      if (!isMachineController(machineId)) return;
      const newTerminal = await createTerminal(
        machineId,
        cwd,
        deviceId,
        startupCommand,
      );
      const match = bookmarks.find(
        (b) => b.machineId === machineId && b.path === cwd,
      );
      dispatchLayout({
        type: "TERMINAL_CREATED",
        terminalId: newTerminal.id,
        workpathId: match?.id ?? "all",
      });
      window.history.pushState(null, "", `#/t/${newTerminal.id}`);
      if (isMobile) setSidebarOpen(false);
    },
    [deviceId, isMachineController, isMobile, bookmarks],
  );

  const handleRequestControl = useCallback(async (machineId: string) => {
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
  }, [deviceId]);

  const handleReleaseControl = useCallback(async (machineId: string) => {
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
  }, [deviceId]);

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
        // If the foreground-process check fails, fall through and close.
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

  const activeMachine = activeMachineId
    ? machines.find((machine) => machine.id === activeMachineId) ?? null
    : machines[0] ?? null;

  const handleNewTerminalFromOverview = useCallback(async () => {
    if (!activeMachine || !deviceId) return;
    if (!isMachineController(activeMachine.id)) return;
    if (layout.selectedWorkpathId === "all") {
      // Per spec §6 ("In `All`, open directory picker"): don't silently
      // pick home_dir — surface the workpath rail + add-directory picker
      // so the user actively chooses where the new terminal lands.
      if (!layout.columnForceExpanded) {
        dispatchLayout({ type: "TOGGLE_NAV_FORCE_EXPANDED" });
      }
      setAddDirectoryOpen(true);
      return;
    }
    const bookmark = bookmarks.find((b) => b.id === layout.selectedWorkpathId);
    if (!bookmark) {
      await handleCreateTerminal(activeMachine.id, activeMachine.home_dir || "~");
      return;
    }
    await handleCreateTerminal(bookmark.machineId, bookmark.path);
  }, [
    activeMachine,
    deviceId,
    isMachineController,
    handleCreateTerminal,
    layout.selectedWorkpathId,
    bookmarks,
  ]);

  const handleCloseZoomedTerminal = useCallback(async () => {
    if (!layout.zoomedTerminalId) return;
    const terminal = terminals.find((t) => t.id === layout.zoomedTerminalId);
    if (terminal) await handleDestroyTerminal(terminal);
  }, [layout.zoomedTerminalId, terminals, handleDestroyTerminal]);

  const splitPaneRef = useRef<{
    splitVertical: () => void;
    splitHorizontal: () => void;
    focusPrevPane: () => void;
    focusNextPane: () => void;
    closePane: () => void;
  } | null>(null);

  const handleSplitVertical = useCallback(() => {
    splitPaneRef.current?.splitVertical();
  }, []);

  const handleSplitHorizontal = useCallback(() => {
    splitPaneRef.current?.splitHorizontal();
  }, []);

  const handleFocusPrevPane = useCallback(() => {
    splitPaneRef.current?.focusPrevPane();
  }, []);

  const handleFocusNextPane = useCallback(() => {
    splitPaneRef.current?.focusNextPane();
  }, []);

  const handleClosePane = useCallback(() => {
    splitPaneRef.current?.closePane();
  }, []);

  const handleSelectWorkpathByIndex = useCallback(
    (index: number) => {
      if (index === 0) {
        dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" });
        return;
      }
      const list = bookmarks.filter((b) => b.machineId === activeMachineId);
      const target = list[index - 1];
      if (target) {
        dispatchLayout({ type: "SELECT_WORKPATH", workpathId: target.id });
      }
    },
    [bookmarks, activeMachineId],
  );

  useShortcuts({
    newTerminal: isActiveController ? handleNewTerminalFromOverview : undefined,
    closeTab: handleCloseZoomedTerminal,
    closePane: isActiveController ? handleClosePane : undefined,
    nextTab: undefined, // deprecated with workpath-based navigation
    prevTab: undefined,
    selectTab: handleSelectWorkpathByIndex,
    splitVertical: isActiveController ? handleSplitVertical : undefined,
    splitHorizontal: isActiveController ? handleSplitHorizontal : undefined,
    focusPrevPane: handleFocusPrevPane,
    focusNextPane: handleFocusNextPane,
    toggleNav: () => dispatchLayout({ type: "TOGGLE_NAV_FORCE_EXPANDED" }),
  });

  // Esc unzooms the immersive terminal view, as long as focus is not inside
  // a terminal (which needs Esc for its own purposes).
  useEffect(() => {
    if (!layout.zoomedTerminalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
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

  const navColumnProps = {
    machines,
    activeMachineId,
    bookmarks,
    terminals,
    selectedWorkpathId: layout.selectedWorkpathId,
    forceExpanded: layout.columnForceExpanded,
    canCreateTerminalForActiveMachine: isActiveController,
    quickCommands,
    addDirectoryOpen,
    onSelectMachine: (id: string) => setActiveMachineId(id),
    onSelectAll: () =>
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" }),
    onSelectWorkpath: (id: string) =>
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: id }),
    onCreateTerminal: handleCreateTerminal,
    onRequestControl: handleRequestControl,
    // Rail "+" button: surface the overlay (force-expand if collapsed)
    // and pop the existing add-directory PathInput. No more silent no-op.
    onAddBookmark: () => {
      setAddDirectoryOpen(true);
      if (!layout.columnForceExpanded) {
        dispatchLayout({ type: "TOGGLE_NAV_FORCE_EXPANDED" });
      }
    },
    onConfirmAddDirectory: async (machineId: string, path: string) => {
      const label = (() => {
        const parts = path.replace(/\/+$/, "").split("/");
        return parts[parts.length - 1] || path;
      })();
      try {
        const bm = await createBookmark(machineId, path, label);
        setBookmarks((prev) => [...prev, bm]);
      } catch {
        // Fall back to a local-only bookmark so the user still sees their
        // entry in the rail. Sync will pick it up on the next reload if
        // the API was just transiently down.
        setBookmarks((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            machineId,
            path,
            label,
            sortOrder: prev.length,
          },
        ]);
      } finally {
        setAddDirectoryOpen(false);
      }
    },
    onCancelAddDirectory: () => setAddDirectoryOpen(false),
    onRemoveBookmark: async (id: string) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      // Reset the layout if the deleted bookmark was the selected workpath,
      // otherwise selectedWorkpathId points at a now-nonexistent id and the
      // grid renders empty with no obvious recovery for the user.
      dispatchLayout({ type: "WORKPATH_DELETED", workpathId: id });
      // Synthetic local-* bookmarks (the home fallback or local-only adds
      // from a failed createBookmark) don't exist server-side; skip the API
      // call so we don't get a misleading 404 in the network tab.
      if (id.startsWith("local-")) return;
      try {
        await deleteBookmark(id);
      } catch {
        /* leave optimistic removal in place */
      }
    },
    onOpenSettings: () => setShowSettings(true),
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: rootHeight,
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <AppTitleBar isMobile={isMobile} />
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Mobile hamburger button */}
        {isMobile && !layout.zoomedTerminalId && (
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            data-testid="mobile-sidebar-toggle"
            style={{
              position: "fixed",
              top: 12,
              left: 12,
              zIndex: 90,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.foreground,
              cursor: "pointer",
              fontSize: 18,
              padding: "6px 10px",
              lineHeight: 1,
            }}
          >
            &#x2630;
          </button>
        )}

        {/* Sidebar backdrop on mobile */}
        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              background: "rgba(0, 0, 0, 0.5)",
            }}
          />
        )}

        {/* Nav column (desktop renders inline; mobile renders in drawer) */}
        {!isMobile && <NavColumn {...navColumnProps} />}
        {isMobile && sidebarOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              height: rootHeight,
              zIndex: 85,
            }}
          >
            {/* NavColumn isn't lazy-loaded, so no Suspense boundary needed. */}
            <NavColumn {...navColumnProps} />
          </div>
        )}

        {/* Main content */}
        {showSettings ? (
          <Suspense fallback={null}>
            <SettingsPage onClose={() => setShowSettings(false)} />
          </Suspense>
        ) : machines.length === 0 ? (
          <Suspense fallback={null}>
            <OnboardingView />
          </Suspense>
        ) : (
          <Canvas
            machines={machines}
            terminals={terminals}
            bookmarks={bookmarks}
            selectedWorkpathId={layout.selectedWorkpathId}
            zoomedTerminalId={layout.zoomedTerminalId}
            activeMachineId={activeMachine?.id ?? null}
            machineStats={machineStats}
            isMobile={isMobile}
            isActiveController={isActiveController}
            isMachineController={isMachineController}
            deviceId={deviceId ?? ""}
            onZoomTerminal={handleZoomTerminal}
            onUnzoom={handleUnzoom}
            onDestroy={handleDestroyTerminal}
            onRequestControl={handleRequestControl}
            onReleaseControl={handleReleaseControl}
            onNewTerminal={
              isActiveController ? handleNewTerminalFromOverview : undefined
            }
            splitPaneRef={splitPaneRef}
          />
        )}
      </div>

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
    </div>
  );
}
