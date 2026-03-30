import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import type { Run } from "@webmux/shared";
import { useWorkpaths } from "../lib/workpath-context";
import { deleteThread } from "../lib/api";
import { useTheme } from "../lib/theme";
import { ThreadRow } from "./ThreadRow";

interface LeftPanelProps {
  activeThreadId: string | null;
}

export function LeftPanel({ activeThreadId }: LeftPanelProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    workpaths,
    agents,
    selectedPath,
    setSelectedPath,
    isLoading,
    setRuns,
    reload,
  } = useWorkpaths();

  const [selectorOpen, setSelectorOpen] = useState(false);

  const selectedWorkpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === selectedPath) ?? null,
    [workpaths, selectedPath],
  );

  const handleDeleteThread = async (run: Run) => {
    try {
      await deleteThread(run.agentId, run.id);
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      if (run.id === activeThreadId) {
        router.navigate("/(main)" as never);
      }
    } catch {
      await reload();
    }
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
    <View className="w-72 bg-surface border-r border-border flex-1">
      {/* Header */}
      <View className="h-12 px-4 flex-row items-center border-b border-border">
        <Pressable
          className="flex-1"
          onPress={() => router.navigate("/(main)" as never)}
        >
          <Text className="text-foreground text-lg font-bold">webmux</Text>
        </Pressable>
        <Pressable
          className="bg-accent rounded-md px-2.5 py-1"
          onPress={handleNewThread}
        >
          <Text className="text-background text-xs font-semibold">+ New</Text>
        </Pressable>
      </View>

      {/* Scrollable content: workpath selector + thread list */}
      <ScrollView className="flex-1" contentContainerClassName="pb-2">
        {/* Workpath selector (only show when workpaths exist) */}
        {workpaths.length > 0 ? (
          <>
            <Pressable
              className="px-4 py-2.5 border-b border-border flex-row items-center"
              onPress={() => setSelectorOpen(!selectorOpen)}
            >
              <Text className="text-foreground text-sm font-semibold flex-1" numberOfLines={1}>
                {selectedWorkpath?.dirName ?? "Select workpath"}
              </Text>
              {selectedWorkpath?.unreadCount ? (
                <View className="bg-red/20 rounded-full w-5 h-5 items-center justify-center mr-1">
                  <Text className="text-red text-[10px] font-bold">
                    {selectedWorkpath.unreadCount}
                  </Text>
                </View>
              ) : null}
              {selectedWorkpath?.activeCount ? (
                <View className="bg-accent/20 rounded px-1.5 py-0.5 mr-2">
                  <Text className="text-accent text-xs font-medium">
                    {selectedWorkpath.activeCount}
                  </Text>
                </View>
              ) : null}
              <Text className="text-foreground-secondary text-xs">
                {selectorOpen ? "\u25B2" : "\u25BC"}
              </Text>
            </Pressable>

            {/* Inline workpath list (expanded) */}
            {selectorOpen ? (
              <View className="border-b border-border">
                {workpaths.map((wp) => {
                  const isSelected = selectedPath === wp.repoPath;
                  return (
                    <Pressable
                      key={wp.repoPath}
                      className={`px-4 py-2 ${isSelected ? "bg-accent/10" : "bg-background"}`}
                      onPress={() => {
                        setSelectedPath(wp.repoPath);
                        setSelectorOpen(false);
                        router.navigate("/(main)" as never);
                      }}
                    >
                      <View className="flex-row items-center gap-2">
                        <Text
                          className={`text-sm flex-1 ${isSelected ? "text-accent font-semibold" : "text-foreground"}`}
                          numberOfLines={1}
                        >
                          {wp.dirName}
                        </Text>
                        {wp.unreadCount > 0 ? (
                          <View className="bg-red/20 rounded-full w-4 h-4 items-center justify-center">
                            <Text className="text-red text-[9px] font-bold">
                              {wp.unreadCount}
                            </Text>
                          </View>
                        ) : null}
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
              </View>
            ) : null}
          </>
        ) : null}

        {/* Thread list */}
        <View className="p-3">
          {isLoading ? (
            <View className="items-center py-8">
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : workpaths.length === 0 ? (
            <View className="items-center py-8 px-4">
              <Text className="text-foreground-secondary text-sm text-center">
                {agents.size === 0
                  ? "Register a node to get started"
                  : "No threads yet"}
              </Text>
            </View>
          ) : !selectedWorkpath ? (
            <View className="items-center py-8">
              <Text className="text-foreground-secondary text-sm text-center">
                Select a workpath
              </Text>
            </View>
          ) : selectedWorkpath.runs.length === 0 ? (
            <Text className="text-foreground-secondary text-sm text-center py-8">
              No threads yet
            </Text>
          ) : (
            selectedWorkpath.runs.map((run) => (
              <ThreadRow
                key={run.id}
                run={run}
                agentName={agents.get(run.agentId)?.name}
                isActive={run.id === activeThreadId}
                onDelete={() => void handleDeleteThread(run)}
                onPress={() =>
                  router.push(
                    `/(main)/threads/${run.agentId}/${run.id}` as never,
                  )
                }
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Bottom: Settings */}
      <Pressable
        className="px-4 py-3 border-t border-border flex-row items-center"
        onPress={() => router.push("/(main)/settings" as never)}
      >
        <Text className="text-foreground-secondary text-sm">Settings</Text>
      </Pressable>
    </View>
  );
}
