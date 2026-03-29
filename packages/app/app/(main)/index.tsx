import { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import type { Run } from "@webmux/shared";
import {
  timeAgo,
  toolLabel,
  runStatusColor,
  runStatusLabel,
} from "@webmux/shared";
import { useWorkpaths } from "../../lib/workpath-context";
import { deleteThread } from "../../lib/api";
import type { Workpath } from "../../lib/workpath";

// --- Thread Row ---

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
  const isClaude = run.tool !== "codex";

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

// --- Mobile: Workpath Card ---

function WorkpathCard({
  workpath,
  onPress,
}: {
  workpath: Workpath;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="bg-surface border border-border rounded-lg px-4 py-3 mb-2"
      onPress={onPress}
    >
      <View className="flex-row items-center gap-2">
        <Text className="text-foreground text-base font-semibold flex-1" numberOfLines={1}>
          {workpath.dirName}
        </Text>
        {workpath.activeCount > 0 ? (
          <View className="bg-accent/20 rounded px-1.5 py-0.5">
            <Text className="text-accent text-xs font-medium">
              {workpath.activeCount} active
            </Text>
          </View>
        ) : null}
        <Text className="text-foreground-secondary text-xs">
          {workpath.runs.length} {workpath.runs.length === 1 ? "thread" : "threads"}
        </Text>
      </View>
      {workpath.nodeName ? (
        <Text className="text-foreground-secondary text-xs mt-1">
          {workpath.nodeName}
        </Text>
      ) : null}
      <Text
        className="text-foreground-secondary text-xs mt-0.5 font-mono"
        numberOfLines={1}
      >
        {workpath.repoPath}
      </Text>
    </Pressable>
  );
}

// --- Main Home Screen ---

export default function HomeScreen() {
  const router = useRouter();
  const { workpaths, agents, selectedPath, isLoading, error, reload, setRuns } =
    useWorkpaths();

  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  // Selected workpath for web view
  const selectedWorkpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === selectedPath) ?? null,
    [workpaths, selectedPath],
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

  // --- Loading ---
  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#1a1a1a" size="large" />
        <Text className="text-foreground-secondary mt-3 text-sm">Loading...</Text>
      </View>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-red text-sm mb-4">{error}</Text>
        <Pressable
          className="bg-accent rounded-lg px-4 py-2"
          onPress={() => void reload()}
        >
          <Text className="text-background text-sm font-semibold">Retry</Text>
        </Pressable>
      </View>
    );
  }

  // --- Web wide view: thread list for selected workpath ---
  if (isWideScreen) {
    if (!selectedWorkpath) {
      return (
        <View className="flex-1 bg-background items-center justify-center">
          <Text className="text-foreground-secondary text-sm">
            No workpaths yet. Start a new thread to get started.
          </Text>
          <Pressable
            className="bg-accent rounded-lg px-4 py-2 mt-4"
            onPress={() => router.push("/(main)/threads/new" as never)}
          >
            <Text className="text-background text-sm font-semibold">
              + New Thread
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View className="flex-1 bg-background">
        {/* Header */}
        <View className="h-12 px-4 flex-row items-center border-b border-border">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-foreground text-lg font-bold">
                {selectedWorkpath.dirName}
              </Text>
              <Text className="text-foreground-secondary text-xs font-mono">
                {selectedWorkpath.repoPath}
              </Text>
            </View>
          </View>
          <Pressable
            className="bg-accent rounded-md px-3 py-1.5"
            onPress={() => {
              const params = new URLSearchParams();
              params.set("agentId", selectedWorkpath.agentId);
              params.set("repoPath", selectedWorkpath.repoPath);
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

        {/* Thread list */}
        <ScrollView className="flex-1" contentContainerClassName="p-4">
          {selectedWorkpath.runs.length === 0 ? (
            <Text className="text-foreground-secondary text-sm text-center py-8">
              No threads in this workpath yet.
            </Text>
          ) : (
            selectedWorkpath.runs.map((run) => (
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

  // --- Mobile view: workpath list ---
  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="px-4 pt-2 pb-3 flex-row items-center gap-3">
        <Text className="text-foreground text-2xl font-bold flex-1">webmux</Text>
        <Pressable
          className="bg-accent rounded-md px-3 py-1.5"
          onPress={() => router.push("/(main)/threads/new" as never)}
        >
          <Text className="text-background text-xs font-semibold">+ New</Text>
        </Pressable>
        <Pressable
          className="bg-surface border border-border rounded-md px-3 py-1.5"
          onPress={() => router.push("/(main)/settings" as never)}
        >
          <Text className="text-foreground-secondary text-xs">Settings</Text>
        </Pressable>
      </View>

      {/* Workpath list */}
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8">
        {workpaths.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-foreground-secondary text-sm">
              No threads yet. Create one to get started.
            </Text>
          </View>
        ) : (
          workpaths.map((wp) => (
            <WorkpathCard
              key={wp.repoPath}
              workpath={wp}
              onPress={() => {
                router.push(
                  `/(main)/workpath?path=${encodeURIComponent(wp.repoPath)}&agentId=${wp.agentId}` as never,
                );
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
