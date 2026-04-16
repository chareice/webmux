import { lazy, Suspense, useState, useCallback, useEffect, useRef } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Canvas } from "./Canvas.web";
import {
  createTerminal,
  destroyTerminal,
  checkForegroundProcess,
  eventsWsUrl,
  getBootstrap,
  requestControl,
  releaseControl,
  releaseControlKeepalive,
} from "@/lib/api";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
  shouldResyncForEnvelope,
} from "@/lib/bootstrapState";
import { getPersistentDeviceId } from "@/lib/deviceId";
import { colors } from "@/lib/colors";
import { useIsMobile } from "@/lib/hooks";
import {
  storePendingControlRelease,
  takePendingControlRelease,
} from "@/lib/unloadControlRelease";

const Sidebar = lazy(() =>
  import("./Sidebar").then((module) => ({ default: module.Sidebar })),
);
const OnboardingView = lazy(() =>
  import("./OnboardingView.web").then((module) => ({
    default: module.OnboardingView,
  })),
);
const StatusBar = lazy(() =>
  import("./StatusBar").then((module) => ({ default: module.StatusBar })),
);

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  // null = grid overview ("All" tab), terminal id = single terminal tab
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const activeTabRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
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

  useEffect(() => {
    activeTabRef.current = activeTabId;
  }, [activeTabId]);

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

  // Restore active tab from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/t/")) {
      const id = hash.slice(4);
      if (id) setActiveTabId(id);
    }
  }, []);

  // Handle browser back button
  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/t/")) {
        setActiveTabId(hash.slice(4));
      } else {
        setActiveTabId(null);
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

  // Events WebSocket for live updates
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
            envelope.event?.type === "terminal_destroyed" &&
            activeTabRef.current === envelope.event.terminal_id
          ) {
            setActiveTabId(null);
            window.history.pushState(null, "", window.location.pathname);
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
      const newTerminal = await createTerminal(machineId, cwd, deviceId, startupCommand);
      // Auto-switch to the new terminal's tab
      setActiveTabId(newTerminal.id);
      window.history.pushState(null, "", `#/t/${newTerminal.id}`);
      if (isMobile) setSidebarOpen(false);
    },
    [deviceId, isMachineController, isMobile],
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
          const name = result.process_name ?? "unknown";
          if (
            !window.confirm(
              `"${name}" is still running. Close this terminal?`,
            )
          ) {
            return;
          }
        }
      } catch {
        // If check fails, allow closing without confirmation
      }
      await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
    },
    [deviceId, isMachineController],
  );

  const handleSelectTab = useCallback((id: string | null) => {
    setActiveTabId(id);
    if (id) {
      window.history.pushState(null, "", `#/t/${id}`);
    } else {
      window.history.pushState(null, "", window.location.pathname);
    }
  }, []);

  const activeMachine = activeMachineId
    ? machines.find((machine) => machine.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Mobile hamburger button */}
        {isMobile && !activeTabId && (
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

        {/* Sidebar */}
        {(sidebarOpen || !isMobile) && (
          <div
            style={
              isMobile
                ? {
                    position: "fixed",
                    top: 0,
                    left: 0,
                    height: "100dvh",
                    zIndex: 85,
                  }
                : {}
            }
          >
            <Suspense fallback={null}>
              <Sidebar
                machines={machines}
                onCreateTerminal={handleCreateTerminal}
                canCreateTerminal={isMachineController}
                onRequestControl={handleRequestControl}
              />
            </Suspense>
          </div>
        )}

        {/* Main content */}
        {machines.length === 0 ? (
          <Suspense fallback={null}>
            <OnboardingView />
          </Suspense>
        ) : (
          <Canvas
            machines={machines}
            terminals={terminals}
            activeTabId={activeTabId}
            activeMachineId={activeMachine?.id ?? null}
            machineStats={machineStats}
            isMobile={isMobile}
            isActiveController={isActiveController}
            isMachineController={isMachineController}
            deviceId={deviceId ?? ""}
            onSelectTab={handleSelectTab}
            onDestroy={handleDestroyTerminal}
            onRequestControl={handleRequestControl}
            onReleaseControl={handleReleaseControl}
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
    </div>
  );
}
