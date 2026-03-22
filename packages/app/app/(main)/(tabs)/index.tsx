import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import type { AgentInfo } from "@webmux/shared";
import { timeAgo } from "@webmux/shared";
import {
  listAgents,
  createRegistrationToken,
  deleteAgent,
  renameAgent,
  getBaseUrl,
} from "../../../lib/api";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export default function AgentsScreen() {
  const router = useRouter();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-agent modal
  const [modalOpen, setModalOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [copied, setCopied] = useState(false);
  const cachedTokenRef = useRef<CachedToken | null>(null);
  const [registrationCommand, setRegistrationCommand] = useState<string | null>(
    null
  );

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const loadAgents = useCallback(async () => {
    try {
      const data = await listAgents();
      setAgents(data.agents);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const buildCommand = (token: string) => {
    const baseUrl =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : getBaseUrl();
    return `npx @webmux/agent register --server ${baseUrl} --token ${token}`;
  };

  const fetchNewToken = async () => {
    setRegistering(true);
    setError(null);
    try {
      const data = await createRegistrationToken();
      cachedTokenRef.current = {
        token: data.token,
        expiresAt: data.expiresAt,
      };
      setRegistrationCommand(buildCommand(data.token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  };

  const openModal = () => {
    setModalOpen(true);
    setCopied(false);

    // Reuse cached token if still valid (with 1 min buffer)
    const cached = cachedTokenRef.current;
    if (cached && cached.expiresAt > Date.now() + 60000) {
      setRegistrationCommand(buildCommand(cached.token));
      return;
    }

    // Otherwise fetch a new one
    cachedTokenRef.current = null;
    setRegistrationCommand(null);
    void fetchNewToken();
  };

  const handleRegenerate = () => {
    cachedTokenRef.current = null;
    setRegistrationCommand(null);
    setCopied(false);
    void fetchNewToken();
  };

  const handleDeleteAgent = async (agent: AgentInfo) => {
    const doDelete = async () => {
      setError(null);
      try {
        await deleteAgent(agent.id);
        void loadAgents();
      } catch (err) {
        setError((err as Error).message);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-restricted-globals
      const confirmed = confirm(
        `Delete agent "${agent.name}"? This cannot be undone.`
      );
      if (!confirmed) return;
      await doDelete();
    } else {
      Alert.alert(
        "Delete Agent",
        `Delete agent "${agent.name}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void doDelete(),
          },
        ]
      );
    }
  };

  const handleRename = async (agentId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameAgent(agentId, name);
      setRenamingId(null);
      void loadAgents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setCopied(false);
    void loadAgents();
  };

  const copyCommand = async () => {
    if (!registrationCommand) return;
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard
      ) {
        await navigator.clipboard.writeText(registrationCommand);
      }
      // On native without expo-clipboard, copy is not supported — but we still show "Copied" feedback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard errors
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading agents...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-foreground text-2xl font-bold">
            Your Agents
          </Text>
          <Pressable
            className="flex-row items-center bg-accent rounded-lg px-4 py-2"
            onPress={openModal}
          >
            <Text className="text-background font-semibold text-sm">
              + Add Agent
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
        {agents.length === 0 ? (
          <View className="items-center justify-center py-16">
            <Text className="text-foreground-secondary text-5xl mb-4">
              {"🖥️"}
            </Text>
            <Text className="text-foreground text-xl font-semibold mb-2">
              No agents yet
            </Text>
            <Text className="text-foreground-secondary text-sm text-center mb-6 px-8">
              Add an agent to connect a machine. Agents run on your servers and
              provide AI-powered coding assistance through webmux.
            </Text>
            <Pressable
              className="flex-row items-center bg-accent rounded-lg px-5 py-3"
              onPress={openModal}
            >
              <Text className="text-background font-semibold">
                + Add your first agent
              </Text>
            </Pressable>
          </View>
        ) : (
          /* Agent list */
          <View className="gap-3">
            {agents.map((agent) => (
              <Pressable
                key={agent.id}
                className="bg-surface rounded-xl p-4 border border-border"
                onPress={() => {
                  if (renamingId) return;
                  router.push(
                    `/(main)/threads/new?agentId=${agent.id}` as never
                  );
                }}
              >
                {/* Card header */}
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1 mr-2">
                    {/* Status dot */}
                    <View
                      className={`w-2.5 h-2.5 rounded-full mr-2.5 ${
                        agent.status === "online" ? "bg-green" : "bg-foreground-secondary"
                      }`}
                    />
                    {/* Name or rename input */}
                    {renamingId === agent.id ? (
                      <View className="flex-row items-center flex-1 gap-2">
                        <TextInput
                          className="flex-1 bg-surface-light text-foreground rounded-md px-2 py-1 text-sm border border-border"
                          value={renameValue}
                          onChangeText={setRenameValue}
                          maxLength={32}
                          autoFocus
                          onSubmitEditing={() => void handleRename(agent.id)}
                          placeholderTextColor="#565f89"
                        />
                        <Pressable
                          className="bg-accent rounded-md px-2 py-1"
                          onPress={() => void handleRename(agent.id)}
                        >
                          <Text className="text-background text-xs font-semibold">
                            OK
                          </Text>
                        </Pressable>
                        <Pressable
                          className="bg-surface-light rounded-md px-2 py-1"
                          onPress={() => setRenamingId(null)}
                        >
                          <Text className="text-foreground-secondary text-xs">
                            Cancel
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text className="text-foreground text-base font-semibold flex-shrink">
                        {agent.name}
                      </Text>
                    )}
                  </View>
                  {/* Actions */}
                  {renamingId !== agent.id ? (
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        className="bg-surface-light rounded-md px-2.5 py-1.5"
                        onPress={() => {
                          setRenamingId(agent.id);
                          setRenameValue(agent.name);
                        }}
                      >
                        <Text className="text-foreground-secondary text-xs">
                          Rename
                        </Text>
                      </Pressable>
                      <Pressable
                        className="bg-surface-light rounded-md px-2.5 py-1.5"
                        onPress={() => void handleDeleteAgent(agent)}
                      >
                        <Text className="text-red text-xs">Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {/* Card meta */}
                <View className="flex-row items-center mt-3 gap-2">
                  <View
                    className={`rounded-full px-2 py-0.5 ${
                      agent.status === "online"
                        ? "bg-green/20"
                        : "bg-foreground-secondary/20"
                    }`}
                  >
                    <Text
                      className={`text-xs font-medium ${
                        agent.status === "online"
                          ? "text-green"
                          : "text-foreground-secondary"
                      }`}
                    >
                      {agent.status === "online" ? "Online" : "Offline"}
                    </Text>
                  </View>
                  {agent.lastSeenAt ? (
                    <Text className="text-foreground-secondary text-xs">
                      Last seen {timeAgo(agent.lastSeenAt * 1000)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add Agent Modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center p-4"
          onPress={closeModal}
        >
          <Pressable
            className="bg-surface rounded-xl w-full max-w-lg p-5 border border-border"
            onPress={() => {
              /* prevent close when tapping modal body */
            }}
          >
            {/* Modal header */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-foreground text-lg font-bold">
                Register Agent
              </Text>
              <Pressable
                className="bg-surface-light rounded-md px-2.5 py-1"
                onPress={closeModal}
              >
                <Text className="text-foreground-secondary text-sm">
                  Close
                </Text>
              </Pressable>
            </View>

            {/* Modal body */}
            {registering ? (
              <View className="items-center py-8">
                <ActivityIndicator size="small" color="#7aa2f7" />
                <Text className="text-foreground-secondary mt-2 text-sm">
                  Generating token...
                </Text>
              </View>
            ) : registrationCommand ? (
              <View>
                <Text className="text-foreground-secondary text-sm mb-3">
                  Run this command on the target machine:
                </Text>
                <View className="bg-background rounded-lg p-3 mb-3 border border-border">
                  <Text className="text-foreground text-xs font-mono" selectable>
                    {registrationCommand}
                  </Text>
                </View>
                <View className="flex-row gap-2 mb-3">
                  <Pressable
                    className="flex-row items-center bg-surface-light rounded-lg px-3 py-2"
                    onPress={() => void copyCommand()}
                  >
                    <Text className="text-foreground text-sm">
                      {copied ? "Copied!" : "Copy"}
                    </Text>
                  </Pressable>
                  <Pressable
                    className="flex-row items-center bg-surface-light rounded-lg px-3 py-2"
                    onPress={handleRegenerate}
                  >
                    <Text className="text-foreground text-sm">Regenerate</Text>
                  </Pressable>
                </View>
                <Text className="text-foreground-secondary text-xs mb-4">
                  The agent name defaults to the machine's hostname. Use --name
                  to override.
                </Text>
                <Pressable
                  className="bg-accent rounded-lg py-2.5 items-center"
                  onPress={closeModal}
                >
                  <Text className="text-background font-semibold">Done</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
