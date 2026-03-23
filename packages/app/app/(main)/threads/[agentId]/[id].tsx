import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import type {
  ContinueRunRequest,
  Run,
  RunEvent,
  RunImageAttachmentUpload,
  RunStatus,
  RunTimelineEvent,
  RunTurnDetail,
  RunTurnOptions,
  RunTool,
  TodoEntry,
} from "@webmux/shared";
import {
  timeAgo,
  runStatusLabel,
  runStatusColor,
  toolLabel,
  toolIcon,
  repoName,
} from "@webmux/shared";
import {
  getThreadDetail,
  continueThread,
  interruptThread,
  deleteThread,
  updateQueuedTurn,
  deleteQueuedTurn,
  resumeQueue,
  discardQueue,
  getBaseUrl,
  getToken,
} from "../../../../lib/api";
import MarkdownContent from "../../../../components/MarkdownContent";
import { getThreadsRoute } from "../../../../lib/route-utils";
import { canContinueTurn, canRetryTurn } from "../../../../lib/thread-utils";
import { createReconnectableSocket } from "../../../../lib/websocket";

// --- Constants ---

const MAX_ATTACHMENTS = 4;
const AUTO_REFRESH_INTERVAL = 5000;
const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;
const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

// --- Types ---

interface DraftAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUri: string;
  base64: string;
}

type ConversationSegment =
  | { type: "user"; text: string; attachmentCount: number; id: string }
  | { type: "assistant"; text: string; id: number }
  | { type: "tools"; items: RunTimelineEvent[]; id: string }
  | { type: "system"; text: string; id: number };

// --- Helpers ---

function isRunActive(status: RunStatus): boolean {
  return status === "starting" || status === "running";
}

function isTrivialActivity(item: RunTimelineEvent): boolean {
  if (item.type !== "activity") return false;
  const lbl = item.label.toLowerCase();
  return (
    lbl.includes("completed") ||
    lbl.includes("started") ||
    lbl.includes("finished")
  );
}

function groupIntoSegments(turns: RunTurnDetail[]): ConversationSegment[] {
  const segments: ConversationSegment[] = [];

  for (const turn of turns) {
    // User message
    if (turn.prompt || turn.attachments.length > 0) {
      segments.push({
        type: "user",
        text: turn.prompt,
        attachmentCount: turn.attachments.length,
        id: `user-${turn.id}`,
      });
    }

    // Group items into assistant messages vs tool calls
    let pendingTools: RunTimelineEvent[] = [];

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      // Single trivial activity -> inline system text
      if (pendingTools.length === 1 && isTrivialActivity(pendingTools[0])) {
        segments.push({
          type: "system",
          text:
            pendingTools[0].type === "activity"
              ? pendingTools[0].label +
                (pendingTools[0].detail ? `: ${pendingTools[0].detail}` : "")
              : "",
          id: pendingTools[0].id,
        });
      } else {
        segments.push({
          type: "tools",
          items: [...pendingTools],
          id: `tools-${turn.id}-${pendingTools[0].id}`,
        });
      }
      pendingTools = [];
    };

    for (const item of turn.items) {
      if (item.type === "message" && item.role === "assistant") {
        flushTools();
        segments.push({ type: "assistant", text: item.text, id: item.id });
      } else {
        // Commands, activities, system messages -> tool group
        pendingTools.push(item);
      }
    }

    flushTools();
  }

  return segments;
}

// Upsert a turn in the turns array
function upsertTurn(
  prev: RunTurnDetail[],
  turn: Pick<RunTurnDetail, "id"> & Partial<Omit<RunTurnDetail, "items">>
): RunTurnDetail[] {
  const idx = prev.findIndex((t) => t.id === turn.id);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { ...next[idx], ...turn, items: next[idx].items };
    return next;
  }
  return [...prev, { ...turn, items: [] } as RunTurnDetail];
}

