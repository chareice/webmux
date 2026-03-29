import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Image,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type {
  AgentInfo,
  ImportableSessionSummary,
  RepositoryBrowseResponse,
  RepositoryEntry,
  RunTool,
  StartRunRequest,
  RunImageAttachmentUpload,
  Run,
} from "@webmux/shared";
import { repoName, timeAgo } from "@webmux/shared";
import * as ImagePicker from "expo-image-picker";
import {
  listAgents,
  listThreads,
  browseAgentRepositories,
  listImportableSessions,
  startThread,
} from "../../../lib/api";
import { getRepoNameFromPath } from "../../../lib/repo-path-utils";
import { getKeyboardAwareScrollProps } from "../../../lib/mobile-layout";
import { useTheme } from "../../../lib/theme";

// --- Constants ---

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic Claude Code CLI" },
  { value: "codex", label: "Codex", description: "OpenAI Codex CLI" },
];

const MAX_ATTACHMENTS = 4;

// --- Types ---

interface DraftAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUri: string;
  base64: string;
}

// --- Helpers ---

function extractRecentRepositories(runs: Run[]): string[] {
  const seen = new Set<string>();
  return [...runs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => r.repoPath)
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .slice(0, 8);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64Web(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Main Screen ---

export default function NewThreadScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { agentId, repoPath: repoPathParam } = useLocalSearchParams<{
    agentId: string;
    repoPath: string;
  }>();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState(agentId || "");
  const [selectedTool, setSelectedTool] = useState<RunTool>("claude");
  const [repoPath, setRepoPath] = useState(repoPathParam ? decodeURIComponent(repoPathParam) : "");
  const [prompt, setPrompt] = useState("");
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [importableSessions, setImportableSessions] = useState<
    ImportableSessionSummary[]
  >([]);
  const [selectedImportSession, setSelectedImportSession] =
    useState<ImportableSessionSummary | null>(null);

  const [repoBrowser, setRepoBrowser] = useState<RepositoryBrowseResponse | null>(null);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false);
  const [isImportSessionOpen, setIsImportSessionOpen] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingImportableSessions, setIsLoadingImportableSessions] =
    useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [importableSessionsError, setImportableSessionsError] = useState<
    string | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previousAgentRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAgentsData = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const data = await listAgents();
      const onlineAgents = data.agents.filter((a) => a.status === "online");
      setAgents(onlineAgents);
      setSelectedAgent((current) => {
        if (agentId && onlineAgents.some((a) => a.id === agentId)) return agentId;
        if (current && onlineAgents.some((a) => a.id === current)) return current;
        return onlineAgents[0]?.id ?? "";
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoadingAgents(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchAgentsData();
  }, [fetchAgentsData]);

  // Load repos when agent changes
  useEffect(() => {
    if (!selectedAgent) {
      setRecentRepos([]);
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

    void Promise.allSettled([
      listThreads(selectedAgent),
      browseAgentRepositories(selectedAgent),
    ]).then(([runsResult, browseResult]) => {
      if (cancelled) return;
      if (runsResult.status === "fulfilled") {
        setRecentRepos(extractRecentRepositories(runsResult.value));
      } else {
        setRecentRepos([]);
      }
      if (browseResult.status === "fulfilled") {
        setRepoBrowser(browseResult.value);
      } else {
        setRepoBrowser(null);
        setRepoError("Failed to browse repositories");
      }
      setIsLoadingRepos(false);
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

  useEffect(() => {
    setSelectedImportSession(null);
    setImportableSessions([]);
    setImportableSessionsError(null);
    setIsImportSessionOpen(false);
  }, [selectedAgent, selectedTool, trimmedRepoPath]);

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

  const loadImportableSessions = useCallback(
    async (aid: string, tool: RunTool, path: string) => {
      setIsLoadingImportableSessions(true);
      setImportableSessionsError(null);
      try {
        const sessions = await listImportableSessions(aid, tool, path);
        setImportableSessions(sessions);
      } catch (err) {
        setImportableSessions([]);
        setImportableSessionsError((err as Error).message);
      } finally {
        setIsLoadingImportableSessions(false);
      }
    },
    [],
  );

  // --- Image Attachment Handling ---

  const handleFilesSelectedWeb = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toAdd = Array.from(files).slice(0, remaining);

    const newAttachments: DraftAttachment[] = [];
    for (const file of toAdd) {
      const base64 = await fileToBase64Web(file);
      newAttachments.push({
        id: generateId(),
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUri: URL.createObjectURL(file),
        base64,
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePickImageNative = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: MAX_ATTACHMENTS - attachments.length,
        base64: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets) return;

      const newAttachments: DraftAttachment[] = result.assets
        .slice(0, MAX_ATTACHMENTS - attachments.length)
        .filter((asset) => asset.base64)
        .map((asset) => ({
          id: generateId(),
          name: asset.fileName ?? "image.jpg",
          mimeType: asset.mimeType ?? "image/jpeg",
          sizeBytes: asset.fileSize ?? 0,
          previewUri: asset.uri,
          base64: asset.base64!,
        }));

      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch {
      // expo-image-picker not available or user cancelled
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed && Platform.OS === "web") {
        URL.revokeObjectURL(removed.previewUri);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const hasContent = prompt.trim().length > 0 || attachments.length > 0;

  const handleSubmit = async () => {
    setError(null);
    if (!selectedAgent) {
      setError("Please select a node");
      return;
    }
    if (!repoPath.trim()) {
      setError("Please choose a working directory");
      return;
    }
    if (!hasContent) {
      setError("Please enter a prompt or attach images");
      return;
    }

    setIsSubmitting(true);
    try {
      const uploadAttachments: RunImageAttachmentUpload[] = attachments.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        base64: a.base64,
      }));

      const body: StartRunRequest = {
        tool: selectedTool,
        repoPath: repoPath.trim(),
        prompt: prompt.trim(),
        ...(selectedImportSession
          ? { existingSessionId: selectedImportSession.id }
          : {}),
        ...(uploadAttachments.length > 0 ? { attachments: uploadAttachments } : {}),
      };

      const run = await startThread(selectedAgent, body);

      // Clean up object URLs before navigating
      if (Platform.OS === "web") {
        for (const a of attachments) URL.revokeObjectURL(a.previewUri);
      }

      router.replace(`/(main)/threads/${selectedAgent}/${run.id}` as never);
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
        <ActivityIndicator size="large" color={colors.accent} />
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
        {...getKeyboardAwareScrollProps(Platform.OS)}
      >
        {/* Node Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Node
          </Text>
          {agents.length === 0 ? (
            <Text className="text-foreground-secondary text-sm">
              No nodes online right now.
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

        {/* Tool Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Tool
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

        {/* Working Directory Selection */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Working Directory
          </Text>

          <TextInput
            className="bg-surface border border-border rounded-lg px-4 py-3 text-foreground font-mono min-h-[88px]"
            placeholder={
              selectedAgent
                ? "/home/chareice/projects/webmux"
                : "Select a node first"
            }
            placeholderTextColor={colors.placeholder}
            value={repoPath}
            onChangeText={setRepoPath}
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
                    : "Select a node first"}
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
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null}

          {/* Recent repos */}
          {recentRepos.length > 0 ? (
            <View className="mt-3">
              <Text className="text-foreground-secondary text-xs mb-1.5">
                Recent repositories
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {recentRepos.map((rp) => (
                  <Pressable
                    key={rp}
                    className={`rounded-lg px-3 py-2 border ${
                      trimmedRepoPath === rp
                        ? "bg-accent/20 border-accent"
                        : "bg-surface border-border"
                    }`}
                    onPress={() => setRepoPath(rp)}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        trimmedRepoPath === rp ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {repoName(rp)}
                    </Text>
                    <Text className="text-foreground-secondary text-xs mt-0.5">
                      {rp}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : selectedAgent && !isLoadingRepos ? (
            <Text className="text-foreground-secondary text-xs mt-2">
              No recent repositories. Use the picker above to browse.
            </Text>
          ) : null}

          {repoError ? (
            <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mt-2">
              <Text className="text-red text-sm">{repoError}</Text>
            </View>
          ) : null}
        </View>

        {/* Prompt */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Existing Session
          </Text>

          <Pressable
            className={`border rounded-lg px-4 py-3 ${
              selectedAgent && trimmedRepoPath
                ? "bg-surface border-border"
                : "bg-surface-light border-border/60"
            }`}
            disabled={!selectedAgent || !trimmedRepoPath}
            onPress={() => {
              if (!selectedAgent || !trimmedRepoPath) return;
              setIsImportSessionOpen(true);
              void loadImportableSessions(
                selectedAgent,
                selectedTool,
                trimmedRepoPath,
              );
            }}
          >
            <Text className="text-foreground text-sm font-medium">
              {selectedImportSession
                ? selectedImportSession.title
                : "Select an existing session to continue"}
            </Text>
            <Text className="text-foreground-secondary text-xs mt-0.5">
              {selectedImportSession
                ? `Last updated ${timeAgo(selectedImportSession.updatedAt)}`
                : selectedAgent && trimmedRepoPath
                  ? "Optional. Webmux will continue from the next message."
                  : "Choose a node and working directory first"}
            </Text>
          </Pressable>

          {selectedImportSession ? (
            <View className="mt-2 rounded-lg border border-border bg-surface px-3 py-2">
              <Text className="text-foreground text-sm font-medium">
                {selectedImportSession.title}
              </Text>
              {selectedImportSession.subtitle ? (
                <Text
                  className="text-foreground-secondary text-xs mt-1"
                  numberOfLines={2}
                >
                  {selectedImportSession.subtitle}
                </Text>
              ) : null}
              <View className="mt-2 flex-row items-center justify-between">
                <Text className="text-foreground-secondary text-xs">
                  Earlier history will not appear here.
                </Text>
                <Pressable
                  className="bg-surface-light rounded px-2.5 py-1"
                  onPress={() => setSelectedImportSession(null)}
                >
                  <Text className="text-foreground-secondary text-xs">Clear</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* Prompt */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            {selectedImportSession ? "Next Message" : "Prompt"}
          </Text>
          <TextInput
            className="bg-surface border border-border rounded-lg px-4 py-3 text-foreground min-h-[120px]"
            placeholder={
              selectedImportSession
                ? "What should the AI do next in this session?"
                : "What would you like the AI to do?"
            }
            placeholderTextColor={colors.placeholder}
            multiline
            textAlignVertical="top"
            value={prompt}
            onChangeText={setPrompt}
          />
        </View>

        {/* Image Attachments */}
        <View className="mb-5">
          <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
            Image Attachments
          </Text>

          {/* Hidden file input for web */}
          {Platform.OS === "web" ? (
            <input
              ref={fileInputRef as React.RefObject<HTMLInputElement>}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                void handleFilesSelectedWeb((e.target as HTMLInputElement).files)
              }
            />
          ) : null}

          {/* Attachment thumbnails */}
          {attachments.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 mb-3">
              {attachments.map((a) => (
                <View
                  key={a.id}
                  className="relative w-20 h-20 rounded-lg overflow-hidden border border-border"
                >
                  <Image
                    source={{ uri: a.previewUri }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                  <Pressable
                    className="absolute top-1 right-1 bg-black/60 rounded-full w-5 h-5 items-center justify-center"
                    onPress={() => removeAttachment(a.id)}
                  >
                    <Text className="text-white text-xs font-bold">x</Text>
                  </Pressable>
                  <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                    <Text className="text-white text-[8px]" numberOfLines={1}>
                      {formatFileSize(a.sizeBytes)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {attachments.length < MAX_ATTACHMENTS ? (
            <Pressable
              className="bg-surface border border-border rounded-lg px-4 py-2.5 flex-row items-center gap-2"
              onPress={() => {
                if (Platform.OS === "web") {
                  fileInputRef.current?.click();
                } else {
                  void handlePickImageNative();
                }
              }}
            >
              <Text className="text-foreground-secondary text-sm">
                {attachments.length === 0 ? "Add Images" : "Add More"}
              </Text>
              <Text className="text-foreground-secondary text-xs">
                ({attachments.length}/{MAX_ATTACHMENTS})
              </Text>
            </Pressable>
          ) : (
            <Text className="text-foreground-secondary text-xs">
              Maximum {MAX_ATTACHMENTS} images reached.
            </Text>
          )}
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
            isSubmitting || !selectedAgent || !repoPath.trim() || !hasContent
              ? "bg-accent/40"
              : "bg-accent"
          }`}
          disabled={isSubmitting || !selectedAgent || !repoPath.trim() || !hasContent}
          onPress={() => void handleSubmit()}
        >
          {isSubmitting ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.background} />
              <Text className="text-background font-semibold text-base">
                Starting...
              </Text>
            </View>
          ) : (
            <Text className="text-background font-semibold text-base">
              Start Thread
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
                  <ActivityIndicator size="small" color={colors.accent} />
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
                      setRepoPath(path);
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
                    setRepoPath(repoBrowser.currentPath);
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

      {/* Import Existing Session Modal */}
      <Modal
        visible={isImportSessionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsImportSessionOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center p-4"
          onPress={() => setIsImportSessionOpen(false)}
        >
          <Pressable
            className="bg-surface rounded-xl w-full max-w-lg border border-border"
            onPress={() => {
              /* prevent close */
            }}
            style={{ maxHeight: "80%" }}
          >
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
              <View className="flex-1 pr-4">
                <Text className="text-foreground text-lg font-bold">
                  Import Existing Session
                </Text>
                <Text className="text-foreground-secondary text-xs mt-1">
                  {selectedTool === "codex" ? "Codex" : "Claude Code"} sessions
                  for {repoName(trimmedRepoPath || "/")}
                </Text>
              </View>
              <Pressable
                className="bg-surface-light rounded-md px-2.5 py-1"
                onPress={() => setIsImportSessionOpen(false)}
              >
                <Text className="text-foreground-secondary text-sm">Close</Text>
              </Pressable>
            </View>

            <ScrollView className="px-5 py-3" style={{ maxHeight: 420 }}>
              {isLoadingImportableSessions ? (
                <View className="items-center py-8">
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text className="text-foreground-secondary mt-2 text-sm">
                    Loading sessions...
                  </Text>
                </View>
              ) : importableSessionsError ? (
                <View className="bg-red/10 border border-red rounded-lg px-3 py-2 my-2">
                  <Text className="text-red text-sm">
                    {importableSessionsError}
                  </Text>
                </View>
              ) : importableSessions.length === 0 ? (
                <Text className="text-foreground-secondary text-sm py-4 text-center">
                  No existing sessions found for this working directory.
                </Text>
              ) : (
                importableSessions.map((session) => (
                  <ImportableSessionRow
                    key={session.id}
                    session={session}
                    selected={selectedImportSession?.id === session.id}
                    onSelect={() => {
                      setSelectedImportSession(session);
                      setIsImportSessionOpen(false);
                    }}
                  />
                ))
              )}
            </ScrollView>

            <View className="px-5 py-3 border-t border-border">
              <Pressable
                className="bg-surface-light rounded-lg py-2.5 items-center"
                onPress={() => {
                  setSelectedImportSession(null);
                  setIsImportSessionOpen(false);
                }}
              >
                <Text className="text-foreground-secondary font-medium text-sm">
                  Start fresh instead
                </Text>
              </Pressable>
            </View>
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

function ImportableSessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ImportableSessionSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      className={`rounded-lg border px-3 py-3 mb-2 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-surface-light"
      }`}
      onPress={onSelect}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-foreground text-sm font-semibold">
            {session.title}
          </Text>
          {session.subtitle ? (
            <Text
              className="text-foreground-secondary text-xs mt-1"
              numberOfLines={2}
            >
              {session.subtitle}
            </Text>
          ) : null}
          <Text className="text-foreground-secondary text-[11px] mt-2">
            {timeAgo(session.updatedAt)}
          </Text>
        </View>
        <View
          className={`rounded-full px-2 py-1 ${
            selected ? "bg-accent/20" : "bg-surface"
          }`}
        >
          <Text
            className={`text-[11px] font-semibold ${
              selected ? "text-accent" : "text-foreground-secondary"
            }`}
          >
            {selected ? "Selected" : "Select"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
