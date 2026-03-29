import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  Image,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
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
  TodoEntry,
} from "@webmux/shared";
import {
  timeAgo,
  runStatusLabel,
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
import {
  copyMessageContent,
  getComposerCardClassName,
  getComposerIconButtonClassName,
  getComposerInputClassName,
  getComposerToolbarClassName,
  getComposerSubmitButtonClassName,
  getComposerSubmitTextClassName,
  getMessageCopyButtonClassName,
  getMessageCopyTextClassName,
} from "../../../../lib/thread-detail-ui";
import { getKeyboardAwareScrollProps, getKeyboardAvoidingBehavior } from "../../../../lib/mobile-layout";
import { useTheme } from "../../../../lib/theme";
import { getRunStatusThemeColor } from "../../../../lib/theme-utils";
import { canContinueTurn, canRetryTurn } from "../../../../lib/thread-utils";
import { createReconnectableSocket } from "../../../../lib/websocket";

// --- Constants ---

const MAX_ATTACHMENTS = 4;
const AUTO_REFRESH_INTERVAL = 5000;

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
  const { colors } = useTheme();
  const { agentId, id: threadId } = useLocalSearchParams<{
    agentId: string;
    id: string;
  }>();
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  const [run, setRun] = useState<Run | null>(null);
  const [turns, setTurns] = useState<RunTurnDetail[]>([]);
  const followUpRef = useRef("");
  const [hasText, setHasText] = useState(false);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Queued turn editing
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");

  // Tool detail view
  const [toolDetailItems, setToolDetailItems] = useState<
    RunTimelineEvent[] | null
  >(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<TextInput>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    followUpRef.current = "";
    setHasText(false);
    if (textInputRef.current) textInputRef.current.clear();
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

  const hasContent = hasText || attachments.length > 0;

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

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  // --- Tool detail overlay: intercept back gesture ---

  const closeToolDetail = useCallback(() => {
    if (Platform.OS === "web" && toolDetailItems) {
      // Pop the history entry we pushed; the popstate handler sets state to null
      window.history.back();
    } else {
      setToolDetailItems(null);
    }
  }, [toolDetailItems]);

  useEffect(() => {
    if (!toolDetailItems) return;

    // Native Android: intercept hardware back button
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setToolDetailItems(null);
      return true;
    });

    // Web: push a history entry so browser back closes the overlay
    if (Platform.OS === "web") {
      window.history.pushState({ toolDetail: true }, "");
      const handlePopState = () => {
        setToolDetailItems(null);
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        sub.remove();
        window.removeEventListener("popstate", handlePopState);
      };
    }

    return () => sub.remove();
  }, [toolDetailItems]);

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
        if (Platform.OS === "web") {
          router.navigate("/(main)" as never);
        } else {
          router.back();
        }
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

      const body: ContinueRunRequest = {
        prompt: followUpRef.current.trim(),
        ...(uploadAttachments.length > 0
          ? { attachments: uploadAttachments }
          : {}),
      };

      const data = await continueThread(agentId, threadId, body);
      setRun(data.run);
      setTurns(data.turns);
      followUpRef.current = "";
      setHasText(false);
      if (textInputRef.current) textInputRef.current.clear();
      // Clean up object URLs on web
      if (Platform.OS === "web") {
        for (const a of attachments) URL.revokeObjectURL(a.previewUri);
      }
      setAttachments([]);
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

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    const copied = await copyMessageContent(content, Clipboard.setStringAsync);
    if (!copied) {
      return;
    }

    setCopiedMessageId(messageId);
    if (copyFeedbackTimeoutRef.current) {
      clearTimeout(copyFeedbackTimeoutRef.current);
    }
    copyFeedbackTimeoutRef.current = setTimeout(() => {
      setCopiedMessageId((current) =>
        current === messageId ? null : current,
      );
      copyFeedbackTimeoutRef.current = null;
    }, 1600);
  }, []);

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

  // --- Paste image handling (web) ---

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    if (Platform.OS !== "web" || !textInputRef.current) return;

    // Access the underlying DOM node from React Native Web
    const node = textInputRef.current as unknown as HTMLElement;
    if (!node || !node.addEventListener) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      // Prevent the default text paste for image-only pastes
      const hasTextItem = Array.from(items).some((item) => item.type === "text/plain");
      if (!hasTextItem) e.preventDefault();

      const remaining = MAX_ATTACHMENTS - attachmentsRef.current.length;
      if (remaining <= 0) return;

      const toAdd = imageFiles.slice(0, remaining);
      void (async () => {
        const newAttachments: DraftAttachment[] = [];
        for (const file of toAdd) {
          const base64 = await fileToBase64Web(file);
          newAttachments.push({
            id: generateId(),
            name: file.name || "pasted-image.png",
            mimeType: file.type,
            sizeBytes: file.size,
            previewUri: URL.createObjectURL(file),
            base64,
          });
        }
        setAttachments((prev) => [...prev, ...newAttachments]);
      })();
    };

    node.addEventListener("paste", handlePaste as EventListener);
    return () => {
      node.removeEventListener("paste", handlePaste as EventListener);
    };
  }, [textInputRef.current]);

  // --- Loading state ---

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.accent} />
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
          onPress={() => {
            if (Platform.OS === "web" && isWideScreen) {
              router.navigate("/(main)" as never);
            } else {
              router.back();
            }
          }}
        >
          <Text className="text-foreground-secondary text-sm">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const statusColor = getRunStatusThemeColor(run.status, colors);

  // --- Render ---

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Compact header (always visible) */}
      <View className="bg-surface px-4 py-2.5 border-b border-border">
        <View className="flex-row items-center gap-2">
          {!isWideScreen ? (
            <Pressable
              className="bg-surface-light rounded-md px-2.5 py-1.5"
              onPress={() => router.back()}
            >
              <Text className="text-foreground-secondary text-sm">Back</Text>
            </Pressable>
          ) : null}

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

          {/* Action buttons */}
          {active ? (
            <Pressable
              className="px-2.5 py-1 ml-1"
              onPress={() => void handleInterrupt()}
            >
              <Text className="text-foreground-secondary text-xs">Interrupt</Text>
            </Pressable>
          ) : null}
          {!active && canRetry ? (
            <Pressable
              className={`px-2.5 py-1 ml-1 ${isRetrying ? "opacity-50" : ""}`}
              disabled={isRetrying}
              onPress={() => void handleRetry()}
            >
              <Text className="text-foreground-secondary text-xs">
                {isRetrying ? "Retrying..." : "Retry"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            className="px-2.5 py-1 ml-1"
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

      {/* Main content area */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={getKeyboardAvoidingBehavior(Platform.OS)}
        enabled={Platform.OS !== "web"}
      >
        {/* Timeline */}
          <ScrollView
            ref={scrollViewRef}
            className="flex-1"
            contentContainerClassName="p-4 pb-8"
            keyboardShouldPersistTaps="handled"
            {...getKeyboardAwareScrollProps(Platform.OS)}
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
                  const copied = copiedMessageId === segment.id;

                  return (
                    <View
                      key={segment.id}
                      className="self-end mb-3 max-w-[88%] rounded-2xl border border-accent/10 bg-accent/10 px-3.5 py-3"
                    >
                      <View className="mb-1.5 flex-row items-center gap-2">
                        <Text className="flex-1 text-accent text-xs font-semibold">
                          You
                        </Text>
                        <Pressable
                          className={getMessageCopyButtonClassName({ copied })}
                          disabled={!segment.text}
                          onPress={() =>
                            void handleCopyMessage(segment.id, segment.text)
                          }
                        >
                          <Text
                            className={getMessageCopyTextClassName({ copied })}
                          >
                            {copied ? "Copied" : "Copy"}
                          </Text>
                        </Pressable>
                      </View>
                      {segment.text ? (
                        <Text
                          className="text-foreground text-sm leading-5"
                          selectable
                        >
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
                  const copied = copiedMessageId === `assistant-${segment.id}`;

                  return (
                    <View
                      key={segment.id}
                      className="mb-3 max-w-[88%] rounded-2xl border border-border bg-surface px-3.5 py-3"
                    >
                      <View className="mb-1.5 flex-row items-center gap-2">
                        <Text className="flex-1 text-foreground-secondary text-xs font-semibold">
                          Assistant
                        </Text>
                        <Pressable
                          className={getMessageCopyButtonClassName({ copied })}
                          onPress={() =>
                            void handleCopyMessage(
                              `assistant-${segment.id}`,
                              segment.text,
                            )
                          }
                        >
                          <Text
                            className={getMessageCopyTextClassName({ copied })}
                          >
                            {copied ? "Copied" : "Copy"}
                          </Text>
                        </Pressable>
                      </View>
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
                <ActivityIndicator size="small" color={colors.accent} />
                <Text className="text-foreground-secondary text-sm">
                  Waiting for events...
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer / Composer */}
          <View className="bg-surface border-t border-border px-3.5 pt-3 pb-3">
            {/* Interrupt button (mobile, when active) */}
            {active && !isWideScreen ? (
              <Pressable
                className="mb-2.5 flex-row items-center justify-center gap-1 rounded-xl bg-orange/20 px-4 py-3"
                onPress={() => void handleInterrupt()}
              >
                <Text className="text-orange text-sm font-semibold">
                  Interrupt
                </Text>
              </Pressable>
            ) : null}

            {!active && canRetry ? (
              <Pressable
                className={`mb-2.5 flex-row items-center justify-center gap-1 rounded-xl bg-accent/20 px-4 py-3 ${isRetrying ? "opacity-60" : ""}`}
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
                <View className={getComposerCardClassName()}>
                  {/* Attachment thumbnails */}
                  {attachments.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className="px-3 pt-2"
                      contentContainerClassName="gap-2"
                    >
                      {attachments.map((a) => (
                        <View
                          key={a.id}
                          className="relative h-16 w-16 overflow-hidden bg-surface-light"
                        >
                          <Image
                            source={{ uri: a.previewUri }}
                            className="w-full h-full"
                            resizeMode="cover"
                          />
                          <Pressable
                            className="absolute top-1 right-1 h-5 w-5 items-center justify-center bg-black/60"
                            onPress={() => removeAttachment(a.id)}
                          >
                            <Text className="text-white text-[10px] font-bold leading-none">
                              ✕
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
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

                  {/* Text input */}
                  <TextInput
                    ref={textInputRef}
                    className={getComposerInputClassName()}
                    placeholder={
                      active
                        ? "Queue a follow-up message..."
                        : "Message this thread..."
                    }
                    placeholderTextColor={colors.placeholder}
                    multiline
                    textAlignVertical="top"
                    onChangeText={(text) => {
                      followUpRef.current = text;
                      const nowHas = text.trim().length > 0;
                      if (nowHas !== hasText) setHasText(nowHas);
                    }}
                  />

                  {/* Toolbar row: Attach + Options + Send */}
                  <View className={getComposerToolbarClassName()}>
                    {/* Attach */}
                    <Pressable
                      className={getComposerIconButtonClassName({
                        disabled: attachments.length >= MAX_ATTACHMENTS,
                      })}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      onPress={() => {
                        if (Platform.OS === "web") {
                          fileInputRef.current?.click();
                        } else {
                          void handlePickImageNative();
                        }
                      }}
                    >
                      <ImageComposerIcon
                        disabled={attachments.length >= MAX_ATTACHMENTS}
                      />
                    </Pressable>

                    {/* Send */}
                    <Pressable
                      className={`${getComposerSubmitButtonClassName({
                        disabled: !hasContent,
                      })} ${isContinuing ? "opacity-70" : ""}`}
                      disabled={isContinuing || !hasContent}
                      onPress={() => void handleContinue()}
                    >
                      {isContinuing ? (
                        <ActivityIndicator size="small" color={colors.background} />
                      ) : (
                        <Text
                          className={getComposerSubmitTextClassName({
                            disabled: !hasContent,
                          })}
                        >
                          {active ? "Queue" : "Send"}
                        </Text>
                      )}
                    </Pressable>
                  </View>

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
      </KeyboardAvoidingView>

      {/* Tool detail overlay */}
      {toolDetailItems ? (
        <View className="absolute inset-0 bg-background">
          <ToolDetailView
            items={toolDetailItems}
            onClose={closeToolDetail}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ImageComposerIcon({ disabled }: { disabled: boolean }) {
  const color = disabled ? "text-foreground-secondary/30" : "text-foreground-secondary";
  return (
    <View className={`h-7 w-7 border border-border items-center justify-center ${disabled ? "opacity-40" : ""}`}>
      <Text className={`text-base leading-none ${color}`}>+</Text>
    </View>
  );
}

// --- Sub-components ---

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
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isCollapsible = item.output.split("\n").length > 4;
  const commandColor = item.status === "failed" ? colors.red : colors.accent;

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
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasLongDetail = !!item.detail && item.detail.split("\n").length > 3;
  const dotColor =
    item.status === "success"
      ? colors.green
      : item.status === "warning"
        ? colors.yellow
        : item.status === "error"
          ? colors.red
          : colors.accent;

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
  const { colors } = useTheme();

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
            placeholderTextColor={colors.placeholder}
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

