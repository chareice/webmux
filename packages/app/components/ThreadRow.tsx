import {
  View,
  Text,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import type { Run } from "@webmux/shared";
import { timeAgo, toolLabel, runStatusLabel } from "@webmux/shared";
import { useTheme } from "../lib/theme";
import { getRunStatusThemeColor } from "../lib/theme-utils";

interface ThreadRowProps {
  run: Run;
  agentName: string | undefined;
  onDelete: () => void;
  onPress: () => void;
  isActive?: boolean;
}

export function ThreadRow({
  run,
  agentName,
  onDelete,
  onPress,
  isActive,
}: ThreadRowProps) {
  const { colors } = useTheme();
  const isClaude = run.tool !== "codex";
  const statusColor = getRunStatusThemeColor(run.status, colors);

  const handleDelete = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Delete this thread?")) {
        onDelete();
      }
    } else {
      Alert.alert("Delete Thread", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: onDelete },
      ]);
    }
  };

  return (
    <Pressable
      className={`border border-border px-4 py-3 mb-2 ${
        isActive
          ? "bg-accent/10 border-l-2 border-l-accent"
          : "bg-surface"
      }`}
      onPress={onPress}
    >
      {/* Top row: badges + time + delete */}
      <View className="flex-row items-center gap-2 mb-1.5">
        {/* Tool badge */}
        <View
          className={`rounded px-1.5 py-0.5 ${isClaude ? "bg-foreground" : "bg-background border border-foreground"}`}
        >
          <Text className={`text-[11px] font-bold ${isClaude ? "text-background" : "text-foreground"}`}>
            {toolLabel(run.tool)}
          </Text>
        </View>

        {/* Branch */}
        {run.branch ? (
          <Text
            className="text-foreground-secondary text-[11px] font-mono"
            numberOfLines={1}
          >
            {run.branch}
          </Text>
        ) : null}

        {/* Node name */}
        {agentName ? (
          <Text className="text-foreground-secondary text-[11px]" numberOfLines={1}>
            {agentName}
          </Text>
        ) : null}

        {/* Has-diff badge */}
        {run.hasDiff ? (
          <View className="rounded px-1.5 py-0.5 bg-yellow/20">
            <Text className="text-yellow text-[11px] font-semibold">{"\u0394"}</Text>
          </View>
        ) : null}

        {/* Spacer */}
        <View className="flex-1" />

        {/* Status */}
        <View className="flex-row items-center gap-1">
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <Text
            className="text-[11px]"
            style={{ color: statusColor }}
          >
            {runStatusLabel(run.status)}
          </Text>
        </View>

        {/* Time */}
        <Text className="text-foreground-secondary text-[11px]">
          {timeAgo(run.updatedAt)}
        </Text>

        {/* Delete */}
        <Pressable
          className="rounded px-1.5 py-0.5"
          onPress={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Text className="text-foreground-secondary text-[11px]">x</Text>
        </Pressable>
      </View>

      {/* Prompt preview */}
      {run.prompt ? (
        <Text className="text-foreground text-sm" numberOfLines={2}>
          {run.prompt}
        </Text>
      ) : null}

      {/* Summary */}
      {run.summary ? (
        <Text className="text-foreground-secondary text-xs mt-1" numberOfLines={2}>
          {run.summary}
        </Text>
      ) : null}
    </Pressable>
  );
}
