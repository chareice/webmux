import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import type { AgentInfo, Run, RunStatus } from "@webmux/shared";
import {
  timeAgo,
  runStatusLabel,
  runStatusColor,
  toolIcon,
  repoName,
} from "@webmux/shared";
import { listAllThreads, listAgents, deleteThread } from "../../../lib/api";

// --- Constants ---

const ACTIVE_STATUSES: RunStatus[] = ["starting", "running"];
const AUTO_REFRESH_INTERVAL = 5000;

// --- Types ---

interface ProjectGroup {
  repoPath: string;
  repoName: string;
  runs: Run[];
  hasActive: boolean;
  latestUpdate: number;
}

// --- Helpers ---

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function aiPreview(run: Run): string {
  if (run.summary) return truncate(run.summary, 120);
  if (run.status === "running" || run.status === "starting") return "Running...";
  return "No summary";
}

function groupByProject(runs: Run[]): ProjectGroup[] {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const key = run.repoPath;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(run);
  }

  const groups: ProjectGroup[] = [];
  for (const [path, groupRuns] of map) {
    groupRuns.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.push({
      repoPath: path,
      repoName: repoName(path),
      runs: groupRuns,
      hasActive: groupRuns.some((r) => ACTIVE_STATUSES.includes(r.status)),
      latestUpdate: groupRuns[0].updatedAt,
    });
  }

  // Sort: groups with active runs first, then by most recent update
  groups.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1;
    return b.latestUpdate - a.latestUpdate;
  });

  return groups;
}

// --- Components ---

