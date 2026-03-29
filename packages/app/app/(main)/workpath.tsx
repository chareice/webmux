import { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type { Run } from "@webmux/shared";
import {
  timeAgo,
  toolLabel,
  runStatusColor,
  runStatusLabel,
} from "@webmux/shared";
import { useWorkpaths } from "../../lib/workpath-context";
import { deleteThread } from "../../lib/api";

// --- Thread Row (same pattern as index.tsx) ---

function ThreadRow({
  run,
  agentName,
  onDelete,
  onPress,
}: {
  run: Run;
  agentName: string | undefined;
  onDelete: () => void;
  onPress: () => void;
}) {
  const toolColor = run.tool === "codex" ? "#bb9af7" : "#7aa2f7";

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
      className="bg-surface border border-border rounded-lg px-4 py-3 mb-2"
      onPress={onPress}
    >
      {/* Top row: badges + time + delete */}
      <View className="flex-row items-center gap-2 mb-1.5">
        {/* Tool badge */}
        <View
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: `${toolColor}20` }}
        >
          <Text style={{ color: toolColor }} className="text-[11px] font-semibold">
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

        {/* Agent name */}
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
            style={{ backgroundColor: runStatusColor(run.status) }}
          />
          <Text
            className="text-[11px]"
            style={{ color: runStatusColor(run.status) }}
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

// --- Workpath Thread List Screen (mobile) ---

export default function WorkpathScreen() {
  const router = useRouter();
  const { path, agentId } = useLocalSearchParams<{
    path: string;
    agentId: string;
  }>();
  const { workpaths, agents, reload, setRuns } = useWorkpaths();

  const workpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === path) ?? null,
    [workpaths, path],
  );

  const handleDeleteThread = async (run: Run) => {
    try {
      await deleteThread(run.agentId, run.id);
      // Optimistic removal
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch {
      // Reload on failure to restore state
      await reload();
    }
  };

  // Empty state: no matching workpath
  if (!workpath) {
    return (
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="h-12 px-4 flex-row items-center border-b border-border">
          <Pressable onPress={() => router.back()} className="mr-3">
            <Text className="text-accent text-sm">← Back</Text>
          </Pressable>
          <Text className="text-foreground text-lg font-bold flex-1">
            Workpath
          </Text>
        </View>
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-foreground-secondary text-sm">
            No threads found for this workpath.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="px-4 pt-2 pb-2 border-b border-border">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()}>
            <Text className="text-accent text-sm">← Back</Text>
          </Pressable>
          <Text
            className="text-foreground text-lg font-bold flex-1"
            numberOfLines={1}
          >
            {workpath.dirName}
          </Text>
          <Pressable
            className="bg-accent rounded-md px-3 py-1.5"
            onPress={() => {
              const params = new URLSearchParams();
              params.set("agentId", agentId ?? workpath.agentId);
              params.set("repoPath", workpath.repoPath);
              router.push(
                `/(main)/threads/new?${params.toString()}` as never,
              );
            }}
          >
            <Text className="text-background text-xs font-semibold">
              + New Thread
            </Text>
          </Pressable>
        </View>
        {/* Path + node info */}
        <View className="mt-1">
          {workpath.nodeName ? (
            <Text className="text-foreground-secondary text-xs">
              {workpath.nodeName}
            </Text>
          ) : null}
          <Text
            className="text-foreground-secondary text-xs font-mono"
            numberOfLines={1}
          >
            {workpath.repoPath}
          </Text>
        </View>
      </View>

      {/* Thread list */}
      <ScrollView className="flex-1" contentContainerClassName="p-4">
        {workpath.runs.length === 0 ? (
          <Text className="text-foreground-secondary text-sm text-center py-8">
            No threads in this workpath yet.
          </Text>
        ) : (
          workpath.runs.map((run) => (
            <ThreadRow
              key={run.id}
              run={run}
              agentName={agents.get(run.agentId)?.name}
              onDelete={() => void handleDeleteThread(run)}
              onPress={() =>
                router.push(
                  `/(main)/threads/${run.agentId}/${run.id}` as never,
                )
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