// Append a timeline item to the correct turn
function appendItem(
  prev: RunTurnDetail[],
  turnId: string,
  item: RunTimelineEvent
): RunTurnDetail[] {
  const idx = prev.findIndex((t) => t.id === turnId);
  if (idx < 0) return prev; // signal caller to refetch

  const turn = prev[idx];
  // Avoid duplicates
  if (turn.items.some((i) => i.id === item.id)) return prev;

  const next = [...prev];
  next[idx] = { ...turn, items: [...turn.items, item] };
  return next;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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

// --- Main Screen ---

export default function ThreadDetailScreen() {
  const router = useRouter();
  const { agentId, id: threadId } = useLocalSearchParams<{
    agentId: string;
    id: string;
  }>();
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 1024;

  const [run, setRun] = useState<Run | null>(null);
  const [turns, setTurns] = useState<RunTurnDetail[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [turnOptions, setTurnOptions] = useState<RunTurnOptions>({});
  const [showOptions, setShowOptions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queued turn editing
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");

  // Tool detail view
  const [toolDetailItems, setToolDetailItems] = useState<
    RunTimelineEvent[] | null
  >(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Data Loading ---

  const fetchDetail = useCallback(async () => {
    if (!agentId || !threadId) return;
    try {
      const data = await getThreadDetail(agentId, threadId);
      setRun(data.run);
      setTurns(data.turns);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, threadId]);

  useEffect(() => {
    setRun(null);
    setTurns([]);
    setError(null);
    setFollowUp("");
    setAttachments([]);
    setIsLoading(true);
    void fetchDetail();
  }, [fetchDetail]);

  // --- WebSocket for real-time updates ---

  useEffect(() => {
    if (!threadId) return;

    const baseUrl = getBaseUrl();
    const token = getToken();

    // On web with no explicit baseUrl, use window.location
    let wsUrl: string;
    if (Platform.OS === "web" && !baseUrl) {
      const wsProtocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${wsProtocol}//${window.location.host}/ws/thread?threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(token)}`;
    } else if (baseUrl) {
      const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
      const wsHost = baseUrl.replace(/^https?:\/\//, "");
      wsUrl = `${wsProtocol}://${wsHost}/ws/thread?threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(token)}`;
    } else {
      // No baseUrl and not web — skip WS
      return;
    }

    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(wsUrl);
      },
      onMessage(event: MessageEvent) {
        try {
          const data = JSON.parse(event.data as string) as RunEvent;
          if (data.type === "run-status") {
            setRun(data.run);
          } else if (data.type === "run-turn") {
            setTurns((prev) => upsertTurn(prev, data.turn));
          } else if (data.type === "run-item") {
            setTurns((prev) => {
              const next = appendItem(prev, data.turnId, data.item);
              if (next === prev) {
                // Turn not found, refetch
                void fetchDetail();
              }
              return next;
            });
          }
        } catch {
          // Ignore malformed messages
        }
      },
      onError() {
        void fetchDetail();
      },
    });

    return () => controller.dispose();
  }, [threadId, fetchDetail]);

  // --- Derived state (must be before effects that reference it) ---

  const queuedTurns = turns.filter((t) => t.status === "queued");
  const nonQueuedTurns = turns.filter((t) => t.status !== "queued");
  const latestTurn =
    nonQueuedTurns.length > 0
      ? nonQueuedTurns[nonQueuedTurns.length - 1]
      : undefined;
  const active = latestTurn
    ? isRunActive(latestTurn.status)
    : run
      ? isRunActive(run.status)
      : false;
  const interruptedWithQueue =
    latestTurn?.status === "interrupted" && queuedTurns.length > 0;
  const canRetry = canRetryTurn(latestTurn, queuedTurns.length);

  const segments = groupIntoSegments(nonQueuedTurns);

  const hasContent = followUp.trim().length > 0 || attachments.length > 0;

  // --- Auto-refresh fallback for active threads ---

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      void fetchDetail();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [active, fetchDetail]);

  // --- Auto-scroll on new events ---

  useEffect(() => {
    if (!scrollViewRef.current) return;
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [turns]);

  // --- Handlers ---

  const handleInterrupt = async () => {
    if (!agentId || !threadId) return;
    try {
      await interruptThread(agentId, threadId);
    } catch {
      // Ignore transient failures
    }
  };

  const handleDelete = async () => {
    if (!agentId || !threadId) return;
    const label =
      run && isRunActive(run.status)
        ? "This will stop the running task and remove it."
        : "This will remove the thread.";

    const doDelete = async () => {
      try {
        await deleteThread(agentId, threadId);
        router.replace(getThreadsRoute() as never);
      } catch (err) {
        setError((err as Error).message);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm(label)) return;
      await doDelete();
    } else {
      Alert.alert("Delete Thread", label, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void doDelete(),
        },
      ]);
    }
  };

  const handleContinue = async () => {
    if (!agentId || !threadId) return;
    if (!hasContent) {
      setError("Please enter a follow-up message or attach images");
      return;
    }

    setIsContinuing(true);
    try {
      const uploadAttachments: RunImageAttachmentUpload[] = attachments.map(
        (a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          base64: a.base64,
        })
      );

      const opts =
        Object.keys(turnOptions).length > 0 ? turnOptions : undefined;
      const body: ContinueRunRequest = {
        prompt: followUp.trim(),
        ...(uploadAttachments.length > 0
          ? { attachments: uploadAttachments }
          : {}),
        options: opts,
      };

      const data = await continueThread(agentId, threadId, body);
      setRun(data.run);
      setTurns(data.turns);
      setFollowUp("");
      // Clean up object URLs on web
      if (Platform.OS === "web") {
        for (const a of attachments) URL.revokeObjectURL(a.previewUri);
      }
      setAttachments([]);
      // Reset clearSession after use but keep model/effort
      if (turnOptions.clearSession) {
        setTurnOptions((prev) => ({ ...prev, clearSession: false }));
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsContinuing(false);
    }
  };

  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (!agentId || !threadId || !latestTurn?.prompt) return;

    setIsRetrying(true);
    try {
      const data = await continueThread(agentId, threadId, {
        prompt: latestTurn.prompt,
      });
      setRun(data.run);
      setTurns(data.turns);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDeleteQueuedTurn = async (turnId: string) => {
    if (!agentId || !threadId) return;
    try {
      await deleteQueuedTurn(agentId, threadId, turnId);
      setTurns((prev) => prev.filter((t) => t.id !== turnId));
    } catch {
      // Ignore
    }
  };

  const handleUpdateQueuedTurn = async (turnId: string, prompt: string) => {
    if (!agentId || !threadId) return;
    try {
      await updateQueuedTurn(agentId, threadId, turnId, prompt);
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, prompt } : t))
      );
      setEditingTurnId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleResumeQueue = async () => {
    if (!agentId || !threadId) return;
    try {
      const data = await resumeQueue(agentId, threadId);
      setRun(data.run);
      setTurns(data.turns);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDiscardQueue = async () => {
    if (!agentId || !threadId) return;
    try {
      await discardQueue(agentId, threadId);
      setTurns((prev) => prev.filter((t) => t.status !== "queued"));
    } catch {
      // Ignore
    }
  };

  // --- Image attachment handling ---

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

  // --- Tool detail view ---

  if (toolDetailItems) {
    return (
      <View className="flex-1 bg-background">
        <ToolDetailView
          items={toolDetailItems}
          onClose={() => setToolDetailItems(null)}
        />
      </View>
    );
  }

  // --- Loading state ---

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading thread...
        </Text>
      </View>
    );
  }

  if (!run) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-foreground text-lg font-semibold mb-2">
          Thread not found
        </Text>
        {error ? (
          <Text className="text-red text-sm mb-4">{error}</Text>
        ) : null}
        <Pressable
          className="bg-surface-light rounded-lg px-4 py-2"
          onPress={() => router.replace(getThreadsRoute() as never)}
        >
          <Text className="text-foreground-secondary text-sm">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const statusColor = runStatusColor(run.status);

  // --- Render ---

  return (
    <View className="flex-1 bg-background">
      {/* Compact header (always visible) */}
      <View className="bg-surface px-4 py-2.5 border-b border-border">
        <View className="flex-row items-center gap-2">
          <Pressable
            className="bg-surface-light rounded-md px-2.5 py-1"
            onPress={() => router.replace(getThreadsRoute() as never)}
          >
            <Text className="text-foreground-secondary text-sm">Back</Text>
          </Pressable>

          <Text className="text-foreground font-semibold text-sm" numberOfLines={1}>
            {repoName(run.repoPath)}
          </Text>
          <Text className="text-foreground-secondary text-xs">
            {toolLabel(run.tool)}
          </Text>

          <View className="flex-1" />

          {/* Status badge */}
          <View className="flex-row items-center gap-1.5">
            <View
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
            <Text className="text-xs" style={{ color: statusColor }}>
              {runStatusLabel(run.status)}
            </Text>
          </View>

          {/* Delete button */}
          <Pressable
            className="bg-surface-light rounded-md px-2.5 py-1 ml-1"
            onPress={() => void handleDelete()}
          >
            <Text className="text-red text-xs">Delete</Text>
          </Pressable>
        </View>

        {/* Branch info */}
        {run.branch ? (
          <Text
            className="text-foreground-secondary text-xs mt-1"
            numberOfLines={1}
          >
            {run.branch}
          </Text>
        ) : null}
      </View>

      {/* Main body — two-column on wide web, single column otherwise */}
      <View className={`flex-1 ${isWideScreen ? "flex-row" : ""}`}>
        {/* Sidebar (web wide only) */}
        {isWideScreen ? (
          <View className="w-64 bg-surface border-r border-border p-4">
            <SidebarSection label="Tool">
              <View className="flex-row items-center gap-2">
                <View
                  className={`rounded px-1.5 py-0.5 ${run.tool === "codex" ? "bg-purple/20" : "bg-accent/20"}`}
                >
                  <Text
                    className={`text-xs font-bold ${run.tool === "codex" ? "text-purple" : "text-accent"}`}
                  >
                    {toolIcon(run.tool)}
                  </Text>
                </View>
                <Text className="text-foreground text-sm">
                  {toolLabel(run.tool)}
                </Text>
              </View>
            </SidebarSection>

            <SidebarSection label="Repository">
              <Text className="text-foreground text-sm font-medium">
                {repoName(run.repoPath)}
              </Text>
              <Text className="text-foreground-secondary text-xs mt-0.5">
                {run.repoPath}
              </Text>
            </SidebarSection>

            {run.branch ? (
              <SidebarSection label="Branch">
                <Text className="text-foreground text-sm font-mono">
                  {run.branch}
                </Text>
              </SidebarSection>
            ) : null}

            <SidebarSection label="Status">
              <View className="flex-row items-center gap-1.5">
                <View
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: statusColor }}
                />
                <Text className="text-sm" style={{ color: statusColor }}>
                  {runStatusLabel(run.status)}
                </Text>
              </View>
            </SidebarSection>

            <SidebarSection label="Updated">
              <Text className="text-foreground-secondary text-sm">
                {timeAgo(run.updatedAt)}
              </Text>
            </SidebarSection>

            <View className="mt-4 gap-2">
              {active ? (
                <Pressable
                  className="bg-orange/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1"
                  onPress={() => void handleInterrupt()}
                >
                  <Text className="text-orange text-sm font-semibold">
                    Interrupt
                  </Text>
                </Pressable>
              ) : null}
              {!active && canRetry ? (
                <Pressable
                  className={`bg-accent/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 ${isRetrying ? "opacity-60" : ""}`}
                  disabled={isRetrying}
                  onPress={() => void handleRetry()}
                >
                  <Text className="text-accent text-sm font-semibold">
                    {isRetrying ? "Retrying..." : "Retry"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                className="bg-red/10 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1"
                onPress={() => void handleDelete()}
              >
                <Text className="text-red text-sm font-semibold">Delete</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Main content area */}
        <View className="flex-1">
          {/* Timeline */}
          <ScrollView
            ref={scrollViewRef}
            className="flex-1"
            contentContainerClassName="p-4 pb-8"
            keyboardShouldPersistTaps="handled"
          >
            {segments.length === 0 && queuedTurns.length === 0 ? (
              <View className="items-center py-16">
                <Text className="text-foreground-secondary text-sm">
                  {active
                    ? "Thread started. Waiting for events..."
                    : "No timeline recorded."}
                </Text>
              </View>
            ) : (
              segments.map((segment) => {
                if (segment.type === "user") {
                  return (
                    <View
                      key={segment.id}
                      className="bg-accent/10 rounded-xl p-3 mb-3 self-end max-w-[85%]"
                    >
                      <Text className="text-accent text-xs font-semibold mb-1">
                        You
                      </Text>
                      {segment.text ? (
                        <Text className="text-foreground text-sm leading-5">
                          {segment.text}
                        </Text>
                      ) : null}
                      {segment.attachmentCount > 0 ? (
                        <Text className="text-foreground-secondary text-xs mt-1">
                          {segment.attachmentCount} image
                          {segment.attachmentCount > 1 ? "s" : ""} attached
                        </Text>
                      ) : null}
                    </View>
                  );
                }

                if (segment.type === "assistant") {
                  return (
                    <View
                      key={segment.id}
                      className="bg-surface rounded-xl p-3 mb-3 max-w-[85%]"
                    >
                      <Text className="text-foreground-secondary text-xs font-semibold mb-1">
                        Assistant
                      </Text>
                      <MessageContent content={segment.text} />
                    </View>
                  );
                }

                if (segment.type === "system") {
                  return (
                    <View
                      key={segment.id}
                      className="py-1.5 mb-2"
                    >
                      <Text className="text-foreground-secondary text-xs text-center">
                        {segment.text}
                      </Text>
                    </View>
                  );
                }

                // tools segment
                return (
                  <ToolsGroup
                    key={segment.id}
                    items={segment.items}
                    onOpenDetail={setToolDetailItems}
                  />
                );
              })
            )}

            {/* Queued turns */}
            {queuedTurns.length > 0 ? (
              <View className="mt-4">
                <Text className="text-foreground-secondary text-xs uppercase tracking-wider mb-2">
                  Queued ({queuedTurns.length})
                </Text>
                {queuedTurns.map((turn) => (
                  <QueuedTurnCard
                    key={turn.id}
                    turn={turn}
                    isEditing={editingTurnId === turn.id}
                    editingPrompt={editingPrompt}
                    onStartEdit={() => {
                      setEditingTurnId(turn.id);
                      setEditingPrompt(turn.prompt);
                    }}
                    onCancelEdit={() => setEditingTurnId(null)}
                    onChangeEditPrompt={setEditingPrompt}
                    onSave={() =>
                      void handleUpdateQueuedTurn(turn.id, editingPrompt)
                    }
                    onDelete={() => void handleDeleteQueuedTurn(turn.id)}
                  />
                ))}
              </View>
            ) : null}

            {/* Waiting indicator for active turns */}
            {active &&
              nonQueuedTurns.length > 0 &&
              nonQueuedTurns[nonQueuedTurns.length - 1].items.length === 0 ? (
              <View className="flex-row items-center gap-2 py-4">
                <ActivityIndicator size="small" color="#7aa2f7" />
                <Text className="text-foreground-secondary text-sm">
                  Waiting for events...
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer / Composer */}
          <View className="bg-surface border-t border-border px-4 py-3">
            {/* Interrupt button (mobile, when active) */}
            {active && !isWideScreen ? (
              <Pressable
                className="bg-orange/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 mb-2"
                onPress={() => void handleInterrupt()}
              >
                <Text className="text-orange text-sm font-semibold">
                  Interrupt
                </Text>
              </Pressable>
            ) : null}

            {!active && canRetry ? (
              <Pressable
                className={`bg-accent/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 mb-2 ${isRetrying ? "opacity-60" : ""}`}
                disabled={isRetrying}
                onPress={() => void handleRetry()}
              >
                <Text className="text-accent text-sm font-semibold">
                  {isRetrying ? "Retrying..." : "Retry"}
                </Text>
              </Pressable>
            ) : null}

            {/* Resume/Discard decision */}
            {interruptedWithQueue ? (
              <View className="flex-row items-center gap-2 mb-2">
                <Text className="text-foreground-secondary text-sm flex-1">
                  {queuedTurns.length} queued message
                  {queuedTurns.length > 1 ? "s" : ""}
                </Text>
                <Pressable
                  className="bg-accent/20 rounded-lg px-3 py-2"
                  onPress={() => void handleResumeQueue()}
                >
                  <Text className="text-accent text-sm font-semibold">
                    Resume
                  </Text>
                </Pressable>
                <Pressable
                  className="bg-red/20 rounded-lg px-3 py-2"
                  onPress={() => void handleDiscardQueue()}
                >
                  <Text className="text-red text-sm font-semibold">
                    Discard
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Composer */}
            {active || canContinueTurn(latestTurn) ? (
              <>
                {/* Attachment thumbnails */}
                {attachments.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="mb-2"
                    contentContainerClassName="gap-2"
                  >
                    {attachments.map((a) => (
                      <View
                        key={a.id}
                        className="relative w-16 h-16 rounded-lg overflow-hidden border border-border"
                      >
                        <Image
                          source={{ uri: a.previewUri }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                        <Pressable
                          className="absolute top-0.5 right-0.5 bg-black/60 rounded-full w-4 h-4 items-center justify-center"
                          onPress={() => removeAttachment(a.id)}
                        >
                          <Text className="text-white text-[8px] font-bold">
                            x
                          </Text>
                        </Pressable>
                        <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-0.5">
                          <Text
                            className="text-white text-[7px]"
                            numberOfLines={1}
                          >
                            {formatFileSize(a.sizeBytes)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                {/* Options panel (only when not active) */}
                {!active ? (
                  <TurnOptionsPanel
                    tool={run.tool}
                    options={turnOptions}
                    onChange={setTurnOptions}
                    expanded={showOptions}
                    onToggle={() => setShowOptions((v) => !v)}
                  />
                ) : null}

                {/* Hidden file input for web */}
                {Platform.OS === "web" ? (
                  <input
                    ref={fileInputRef as React.RefObject<HTMLInputElement>}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      void handleFilesSelectedWeb(
                        (e.target as HTMLInputElement).files
                      )
                    }
                  />
                ) : null}

                {/* Input row */}
                <View className="flex-row items-end gap-2">
                  {/* Image button */}
                  <Pressable
                    className={`bg-surface-light rounded-lg px-2.5 py-2 ${attachments.length >= MAX_ATTACHMENTS ? "opacity-40" : ""}`}
                    disabled={attachments.length >= MAX_ATTACHMENTS}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        fileInputRef.current?.click();
                      } else {
                        void handlePickImageNative();
                      }
                    }}
                  >
                    <Text className="text-foreground-secondary text-sm">
                      +Img
                    </Text>
                  </Pressable>

                  {/* Text input */}
                  <TextInput
                    className="flex-1 bg-surface-light border border-border rounded-lg px-3 py-2 text-foreground text-sm min-h-[36px] max-h-[100px]"
                    placeholder={
                      active
                        ? "Queue a follow-up message..."
                        : "Message this thread..."
                    }
                    placeholderTextColor="#565f89"
                    multiline
                    textAlignVertical="top"
                    value={followUp}
                    onChangeText={setFollowUp}
                  />

                  {/* Send button */}
                  <Pressable
                    className={`rounded-lg px-4 py-2 ${isContinuing || !hasContent ? "bg-accent/40" : "bg-accent"}`}
                    disabled={isContinuing || !hasContent}
                    onPress={() => void handleContinue()}
                  >
                    {isContinuing ? (
                      <ActivityIndicator size="small" color="#1a1b26" />
                    ) : (
                      <Text className="text-background text-sm font-semibold">
                        {active ? "Queue" : "Send"}
                      </Text>
                    )}
                  </Pressable>
                </View>

                {/* Error banner */}
                {error ? (
                  <Text className="text-red text-xs mt-1">{error}</Text>
                ) : null}
              </>
            ) : (
              <Text className="text-foreground-secondary text-sm text-center">
                Thread ended.
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

// --- Sub-components ---

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4">
      <Text className="text-foreground-secondary text-xs uppercase tracking-wider mb-1">
        {label}
      </Text>
      {children}
    </View>
  );
}

function MessageContent({ content }: { content: string }) {
  return <MarkdownContent compact content={content} selectable />;
}

function ToolsGroup({
  items,
  onOpenDetail,
}: {
  items: RunTimelineEvent[];
  onOpenDetail: (items: RunTimelineEvent[]) => void;
}) {
  // Show todos inline, separate from the collapsible tools group
  const todoItems = items.filter((i) => i.type === "todo");
  const rest = items.filter((i) => i.type !== "todo");

  return (
    <>
      {todoItems.map((item) =>
        item.type === "todo" ? (
          <TodoCard key={item.id} item={item} />
        ) : null
      )}
      {rest.length > 0 ? (
        <ToolsGroupInner items={rest} onOpenDetail={onOpenDetail} />
      ) : null}
    </>
  );
}

function ToolsGroupInner({
  items,
  onOpenDetail,
}: {
  items: RunTimelineEvent[];
  onOpenDetail: (items: RunTimelineEvent[]) => void;
}) {
  // Single activity with short/no detail -> show inline as system text
  if (items.length === 1 && items[0].type === "activity") {
    const a = items[0];
    const detail = a.detail && a.detail.length <= 80 ? `: ${a.detail}` : "";
    return (
      <View className="py-1.5 mb-2">
        <Text className="text-foreground-secondary text-xs text-center">
          {a.label}
          {detail}
        </Text>
      </View>
    );
  }

  // Only trivial activities (no commands, all short) -> show inline
  const hasCommands = items.some((i) => i.type === "command");
  if (
    !hasCommands &&
    items.length <= 3 &&
    items.every(
      (i) =>
        i.type === "activity" && (!i.detail || i.detail.length <= 80)
    )
  ) {
    return (
      <View className="py-1.5 mb-2">
        <Text className="text-foreground-secondary text-xs text-center">
          {items
            .map((i) => (i.type === "activity" ? i.label : ""))
            .filter(Boolean)
            .join(" -> ")}
        </Text>
      </View>
    );
  }

  // Summarize and make tappable
  const commands = items.filter((i) => i.type === "command").length;
  const activities = items.filter((i) => i.type === "activity").length;
  const parts: string[] = [];
  if (commands > 0) parts.push(`${commands} command${commands > 1 ? "s" : ""}`);
  if (activities > 0)
    parts.push(`${activities} activit${activities > 1 ? "ies" : "y"}`);
  const summary = parts.join(", ");

  return (
    <Pressable
      className="bg-surface-light rounded-lg px-3 py-2 mb-3 flex-row items-center gap-2"
      onPress={() => onOpenDetail(items)}
    >
      <Text className="text-foreground-secondary text-xs">
        {summary}
      </Text>
      <Text className="text-foreground-secondary text-xs ml-auto">{">"}</Text>
    </Pressable>
  );
}

function TodoCard({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: "todo" }>;
}) {
  const completedCount = item.items.filter(
    (e: TodoEntry) => e.status === "completed"
  ).length;
  const totalCount = item.items.length;

  return (
    <View className="bg-surface rounded-xl p-3 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-accent text-xs font-semibold uppercase">
          Todo List
        </Text>
        <Text className="text-foreground-secondary text-xs">
          {completedCount}/{totalCount}
        </Text>
      </View>
      {item.items.map((entry: TodoEntry, i: number) => (
        <View key={i} className="flex-row items-start gap-2 py-0.5">
          <Text className="text-foreground-secondary text-xs mt-0.5">
            {entry.status === "completed"
              ? "[x]"
              : entry.status === "in_progress"
                ? "[~]"
                : "[ ]"}
          </Text>
          <Text
            className={`text-sm flex-1 ${entry.status === "completed" ? "text-foreground-secondary line-through" : "text-foreground"}`}
          >
            {entry.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ToolDetailView({
  items,
  onClose,
}: {
  items: RunTimelineEvent[];
  onClose: () => void;
}) {
  return (
    <View className="flex-1">
      {/* Header */}
      <View className="bg-surface px-4 py-3 border-b border-border flex-row items-center gap-3">
        <Pressable
          className="bg-surface-light rounded-lg px-3 py-1.5"
          onPress={onClose}
        >
          <Text className="text-foreground-secondary text-sm">Back</Text>
        </Pressable>
        <Text className="text-foreground text-lg font-semibold">
          Tool Details
        </Text>
      </View>

      {/* Items */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-8"
      >
        {items.map((item) => {
          if (item.type === "command") {
            return <CommandCard key={item.id} item={item} />;
          }
          if (item.type === "activity") {
            return <ActivityRow key={item.id} item={item} />;
          }
          if (item.type === "todo") {
            return (
              <TodoCard
                key={item.id}
                item={item as Extract<RunTimelineEvent, { type: "todo" }>}
              />
            );
          }
          return null;
        })}
      </ScrollView>
    </View>
  );
}

function CommandCard({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: "command" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCollapsible = item.output.split("\n").length > 4;
  const commandColor =
    item.status === "failed"
      ? "#f7768e"
      : item.status === "completed"
        ? "#9ece6a"
        : "#7aa2f7";

  return (
    <View className="bg-surface rounded-xl p-3 mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-xs font-semibold" style={{ color: commandColor }}>
          {item.status === "started" ? "Command running" : "Command"}
        </Text>
        {item.exitCode !== null ? (
          <Text className="text-foreground-secondary text-xs">
            exit {item.exitCode}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-foreground text-sm font-mono bg-surface-light rounded px-2 py-1 mb-2"
        selectable
      >
        {item.command}
      </Text>
      {item.output ? (
        <View>
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-foreground-secondary text-xs">Output</Text>
            {isCollapsible ? (
              <Pressable onPress={() => setExpanded(!expanded)}>
                <Text className="text-accent text-xs">
                  {expanded ? "Collapse" : "Expand"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text
            className="text-foreground-secondary text-xs font-mono bg-surface-light rounded px-2 py-1"
            numberOfLines={!expanded && isCollapsible ? 4 : undefined}
            selectable
          >
            {item.output.trimEnd()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ActivityRow({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: "activity" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasLongDetail = !!item.detail && item.detail.split("\n").length > 3;
  const dotColor =
    item.status === "success"
      ? "#9ece6a"
      : item.status === "warning"
        ? "#e0af68"
        : item.status === "error"
          ? "#f7768e"
          : "#7aa2f7";

  return (
    <View className="flex-row gap-2 mb-3">
      <View
        className="w-2 h-2 rounded-full mt-1.5"
        style={{ backgroundColor: dotColor }}
      />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-foreground text-sm flex-1">{item.label}</Text>
          {hasLongDetail ? (
            <Pressable onPress={() => setExpanded(!expanded)}>
              <Text className="text-accent text-xs">
                {expanded ? "Collapse" : "Expand"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {item.detail ? (
          <Text
            className="text-foreground-secondary text-xs font-mono mt-0.5"
            numberOfLines={!expanded && hasLongDetail ? 3 : undefined}
            selectable
          >
            {item.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function QueuedTurnCard({
  turn,
  isEditing,
  editingPrompt,
  onStartEdit,
  onCancelEdit,
  onChangeEditPrompt,
  onSave,
  onDelete,
}: {
  turn: RunTurnDetail;
  isEditing: boolean;
  editingPrompt: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeEditPrompt: (text: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <View className="bg-surface rounded-lg p-3 mb-2 border border-border">
      {isEditing ? (
        <View>
          <TextInput
            className="bg-surface-light border border-border rounded-lg px-3 py-2 text-foreground text-sm min-h-[60px] mb-2"
            value={editingPrompt}
            onChangeText={onChangeEditPrompt}
            multiline
            autoFocus
            placeholderTextColor="#565f89"
          />
          <View className="flex-row justify-end gap-2">
            <Pressable
              className="bg-surface-light rounded-lg px-3 py-1.5"
              onPress={onCancelEdit}
            >
              <Text className="text-foreground-secondary text-sm">Cancel</Text>
            </Pressable>
            <Pressable
              className={`rounded-lg px-3 py-1.5 ${!editingPrompt.trim() ? "bg-accent/40" : "bg-accent"}`}
              disabled={!editingPrompt.trim()}
              onPress={onSave}
            >
              <Text className="text-background text-sm font-semibold">
                Save
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="flex-row items-start gap-2">
          <Text
            className="text-foreground text-sm flex-1"
            numberOfLines={3}
          >
            {turn.prompt}
          </Text>
          <Pressable
            className="bg-surface-light rounded px-2 py-1"
            onPress={onStartEdit}
          >
            <Text className="text-foreground-secondary text-xs">Edit</Text>
          </Pressable>
          <Pressable
            className="bg-red/10 rounded px-2 py-1"
            onPress={onDelete}
          >
            <Text className="text-red text-xs">X</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function TurnOptionsPanel({
  tool,
  options,
  onChange,
  expanded,
  onToggle,
}: {
  tool: RunTool;
  options: RunTurnOptions;
  onChange: (opts: RunTurnOptions) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const efforts = tool === "claude" ? CLAUDE_EFFORTS : CODEX_EFFORTS;
  const activeEffort =
    tool === "claude" ? options.claudeEffort : options.codexEffort;
  const hasActive =
    !!options.model || !!activeEffort || !!options.clearSession;

  return (
    <View className="mb-2">
      <Pressable onPress={onToggle}>
        <Text
          className={`text-xs mb-1 ${hasActive ? "text-accent" : "text-foreground-secondary"}`}
        >
          {expanded ? "v" : ">"} Options{hasActive ? " *" : ""}
        </Text>
      </Pressable>

      {expanded ? (
        <View className="bg-surface-light rounded-lg p-3 mb-2">
          {/* Model */}
          <View className="mb-3">
            <Text className="text-foreground-secondary text-xs mb-1">
              Model
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              placeholder={
                tool === "claude" ? "e.g. claude-sonnet-4-6" : "e.g. o4-mini"
              }
              placeholderTextColor="#565f89"
              value={options.model ?? ""}
              onChangeText={(text) =>
                onChange({ ...options, model: text || undefined })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Effort */}
          <View className="mb-3">
            <Text className="text-foreground-secondary text-xs mb-1">
              Effort
            </Text>
            <View className="flex-row flex-wrap gap-1.5">
              {efforts.map((level) => {
                const isActive = activeEffort === level;
                return (
                  <Pressable
                    key={level}
                    className={`rounded-lg px-3 py-1.5 border ${isActive ? "bg-accent/20 border-accent" : "bg-surface border-border"}`}
                    onPress={() => {
                      if (tool === "claude") {
                        onChange({
                          ...options,
                          claudeEffort: isActive
                            ? undefined
                            : (level as RunTurnOptions["claudeEffort"]),
                        });
                      } else {
                        onChange({
                          ...options,
                          codexEffort: isActive
                            ? undefined
                            : (level as RunTurnOptions["codexEffort"]),
                        });
                      }
                    }}
                  >
                    <Text
                      className={`text-xs ${isActive ? "text-accent font-semibold" : "text-foreground-secondary"}`}
                    >
                      {level}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Clear session */}
          <Pressable
            className="flex-row items-center gap-2"
            onPress={() =>
              onChange({
                ...options,
                clearSession: !options.clearSession,
              })
            }
          >
            <Text className="text-foreground-secondary text-xs">
              {options.clearSession ? "[x]" : "[ ]"} Clear session
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
