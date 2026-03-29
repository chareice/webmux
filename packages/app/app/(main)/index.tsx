import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useWorkpaths } from "../../lib/workpath-context";
import type { Workpath } from "../../lib/workpath";

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
  const { workpaths } = useWorkpaths();

  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  // --- Web wide view: placeholder (thread list is in LeftPanel) ---
  if (isWideScreen) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-foreground-secondary text-sm">
          Select a thread from the sidebar
        </Text>
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
