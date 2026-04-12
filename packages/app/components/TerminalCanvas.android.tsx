import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  BackHandler,
  StatusBar,
} from "react-native";
import type { TerminalInfo } from "@webmux/shared";
import { Sidebar } from "./Sidebar";
import { Canvas } from "./Canvas.android";
import {
  createTerminal,
  destroyTerminal,
  eventsWsUrl,
  getBootstrap,
  requestControl,
} from "@/lib/api";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
} from "@/lib/bootstrapState";
import { getPersistentDeviceId } from "@/lib/deviceId";

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const maximizedRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const machines = browserState.machines;
  const terminals = browserState.terminals;
  const controlLeases = browserState.controlLeases;
  const isMachineController = useCallback(
    (machineId: string) =>
      deviceId !== null && controlLeases[machineId] === deviceId,
    [controlLeases, deviceId],
  );

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

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

  // Events WebSocket for live updates
  useEffect(() => {
    if (!bootstrapReady || !deviceId) return;

    const url = eventsWsUrl(deviceId, lastSeqRef.current);
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
        setBootstrapReady(false);
        setReconnectGeneration((value) => value + 1);
      }, 1000);
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws.close();
    };
  }, [bootstrapReady, deviceId]);

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      if (!deviceId || !isMachineController(machineId)) return;
      await createTerminal(machineId, cwd, deviceId);
      setSidebarOpen(false);
    },
    [deviceId, isMachineController],
  );

  const handleDestroyTerminal = useCallback(
    async (terminal: TerminalInfo) => {
      if (!deviceId || !isMachineController(terminal.machine_id)) return;
      await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
    },
    [deviceId, isMachineController],
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
              canCreateTerminal={isMachineController}
              onRequestControl={(machineId) => {
                if (!deviceId) return;
                void requestControl(machineId, deviceId).then((next) => {
                  setBrowserState((prev) => ({
                    ...prev,
                    controlLeases: next.controller_device_id
                      ? {
                          ...prev.controlLeases,
                          [machineId]: next.controller_device_id,
                        }
                      : prev.controlLeases,
                  }));
                });
              }}
            />
          </View>
        </>
      )}

      {/* Main content */}
      <Canvas
        terminals={terminals}
        maximizedId={maximizedId}
        isMobile
        isMachineController={isMachineController}
        deviceId={deviceId}
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
