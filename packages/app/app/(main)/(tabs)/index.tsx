import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import type { Run } from "@webmux/shared";
import { useWorkpaths } from "../../../lib/workpath-context";
import { createRegistrationToken, deleteThread } from "../../../lib/api";
import { LAST_SERVER_URL_KEY } from "../../../lib/auth-utils";
import { buildRegistrationCommand } from "../../../lib/registration-utils";
import { storage } from "../../../lib/storage";
import { useTheme } from "../../../lib/theme";
import { ThreadCard } from "../../../components/ThreadCard";
import { ThreadDrawer } from "../../../components/ThreadDrawer";
import ThreadDetailScreen from "../threads/[agentId]/[id]";
import type { Workpath } from "../../../lib/workpath";

// --- Onboarding: inline node registration ---

function OnboardingView() {
  const { colors } = useTheme();

  const [registering, setRegistering] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cachedRef = useRef<{ token: string; expiresAt: number; serverUrl?: string | null } | null>(null);
  const [lastServerUrl, setLastServerUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void storage.get(LAST_SERVER_URL_KEY).then((v) => {
      if (!cancelled) setLastServerUrl(v);
    });
    return () => { cancelled = true; };
  }, []);

  const buildCmd = useCallback(
    (token: string, serverUrl?: string | null) => {
      const windowOrigin =
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.origin
          : null;
      return buildRegistrationCommand({ token, serverUrl, lastServerUrl, windowOrigin });
    },
    [lastServerUrl],
  );

  const generateToken = useCallback(async () => {
    // Reuse cached token if valid
    const cached = cachedRef.current;
    if (cached && cached.expiresAt > Date.now() + 60000) {
      setCommand(buildCmd(cached.token, cached.serverUrl));
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      const data = await createRegistrationToken();
      cachedRef.current = {
        token: data.token,
        expiresAt: data.expiresAt,
        serverUrl: data.serverUrl ?? null,
      };
      setCommand(buildCmd(data.token, data.serverUrl));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  }, [buildCmd]);

  // Auto-generate on mount
  useEffect(() => {
    void generateToken();
  }, [generateToken]);

  const handleCopy = async () => {
    if (!command) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleRegenerate = () => {
    cachedRef.current = null;
    setCommand(null);
    setCopied(false);
    void generateToken();
  };

  return (
    <View className="flex-1 bg-background items-center justify-center p-8">
      <View className="w-full max-w-md">
        <Text className="text-foreground text-2xl font-bold mb-2">
          Welcome to webmux
        </Text>
        <Text className="text-foreground-secondary text-sm mb-6 leading-5">
          Connect a machine to get started. Run the command below on the server
          where your coding agent should work.
        </Text>

        {registering ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={colors.accent} />
            <Text className="text-foreground-secondary mt-2 text-sm">
              Generating registration command...
            </Text>
          </View>
        ) : command ? (
          <View>
            <Text className="text-foreground-secondary text-xs mb-2 font-semibold uppercase tracking-wide">
              Run on your server
            </Text>
            <View className="bg-surface border border-border p-3 mb-3">
              <Text className="text-foreground text-xs font-mono" selectable>
                {command}
              </Text>
            </View>
            <View className="flex-row gap-2 mb-4">
              <Pressable
                className="bg-foreground px-4 py-2"
                onPress={() => void handleCopy()}
              >
                <Text className="text-background text-sm font-semibold">
                  {copied ? "Copied!" : "Copy"}
                </Text>
              </Pressable>
              <Pressable
                className="bg-surface border border-border px-4 py-2"
                onPress={handleRegenerate}
              >
                <Text className="text-foreground-secondary text-sm">
                  Regenerate
                </Text>
              </Pressable>
            </View>
            <Text className="text-foreground-secondary text-xs leading-4">
              Once the agent connects, this page will update automatically.
              Use --name to set a custom node name.
            </Text>
          </View>
        ) : error ? (
          <View>
            <Text className="text-red text-sm mb-3">{error}</Text>
            <Pressable
              className="bg-surface border border-border px-4 py-2 self-start"
              onPress={handleRegenerate}
            >
              <Text className="text-foreground text-sm">Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
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

// --- Web: Canvas grid view ---

function ThreadCanvasView() {
  const router = useRouter();
  const { workpaths, agents, selectedPath, setSelectedPath, isLoading, setRuns } =
    useWorkpaths();
  const { colors } = useTheme();

  // Drawer state
  const [drawerThread, setDrawerThread] = useState<{
    agentId: string;
    threadId: string;
  } | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(allRuns.map((r) => r.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (Platform.OS === "web") {
      if (!window.confirm(`Delete ${count} thread${count > 1 ? "s" : ""}?`)) return;
    }
    setDeleting(true);
    try {
      const toDelete = allRuns.filter((r) => selectedIds.has(r.id));
      await Promise.all(
        toDelete.map((r) => deleteThread(r.agentId, r.id)),
      );
      setRuns((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    } catch {
      // best effort
    }
    setDeleting(false);
    clearSelection();
  };

  const selectedWorkpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === selectedPath) ?? null,
    [workpaths, selectedPath],
  );

  // All threads sorted by updatedAt (newest first)
  const allRuns = useMemo(() => {
    const runs = selectedWorkpath
      ? selectedWorkpath.runs
      : workpaths.flatMap((wp) => wp.runs);
    return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [selectedWorkpath, workpaths]);

  const handleThreadPress = (run: Run) => {
    if (selectionMode) {
      toggleSelect(run.id);
      return;
    }
    setDrawerThread({ agentId: run.agentId, threadId: run.id });
  };

  const handleLongPress = (run: Run) => {
    toggleSelect(run.id);
  };

  const handleNewThread = () => {
    if (selectedWorkpath) {
      const params = new URLSearchParams();
      params.set("agentId", selectedWorkpath.agentId);
      params.set("repoPath", selectedWorkpath.repoPath);
      router.push(`/(main)/threads/new?${params.toString()}` as never);
    } else {
      router.push("/(main)/threads/new" as never);
    }
  };

  return (
    <View className="flex-1 flex-row bg-background">
      {/* Left sidebar: workpath list */}
      <View className="w-48 bg-surface border-r border-border flex-col">
        {/* Sidebar header */}
        <View className="h-12 px-3 flex-row items-center border-b border-border">
          <Text className="text-foreground text-base font-bold flex-1">
            webmux
          </Text>
          <Pressable
            className="bg-accent rounded-md px-2 py-1"
            onPress={handleNewThread}
          >
            <Text className="text-background text-[11px] font-semibold">
              + New
            </Text>
          </Pressable>
        </View>

        {/* Workpath list */}
        <ScrollView className="flex-1" contentContainerClassName="py-1">
          <Pressable
            className={`px-3 py-2 ${!selectedPath ? "bg-accent/10" : ""}`}
            onPress={() => setSelectedPath(null)}
          >
            <Text
              className={`text-sm ${!selectedPath ? "text-accent font-semibold" : "text-foreground-secondary"}`}
            >
              All
            </Text>
          </Pressable>
          {workpaths.map((wp) => {
            const isSelected = selectedPath === wp.repoPath;
            return (
              <Pressable
                key={wp.repoPath}
                className={`px-3 py-2 ${isSelected ? "bg-accent/10" : ""}`}
                onPress={() => setSelectedPath(wp.repoPath)}
              >
                <View className="flex-row items-center gap-1.5">
                  <Text
                    className={`text-sm flex-1 ${isSelected ? "text-accent font-semibold" : "text-foreground"}`}
                    numberOfLines={1}
                  >
                    {wp.dirName}
                  </Text>
                  {wp.activeCount > 0 ? (
                    <View className="bg-accent/20 rounded px-1 py-0.5">
                      <Text className="text-accent text-[10px] font-medium">
                        {wp.activeCount}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-foreground-secondary text-[10px]">
                      {wp.runs.length}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Sidebar footer: settings */}
        <Pressable
          className="px-3 py-2.5 border-t border-border"
          onPress={() => router.push("/(main)/settings" as never)}
        >
          <Text className="text-foreground-secondary text-xs">Settings</Text>
        </Pressable>
      </View>

      {/* Main content area */}
      <View className="flex-1 flex-col">
        {/* Top bar: selection toolbar or status */}
        <View className="h-12 px-4 flex-row items-center border-b border-border">
          {selectionMode ? (
            <>
              <Pressable onPress={clearSelection} className="mr-3 px-2 py-1">
                <Text className="text-foreground text-sm">{"\u2715"}</Text>
              </Pressable>
              <Text className="text-foreground text-sm font-semibold mr-4">
                {selectedIds.size} selected
              </Text>
              <Pressable
                className="px-2.5 py-1 rounded mr-2"
                onPress={selectAll}
              >
                <Text className="text-foreground-secondary text-xs">
                  Select all
                </Text>
              </Pressable>
              <View className="flex-1" />
              <Pressable
                className="bg-red/15 rounded-md px-3 py-1"
                onPress={() => void handleBatchDelete()}
                disabled={deleting}
              >
                <Text className="text-red text-xs font-semibold">
                  {deleting ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-foreground text-lg font-bold flex-1">
                {selectedWorkpath?.dirName ?? "All"}
              </Text>
              <Text className="text-foreground-secondary text-xs">
                {allRuns.length} {allRuns.length === 1 ? "thread" : "threads"}
              </Text>
            </>
          )}
        </View>

        {/* Canvas grid */}
        <ScrollView className="flex-1" contentContainerClassName="p-4">
          {isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : allRuns.length === 0 ? (
            <View className="items-center py-12">
              <Text className="text-foreground-secondary text-sm">
                No threads yet
              </Text>
            </View>
          ) : (
            <View
              style={{
                display: "grid" as any,
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                alignItems: "start",
                gap: 12,
              } as any}
            >
              {allRuns.map((run) => (
                <ThreadCard
                  key={run.id}
                  run={run}
                  agentName={agents.get(run.agentId)?.name}
                  onPress={() => handleThreadPress(run)}
                  onLongPress={() => handleLongPress(run)}
                  isSelected={selectedIds.has(run.id)}
                  selectionMode={selectionMode}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Thread detail drawer */}
      {drawerThread ? (
        <ThreadDrawer onClose={() => setDrawerThread(null)}>
          <ThreadDetailScreen
            agentIdProp={drawerThread.agentId}
            threadIdProp={drawerThread.threadId}
            onClose={() => setDrawerThread(null)}
          />
        </ThreadDrawer>
      ) : null}
    </View>
  );
}

// --- Main Home Screen ---

export default function HomeScreen() {
  const router = useRouter();
  const { workpaths, agents, isLoading, reload } = useWorkpaths();
  const [refreshing, setRefreshing] = useState(false);

  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  // Reload data when screen regains focus (e.g. after creating a thread)
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const hasNodes = agents.size > 0;

  // Show onboarding when no nodes exist (both wide and mobile)
  if (!isLoading && !hasNodes) {
    return <OnboardingView />;
  }

  // --- Web wide view: canvas grid ---
  if (isWideScreen) {
    return <ThreadCanvasView />;
  }

  // --- Mobile view: card grid ---
  return <MobileCanvasView />;
}

// --- Mobile: Canvas card grid ---

function MobileCanvasView() {
  const router = useRouter();
  const { workpaths, agents, selectedPath, setSelectedPath, isLoading, reload, setRuns } =
    useWorkpaths();
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const selectedWorkpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === selectedPath) ?? null,
    [workpaths, selectedPath],
  );

  const allRuns = useMemo(() => {
    const runs = selectedWorkpath
      ? selectedWorkpath.runs
      : workpaths.flatMap((wp) => wp.runs);
    return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [selectedWorkpath, workpaths]);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    Alert.alert("Delete Threads", `Delete ${count} thread${count > 1 ? "s" : ""}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const toDelete = allRuns.filter((r) => selectedIds.has(r.id));
            await Promise.all(toDelete.map((r) => deleteThread(r.agentId, r.id)));
            setRuns((prev) => prev.filter((r) => !selectedIds.has(r.id)));
          } catch {
            // best effort
          }
          setDeleting(false);
          setSelectedIds(new Set());
        },
      },
    ]);
  };

  const handleNewThread = () => {
    if (selectedWorkpath) {
      const params = new URLSearchParams();
      params.set("agentId", selectedWorkpath.agentId);
      params.set("repoPath", selectedWorkpath.repoPath);
      router.push(`/(main)/threads/new?${params.toString()}` as never);
    } else {
      router.push("/(main)/threads/new" as never);
    }
  };

  return (
    <View className="flex-1 bg-background">
      {/* Selection toolbar (replaces default header actions) */}
      {selectionMode ? (
        <View className="px-4 py-2 flex-row items-center border-b border-border">
          <Pressable onPress={() => setSelectedIds(new Set())} className="mr-2">
            <Text className="text-foreground text-sm">{"\u2715"}</Text>
          </Pressable>
          <Text className="text-foreground text-sm font-semibold flex-1">
            {selectedIds.size} selected
          </Text>
          <Pressable
            className="bg-red/15 rounded-md px-3 py-1"
            onPress={() => void handleBatchDelete()}
            disabled={deleting}
          >
            <Text className="text-red text-xs font-semibold">Delete</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Workpath filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-10"
        contentContainerClassName="px-4 py-1.5 gap-1.5 flex-row"
      >
        <Pressable
          className={`px-3 py-1 rounded-full ${!selectedPath ? "bg-accent/15" : "bg-surface"}`}
          onPress={() => setSelectedPath(null)}
        >
          <Text className={`text-xs ${!selectedPath ? "text-accent font-semibold" : "text-foreground-secondary"}`}>
            All
          </Text>
        </Pressable>
        {workpaths.map((wp) => {
          const isSel = selectedPath === wp.repoPath;
          return (
            <Pressable
              key={wp.repoPath}
              className={`px-3 py-1 rounded-full flex-row items-center gap-1 ${isSel ? "bg-accent/15" : "bg-surface"}`}
              onPress={() => setSelectedPath(wp.repoPath)}
            >
              <Text className={`text-xs ${isSel ? "text-accent font-semibold" : "text-foreground-secondary"}`}>
                {wp.dirName}
              </Text>
              {wp.activeCount > 0 ? (
                <View className="bg-accent/20 rounded-full px-1">
                  <Text className="text-accent text-[10px] font-medium">{wp.activeCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Thread card grid */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-3"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
        }
      >
        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : allRuns.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-foreground-secondary text-sm">No threads yet</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {allRuns.map((run) => (
              <ThreadCard
                key={run.id}
                run={run}
                agentName={agents.get(run.agentId)?.name}
                onPress={() => {
                  if (selectionMode) {
                    toggleSelect(run.id);
                  } else {
                    router.push(`/(main)/threads/${run.agentId}/${run.id}` as never);
                  }
                }}
                onLongPress={() => toggleSelect(run.id)}
                isSelected={selectedIds.has(run.id)}
                selectionMode={selectionMode}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
