import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useColors } from "@/lib/theme";

interface TerminalToolbarProps {
  onKey: (data: string) => void;
}

const KEYS = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "\u2191", data: "\x1b[A" },
  { label: "\u2193", data: "\x1b[B" },
  { label: "\u2190", data: "\x1b[D" },
  { label: "\u2192", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "~", data: "~" },
];

const CTRL_KEYS = [
  { label: "C", data: "\x03" },
  { label: "D", data: "\x04" },
  { label: "Z", data: "\x1a" },
  { label: "L", data: "\x0c" },
  { label: "A", data: "\x01" },
  { label: "E", data: "\x05" },
  { label: "R", data: "\x12" },
  { label: "W", data: "\x17" },
];

export function TerminalToolbar({ onKey }: TerminalToolbarProps) {
  const colors = useColors();
  const [ctrlMode, setCtrlMode] = useState(false);

  const handleCtrlToggle = useCallback(() => {
    setCtrlMode((prev) => !prev);
  }, []);

  const handleKey = useCallback(
    (data: string) => {
      onKey(data);
      setCtrlMode(false);
    },
    [onKey],
  );

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.backgroundSecondary,
        flexShrink: 0,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 4,
          paddingVertical: 6,
          paddingHorizontal: 8,
        }}
      >
        <Pressable
          onPress={handleCtrlToggle}
          style={{
            backgroundColor: ctrlMode
              ? colors.accentDim
              : colors.surface,
            borderWidth: 1,
            borderColor: ctrlMode
              ? colors.accent
              : colors.border,
            borderRadius: 4,
            paddingVertical: 6,
            paddingHorizontal: 10,
            minWidth: 36,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: ctrlMode
                ? colors.accent
                : colors.foreground,
            }}
            selectable={false}
          >
            Ctrl
          </Text>
        </Pressable>

        {(ctrlMode ? CTRL_KEYS : KEYS).map((k) => (
          <Pressable
            key={k.label}
            onPress={() => handleKey(k.data)}
            style={({ pressed }) => ({
              backgroundColor: pressed
                ? colors.surfaceHover
                : colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 4,
              paddingVertical: 6,
              paddingHorizontal: 10,
              minWidth: 36,
              alignItems: "center",
            })}
          >
            <Text
              style={{ fontSize: 13, color: colors.foreground }}
              selectable={false}
            >
              {ctrlMode ? `^${k.label}` : k.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
