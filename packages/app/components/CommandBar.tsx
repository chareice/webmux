import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { colors, colorAlpha } from "@/lib/colors";

interface CommandBarProps {
  onSend: (data: string) => void;
  onImagePaste?: (base64: string, mime: string) => void;
}

const SHORTCUTS = [
  { label: "Ctrl+C", data: "\x03", desc: "Interrupt" },
  { label: "Ctrl+D", data: "\x04", desc: "EOF" },
  { label: "Ctrl+Z", data: "\x1a", desc: "Suspend" },
  { label: "Ctrl+L", data: "\x0c", desc: "Clear" },
  { label: "Ctrl+R", data: "\x12", desc: "Search history" },
  { label: "Ctrl+A", data: "\x01", desc: "Line start" },
  { label: "Ctrl+E", data: "\x05", desc: "Line end" },
  { label: "Tab", data: "\t", desc: "Autocomplete" },
  { label: "Esc", data: "\x1b", desc: "Escape" },
  { label: "\u2191", data: "\x1b[A", desc: "Previous" },
  { label: "\u2193", data: "\x1b[B", desc: "Next" },
];

function readImageFile(
  file: File,
  onImagePaste: (b64: string, mime: string) => void,
) {
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = (reader.result as string).split(",")[1];
    onImagePaste(base64, file.type || "image/png");
  };
  reader.readAsDataURL(file);
}

export function CommandBar({ onSend, onImagePaste }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<TextInput>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = useCallback(() => {
    if (!value) return;
    onSend(value + "\r");
    setHistory((prev) => {
      const next = [...prev, value];
      return next.length > 50 ? next.slice(-50) : next;
    });
    setValue("");
    setHistoryIndex(-1);
  }, [value, onSend]);

  const handleKeyPress = useCallback(
    (e: any) => {
      // On web, TextInput's onKeyPress gives us nativeEvent.key
      const key = e.nativeEvent?.key;
      if (key === "Enter" && !e.nativeEvent?.shiftKey) {
        e.preventDefault?.();
        handleSubmit();
      } else if (key === "ArrowUp" && !value.includes("\n")) {
        e.preventDefault?.();
        if (history.length === 0) return;
        const newIndex =
          historyIndex === -1
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      } else if (key === "ArrowDown" && !value.includes("\n")) {
        e.preventDefault?.();
        if (historyIndex === -1) return;
        if (historyIndex >= history.length - 1) {
          setHistoryIndex(-1);
          setValue("");
        } else {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setValue(history[newIndex]);
        }
      }
    },
    [handleSubmit, history, historyIndex, value],
  );

  const handleShortcut = useCallback(
    (data: string) => {
      onSend(data);
      inputRef.current?.focus();
    },
    [onSend],
  );

  return (
    <View
      style={{
        backgroundColor: colorAlpha.backgroundOverlay,
        flexDirection: "column",
        overflow: "hidden",
        flex: 1,
      }}
    >
      {/* Header */}
      <View
        style={{
          padding: 8,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: colors.foregroundSecondary,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Control
        </Text>
      </View>

      {/* Command input */}
      <View
        style={{
          padding: 8,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <TextInput
          ref={inputRef}
          testID="command-bar-input"
          value={value}
          onChangeText={(text) => {
            setValue(text);
            setHistoryIndex(-1);
          }}
          onKeyPress={handleKeyPress}
          multiline
          numberOfLines={3}
          style={{
            width: "100%",
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 4,
            color: colors.foreground,
            padding: 6,
            paddingHorizontal: 8,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineHeight: 17,
            maxHeight: 60,
          }}
          placeholder="Command..."
          placeholderTextColor={colors.foregroundMuted}
        />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: colors.foregroundMuted }}>
            Paste image or drag file
          </Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {Platform.OS === "web" && onImagePaste && (
              <Pressable
                accessibilityRole="button"
                testID="command-bar-image"
                onPress={() => {
                  // Create file input on demand for web
                  if (!fileInputRef.current) {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.style.display = "none";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (file && onImagePaste)
                        readImageFile(file, onImagePaste);
                      input.value = "";
                    };
                    document.body.appendChild(input);
                    fileInputRef.current = input;
                  }
                  fileInputRef.current.click();
                }}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 4,
                  paddingVertical: 3,
                  paddingHorizontal: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: colors.foregroundSecondary }}>
                  IMG
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              testID="command-bar-send"
              onPress={handleSubmit}
              style={{
                backgroundColor: colorAlpha.accentLight,
                borderWidth: 1,
                borderColor: colors.success,
                borderRadius: 4,
                paddingVertical: 3,
                paddingHorizontal: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: colors.success,
                }}
              >
                Send
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Shortcuts */}
      <ScrollView style={{ flex: 1, paddingVertical: 4 }}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.label}
            onPress={() => handleShortcut(s.data)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 5,
              paddingHorizontal: 10,
              backgroundColor: pressed
                ? colors.surface
                : "transparent",
            })}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
              }}
            >
              {s.label}
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
              {s.desc}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* History */}
      {history.length > 0 && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            maxHeight: 120,
          }}
        >
          <Text
            style={{
              paddingHorizontal: 10,
              paddingTop: 6,
              paddingBottom: 2,
              fontSize: 10,
              color: colors.foregroundMuted,
              textTransform: "uppercase",
            }}
          >
            History
          </Text>
          <ScrollView>
            {[...history]
              .reverse()
              .slice(0, 10)
              .map((cmd, i) => (
                <Pressable
                  key={`${i}-${cmd}`}
                  onPress={() => {
                    setValue(cmd);
                    inputRef.current?.focus();
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 3,
                    paddingHorizontal: 10,
                    backgroundColor: pressed
                      ? colors.surface
                      : "transparent",
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: colors.foregroundSecondary,
                    }}
                  >
                    {cmd}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
