import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  BackHandler,
  StatusBar,
} from "react-native";
import type { TerminalInfo, MachineInfo } from "@webmux/shared";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas.android";
import {
  createTerminal,
  destroyTerminal,
  eventsWsUrl,
  getBootstrap,
} from "@/lib/api";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
} from "@/lib/bootstrapState";

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const maximizedRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [eventsGeneration, setEventsGeneration] = useState(0);
  const machines = browserState.machines;
  const terminals = browserState.terminals;

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

  useEffect(() => {
    lastSeqRef.current = browserState.lastSeq;
  }, [browserState.lastSeq]);

  // Handle Android back button
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (maximizedId) {
        setMaximizedId(null);
        return true;
      }
      if (sidebarOpen) {
        setSidebarOpen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [maximizedId, sidebarOpen]);

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
  }, []);

  // Events WebSocket for live updates
  useEffect(() => {
    if (!bootstrapReady) return;

    const url = eventsWsUrl(undefined, lastSeqRef.current);
    const ws = new WebSocket(url);
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onmessage = (event: any) => {
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
  }, [bootstrapReady, eventsGeneration]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      await createTerminal(machineId, cwd);
      setSidebarOpen(false);
    },
    [],
  );

  const handleDestroyTerminal = useCallback(
    async (terminal: TerminalInfo) => {
      await destroyTerminal(terminal.machine_id, terminal.id);
    },
    [],
  );

  const handleMaximize = useCallback((id: string) => {
    setMaximizedId(id);
  }, []);

  const handleMinimize = useCallback(() => {
    setMaximizedId(null);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1929" />

      {/* Hamburger button */}
      {!maximizedId && (
        <Pressable
          onPress={() => setSidebarOpen((prev) => !prev)}
          style={styles.hamburger}
        >
          <Text style={styles.hamburgerText}>{"\u2630"}</Text>
        </Pressable>
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <>
          <Pressable
            onPress={() => setSidebarOpen(false)}
            style={styles.backdrop}
          />
          <View style={styles.sidebarContainer}>
            <Sidebar
              machines={machines}
              onCreateTerminal={handleCreateTerminal}
            />
          </View>
        </>
      )}

      {/* Main content */}
      <Canvas
        terminals={terminals}
        maximizedId={maximizedId}
        isMobile
        onMaximize={handleMaximize}
        onMinimize={handleMinimize}
        onDestroy={handleDestroyTerminal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgb(10, 25, 41)",
  },
  hamburger: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 90,
    backgroundColor: "rgb(17, 42, 69)",
    borderWidth: 1,
    borderColor: "rgb(26, 58, 92)",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  hamburgerText: {
    fontSize: 18,
    color: "rgb(224, 232, 240)",
    lineHeight: 22,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 80,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  sidebarContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    zIndex: 85,
  },
});
