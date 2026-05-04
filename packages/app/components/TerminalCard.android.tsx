import { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  StatusBar,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TerminalInfo } from "@webmux/shared";
import { TerminalView } from "./TerminalView.android";
import type { TerminalViewRef } from "./TerminalView.types";
import { TerminalToolbar } from "./TerminalToolbar";
import { terminalWsUrl } from "@/lib/api";
import { colors, colorAlpha } from "@/lib/colors";

interface TerminalCardProps {
  terminal: TerminalInfo;
  siblings?: TerminalInfo[];
  maximized: boolean;
  isMobile: boolean;
  isController: boolean;
  deviceId: string | null;
  onMaximize: () => void;
  onMinimize: () => void;
  onDestroy: () => void;
  onPickTerminal?: (terminalId: string) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

export function TerminalCard({
  terminal,
  siblings = [],
  maximized,
  isMobile,
  isController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
  onPickTerminal,
  onRequestControl,
  onReleaseControl,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);

  const handleToolbarKey = useCallback((data: string) => {
    if (!isController) return;
    termViewRef.current?.sendInput(data);
    termViewRef.current?.focus();
  }, [isController]);

  const handleFitHere = useCallback(() => {
    if (!isController || !maximized) return;
    termViewRef.current?.fitToContainer();
    termViewRef.current?.focus();
  }, [isController, maximized]);

  useEffect(() => {
    if (!maximized || !isController) return;
    const timers = [120, 420, 900].map((delay) =>
      setTimeout(() => {
        termViewRef.current?.fitToContainer();
      }, delay),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [isController, maximized, terminal.id]);

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
          <StatusBar barStyle="light-content" backgroundColor={colors.bg2} />

          <View style={styles.modalTitleBar}>
            <View style={styles.titleRow}>
              <View style={styles.statusDot} />
              <View style={styles.titleStack}>
                <Text numberOfLines={1} style={styles.titleText}>
                  {terminal.title || terminal.id.slice(0, 8)}
                </Text>
                <Text numberOfLines={1} style={styles.cwdText}>
                  {shortenHome(terminal.cwd)}
                </Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  if (isController) onReleaseControl?.(terminal.machine_id);
                  else onRequestControl?.(terminal.machine_id);
                }}
                hitSlop={8}
                style={[
                  styles.controlPill,
                  !isController && styles.controlPillTake,
                ]}
              >
                <Text
                  style={[
                    styles.controlPillText,
                    !isController && styles.controlPillTakeText,
                  ]}
                >
                  {isController ? "CTRL" : "CONTROL"}
                </Text>
              </Pressable>
              {isController && (
                <Pressable
                  onPress={handleFitHere}
                  hitSlop={12}
                  style={styles.fitButton}
                >
                  <Text style={styles.fitText}>{"\u2922"}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={onMinimize}
                hitSlop={12}
                style={styles.minimizeButton}
              >
                <Text style={styles.minimizeText}>{"\u2715"}</Text>
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
              cols={terminal.cols}
              rows={terminal.rows}
              isController={isController}
              canResizeTerminal={isController}
            />
          </View>

          {/* Mobile toolbar with special keys */}
          {isController && <TerminalToolbar onKey={handleToolbarKey} />}

          {/* Footer */}
          <View style={styles.modalFooter}>
            <Text numberOfLines={1} style={styles.footerText}>
              {terminal.cwd}
            </Text>
            {siblings.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.siblingStrip}
              >
                {siblings.map((sibling) => (
                  <Pressable
                    key={sibling.id}
                    onPress={() => onPickTerminal?.(sibling.id)}
                    style={[
                      styles.siblingPill,
                      sibling.id === terminal.id && styles.siblingPillActive,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.siblingTitle,
                        sibling.id === terminal.id && styles.siblingTitleActive,
                      ]}
                    >
                      {sibling.title || sibling.id.slice(0, 8)}
                    </Text>
                    <Text numberOfLines={1} style={styles.siblingPath}>
                      {sibling.cwd.replace(/^\/home\/[^/]+/, "~")}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
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
          cols={terminal.cols}
          rows={terminal.rows}
          isController={isController}
          canResizeTerminal={false}
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
    backgroundColor: colors.termBg,
  },
  modalTitleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    backgroundColor: colors.bg2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  titleStack: {
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.fg0,
  },
  cwdText: {
    marginTop: 1,
    fontFamily: "monospace",
    fontSize: 10,
    color: colors.fg2,
  },
  minimizeButton: {
    width: 32,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  controlPill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colorAlpha.accentLine,
    backgroundColor: colorAlpha.accentSoft,
  },
  controlPillTake: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  controlPillText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
  },
  controlPillTakeText: {
    color: "#120904",
  },
  fitButton: {
    width: 32,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  minimizeText: {
    fontSize: 15,
    color: colors.fg1,
  },
  fitText: {
    fontSize: 15,
    color: colors.accent,
    fontWeight: "600",
  },
  disabledCloseText: {
    color: colors.foregroundMuted,
    opacity: 0.5,
  },
  terminalContainer: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.termBg,
    overflow: "hidden",
  },
  modalFooter: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    backgroundColor: colors.bg1,
  },
  footerText: {
    fontSize: 11,
    color: colors.fg2,
  },
  siblingStrip: {
    gap: 6,
    paddingTop: 7,
    paddingBottom: 2,
  },
  siblingPill: {
    width: 130,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  siblingPillActive: {
    borderColor: colors.accent,
    backgroundColor: colorAlpha.accentSoft,
  },
  siblingTitle: {
    color: colors.foregroundSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  siblingTitleActive: {
    color: colors.accent,
  },
  siblingPath: {
    marginTop: 2,
    color: colors.foregroundMuted,
    fontSize: 9,
  },

  // ── Card (thumbnail) ──
  card: {
    backgroundColor: colors.bg2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    backgroundColor: colors.bg1,
  },
  cardTitle: {
    fontSize: 12,
    color: colors.foreground,
    flex: 1,
  },
  cardCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardCloseText: {
    fontSize: 12,
    color: colors.danger,
    opacity: 0.6,
  },
  previewContainer: {
    height: 160,
    backgroundColor: colors.termBg,
    overflow: "hidden",
  },
  cardFooter: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    fontSize: 9,
    color: colors.foregroundMuted,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
  },
});

function shortenHome(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, "~");
}
