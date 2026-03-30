import { View, Text, Pressable } from "react-native";
import type { Run } from "@webmux/shared";
import { timeAgo, toolLabel, runStatusLabel } from "@webmux/shared";
import { useTheme } from "../lib/theme";
import { getRunStatusThemeColor } from "../lib/theme-utils";

interface ThreadCardProps {
  run: Run;
  agentName: string | undefined;
  onPress: () => void;
  onLongPress?: () => void;
  isActive?: boolean;
  isSelected?: boolean;
  selectionMode?: boolean;
}

export function ThreadCard({
  run,
  agentName,
  onPress,
  onLongPress,
  isActive,
  isSelected,
  selectionMode,
}: ThreadCardProps) {
  const { colors } = useTheme();
  const isClaude = run.tool !== "codex";
  const statusColor = getRunStatusThemeColor(run.status, colors);
  const isRunning = run.status === "running" || run.status === "starting";

  return (
    <Pressable
      className={`border overflow-hidden ${
        isSelected
          ? "border-accent border-2"
          : isActive
            ? "border-accent"
            : "border-border"
      }`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Selection checkbox overlay */}
      {selectionMode ? (
        <View className="absolute top-1.5 right-1.5 z-10">
          <View
            className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
              isSelected
                ? "bg-accent border-accent"
                : "border-foreground-secondary bg-background"
            }`}
          >
            {isSelected ? (
              <Text className="text-background text-[10px] font-bold">
                {"\u2713"}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Card header */}
      <View className="px-3 py-2 flex-row items-center gap-2 border-b border-border bg-surface">
        {/* Unread dot */}
        {run.unread ? (
          <View className="w-2 h-2 rounded-full bg-red" />
        ) : null}

        {/* Tool badge */}
        <View
          className={`rounded px-1.5 py-0.5 ${isClaude ? "bg-foreground" : "bg-background border border-foreground"}`}
        >
          <Text
            className={`text-[10px] font-bold ${isClaude ? "text-background" : "text-foreground"}`}
          >
            {toolLabel(run.tool)}
          </Text>
        </View>

        {/* Branch */}
        {run.branch ? (
          <Text
            className="text-foreground-secondary text-[10px] font-mono flex-shrink"
            numberOfLines={1}
          >
            {run.branch}
          </Text>
        ) : null}

        {/* Spacer */}
        <View className="flex-1" />

        {/* Status dot */}
        <View className="flex-row items-center gap-1">
          <View
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          {isRunning ? (
            <Text className="text-[10px]" style={{ color: statusColor }}>
              {runStatusLabel(run.status)}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Card body - content preview */}
      <View className="px-3 py-2.5 bg-background min-h-[80px]">
        {run.prompt ? (
          <Text
            className="text-foreground text-xs leading-4"
            numberOfLines={4}
          >
            {run.prompt}
          </Text>
        ) : (
          <Text className="text-foreground-secondary text-xs italic">
            No prompt
          </Text>
        )}

        {run.summary ? (
          <Text
            className="text-foreground-secondary text-[11px] mt-1.5 leading-4"
            numberOfLines={2}
          >
            {run.summary}
          </Text>
        ) : null}
      </View>

      {/* Card footer */}
      <View className="px-3 py-1.5 flex-row items-center gap-2 border-t border-border bg-surface">
        {/* Has-diff badge */}
        {run.hasDiff ? (
          <View className="rounded px-1 py-0.5 bg-yellow/20">
            <Text className="text-yellow text-[10px] font-semibold">
              {"\u0394"}
            </Text>
          </View>
        ) : null}

        {/* Node name */}
        {agentName ? (
          <Text
            className="text-foreground-secondary text-[10px]"
            numberOfLines={1}
          >
            {agentName}
          </Text>
        ) : null}

        <View className="flex-1" />

        {/* Time */}
        <Text className="text-foreground-secondary text-[10px]">
          {timeAgo(run.updatedAt)}
        </Text>
      </View>
    </Pressable>
  );
}