function ThreadRow({
  run,
  agentName,
  isDeleting,
  onDelete,
  onPress,
}: {
  run: Run;
  agentName?: string;
  isDeleting: boolean;
  onDelete: () => void;
  onPress: () => void;
}) {
  const statusColor = runStatusColor(run.status);
  const isActive = run.status === "running" || run.status === "starting";

  return (
    <Pressable
      className={`bg-surface p-3 border-b border-border ${isActive ? "border-l-2 border-l-accent" : ""}`}
      onPress={onPress}
    >
      {/* Row 1: meta info */}
      <View className="flex-row items-center gap-2 mb-1.5">
        {/* Tool badge */}
        <View
          className={`rounded px-1.5 py-0.5 ${run.tool === "codex" ? "bg-purple/20" : "bg-accent/20"}`}
        >
          <Text
            className={`text-xs font-bold ${run.tool === "codex" ? "text-purple" : "text-accent"}`}
          >
            {toolIcon(run.tool)}
          </Text>
        </View>

        {/* Branch */}
        {run.branch ? (
          <Text className="text-foreground-secondary text-xs" numberOfLines={1}>
            {run.branch}
          </Text>
        ) : null}

        {/* Agent name */}
        {agentName ? (
          <>
            <Text className="text-foreground-secondary text-xs">·</Text>
            <Text className="text-foreground-secondary text-xs" numberOfLines={1}>
              {agentName}
            </Text>
          </>
        ) : null}

        {/* Spacer */}
        <View className="flex-1" />

        {/* Has-diff badge */}
        {run.hasDiff ? (
          <View className="bg-yellow/20 rounded px-1.5 py-0.5">
            <Text className="text-yellow text-xs font-bold">Δ</Text>
          </View>
        ) : null}

        {/* Status badge */}
        <View className="flex-row items-center gap-1">
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <Text className="text-xs" style={{ color: statusColor }}>
            {runStatusLabel(run.status)}
          </Text>
        </View>

        {/* Time ago */}
        <Text className="text-foreground-secondary text-xs">
          {timeAgo(run.updatedAt)}
        </Text>

        {/* Delete button */}
        <Pressable
          className="bg-surface-light rounded px-2 py-1 ml-1"
          disabled={isDeleting}
          onPress={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          hitSlop={4}
        >
          <Text className="text-red text-xs">{isDeleting ? "..." : "✕"}</Text>
        </Pressable>
      </View>

      {/* Row 2: prompt and summary */}
      <View className="flex-row items-center gap-1.5">
        <Text className="text-foreground text-sm flex-shrink" numberOfLines={1}>
          {truncate(run.prompt, 80)}
        </Text>
        {run.summary || isActive ? (
          <>
            <Text className="text-foreground-secondary text-xs">→</Text>
            <Text
              className="text-foreground-secondary text-xs flex-1"
              numberOfLines={1}
            >
              {aiPreview(run)}
            </Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

// --- Main Screen ---

export default function ThreadsScreen() {
  const router = useRouter();

  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set()
  );
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const [threadsData, agentsData] = await Promise.all([
        listAllThreads(),
        listAgents(),
      ]);
      setRuns(threadsData);
      setAgents(new Map(agentsData.agents.map((a) => [a.id, a])));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  // Auto-refresh when there are active runs
  useEffect(() => {
    const hasActive = runs.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (hasActive) {
      intervalRef.current = setInterval(() => {
        void loadData(false);
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runs, loadData]);

  const handleDelete = async (run: Run) => {
    const label =
      run.status === "starting" || run.status === "running"
        ? "This will stop the running task and remove it."
        : "This will remove the thread.";

    const doDelete = async () => {
      try {
        setDeletingId(run.id);
        await deleteThread(run.agentId, run.id);
        setRuns((prev) => prev.filter((r) => r.id !== run.id));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDeletingId(null);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm(label)) return;
      await doDelete();
    } else {
      Alert.alert("Delete Thread", label, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void doDelete(),
        },
      ]);
    }
  };

  const projectGroups = useMemo(() => groupByProject(runs), [runs]);

  const toggleProject = (repoPath: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) next.delete(repoPath);
      else next.add(repoPath);
      return next;
    });
  };

  // Find online agents for the "New Thread" button
  const onlineAgents = useMemo(
    () => [...agents.values()].filter((a) => a.status === "online"),
    [agents]
  );

  const handleNewThread = () => {
    if (onlineAgents.length === 1) {
      router.push(
        `/(main)/threads/new?agentId=${onlineAgents[0].id}` as never
      );
    } else if (onlineAgents.length > 1) {
      setAgentPickerOpen(true);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading threads...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-foreground text-2xl font-bold">Threads</Text>
          {onlineAgents.length > 0 ? (
            <Pressable
              className="flex-row items-center bg-accent rounded-lg px-4 py-2"
              onPress={handleNewThread}
            >
              <Text className="text-background font-semibold text-sm">
                + New Thread
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Error banner */}
        {error ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-4">
            <Text className="text-red text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Empty state */}
        {runs.length === 0 && !error ? (
          <View className="items-center justify-center py-16">
            <Text className="text-foreground text-xl font-semibold mb-2">
              No threads yet
            </Text>
            <Text className="text-foreground-secondary text-sm text-center px-8">
              Create a thread to run Claude Code or Codex on a remote agent.
            </Text>
          </View>
        ) : null}

        {/* Thread groups */}
        {projectGroups.map((group) => {
          const isCollapsed = collapsedProjects.has(group.repoPath);
          const activeCount = group.runs.filter((r) =>
            ACTIVE_STATUSES.includes(r.status)
          ).length;

          return (
            <View key={group.repoPath} className="mb-3">
              {/* Group header */}
              <Pressable
                className="bg-surface-light rounded-t-lg px-4 py-2 flex-row items-center gap-2"
                onPress={() => toggleProject(group.repoPath)}
              >
                {/* Chevron */}
                <Text className="text-foreground-secondary text-xs">
                  {isCollapsed ? "▸" : "▾"}
                </Text>

                {/* Repo name */}
                <Text className="text-foreground font-semibold text-sm">
                  {group.repoName}
                </Text>

                {/* Full path */}
                <Text
                  className="text-foreground-secondary text-xs flex-1"
                  numberOfLines={1}
                >
                  {group.repoPath}
                </Text>

                {/* Thread count */}
                <View className="bg-surface rounded px-1.5 py-0.5">
                  <Text className="text-foreground-secondary text-xs">
                    {group.runs.length}
                  </Text>
                </View>

                {/* Active count badge */}
                {activeCount > 0 ? (
                  <View className="bg-accent/20 rounded px-1.5 py-0.5">
                    <Text className="text-accent text-xs font-medium">
                      {activeCount} active
                    </Text>
                  </View>
                ) : null}
              </Pressable>

              {/* Thread list */}
              {!isCollapsed ? (
                <View className="rounded-b-lg overflow-hidden border border-border border-t-0">
                  {group.runs.map((run) => (
                    <ThreadRow
                      key={run.id}
                      run={run}
                      agentName={agents.get(run.agentId)?.name}
                      isDeleting={deletingId === run.id}
                      onDelete={() => void handleDelete(run)}
                      onPress={() =>
                        router.push(
                          `/(main)/threads/${run.agentId}/${run.id}` as never
                        )
                      }
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Agent picker modal (for multi-agent new thread) */}
      <Modal
        visible={agentPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAgentPickerOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center p-4"
          onPress={() => setAgentPickerOpen(false)}
        >
          <Pressable
            className="bg-surface rounded-xl w-full max-w-sm p-5 border border-border"
            onPress={() => {
              /* prevent close when tapping modal body */
            }}
          >
            <Text className="text-foreground text-lg font-bold mb-4">
              Select Agent
            </Text>
            <View className="gap-2">
              {onlineAgents.map((agent) => (
                <Pressable
                  key={agent.id}
                  className="bg-surface-light rounded-lg px-4 py-3 flex-row items-center"
                  onPress={() => {
                    setAgentPickerOpen(false);
                    router.push(
                      `/(main)/threads/new?agentId=${agent.id}` as never
                    );
                  }}
                >
                  <View className="w-2.5 h-2.5 rounded-full bg-green mr-3" />
                  <Text className="text-foreground text-sm font-medium">
                    {agent.name || agent.id}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              className="mt-4 bg-surface-light rounded-lg py-2.5 items-center"
              onPress={() => setAgentPickerOpen(false)}
            >
              <Text className="text-foreground-secondary text-sm">Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
