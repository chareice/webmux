import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import type {
  AgentInfo,
  RepositoryBrowseResponse,
  RepositoryEntry,
  RunTool,
  CreateProjectRequest,
} from "@webmux/shared";
import {
  listAgents,
  browseAgentRepositories,
  createProject,
} from "../../../lib/api";
import {
  getRepoNameFromPath,
  resolveProjectNameFromRepoPath,
} from "../../../lib/repo-path-utils";
import { getProjectsRoute } from "../../../lib/route-utils";

// --- Constants ---

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic Claude Code CLI" },
  { value: "codex", label: "Codex", description: "OpenAI Codex CLI" },
];

// --- Main Screen ---

export default function NewProjectScreen() {
  const router = useRouter();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedTool, setSelectedTool] = useState<RunTool>("claude");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoPath, setRepoPath] = useState("");

  const [repoBrowser, setRepoBrowser] = useState<RepositoryBrowseResponse | null>(null);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previousAgentRef = useRef("");

  const fetchAgentsData = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const data = await listAgents();
      const onlineAgents = data.agents.filter((a) => a.status === "online");
      setAgents(onlineAgents);
      setSelectedAgent((current) => {
        if (current && onlineAgents.some((a) => a.id === current)) return current;
        return onlineAgents[0]?.id ?? "";
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgentsData();
  }, [fetchAgentsData]);

  // Load repo browser when agent changes
  useEffect(() => {
    if (!selectedAgent) {
      setRepoBrowser(null);
      setRepoError(null);
      return;
    }

    const agentChanged =
      previousAgentRef.current !== "" && previousAgentRef.current !== selectedAgent;
    previousAgentRef.current = selectedAgent;

    if (agentChanged) {
      setRepoPath("");
      setRepoBrowser(null);
    }

    let cancelled = false;
    setIsLoadingRepos(true);
    setRepoError(null);

    void browseAgentRepositories(selectedAgent)
      .then((data) => {
        if (!cancelled) {
          setRepoBrowser(data);
          setIsLoadingRepos(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRepoError((err as Error).message);
          setIsLoadingRepos(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  const selectedAgentInfo = useMemo(
    () => agents.find((a) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  );
  const trimmedRepoPath = repoPath.trim();

  const loadRepoBrowser = useCallback(
    async (aid: string, path?: string) => {
      setIsLoadingRepos(true);
      setRepoError(null);
      try {
        const data = await browseAgentRepositories(aid, path);
        setRepoBrowser(data);
      } catch (err) {
        setRepoError((err as Error).message);
      } finally {
        setIsLoadingRepos(false);
      }
    },
    [],
  );

  // Auto-fill project name from repo path
  const handleSelectRepoPath = (path: string) => {
    setRepoPath(path);
    setName((currentName) => resolveProjectNameFromRepoPath(currentName, path));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Please enter a project name");
      return;
    }
    if (!selectedAgent) {
      setError("Please select an agent");
      return;
    }
    if (!repoPath.trim()) {
      setError("Please choose a work path");
      return;
    }

    setIsSubmitting(true);
    try {
      const body: CreateProjectRequest = {
        name: name.trim(),
        repoPath: repoPath.trim(),
        agentId: selectedAgent,
        defaultTool: selectedTool,
      };
      if (description.trim()) body.description = description.trim();

      const result = await createProject(body);
      router.replace(`/(main)/projects/${result.project.id}` as never);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Loading state ---

  if (isLoadingAgents) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="flex-row items-center gap-3 mb-6">
          <Pressable
            className="bg-surface-light rounded-lg px-3 py-2"
            onPress={() => router.replace(getProjectsRoute() as never)}
          >
            <Text className="text-foreground-secondary text-sm">Back</Text>
          </Pressable>
          <Text className="text-foreground text-2xl font-bold">New Project</Text>
        </View>

        {/* Project Name */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Project Name
          </Text>
          <TextInput
            className="bg-surface border border-border rounded-lg px-4 py-3 text-foreground"
            placeholder="My awesome project"
            placeholderTextColor="#565f89"
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Description */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Description (optional)
          </Text>
          <TextInput
            className="bg-surface border border-border rounded-lg px-4 py-3 text-foreground min-h-[80px]"
            placeholder="What is this project about?"
            placeholderTextColor="#565f89"
            multiline
            textAlignVertical="top"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        {/* Agent Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Agent
          </Text>
          {agents.length === 0 ? (
            <Text className="text-foreground-secondary text-sm">
              No agents online right now.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {agents.map((agent) => (
                <Pressable
                  key={agent.id}
                  className={`rounded-lg px-4 py-2 border ${
                    selectedAgent === agent.id
                      ? "bg-accent/20 border-accent"
                      : "bg-surface border-border"
                  }`}
                  onPress={() => setSelectedAgent(agent.id)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      selectedAgent === agent.id
                        ? "text-accent"
                        : "text-foreground"
                    }`}
                  >
                    {agent.name || agent.id}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Work Path Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Work Path
          </Text>

          <TextInput
            className="bg-surface border border-border rounded-lg px-4 py-3 text-foreground font-mono min-h-[88px]"
            placeholder={
              selectedAgent
                ? "/home/chareice/projects/webmux"
                : "Select an agent first"
            }
            placeholderTextColor="#565f89"
            value={repoPath}
            onChangeText={setRepoPath}
            onBlur={() => {
              setName((currentName) =>
                resolveProjectNameFromRepoPath(currentName, repoPath),
              );
            }}
            editable={!!selectedAgent}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View className="mt-2 gap-2">
            <Pressable
              className={`border rounded-lg px-4 py-3 flex-row items-center ${
                selectedAgent
                  ? "bg-surface border-border"
                  : "bg-surface-light border-border/60"
              }`}
              disabled={!selectedAgent}
              onPress={() => {
                if (!selectedAgent) return;
                setIsRepoBrowserOpen(true);
                if (!repoBrowser && !isLoadingRepos) {
                  void loadRepoBrowser(selectedAgent);
                }
              }}
            >
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium">
                  {trimmedRepoPath
                    ? `Browse from ${getRepoNameFromPath(trimmedRepoPath)}`
                    : "Browse directories"}
                </Text>
                <Text className="text-foreground-secondary text-xs mt-0.5">
                  {selectedAgentInfo
                    ? `Pick a path on ${selectedAgentInfo.name || selectedAgentInfo.id}`
                    : "Select an agent first"}
                </Text>
              </View>
              <Text className="text-foreground-secondary text-lg ml-2">{">"}</Text>
            </Pressable>

            {trimmedRepoPath ? (
              <Text className="text-foreground-secondary text-xs">
                Selected repository: {getRepoNameFromPath(trimmedRepoPath)}
              </Text>
            ) : null}
          </View>

          {isLoadingRepos && !repoBrowser ? (
            <View className="items-center py-2">
              <ActivityIndicator size="small" color="#7aa2f7" />
            </View>
          ) : null}

          {repoError ? (
            <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mt-2">
              <Text className="text-red text-sm">{repoError}</Text>
            </View>
          ) : null}
        </View>

        {/* Default Tool Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Default Tool
          </Text>
          <View className="flex-row gap-2">
            {TOOLS.map((tool) => (
              <Pressable
                key={tool.value}
                className={`flex-1 rounded-lg px-4 py-3 border ${
                  selectedTool === tool.value
                    ? "bg-accent/20 border-accent"
                    : "bg-surface border-border"
                }`}
                onPress={() => setSelectedTool(tool.value)}
              >
                <Text
                  className={`text-sm font-semibold mb-0.5 ${
                    selectedTool === tool.value ? "text-accent" : "text-foreground"
                  }`}
                >
                  {tool.label}
                </Text>
                <Text className="text-foreground-secondary text-xs">
                  {tool.description}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Error banner */}
        {error ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-4">
            <Text className="text-red text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Submit */}
        <Pressable
          className={`rounded-lg py-3.5 items-center ${
            isSubmitting || !selectedAgent || !repoPath.trim() || !name.trim()
              ? "bg-accent/40"
              : "bg-accent"
          }`}
          disabled={isSubmitting || !selectedAgent || !repoPath.trim() || !name.trim()}
          onPress={() => void handleSubmit()}
        >
          {isSubmitting ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#1a1b26" />
              <Text className="text-background font-semibold text-base">
                Creating...
              </Text>
            </View>
          ) : (
            <Text className="text-background font-semibold text-base">
              Create Project
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {/* Repository Browser Modal */}
      <Modal
        visible={isRepoBrowserOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsRepoBrowserOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center p-4"
          onPress={() => setIsRepoBrowserOpen(false)}
        >
          <Pressable
            className="bg-surface rounded-xl w-full max-w-lg border border-border"
            onPress={() => {
              /* prevent close */
            }}
            style={{ maxHeight: "80%" }}
          >
            {/* Modal header */}
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
              <Text className="text-foreground text-lg font-bold">
                Browse Directories
              </Text>
              <Pressable
                className="bg-surface-light rounded-md px-2.5 py-1"
                onPress={() => setIsRepoBrowserOpen(false)}
              >
                <Text className="text-foreground-secondary text-sm">Close</Text>
              </Pressable>
            </View>

            {/* Current path */}
            {repoBrowser?.currentPath ? (
              <View className="px-5 py-2 bg-surface-light">
                <Text className="text-foreground-secondary text-xs font-mono">
                  {repoBrowser.currentPath}
                </Text>
              </View>
            ) : null}

            {/* Browser content */}
            <ScrollView className="px-5 py-3" style={{ maxHeight: 400 }}>
              {/* Up one level */}
              {repoBrowser?.parentPath !== undefined &&
              repoBrowser?.parentPath !== null ? (
                <Pressable
                  className="flex-row items-center gap-2 py-2.5 border-b border-border"
                  onPress={() => {
                    if (selectedAgent && repoBrowser.parentPath != null) {
                      void loadRepoBrowser(selectedAgent, repoBrowser.parentPath);
                    }
                  }}
                >
                  <Text className="text-accent text-sm">{"<-"}</Text>
                  <Text className="text-accent text-sm">Up one level</Text>
                </Pressable>
              ) : null}

              {isLoadingRepos ? (
                <View className="items-center py-8">
                  <ActivityIndicator size="small" color="#7aa2f7" />
                  <Text className="text-foreground-secondary mt-2 text-sm">
                    Loading...
                  </Text>
                </View>
              ) : repoError ? (
                <View className="bg-red/10 border border-red rounded-lg px-3 py-2 my-2">
                  <Text className="text-red text-sm">{repoError}</Text>
                </View>
              ) : repoBrowser?.entries.length === 0 ? (
                <Text className="text-foreground-secondary text-sm py-4 text-center">
                  No entries found
                </Text>
              ) : (
                repoBrowser?.entries.map((entry) => (
                  <RepositoryEntryRow
                    key={entry.path}
                    entry={entry}
                    onNavigate={(path) => {
                      if (selectedAgent) void loadRepoBrowser(selectedAgent, path);
                    }}
                    onSelect={(path) => {
                      handleSelectRepoPath(path);
                      setIsRepoBrowserOpen(false);
                    }}
                  />
                ))
              )}
            </ScrollView>

            {/* Select current directory */}
            {repoBrowser?.currentPath ? (
              <View className="px-5 py-3 border-t border-border">
                <Pressable
                  className="bg-accent rounded-lg py-2.5 items-center"
                  onPress={() => {
                    handleSelectRepoPath(repoBrowser.currentPath);
                    setIsRepoBrowserOpen(false);
                  }}
                >
                  <Text className="text-background font-semibold text-sm">
                    Select current directory
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// --- Repository Entry Row ---

function RepositoryEntryRow({
  entry,
  onNavigate,
  onSelect,
}: {
  entry: RepositoryEntry;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isRepo = entry.kind === "repository";
  return (
    <View className="flex-row items-center py-2.5 border-b border-border">
      <Pressable
        className="flex-row items-center flex-1 gap-2"
        onPress={() => onNavigate(entry.path)}
      >
        <Text className={isRepo ? "text-accent" : "text-foreground-secondary"}>
          {isRepo ? "[repo]" : "[dir]"}
        </Text>
        <Text className="text-foreground text-sm flex-1" numberOfLines={1}>
          {entry.name}
        </Text>
      </Pressable>
      <Pressable
        className="bg-accent/20 rounded px-2.5 py-1 ml-2"
        onPress={() => onSelect(entry.path)}
      >
        <Text className="text-accent text-xs font-semibold">Select</Text>
      </Pressable>
    </View>
  );
}
