import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import {
  useRouter,
  useLocalSearchParams,
  useFocusEffect,
  Stack,
} from "expo-router";
import type { Run } from "@webmux/shared";
import { useWorkpaths } from "../../lib/workpath-context";
import { deleteThread } from "../../lib/api";
import { ThreadCard } from "../../components/ThreadCard";

export default function WorkpathScreen() {
  const router = useRouter();
  const { path, agentId } = useLocalSearchParams<{
    path: string;
    agentId: string;
  }>();
  const { workpaths, agents, reload, setRuns } = useWorkpaths();
  const [refreshing, setRefreshing] = useState(false);

  // Reload data when screen regains focus
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

  const workpath = useMemo(
    () => workpaths.find((wp) => wp.repoPath === path) ?? null,
    [workpaths, path],
  );

  if (!workpath) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: "Workpath" }} />
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
      <Stack.Screen
        options={{
          title: workpath.dirName,
          headerRight: () => (
            <Pressable
              className="bg-accent rounded-md px-3 py-1.5 mr-2"
              onPress={() => {
                const params = new URLSearchParams();
                params.set("agentId", agentId ?? workpath.agentId);
                params.set("repoPath", workpath.repoPath);
                router.push(`/(main)/threads/new?${params.toString()}` as never);
              }}
            >
              <Text className="text-background text-xs font-semibold">+ New</Text>
            </Pressable>
          ),
        }}
      />

      {/* Thread card list */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-3"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
        }
      >
        {workpath.runs.length === 0 ? (
          <Text className="text-foreground-secondary text-sm text-center py-8">
            No threads in this workpath yet.
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            {workpath.runs.map((run) => (
              <ThreadCard
                key={run.id}
                run={run}
                agentName={agents.get(run.agentId)?.name}
                onPress={() =>
                  router.push(
                    `/(main)/threads/${run.agentId}/${run.id}` as never,
                  )
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
