import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import type { AgentInfo, RunTool } from "@webmux/shared";
import { listAgents, getInstructions, saveInstructions } from "../../../lib/api";
import { getKeyboardAwareScrollProps } from "../../../lib/mobile-layout";
import { getSettingsRoute } from "../../../lib/route-utils";

const TOOLS: { key: RunTool; label: string; file: string }[] = [
  { key: "claude", label: "Claude Code", file: "~/.claude/CLAUDE.md" },
  { key: "codex", label: "Codex", file: "~/.codex/AGENTS.md" },
];

export default function InstructionsScreen() {
  const router = useRouter();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [activeTool, setActiveTool] = useState<RunTool>("claude");
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    listAgents()
      .then((data) => {
        setAgents(data.agents);
        const onlineAgent = data.agents.find((a) => a.status === "online");
        if (onlineAgent) setSelectedAgentId(onlineAgent.id);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setIsLoading(false));
  }, []);

  const fetchInstructionsData = useCallback(async () => {
    if (!selectedAgentId) return;
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (!agent || agent.status !== "online") {
      setContent("");
      setOriginalContent("");
      return;
    }

    setIsFetching(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const data = await getInstructions(selectedAgentId, activeTool);
      setContent(data.content ?? "");
      setOriginalContent(data.content ?? "");
    } catch (err) {
      setError((err as Error).message);
      setContent("");
      setOriginalContent("");
    } finally {
      setIsFetching(false);
    }
  }, [selectedAgentId, activeTool, agents]);

  useEffect(() => {
    void fetchInstructionsData();
  }, [fetchInstructionsData]);

  const handleSave = async () => {
    if (!selectedAgentId) return;
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await saveInstructions(selectedAgentId, activeTool, content);
      setOriginalContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const isDirty = content !== originalContent;
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const isOffline = selectedAgent?.status !== "online";

  // Cycle node selection
  const cycleAgent = () => {
    if (agents.length === 0) return;
    const currentIdx = agents.findIndex((a) => a.id === selectedAgentId);
    const nextIdx = (currentIdx + 1) % agents.length;
    setSelectedAgentId(agents[nextIdx].id);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#1a1a1a" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading...
        </Text>
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
        {/* Header */}
        <View className="flex-row items-center gap-3 mb-4">
          <Pressable onPress={() => router.replace(getSettingsRoute() as never)}>
            <Text className="text-accent text-base">{"< Back"}</Text>
          </Pressable>
          <Text className="text-foreground text-2xl font-bold">
            Global Instructions
          </Text>
        </View>

        {/* Node selector */}
        <View className="mb-4">
          <Text className="text-foreground-secondary text-sm mb-1">Node</Text>
          <Pressable
            className="bg-surface-light border border-border rounded-lg px-4 py-3"
            onPress={cycleAgent}
          >
            <Text className="text-foreground text-base">
              {selectedAgentId
                ? `${
                    agents.find((a) => a.id === selectedAgentId)?.name ??
                    selectedAgentId
                  }${isOffline ? " (offline)" : ""}`
                : "Select a node..."}
            </Text>
          </Pressable>
          {agents.length > 1 ? (
            <Text className="text-foreground-secondary text-xs mt-1">
              Tap to cycle through nodes
            </Text>
          ) : null}
        </View>

        {/* Offline state */}
        {selectedAgentId && isOffline ? (
          <View className="items-center justify-center py-16">
            <Text className="text-foreground text-xl font-semibold mb-2">
              Node Offline
            </Text>
            <Text className="text-foreground-secondary text-sm text-center px-8">
              Connect the node to manage instructions.
            </Text>
          </View>
        ) : selectedAgentId ? (
          <>
            {/* Tool tabs */}
            <View className="flex-row gap-2 mb-3">
              {TOOLS.map((t) => (
                <Pressable
                  key={t.key}
                  className={`rounded-lg px-4 py-2 ${
                    activeTool === t.key
                      ? "bg-accent"
                      : "bg-surface-light"
                  }`}
                  onPress={() => setActiveTool(t.key)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      activeTool === t.key
                        ? "text-background"
                        : "text-foreground-secondary"
                    }`}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* File hint */}
            <Text className="text-foreground-secondary text-xs mb-3">
              {TOOLS.find((t) => t.key === activeTool)?.file}
            </Text>

            {/* Error banner */}
            {error ? (
              <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
                <Text className="text-red text-sm">{error}</Text>
              </View>
            ) : null}

            {/* Loading instructions */}
            {isFetching ? (
              <View className="items-center justify-center py-16">
                <ActivityIndicator size="large" color="#1a1a1a" />
                <Text className="text-foreground-secondary mt-3 text-sm">
                  Loading instructions...
                </Text>
              </View>
            ) : (
              <>
                {/* Text editor */}
                <TextInput
                  className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground text-sm min-h-[240px]"
                  value={content}
                  onChangeText={setContent}
                  placeholder={`Enter global instructions for ${
                    activeTool === "claude" ? "Claude Code" : "Codex"
                  }...`}
                  placeholderTextColor="#9a9a9a"
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                />

                {/* Save actions */}
                <View className="flex-row items-center gap-3 mt-3">
                  <Pressable
                    className={`rounded-lg px-4 py-2.5 ${
                      isSaving || !isDirty ? "bg-accent/50" : "bg-accent"
                    }`}
                    disabled={isSaving || !isDirty}
                    onPress={() => void handleSave()}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#f8f5ed" />
                    ) : null}
                    <Text className="text-background font-semibold text-sm">
                      {saveSuccess
                        ? "Saved!"
                        : isSaving
                        ? "Saving..."
                        : "Save"}
                    </Text>
                  </Pressable>
                  {isDirty ? (
                    <Text className="text-yellow text-xs">Unsaved changes</Text>
                  ) : null}
                </View>
              </>
            )}
          </>
        ) : (
          // No node selected
          <View className="items-center justify-center py-16">
            <Text className="text-foreground text-xl font-semibold mb-2">
              Select a Node
            </Text>
            <Text className="text-foreground-secondary text-sm text-center px-8">
              Select a node to manage its global instructions.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
