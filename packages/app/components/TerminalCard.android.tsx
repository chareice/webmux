import { useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TerminalInfo } from "@webmux/shared";
import { TerminalView } from "./TerminalView.android";
import type { TerminalViewRef } from "./TerminalView.types";
import { TerminalToolbar } from "./TerminalToolbar";
import { terminalWsUrl } from "@/lib/api";

interface TerminalCardProps {
  terminal: TerminalInfo;
  maximized: boolean;
  isMobile: boolean;
  onMaximize: () => void;
  onMinimize: () => void;
  onDestroy: () => void;
}

export function TerminalCard({
  terminal,
  maximized,
  isMobile,
  onMaximize,
  onMinimize,
  onDestroy,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);

  const handleToolbarKey = useCallback((data: string) => {
    termViewRef.current?.sendInput(data);
    termViewRef.current?.focus();
  }, []);

  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id);

  // Maximized terminal shown as a full-screen Modal
  if (maximized) {
    return (
      <Modal
        visible
        animationType="slide"
        onRequestClose={onMinimize}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.modalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0d2137" />

          {/* Title bar */}
          <View style={styles.modalTitleBar}>
            <View style={styles.titleRow}>
              <View style={styles.statusDot} />
              <Text numberOfLines={1} style={styles.titleText}>
                {terminal.title}
              </Text>
            </View>
            <View style={styles.titleActions}>
              <Pressable
                onPress={onMinimize}
                hitSlop={8}
                style={styles.actionButton}
              >
                <Text style={styles.minimizeText}>{"\u2921"}</Text>
              </Pressable>
              <Pressable
                onPress={onDestroy}
                hitSlop={8}
                style={styles.actionButton}
              >
                <Text style={styles.closeText}>{"\u2715"}</Text>
              </Pressable>
            </View>
          </View>

          {/* Terminal view */}
          <View style={styles.terminalContainer}>
            <TerminalView
              ref={termViewRef}
              machineId={terminal.machine_id}
              terminalId={terminal.id}
              wsUrl={wsUrl}
            />
          </View>

          {/* Mobile toolbar with special keys */}
          <TerminalToolbar onKey={handleToolbarKey} />

          {/* Footer */}
          <View style={styles.modalFooter}>
            <Text numberOfLines={1} style={styles.footerText}>
              {terminal.cwd}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  // Card (thumbnail) mode — show summary info, tap to maximize
  return (
    <Pressable onPress={onMaximize} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <View style={styles.statusDot} />
          <Text numberOfLines={1} style={styles.cardTitle}>
            {terminal.title}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onDestroy();
          }}
          hitSlop={8}
        >
          <Text style={styles.cardCloseText}>{"\u2715"}</Text>
        </Pressable>
      </View>

      {/* Miniature terminal preview */}
      <View style={styles.previewContainer}>
        <TerminalView
          ref={termViewRef}
          machineId={terminal.machine_id}
          terminalId={terminal.id}
          wsUrl={wsUrl}
        />
      </View>

      <Text numberOfLines={1} style={styles.cardFooter}>
        {terminal.cwd}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ── Modal (maximized) ──
  modalContainer: {
    flex: 1,
    backgroundColor: "#0d2137",
  },
  modalTitleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgb(26, 58, 92)",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgb(0, 212, 170)",
  },
  titleText: {
    fontSize: 13,
    color: "rgb(224, 232, 240)",
    flex: 1,
  },
  titleActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 6,
  },
  minimizeText: {
    fontSize: 16,
    color: "rgb(122, 143, 166)",
  },
  closeText: {
    fontSize: 14,
    color: "rgb(255, 107, 107)",
  },
  terminalContainer: {
    flex: 1,
    overflow: "hidden",
  },
  modalFooter: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "rgb(26, 58, 92)",
  },
  footerText: {
    fontSize: 11,
    color: "rgb(74, 97, 120)",
  },

  // ── Card (thumbnail) ──
  card: {
    backgroundColor: "rgb(17, 42, 69)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgb(26, 58, 92)",
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgb(26, 58, 92)",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  cardTitle: {
    fontSize: 12,
    color: "rgb(224, 232, 240)",
    flex: 1,
  },
  cardCloseText: {
    fontSize: 12,
    color: "rgb(255, 107, 107)",
    opacity: 0.6,
  },
  previewContainer: {
    height: 160,
    overflow: "hidden",
  },
  cardFooter: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    fontSize: 9,
    color: "rgb(74, 97, 120)",
    borderTopWidth: 1,
    borderTopColor: "rgb(26, 58, 92)",
  },
});
