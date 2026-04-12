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
  isController: boolean;
  deviceId: string | null;
  onMaximize: () => void;
  onMinimize: () => void;
  onDestroy: () => void;
}

export function TerminalCard({
  terminal,
  maximized,
  isMobile,
  isController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);

  const handleToolbarKey = useCallback((data: string) => {
    if (!isController) return;
    termViewRef.current?.sendInput(data);
    termViewRef.current?.focus();
  }, [isController]);

  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id, deviceId ?? undefined);

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

          {/* Title bar — close on left, minimize on right */}
          <View style={styles.modalTitleBar}>
            <Pressable
              onPress={isController ? onDestroy : undefined}
              hitSlop={12}
              style={styles.closeButton}
            >
              <Text
                style={[
                  styles.closeText,
                  !isController && styles.disabledCloseText,
                ]}
              >
                {"\u2715"}
              </Text>
            </Pressable>
            <View style={styles.titleRow}>
              <View style={styles.statusDot} />
              <Text numberOfLines={1} style={styles.titleText}>
                {terminal.title}
              </Text>
            </View>
            <Pressable
              onPress={onMinimize}
              hitSlop={12}
              style={styles.minimizeButton}
            >
              <Text style={styles.minimizeText}>{"\u2921"}</Text>
            </Pressable>
          </View>

          {/* Terminal view */}
          <View style={styles.terminalContainer}>
            <TerminalView
              ref={termViewRef}
              machineId={terminal.machine_id}
              terminalId={terminal.id}
              wsUrl={wsUrl}
              isController={isController}
            />
          </View>

          {/* Mobile toolbar with special keys */}
          {isController && <TerminalToolbar onKey={handleToolbarKey} />}

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
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            if (isController) {
              onDestroy();
            }
          }}
          hitSlop={12}
          style={styles.cardCloseButton}
        >
          <Text
            style={[
              styles.cardCloseText,
              !isController && styles.disabledCloseText,
            ]}
          >
            {"\u2715"}
          </Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.statusDot} />
          <Text numberOfLines={1} style={styles.cardTitle}>
            {terminal.title}
          </Text>
        </View>
      </View>

      {/* Miniature terminal preview */}
      <View style={styles.previewContainer}>
        <TerminalView
          ref={termViewRef}
          machineId={terminal.machine_id}
          terminalId={terminal.id}
          wsUrl={wsUrl}
          isController={isController}
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
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  minimizeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  minimizeText: {
    fontSize: 16,
    color: "rgb(122, 143, 166)",
  },
  closeText: {
    fontSize: 14,
    color: "rgb(255, 107, 107)",
  },
  disabledCloseText: {
    color: "rgb(74, 97, 120)",
    opacity: 0.5,
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
  cardCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
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
