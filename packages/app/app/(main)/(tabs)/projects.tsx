import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import type { Project } from "@webmux/shared";
import { timeAgo, repoName, toolIcon } from "@webmux/shared";
import { listProjects } from "../../../lib/api";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function ProjectCard({
  project,
  onPress,
}: {
  project: Project;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="bg-surface rounded-xl p-4 border border-border"
      onPress={onPress}
    >
      {/* Row 1: name + tool badge */}
      <View className="flex-row items-center gap-2 mb-1">
        <Text
          className="text-foreground text-base font-semibold flex-shrink"
          numberOfLines={1}
        >
          {project.name}
        </Text>

        <View className="flex-1" />

        {/* Default tool badge */}
        <View
          className={`rounded px-1.5 py-0.5 ${
            project.defaultTool === "codex" ? "bg-purple/20" : "bg-accent/20"
          }`}
        >
          <Text
            className={`text-xs font-bold ${
              project.defaultTool === "codex" ? "text-purple" : "text-accent"
            }`}
          >
            {toolIcon(project.defaultTool)}
          </Text>
        </View>
      </View>

      {/* Row 2: description */}
      {project.description ? (
        <Text
          className="text-foreground-secondary text-sm mb-1.5"
          numberOfLines={2}
        >
          {truncate(project.description, 120)}
        </Text>
      ) : null}

      {/* Row 3: repo path + time */}
      <View className="flex-row items-center gap-2 mt-1">
        <Text
          className="text-foreground-secondary text-xs flex-1"
          numberOfLines={1}
        >
          {repoName(project.repoPath)}
        </Text>
        <Text className="text-foreground-secondary text-xs">
          {timeAgo(project.updatedAt)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading projects...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-foreground text-2xl font-bold">Projects</Text>
          <Pressable
            className="flex-row items-center bg-accent rounded-lg px-4 py-2"
            onPress={() => router.push("/(main)/projects/new" as never)}
          >
            <Text className="text-background font-semibold text-sm">
              + New Project
            </Text>
          </Pressable>
        </View>

        {/* Error banner */}
        {error ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-4">
            <Text className="text-red text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Empty state */}
        {projects.length === 0 && !error ? (
          <View className="items-center justify-center py-16">
            <Text className="text-foreground text-xl font-semibold mb-2">
              No projects yet
            </Text>
            <Text className="text-foreground-secondary text-sm text-center px-8">
              Create a project to organize tasks and manage your codebase with
              AI agents.
            </Text>
          </View>
        ) : null}

        {/* Project list */}
        {projects.length > 0 ? (
          <View className="gap-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onPress={() =>
                  router.push(
                    `/(main)/projects/${project.id}` as never
                  )
                }
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
