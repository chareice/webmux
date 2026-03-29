import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import type { Workpath } from "../lib/workpath";
import { useTheme } from "../lib/theme";

interface SidebarProps {
  workpaths: Workpath[];
  selectedPath: string | null;
  onSelectWorkpath: (repoPath: string) => void;
  isLoading: boolean;
}

export function Sidebar({
  workpaths,
  selectedPath,
  onSelectWorkpath,
  isLoading,
}: SidebarProps) {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <View className="w-48 bg-surface border-r border-border flex-1">
      {/* Header */}
      <View className="h-12 px-4 flex-row items-center border-b border-border">
        <Text className="text-foreground text-lg font-bold flex-1">webmux</Text>
        <Pressable
          className="bg-accent rounded-md px-2.5 py-1"
          onPress={() => router.push("/(main)/threads/new" as never)}
        >
          <Text className="text-background text-xs font-semibold">+ New</Text>
        </Pressable>
      </View>

      {/* Workpath list */}
      <ScrollView className="flex-1">
        {isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : workpaths.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-foreground-secondary text-sm text-center">
              No threads yet
            </Text>
          </View>
        ) : (
          workpaths.map((wp) => {
            const isSelected = selectedPath === wp.repoPath;
            return (
              <Pressable
                key={wp.repoPath}
                className={`px-4 py-3 border-b border-border ${isSelected ? "bg-accent/10 border-l-2 border-l-accent" : ""}`}
                onPress={() => onSelectWorkpath(wp.repoPath)}
              >
                <View className="flex-row items-center gap-2">
                  <Text
                    className={`text-sm font-semibold flex-1 ${isSelected ? "text-accent" : "text-foreground"}`}
                    numberOfLines={1}
                  >
                    {wp.dirName}
                  </Text>
                  {wp.activeCount > 0 ? (
                    <View className="bg-accent/20 rounded px-1.5 py-0.5">
                      <Text className="text-accent text-xs font-medium">
                        {wp.activeCount}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-foreground-secondary text-xs">
                      {wp.runs.length}
                    </Text>
                  )}
                </View>
                {wp.nodeName ? (
                  <Text className="text-foreground-secondary text-xs mt-0.5">
                    {wp.nodeName}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
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
