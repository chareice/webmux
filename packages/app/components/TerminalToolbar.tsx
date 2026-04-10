import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";

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
        borderTopColor: "rgb(26, 58, 92)",
        backgroundColor: "rgb(13, 33, 55)",
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
              ? "rgba(0, 212, 170, 0.1)"
              : "rgb(17, 42, 69)",
            borderWidth: 1,
            borderColor: ctrlMode
              ? "rgb(0, 212, 170)"
              : "rgb(26, 58, 92)",
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
                ? "rgb(0, 212, 170)"
                : "rgb(224, 232, 240)",
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
                ? "rgb(21, 53, 85)"
                : "rgb(17, 42, 69)",
              borderWidth: 1,
              borderColor: "rgb(26, 58, 92)",
              borderRadius: 4,
              paddingVertical: 6,
              paddingHorizontal: 10,
              minWidth: 36,
              alignItems: "center",
            })}
          >
            <Text
              style={{ fontSize: 13, color: "rgb(224, 232, 240)" }}
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
