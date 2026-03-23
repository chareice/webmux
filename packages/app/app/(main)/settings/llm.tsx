import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import type { LlmConfig, Project } from "@webmux/shared";
import {
  listLlmConfigs,
  createLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  listProjects,
} from "../../../lib/api";
import { getSettingsRoute } from "../../../lib/route-utils";

function maskApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return "****" + key.slice(-4);
}

interface ConfigFormData {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  projectId: string; // empty string = default (null)
}

const EMPTY_FORM: ConfigFormData = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  projectId: "",
};

export default function LlmConfigScreen() {
  const router = useRouter();

  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<ConfigFormData>({
    ...EMPTY_FORM,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ConfigFormData>({ ...EMPTY_FORM });
  const [isUpdating, setIsUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [configsData, projectsData] = await Promise.all([
        listLlmConfigs(),
        listProjects(),
      ]);
      setConfigs(configsData.configs);
      setProjects(projectsData.projects);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async () => {
    setCreateError(null);
    if (!createForm.apiBaseUrl.trim()) {
      setCreateError("API Base URL is required");
      return;
    }
    if (!createForm.apiKey.trim()) {
      setCreateError("API Key is required");
      return;
    }
    if (!createForm.model.trim()) {
      setCreateError("Model is required");
      return;
    }

    setIsCreating(true);
    try {
      const body: {
        apiBaseUrl: string;
        apiKey: string;
        model: string;
        projectId?: string;
      } = {
        apiBaseUrl: createForm.apiBaseUrl.trim(),
        apiKey: createForm.apiKey.trim(),
        model: createForm.model.trim(),
      };
      if (createForm.projectId) {
        body.projectId = createForm.projectId;
      }

      const data = await createLlmConfig(body);
      setConfigs((prev) => [...prev, data.config]);
      setCreateForm({ ...EMPTY_FORM });
      setShowCreateForm(false);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (config: LlmConfig) => {
    setEditingId(config.id);
    setEditForm({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: "", // Don't pre-fill API key for security
      model: config.model,
      projectId: config.projectId ?? "",
    });
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ ...EMPTY_FORM });
    setEditError(null);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setEditError(null);

    setIsUpdating(true);
    try {
      const body: {
        apiBaseUrl?: string;
        apiKey?: string;
        model?: string;
      } = {};
      if (editForm.apiBaseUrl.trim()) body.apiBaseUrl = editForm.apiBaseUrl.trim();
      if (editForm.apiKey.trim()) body.apiKey = editForm.apiKey.trim();
      if (editForm.model.trim()) body.model = editForm.model.trim();

      if (Object.keys(body).length === 0) {
        setEditError("No changes to save");
        setIsUpdating(false);
        return;
      }

      const data = await updateLlmConfig(editingId, body);
      setConfigs((prev) =>
        prev.map((c) => (c.id === editingId ? data.config : c))
      );
      setEditingId(null);
      setEditForm({ ...EMPTY_FORM });
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (configId: string) => {
    const doDelete = async () => {
      try {
        setDeletingId(configId);
        await deleteLlmConfig(configId);
        setConfigs((prev) => prev.filter((c) => c.id !== configId));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDeletingId(null);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm("Delete this LLM config?")) return;
      await doDelete();
    } else {
      Alert.alert("Delete Config", "Delete this LLM config?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void doDelete(),
        },
      ]);
    }
  };

  const projectName = (projectId: string | null): string => {
    if (!projectId) return "Default";
    const project = projects.find((p) => p.id === projectId);
    return project?.name ?? projectId;
  };

  // Sort: default configs first, then by project name
  const sortedConfigs = [...configs].sort((a, b) => {
    if (!a.projectId && b.projectId) return -1;
    if (a.projectId && !b.projectId) return 1;
    return projectName(a.projectId).localeCompare(projectName(b.projectId));
  });

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading LLM configs...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center gap-3">
            <Pressable onPress={() => router.replace(getSettingsRoute() as never)}>
              <Text className="text-accent text-base">{"< Back"}</Text>
            </Pressable>
            <Text className="text-foreground text-2xl font-bold">
              LLM Configuration
            </Text>
          </View>
          <Pressable
            className="flex-row items-center bg-accent rounded-lg px-4 py-2"
            onPress={() => setShowCreateForm(true)}
          >
            <Text className="text-background font-semibold text-sm">
              + New Config
            </Text>
          </Pressable>
        </View>

        {/* Error banner */}
        {error ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-4">
            <Text className="text-red text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Create form */}
        {showCreateForm ? (
          <View className="bg-surface rounded-xl p-4 border border-border mb-4">
            <Text className="text-foreground text-lg font-bold mb-3">
              New LLM Config
            </Text>

            <Text className="text-foreground-secondary text-sm mb-1">
              API Base URL
            </Text>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              placeholder="https://api.openai.com/v1"
              placeholderTextColor="#565f89"
              value={createForm.apiBaseUrl}
              onChangeText={(text) =>
                setCreateForm((f) => ({ ...f, apiBaseUrl: text }))
              }
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text className="text-foreground-secondary text-sm mb-1">
              API Key
            </Text>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              placeholder="sk-..."
              placeholderTextColor="#565f89"
              value={createForm.apiKey}
              onChangeText={(text) =>
                setCreateForm((f) => ({ ...f, apiKey: text }))
              }
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text className="text-foreground-secondary text-sm mb-1">
              Model
            </Text>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              placeholder="gpt-4o, claude-sonnet-4-20250514, etc."
              placeholderTextColor="#565f89"
              value={createForm.model}
              onChangeText={(text) =>
                setCreateForm((f) => ({ ...f, model: text }))
              }
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text className="text-foreground-secondary text-sm mb-1">
              Project (optional)
            </Text>
            <View className="bg-surface-light border border-border rounded-lg mb-1">
              <Pressable
                className="px-4 py-3"
                onPress={() => {
                  // Cycle through: default -> projects -> default
                  const currentIdx = createForm.projectId
                    ? projects.findIndex((p) => p.id === createForm.projectId)
                    : -1;
                  const nextIdx = currentIdx + 1;
                  if (nextIdx >= projects.length) {
                    setCreateForm((f) => ({ ...f, projectId: "" }));
                  } else {
                    setCreateForm((f) => ({
                      ...f,
                      projectId: projects[nextIdx].id,
                    }));
                  }
                }}
              >
                <Text className="text-foreground text-base">
                  {createForm.projectId
                    ? projectName(createForm.projectId)
                    : "Default (all projects)"}
                </Text>
              </Pressable>
            </View>
            <Text className="text-foreground-secondary text-xs mb-3">
              Tap to cycle through projects. Leave as default to apply to all.
            </Text>

            {createError ? (
              <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
                <Text className="text-red text-sm">{createError}</Text>
              </View>
            ) : null}

            <View className="flex-row gap-2">
              <Pressable
                className={`flex-row items-center rounded-lg px-4 py-2.5 ${
                  isCreating ||
                  !createForm.apiBaseUrl.trim() ||
                  !createForm.apiKey.trim() ||
                  !createForm.model.trim()
                    ? "bg-accent/50"
                    : "bg-accent"
                }`}
                disabled={
                  isCreating ||
                  !createForm.apiBaseUrl.trim() ||
                  !createForm.apiKey.trim() ||
                  !createForm.model.trim()
                }
                onPress={() => void handleCreate()}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#1a1b26" />
                ) : null}
                <Text className="text-background font-semibold text-sm ml-1">
                  {isCreating ? "Creating..." : "Create Config"}
                </Text>
              </Pressable>
              <Pressable
                className="bg-surface-light rounded-lg px-4 py-2.5"
                onPress={() => {
                  setShowCreateForm(false);
                  setCreateForm({ ...EMPTY_FORM });
                  setCreateError(null);
                }}
              >
                <Text className="text-foreground-secondary text-sm">
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Empty state */}
        {sortedConfigs.length === 0 && !showCreateForm ? (
          <View className="items-center justify-center py-16">
            <Text className="text-foreground text-xl font-semibold mb-2">
              No LLM configs yet
            </Text>
            <Text className="text-foreground-secondary text-sm text-center px-8">
              Add an LLM configuration to enable the agent loop. You need at
              least a default config with your API endpoint, key, and model.
            </Text>
          </View>
        ) : null}

        {/* Config list */}
        {sortedConfigs.length > 0 ? (
          <View className="gap-3">
            {sortedConfigs.map((config) => (
              <View
                key={config.id}
                className="bg-surface rounded-xl p-4 border border-border"
              >
                {editingId === config.id ? (
                  // Edit mode
                  <View>
                    <Text className="text-foreground-secondary text-sm mb-1">
                      API Base URL
                    </Text>
                    <TextInput
                      className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
                      value={editForm.apiBaseUrl}
                      onChangeText={(text) =>
                        setEditForm((f) => ({ ...f, apiBaseUrl: text }))
                      }
                      autoCapitalize="none"
                      autoCorrect={false}
                    />

                    <Text className="text-foreground-secondary text-sm mb-1">
                      API Key (leave empty to keep current)
                    </Text>
                    <TextInput
                      className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
                      placeholder="Leave empty to keep current key"
                      placeholderTextColor="#565f89"
                      value={editForm.apiKey}
                      onChangeText={(text) =>
                        setEditForm((f) => ({ ...f, apiKey: text }))
                      }
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />

                    <Text className="text-foreground-secondary text-sm mb-1">
                      Model
                    </Text>
                    <TextInput
                      className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
                      value={editForm.model}
                      onChangeText={(text) =>
                        setEditForm((f) => ({ ...f, model: text }))
                      }
                      autoCapitalize="none"
                      autoCorrect={false}
                    />

                    {editError ? (
                      <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
                        <Text className="text-red text-sm">{editError}</Text>
                      </View>
                    ) : null}

                    <View className="flex-row gap-2">
                      <Pressable
                        className={`rounded-lg px-4 py-2.5 ${
                          isUpdating ? "bg-accent/50" : "bg-accent"
                        }`}
                        disabled={isUpdating}
                        onPress={() => void handleUpdate()}
                      >
                        {isUpdating ? (
                          <ActivityIndicator size="small" color="#1a1b26" />
                        ) : null}
                        <Text className="text-background font-semibold text-sm">
                          {isUpdating ? "Saving..." : "Save"}
                        </Text>
                      </Pressable>
                      <Pressable
                        className="bg-surface-light rounded-lg px-4 py-2.5"
                        onPress={handleCancelEdit}
                      >
                        <Text className="text-foreground-secondary text-sm">
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  // Display mode
                  <View>
                    {/* Header: scope + model */}
                    <View className="flex-row items-center gap-2 mb-2">
                      <View
                        className={`rounded-full px-2.5 py-0.5 ${
                          config.projectId
                            ? "bg-purple/20"
                            : "bg-accent/20"
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            config.projectId
                              ? "text-purple"
                              : "text-accent"
                          }`}
                        >
                          {projectName(config.projectId)}
                        </Text>
                      </View>
                      <Text className="text-foreground font-semibold text-sm">
                        {config.model}
                      </Text>
                    </View>

                    {/* Details */}
                    <View className="mb-3">
                      <View className="flex-row items-center gap-2 mb-1">
                        <Text className="text-foreground-secondary text-xs w-16">
                          Endpoint
                        </Text>
                        <Text
                          className="text-foreground text-xs flex-1"
                          numberOfLines={1}
                        >
                          {config.apiBaseUrl}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-foreground-secondary text-xs w-16">
                          API Key
                        </Text>
                        <Text className="text-foreground-secondary text-xs">
                          {maskApiKey(config.apiKey)}
                        </Text>
                      </View>
                    </View>

                    {/* Actions */}
                    <View className="flex-row gap-2">
                      <Pressable
                        className="bg-surface-light rounded-lg px-3 py-1.5"
                        onPress={() => handleStartEdit(config)}
                      >
                        <Text className="text-foreground-secondary text-xs">
                          Edit
                        </Text>
                      </Pressable>
                      <Pressable
                        className="bg-surface-light rounded-lg px-3 py-1.5"
                        disabled={deletingId === config.id}
                        onPress={() => void handleDelete(config.id)}
                      >
                        <Text className="text-red text-xs">
                          {deletingId === config.id ? "..." : "Delete"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
