import { useState, useCallback, useRef, useEffect } from "react";
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
} from "@/lib/api";

interface SidebarProps {
  machines: MachineInfo[];
  onCreateTerminal: (machineId: string, cwd: string) => void;
}

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
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      try {
        const entries = await listDirectory(machineId, parentDir);
        const dirs = entries
          .filter(
            (e) =>
              e.is_dir &&
              (prefix === "" || e.name.toLowerCase().startsWith(prefix)),
          )
          .map((e) => e.path)
          .slice(0, 8);
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
          autoFocus
          value={value}
          onChangeText={setValue}
          onKeyPress={handleKeyPress}
          onBlur={() =>
            setTimeout(() => setShowSuggestions(false), 150)
          }
          style={{
            flex: 1,
            backgroundColor: "rgb(17, 42, 69)",
            borderWidth: 1,
            borderColor: "rgb(26, 58, 92)",
            borderRadius: 4,
            color: "rgb(224, 232, 240)",
            paddingVertical: 4,
            paddingHorizontal: 8,
            fontSize: 12,
          }}
          placeholder="/path/to/directory"
          placeholderTextColor="rgb(74, 97, 120)"
        />
        <Pressable
          onPress={() => onSubmit(value.trim())}
          style={{
            backgroundColor: "rgba(0, 212, 170, 0.1)",
            borderWidth: 1,
            borderColor: "rgb(0, 212, 170)",
            borderRadius: 4,
            paddingVertical: 4,
            paddingHorizontal: 8,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: "rgb(0, 212, 170)",
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
            backgroundColor: "rgb(17, 42, 69)",
            borderWidth: 1,
            borderColor: "rgb(26, 58, 92)",
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
                      ? "rgba(0, 212, 170, 0.1)"
                      : "transparent",
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    color:
                      i === selectedIndex
                        ? "rgb(0, 212, 170)"
                        : "rgb(224, 232, 240)",
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
}: {
  machine: MachineInfo;
  onCreateTerminal: (machineId: string, cwd: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const loadedRef = useRef(false);

  // Load bookmarks from API
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    listBookmarks(machine.id)
      .then((bms) => {
        if (bms.length === 0) {
          // Create default bookmark for home dir
          const homeDir = machine.home_dir || "/home";
          createBookmark(machine.id, homeDir, "~").then((bm) => {
            setBookmarks([bm]);
          }).catch(() => {
            // API might not support bookmarks yet; use a local fallback
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
  }, [machine.id, machine.home_dir]);

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
        borderBottomColor: "rgb(26, 58, 92)",
      }}
    >
      {/* Machine header */}
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: "rgba(0,0,0,0.15)",
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: "rgb(0, 212, 170)",
          }}
        />
        <Text
          numberOfLines={1}
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: "rgb(224, 232, 240)",
            flex: 1,
          }}
        >
          {machine.name}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: "rgb(74, 97, 120)",
          }}
        >
          {machine.os}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: "rgb(122, 143, 166)",
            transform: [{ rotate: expanded ? "90deg" : "0deg" }],
          }}
        >
          {"\u25B6"}
        </Text>
      </Pressable>

      {expanded && (
        <View style={{ paddingVertical: 6 }}>
          {/* Bookmark list */}
          {bookmarks.map((bm) => (
            <Pressable
              key={bm.id}
              onPress={() =>
                onCreateTerminal(machine.id, bm.path)
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 6,
                paddingHorizontal: 12,
                backgroundColor: pressed
                  ? "rgb(17, 42, 69)"
                  : "transparent",
              })}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: "rgb(122, 143, 166)",
                }}
              >
                {"\u25B8"}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    color: "rgb(224, 232, 240)",
                  }}
                >
                  {bm.label}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 10,
                    color: "rgb(74, 97, 120)",
                  }}
                >
                  {bm.path}
                </Text>
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
                    color: "rgb(74, 97, 120)",
                  }}
                >
                  &#x2715;
                </Text>
              </Pressable>
            </Pressable>
          ))}

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
                  color: "rgb(74, 97, 120)",
                }}
              >
                +
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: "rgb(74, 97, 120)",
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

export function Sidebar({ machines, onCreateTerminal }: SidebarProps) {
  return (
    <View
      style={{
        width: 260,
        minWidth: 260,
        backgroundColor: "rgb(13, 33, 55)",
        borderRightWidth: 1,
        borderRightColor: "rgb(26, 58, 92)",
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
          borderBottomColor: "rgb(26, 58, 92)",
        }}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: "rgb(122, 143, 166)",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Machines
        </Text>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {machines.length === 0 ? (
          <View style={{ padding: 20, alignItems: "center" }}>
            <Text
              style={{
                color: "rgb(74, 97, 120)",
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
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
