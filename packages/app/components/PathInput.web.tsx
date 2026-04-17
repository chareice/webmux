import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { listDirectory } from "@/lib/api";
import { useColors, useColorAlpha } from "@/lib/theme";
import {
  buildDirectorySuggestions,
  createDirectoryCache,
  readCachedDirectoryEntries,
  writeCachedDirectoryEntries,
} from "@/lib/directoryAutocomplete";

const directoryCache = createDirectoryCache();

// Path autocomplete input
export function PathInput({
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
