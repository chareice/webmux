import { View, Text, ScrollView, StyleSheet } from "react-native";
import type { TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.android";

interface CanvasProps {
  terminals: TerminalInfo[];
  maximizedId: string | null;
  isMobile: boolean;
  isMachineController: (machineId: string) => boolean;
  deviceId: string | null;
  onMaximize: (id: string) => void;
  onMinimize: () => void;
  onDestroy: (terminal: TerminalInfo) => void;
}

export function Canvas({
  terminals,
  maximizedId,
  isMobile,
  isMachineController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
}: CanvasProps) {
  return (
    <View style={styles.container}>
      {terminals.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>{"\u2B21"}</Text>
          <Text style={styles.emptyText}>
            Tap {"\u2630"} to open a terminal
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {terminals.map((terminal) => (
            <TerminalCard
              key={terminal.id}
              terminal={terminal}
              maximized={maximizedId === terminal.id}
              isMobile={isMobile}
              isController={isMachineController(terminal.machine_id)}
              deviceId={deviceId}
              onMaximize={() => onMaximize(terminal.id)}
              onMinimize={onMinimize}
              onDestroy={() => onDestroy(terminal)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgb(10, 25, 41)",
    padding: 12,
    paddingTop: 52,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.3,
    color: "rgb(74, 97, 120)",
  },
  emptyText: {
    color: "rgb(74, 97, 120)",
    fontSize: 14,
  },
  grid: {
    gap: 12,
    paddingBottom: 20,
  },
});
