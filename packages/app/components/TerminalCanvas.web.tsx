import { useState, useCallback, useEffect, useRef } from "react";
import type { TerminalInfo, MachineInfo } from "@webmux/shared";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas.web";
import { OnboardingView } from "./OnboardingView.web";
import {
  createTerminal,
  destroyTerminal,
  listMachines,
  listTerminals,
  eventsWsUrl,
} from "@/lib/api";
import { useIsMobile } from "@/lib/hooks";

export function TerminalCanvas() {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const maximizedRef = useRef<string | null>(null);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

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
    listMachines().then(setMachines).catch(() => {});
    listTerminals().then(setTerminals).catch(() => {});
  }, []);

  // Events WebSocket for live updates
  useEffect(() => {
    const ws = new WebSocket(eventsWsUrl());

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "machine_online":
            setMachines((prev) => {
              if (prev.some((m) => m.id === msg.machine.id))
                return prev;
              return [...prev, msg.machine];
            });
            break;
          case "machine_offline":
            setMachines((prev) =>
              prev.filter((m) => m.id !== msg.machine_id),
            );
            // Also remove terminals from this machine
            setTerminals((prev) =>
              prev.filter((t) => t.machine_id !== msg.machine_id),
            );
            break;
          case "terminal_created":
            setTerminals((prev) => {
              if (prev.some((t) => t.id === msg.terminal.id))
                return prev;
              return [...prev, msg.terminal];
            });
            break;
          case "terminal_destroyed":
            setTerminals((prev) =>
              prev.filter((t) => t.id !== msg.terminal_id),
            );
            if (maximizedRef.current === msg.terminal_id) {
              setMaximizedId(null);
            }
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
      }, 1000);
    };

    return () => ws.close();
  }, []);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      await createTerminal(machineId, cwd);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile],
  );

  const handleDestroyTerminal = useCallback(
    async (terminal: TerminalInfo) => {
      await destroyTerminal(terminal.machine_id, terminal.id);
    },
    [],
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
        height: "100vh",
        width: "100vw",
        position: "relative",
        overflow: "hidden",
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
                  height: "100vh",
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
          maximizedId={maximizedId}
          isMobile={isMobile}
          onMaximize={handleMaximize}
          onMinimize={handleMinimize}
          onDestroy={handleDestroyTerminal}
        />
      )}
    </div>
  );
}
