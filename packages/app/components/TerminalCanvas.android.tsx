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
  listMachines,
  listTerminals,
  eventsWsUrl,
} from "@/lib/api";

export function TerminalCanvas() {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const maximizedRef = useRef<string | null>(null);

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

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
    listMachines().then(setMachines).catch(() => {});
    listTerminals().then(setTerminals).catch(() => {});
  }, []);

  // Events WebSocket for live updates
  useEffect(() => {
    const url = eventsWsUrl();
    const ws = new WebSocket(url);

    ws.onmessage = (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "machine_online":
            setMachines((prev) => {
              if (prev.some((m) => m.id === msg.machine.id)) return prev;
              return [...prev, msg.machine];
            });
            break;
          case "machine_offline":
            setMachines((prev) =>
              prev.filter((m) => m.id !== msg.machine_id),
            );
            setTerminals((prev) =>
              prev.filter((t) => t.machine_id !== msg.machine_id),
            );
            break;
          case "terminal_created":
            setTerminals((prev) => {
              if (prev.some((t) => t.id === msg.terminal.id)) return prev;
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
      // Reconnect by re-fetching state
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
