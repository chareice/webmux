import { memo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import type { MachineInfo, Bookmark } from "@webmux/shared";
import {
  listDirectory,
  listBookmarks,
  createBookmark,
  deleteBookmark,
  createRegistrationToken,
  getSettings,
} from "@/lib/api";
import { useColors, useColorAlpha } from "@/lib/theme";
import {
  buildDirectorySuggestions,
  createDirectoryCache,
  readCachedDirectoryEntries,
  writeCachedDirectoryEntries,
} from "@/lib/directoryAutocomplete";
import {
  buildOnboardingScript,
  getInstallCommand,
  getRegisterCommand,
  getServiceInstallCommand,
} from "@/lib/nodeInstaller";
import {
  getTokenActionLabel,
  shouldGenerateRegistrationToken,
} from "@/lib/onboardingFlow";
import { isTauri } from "@/lib/platform";
import { shouldLoadMachineBookmarks } from "@/lib/sidebarSections";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

interface QuickCommand {
  label: string;
  command: string;
}

interface SidebarProps {
  machines: MachineInfo[];
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  canCreateTerminal?: (machineId: string) => boolean;
  onRequestControl?: (machineId: string) => void;
  onOpenSettings?: () => void;
}

const directoryCache = createDirectoryCache();

function pathLabel(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

// Path autocomplete input
function PathInput({
  machineId,
  onSubmit,
  onCancel,
}: {
  machineId: string;
  onSubmit: (path: string) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const colorAlpha = useColorAlpha();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Fetch directory suggestions when input changes
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);

    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("/") && !trimmed.startsWith("~"))) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    fetchTimer.current = setTimeout(async () => {
      const lastSlash = trimmed.lastIndexOf("/");
      const parentDir = lastSlash > 0 ? trimmed.substring(0, lastSlash) : "/";
      const prefix =
        lastSlash >= 0 ? trimmed.substring(lastSlash + 1).toLowerCase() : "";
      const requestId = ++requestIdRef.current;

      const cachedEntries = readCachedDirectoryEntries(
        directoryCache,
        machineId,
        parentDir,
      );
      if (cachedEntries) {
        const dirs = buildDirectorySuggestions(cachedEntries, prefix);
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setSelectedIndex(-1);
        return;
      }

      try {
        const entries = await listDirectory(machineId, parentDir);
        if (requestId !== requestIdRef.current) {
          return;
        }
        writeCachedDirectoryEntries(
          directoryCache,
          machineId,
          parentDir,
          entries,
        );
        const dirs = buildDirectorySuggestions(entries, prefix);
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setSelectedIndex(-1);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 150);

    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, [value, machineId]);

  const handleSelect = useCallback((path: string) => {
    setValue(path);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  const handleKeyPress = useCallback(
    (e: any) => {
      const key = e.nativeEvent?.key;

      if (key === "Escape") {
        if (showSuggestions) {
          setShowSuggestions(false);
        } else {
          onCancel();
        }
        return;
      }

      if (
        key === "Tab" &&
        showSuggestions &&
        suggestions.length > 0
      ) {
        e.preventDefault?.();
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        handleSelect(suggestions[idx]);
        return;
      }

      if (key === "Enter") {
        if (showSuggestions && selectedIndex >= 0) {
          handleSelect(suggestions[selectedIndex]);
        } else {
          onSubmit(value.trim());
        }
        return;
      }

      if (key === "ArrowDown" && showSuggestions) {
        e.preventDefault?.();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, suggestions.length - 1),
        );
      } else if (key === "ArrowUp" && showSuggestions) {
        e.preventDefault?.();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    },
    [
      showSuggestions,
      suggestions,
      selectedIndex,
      value,
      handleSelect,
      onSubmit,
      onCancel,
    ],
  );

  return (
    <View style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <TextInput
          ref={inputRef}
          autoFocus={Platform.OS === "web"}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChangeText={setValue}
          onKeyPress={handleKeyPress}
          onBlur={() =>
            setTimeout(() => setShowSuggestions(false), 150)
          }
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 4,
            color: colors.foreground,
            paddingVertical: 4,
            paddingHorizontal: 8,
            fontSize: 12,
          }}
          placeholder="/path/to/directory…"
          placeholderTextColor={colors.foregroundMuted}
        />
        <Pressable
          onPress={() => onSubmit(value.trim())}
          style={{
            backgroundColor: colorAlpha.accentLight,
            borderWidth: 1,
            borderColor: colors.accent,
            borderRadius: 4,
            paddingVertical: 4,
            paddingHorizontal: 8,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: colors.accent,
            }}
          >
            Add
          </Text>
        </Pressable>
      </View>

      {/* Suggestions dropdown — web only for now (absolute positioning) */}
      {showSuggestions && Platform.OS === "web" && (
        <View
          style={{
            position: "absolute" as any,
            left: 12,
            right: 12,
            top: "100%" as any,
            marginTop: 2,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 4,
            zIndex: 50,
            maxHeight: 200,
            overflow: "hidden",
          }}
        >
          <ScrollView>
            {suggestions.map((path, i) => (
              <Pressable
                key={path}
                onPress={() => handleSelect(path)}
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: 8,
                  backgroundColor:
                    i === selectedIndex
                      ? colorAlpha.accentLight
                      : "transparent",
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    color:
                      i === selectedIndex
                        ? colors.accent
                        : colors.foreground,
                  }}
                >
                  {path}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function MachineSection({
  machine,
  onCreateTerminal,
  canCreateTerminal,
  onRequestControl,
  quickCommands,
}: {
  machine: MachineInfo;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  canCreateTerminal: boolean;
  onRequestControl?: (machineId: string) => void;
  quickCommands: QuickCommand[];
}) {
  const colors = useColors();
  const colorAlpha = useColorAlpha();
  const controlCopy = getTerminalControlCopy(false);
  const [expanded, setExpanded] = useState(Platform.OS !== "web");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const loadedRef = useRef(false);

  // Load bookmarks from API
  useEffect(() => {
    if (
      !shouldLoadMachineBookmarks({
        expanded,
        loaded: loadedRef.current,
      })
    ) {
      return;
    }
    loadedRef.current = true;

    listBookmarks(machine.id)
      .then((bms) => {
        if (bms.length === 0) {
          const homeDir = machine.home_dir || "/home";
          setBookmarks([
            {
              id: "local-home",
              machineId: machine.id,
              path: homeDir,
              label: "~",
              sortOrder: 0,
            },
          ]);
        } else {
          setBookmarks(bms);
        }
      })
      .catch(() => {
        // Fallback if API not available
        const homeDir = machine.home_dir || "/home";
        setBookmarks([
          {
            id: "local-home",
            machineId: machine.id,
            path: homeDir,
            label: "~",
            sortOrder: 0,
          },
        ]);
      });
  }, [expanded, machine.id, machine.home_dir]);

  const handleAddBookmark = useCallback(
    async (path: string) => {
      if (!path) return;
      if (bookmarks.some((b) => b.path === path)) {
        setShowAdd(false);
        return;
      }
      try {
        const bm = await createBookmark(
          machine.id,
          path,
          pathLabel(path),
        );
        setBookmarks((prev) => [...prev, bm]);
      } catch {
        // Fallback: add locally
        setBookmarks((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            machineId: machine.id,
            path,
            label: pathLabel(path),
            sortOrder: prev.length,
          },
        ]);
      }
      setShowAdd(false);
    },
    [machine.id, bookmarks],
  );

  const handleRemoveBookmark = useCallback(
    async (bm: Bookmark) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== bm.id));
      try {
        await deleteBookmark(bm.id);
      } catch {
        // Ignore — already removed from UI
      }
    },
    [],
  );

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {/* Machine header */}
      <Pressable
        testID={`machine-section-${machine.id}`}
        onPress={() => setExpanded((prev) => !prev)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: colorAlpha.backgroundDim,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.accent,
          }}
        />
        <Text
          numberOfLines={1}
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: colors.foreground,
            flex: 1,
          }}
        >
          {machine.name}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: colors.foregroundMuted,
          }}
        >
          {machine.os}
        </Text>
      </Pressable>

      {expanded && (
        <View style={{ paddingVertical: 6 }}>
          {/* Bookmark list */}
          {!canCreateTerminal && (
            <View
              style={{
                marginHorizontal: 12,
                marginBottom: 8,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colorAlpha.warningBorder,
                backgroundColor: colorAlpha.warningSubtle,
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 11, color: colors.warning }}>
                You are viewing this machine. Control it here before opening a new terminal.
              </Text>
              {onRequestControl && (
                <Pressable
                  testID={`machine-request-control-${machine.id}`}
                  onPress={() => onRequestControl(machine.id)}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: colors.accent,
                    borderRadius: 999,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: colors.background,
                    }}
                  >
                    {controlCopy.toggleLabel}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {bookmarks.map((bm) => {
            const visibleCmds = quickCommands.filter((c) => c.label && c.command);
            return (
              <Pressable
                key={bm.id}
                testID={`machine-bookmark-${bm.id}`}
                onPress={() => {
                  if (!canCreateTerminal) return;
                  onCreateTerminal(machine.id, bm.path, "");
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  backgroundColor: pressed
                    ? colors.surface
                    : "transparent",
                  opacity: canCreateTerminal ? 1 : 0.45,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 13,
                      color: colors.foreground,
                    }}
                  >
                    {bm.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 10,
                      color: colors.foregroundMuted,
                      marginBottom: visibleCmds.length > 0 && canCreateTerminal ? 3 : 0,
                    }}
                  >
                    {bm.path}
                  </Text>
                  {canCreateTerminal && visibleCmds.length > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      {visibleCmds.map((cmd) => (
                        <Pressable
                          key={cmd.label}
                          testID={`quick-cmd-${cmd.label}`}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            onCreateTerminal(machine.id, bm.path, cmd.command);
                          }}
                          style={({ pressed }) => ({
                            backgroundColor: pressed
                              ? colorAlpha.accentMedium
                              : colorAlpha.accentSubtle,
                            borderRadius: 3,
                            paddingVertical: 1,
                            paddingHorizontal: 5,
                          })}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.accent,
                            }}
                          >
                            {cmd.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleRemoveBookmark(bm);
                  }}
                  hitSlop={6}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      color: colors.foregroundMuted,
                    }}
                  >
                    &#x2715;
                  </Text>
                </Pressable>
              </Pressable>
            );
          })}

          {/* Add bookmark */}
          {showAdd ? (
            <PathInput
              machineId={machine.id}
              onSubmit={handleAddBookmark}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <Pressable
              onPress={() => setShowAdd(true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 6,
                paddingHorizontal: 12,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: colors.foregroundMuted,
                }}
              >
                +
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.foregroundMuted,
                }}
              >
                Add directory
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function AddMachinePanel({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const colorAlpha = useColorAlpha();
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createRegistrationToken("");
      setToken(resp.token);
      setExpiresAt(resp.expires_at);
    } catch (e: any) {
      setError(e.message || "Failed to generate token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || error) {
      return;
    }
    if (
      !shouldGenerateRegistrationToken({
        requested,
        token,
        expiresAt,
      })
    ) {
      return;
    }
    void handleGenerate();
  }, [error, expiresAt, handleGenerate, loading, requested, token]);

  const hubUrl =
    Platform.OS === "web" && typeof window !== "undefined"
      ? (() => {
          const { protocol, host } = window.location;
          const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
          return `${wsProtocol}//${host}/ws/machine`;
        })()
      : "ws://<HUB_HOST>:3000/ws/machine";

  const installCmd = getInstallCommand();
  const registerCmd = token
    ? getRegisterCommand(hubUrl, token)
    : "";
  const serviceCmd = getServiceInstallCommand();

  const fullScript = token
    ? buildOnboardingScript(hubUrl, token)
    : "";

  const handleCopy = useCallback(async () => {
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      try {
        await navigator.clipboard.writeText(fullScript);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Ignore clipboard write failures to avoid unhandled promise rejections.
      }
    }
  }, [fullScript]);

  const handleGenerateClick = useCallback(() => {
    setRequested(true);
    setCopied(false);
    setError(null);
    setToken(null);
    setExpiresAt(null);
  }, []);

  return (
    <View
      style={{
        padding: 12,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: colors.foreground,
          }}
        >
          Add Machine
        </Text>
        <Pressable onPress={onClose} hitSlop={6}>
          <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>
            &#x2715;
          </Text>
        </Pressable>
      </View>

      {!requested && !loading && !token && !error && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 11, color: colors.foregroundSecondary }}>
            Generate a registration token only when you are ready to copy the commands to a machine.
          </Text>
          <Pressable
            onPress={handleGenerateClick}
            style={{
              backgroundColor: colorAlpha.accentLight,
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: 6,
              paddingVertical: 8,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 12, color: colors.accent, fontWeight: "700" }}>
              {getTokenActionLabel({ loading, token })}
            </Text>
          </Pressable>
        </View>
      )}

      {loading && (
        <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>
          Generating token…
        </Text>
      )}

      {error && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 11, color: colors.danger }}>
            {error}
          </Text>
          <Pressable
            onPress={handleGenerateClick}
            style={{
              alignSelf: "flex-start",
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 6,
              paddingVertical: 6,
              paddingHorizontal: 10,
            }}
          >
            <Text style={{ fontSize: 11, color: colors.foreground }}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {token && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 11, color: colors.foregroundSecondary }}>
            Run these commands on the target machine:
          </Text>

          {/* Step 1: Install */}
          <View style={{ gap: 4 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: colors.foregroundSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              1. Install webmux-node
            </Text>
            <View
              style={{
                backgroundColor: colors.backgroundSecondary,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 4,
                padding: 8,
              }}
            >
              <Text
                selectable
                style={{
                  fontSize: 11,
                  color: colors.accent,
                  fontFamily: Platform.OS === "web" ? "monospace" : undefined,
                }}
              >
                {installCmd}
              </Text>
            </View>
          </View>

          {/* Step 2: Register */}
          <View style={{ gap: 4 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: colors.foregroundSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              2. Register with this hub
            </Text>
            <View
              style={{
                backgroundColor: colors.backgroundSecondary,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 4,
                padding: 8,
              }}
            >
              <Text
                selectable
                style={{
                  fontSize: 11,
                  color: colors.accent,
                  fontFamily: Platform.OS === "web" ? "monospace" : undefined,
                }}
              >
                {registerCmd}
              </Text>
            </View>
          </View>

          {/* Step 3: Start service */}
          <View style={{ gap: 4 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: "600",
                color: colors.foregroundSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              3. Start the service
            </Text>
            <View
              style={{
                backgroundColor: colors.backgroundSecondary,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 4,
                padding: 8,
              }}
            >
              <Text
                selectable
                style={{
                  fontSize: 11,
                  color: colors.accent,
                  fontFamily: Platform.OS === "web" ? "monospace" : undefined,
                }}
              >
                {serviceCmd}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={handleCopy}
            style={{
              backgroundColor: copied
                ? colorAlpha.accentMedium
                : colorAlpha.accentLight,
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: 4,
              paddingVertical: 6,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 12, color: colors.accent }}>
              {copied ? "Copied!" : "Copy all commands"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleGenerateClick}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 4,
              paddingVertical: 6,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 11, color: colors.foregroundSecondary }}>
              {getTokenActionLabel({ loading, token })}
            </Text>
          </Pressable>
          <Text style={{ fontSize: 10, color: colors.foregroundMuted }}>
            Token expires in 24 hours
          </Text>
        </View>
      )}
    </View>
  );
}


