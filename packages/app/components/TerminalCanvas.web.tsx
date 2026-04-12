import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas.web";
import { OnboardingView } from "./OnboardingView.web";
import { StatusBar } from "./StatusBar";
import {
  createTerminal,
  destroyTerminal,
  checkForegroundProcess,
  eventsWsUrl,
  getDeviceId,
  getBootstrap,
  requestControl,
  releaseControl,
} from "@/lib/api";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
} from "@/lib/bootstrapState";
import { useIsMobile } from "@/lib/hooks";

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const maximizedRef = useRef<string | null>(null);
  const autoClaimedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const deviceId = useMemo(() => getDeviceId(), []);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [eventsGeneration, setEventsGeneration] = useState(0);
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
    lastSeqRef.current = browserState.lastSeq;
  }, [browserState.lastSeq]);

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

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

  // Restore maximized state from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/t/")) {
      const id = hash.slice(4);
      if (id) setMaximizedId(id);
    }
  }, []);

  // Handle browser back button
  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/t/")) {
        setMaximizedId(hash.slice(4));
      } else {
        setMaximizedId(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Load initial data
  useEffect(() => {
    let cancelled = false;

    getBootstrap()
      .then((snapshot) => {
        if (cancelled) return;
        setBrowserState(applyBootstrapSnapshot(snapshot));
        setBootstrapReady(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!bootstrapReady || autoClaimedRef.current || machines.length === 0) {
      return;
    }
    if (Object.keys(controlLeases).length > 0) {
      autoClaimedRef.current = true;
      return;
    }

    const machineId = machines[0]?.id;
    if (!machineId) return;
    autoClaimedRef.current = true;
    void requestControl(machineId, deviceId)
      .then((next) => {
        setBrowserState((prev) => ({
          ...prev,
          controlLeases: next.controller_device_id
            ? {
                ...prev.controlLeases,
                [machineId]: next.controller_device_id,
              }
            : prev.controlLeases,
        }));
      })
      .catch(() => {
        autoClaimedRef.current = false;
      });
  }, [bootstrapReady, controlLeases, deviceId, machines]);

  // Events WebSocket for live updates
  useEffect(() => {
    if (!bootstrapReady) return;

    const ws = new WebSocket(eventsWsUrl(deviceId, lastSeqRef.current));
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        setBrowserState((prev) => {
          const next = applyBrowserEventEnvelope(prev, envelope);
          if (
            next !== prev &&
            envelope.event?.type === "terminal_destroyed" &&
            maximizedRef.current === envelope.event.terminal_id
          ) {
            setMaximizedId(null);
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      reconnectTimer = setTimeout(() => {
        setEventsGeneration((value) => value + 1);
      }, 1000);
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws.close();
    };
  }, [bootstrapReady, deviceId, eventsGeneration]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      if (!isMachineController(machineId)) return;
      await createTerminal(machineId, cwd, deviceId);
      if (isMobile) setSidebarOpen(false);
    },
    [deviceId, isMachineController, isMobile],
  );

  const handleRequestControl = useCallback(async (machineId: string) => {
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

  const handleMaximize = useCallback((id: string) => {
    setMaximizedId(id);
    window.history.pushState(null, "", `#/t/${id}`);
  }, []);

  const handleMinimize = useCallback(() => {
    setMaximizedId(null);
    window.history.pushState(null, "", window.location.pathname);
  }, []);

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
        {isMobile && !maximizedId && (
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            style={{
              position: "fixed",
              top: 12,
              left: 12,
              zIndex: 90,
              background: "rgb(17, 42, 69)",
              border: "1px solid rgb(26, 58, 92)",
              borderRadius: 6,
              color: "rgb(224, 232, 240)",
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
            <Sidebar
              machines={machines}
              onCreateTerminal={handleCreateTerminal}
              canCreateTerminal={isMachineController}
            />
          </div>
        )}

        {/* Main content */}
        {machines.length === 0 ? (
          <OnboardingView />
        ) : (
          <Canvas
            terminals={terminals}
            maximizedId={maximizedId}
            isMobile={isMobile}
            isMachineController={isMachineController}
            deviceId={deviceId}
            onMaximize={handleMaximize}
            onMinimize={handleMinimize}
            onDestroy={handleDestroyTerminal}
            onRequestControl={handleRequestControl}
            onReleaseControl={handleReleaseControl}
          />
        )}
      </div>

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
    </div>
  );
}
