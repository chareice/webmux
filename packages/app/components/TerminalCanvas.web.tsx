import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { TerminalInfo, MachineInfo, ResourceStats } from "@webmux/shared";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas.web";
import { TabContainer } from "./TabContainer.web";
import { OnboardingView } from "./OnboardingView.web";
import { StatusBar } from "./StatusBar";
import {
  createTerminal,
  destroyTerminal,
  listMachines,
  listTerminals,
  eventsWsUrl,
  getDeviceId,
  getMode,
  requestControl,
  releaseControl,
} from "@/lib/api";
import { useIsMobile } from "@/lib/hooks";

export function TerminalCanvas() {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const openTabsRef = useRef<string[]>([]);
  const activeTabRef = useRef<string | null>(null);
  const deviceId = useMemo(() => getDeviceId(), []);
  const [controllerDeviceId, setControllerDeviceId] = useState<string | null>(
    null,
  );
  const isController = controllerDeviceId === deviceId;
  const [machineStats, setMachineStats] = useState<
    Record<string, ResourceStats>
  >({});
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    activeTabRef.current = activeTabId;
  }, [activeTabId]);

  // Auto-select first machine as active, reset if selected machine goes offline
  useEffect(() => {
    if (machines.length === 0) {
      if (activeMachineId !== null) setActiveMachineId(null);
      return;
    }
    const stillExists =
      activeMachineId && machines.some((m) => m.id === activeMachineId);
    if (!stillExists) {
      setActiveMachineId(machines[0].id);
    }
  }, [machines, activeMachineId]);

  // Restore tab state from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#/t/")) {
      const id = hash.slice(4);
      if (id) {
        setOpenTabs([id]);
        setActiveTabId(id);
      }
    }
  }, []);

  // Handle browser back button
  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/t/")) {
        const id = hash.slice(4);
        setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setActiveTabId(id);
      } else {
        setOpenTabs([]);
        setActiveTabId(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Load initial data
  useEffect(() => {
    listMachines().then(setMachines).catch(() => {});
    listTerminals().then(setTerminals).catch(() => {});
    getMode()
      .then((m) => {
        setControllerDeviceId(m.controller_device_id);
        if (!m.controller_device_id) requestControl(deviceId);
      })
      .catch(() => {});
  }, [deviceId]);

  // Events WebSocket for live updates
  useEffect(() => {
    const ws = new WebSocket(eventsWsUrl(deviceId));

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "machine_online":
            setMachines((prev) => {
              if (prev.some((m) => m.id === msg.machine.id)) return prev;
              return [...prev, msg.machine];
            });
            break;
          case "machine_offline": {
            const offlineMachineId = msg.machine_id;
            setMachines((prev) =>
              prev.filter((m) => m.id !== offlineMachineId),
            );
            // Remove terminals and clean up tabs for this machine
            setTerminals((prev) => {
              const removedIds = new Set(
                prev
                  .filter((t) => t.machine_id === offlineMachineId)
                  .map((t) => t.id),
              );
              if (removedIds.size > 0) {
                setOpenTabs((tabs) => {
                  const next = tabs.filter((id) => !removedIds.has(id));
                  if (
                    next.length !== tabs.length &&
                    activeTabRef.current &&
                    removedIds.has(activeTabRef.current)
                  ) {
                    const idx = tabs.indexOf(activeTabRef.current);
                    const newActive =
                      next[Math.min(idx, next.length - 1)] || null;
                    setActiveTabId(newActive);
                    if (newActive) {
                      window.history.replaceState(
                        null,
                        "",
                        `#/t/${newActive}`,
                      );
                    } else {
                      window.history.replaceState(
                        null,
                        "",
                        window.location.pathname,
                      );
                    }
                  }
                  return next;
                });
              }
              return prev.filter((t) => t.machine_id !== offlineMachineId);
            });
            // Clean up stats
            setMachineStats((prev) => {
              const next = { ...prev };
              delete next[offlineMachineId];
              return next;
            });
            break;
          }
          case "terminal_created":
            setTerminals((prev) => {
              if (prev.some((t) => t.id === msg.terminal.id)) return prev;
              return [...prev, msg.terminal];
            });
            break;
          case "terminal_destroyed": {
            const destroyedId = msg.terminal_id;
            setTerminals((prev) => prev.filter((t) => t.id !== destroyedId));
            // Remove from tabs if open
            setOpenTabs((prev) => {
              const next = prev.filter((id) => id !== destroyedId);
              if (
                next.length !== prev.length &&
                activeTabRef.current === destroyedId
              ) {
                const idx = prev.indexOf(destroyedId);
                const newActive =
                  next[Math.min(idx, next.length - 1)] || null;
                setActiveTabId(newActive);
                if (newActive) {
                  window.history.replaceState(null, "", `#/t/${newActive}`);
                } else {
                  window.history.replaceState(
                    null,
                    "",
                    window.location.pathname,
                  );
                }
              }
              return next;
            });
            break;
          }
          case "machine_stats":
            setMachineStats((prev) => ({
              ...prev,
              [msg.machine_id]: msg.stats,
            }));
            break;
          case "mode_changed":
            setControllerDeviceId(msg.controller_device_id);
            break;
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        listMachines().then(setMachines).catch(() => {});
        listTerminals().then(setTerminals).catch(() => {});
        getMode()
          .then((m) => {
            setControllerDeviceId(m.controller_device_id);
          })
          .catch(() => {});
      }, 1000);
    };

    return () => ws.close();
  }, [deviceId]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      if (!isController) return;
      await createTerminal(machineId, cwd);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, isController],
  );

  const handleRequestControl = useCallback(() => {
    requestControl(deviceId);
  }, [deviceId]);

  const handleReleaseControl = useCallback(() => {
    releaseControl(deviceId);
  }, [deviceId]);

  const handleDestroyTerminal = useCallback(
    async (terminal: TerminalInfo) => {
      await destroyTerminal(terminal.machine_id, terminal.id);
    },
    [],
  );

  // Tab management
  const handleOpenTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
    setActiveTabId(id);
    window.history.pushState(null, "", `#/t/${id}`);
  }, []);

  const handleActivateTab = useCallback((id: string) => {
    setActiveTabId(id);
    window.history.replaceState(null, "", `#/t/${id}`);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((tabId) => tabId !== id);
      if (activeTabRef.current === id) {
        const idx = prev.indexOf(id);
        const newActive = next[Math.min(idx, next.length - 1)] || null;
        setActiveTabId(newActive);
        if (newActive) {
          window.history.replaceState(null, "", `#/t/${newActive}`);
        } else {
          window.history.pushState(null, "", window.location.pathname);
        }
      }
      return next;
    });
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTabId(null);
    window.history.pushState(null, "", window.location.pathname);
  }, []);

  const hasOpenTabs = openTabs.length > 0 && activeTabId !== null;

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
        {isMobile && !hasOpenTabs && (
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
            />
          </div>
        )}

        {/* Main content */}
        {machines.length === 0 ? (
          <OnboardingView />
        ) : (
          <Canvas
            terminals={terminals}
            openTabs={openTabs}
            isMobile={isMobile}
            isController={isController}
            deviceId={deviceId}
            onOpen={handleOpenTab}
            onDestroy={handleDestroyTerminal}
          />
        )}
      </div>

      {/* Tab container overlay */}
      {hasOpenTabs && (
        <TabContainer
          terminals={terminals}
          openTabs={openTabs}
          activeTabId={activeTabId}
          isMobile={isMobile}
          isController={isController}
          deviceId={deviceId}
          onActivateTab={handleActivateTab}
          onCloseTab={handleCloseTab}
          onCloseAllTabs={handleCloseAllTabs}
          onDestroyTerminal={handleDestroyTerminal}
          onRequestControl={handleRequestControl}
          onReleaseControl={handleReleaseControl}
        />
      )}

      <StatusBar
        machines={machines}
        activeMachineId={activeMachineId}
        onSelectMachine={setActiveMachineId}
        machineStats={machineStats}
        isController={isController}
        onRequestControl={handleRequestControl}
        onReleaseControl={handleReleaseControl}
      />
    </div>
  );
}