function SidebarComponent({
  machines,
  onCreateTerminal,
  canCreateTerminal,
  onRequestControl,
  onOpenSettings,
}: SidebarProps) {
  const colors = useColors();
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);

  // Load quick commands eagerly so tags appear when machine sections expand
  useEffect(() => {
    getSettings()
      .then((res) => {
        try {
          const cmds = JSON.parse(res.settings.quick_commands || "[]");
          setQuickCommands(cmds);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  return (
    <View
      style={{
        width: 260,
        minWidth: 260,
        backgroundColor: colors.backgroundSecondary,
        borderRightWidth: 1,
        borderRightColor: colors.border,
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <View
        style={{
          paddingTop: 16,
          paddingBottom: 12,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: colors.foregroundSecondary,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Machines
        </Text>
        <Pressable
          onPress={() => setShowAddMachine(true)}
          hitSlop={6}
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              fontSize: 16,
              color: colors.foregroundMuted,
            }}
          >
            +
          </Text>
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {machines.length === 0 && !showAddMachine ? (
          <View style={{ padding: 20, alignItems: "center" }}>
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 13,
              }}
            >
              No machines connected
            </Text>
          </View>
        ) : (
          machines.map((machine) => (
            <MachineSection
              key={machine.id}
              machine={machine}
              onCreateTerminal={onCreateTerminal}
              canCreateTerminal={canCreateTerminal?.(machine.id) ?? true}
              onRequestControl={onRequestControl}
              quickCommands={quickCommands}
            />
          ))
        )}
      </ScrollView>
      {showAddMachine && (
        <AddMachinePanel onClose={() => setShowAddMachine(false)} />
      )}
      {Platform.OS === "web" && onOpenSettings && (
        <Pressable
          onPress={onOpenSettings}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 14, color: colors.foregroundSecondary }}>
            {"\u2699"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.foregroundSecondary }}>
            Settings
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export const Sidebar = memo(SidebarComponent);
