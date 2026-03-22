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
  Project,
  Task,
  TaskStep,
  TaskMessage,
  TaskStatus,
  RunEvent,
  RunImageAttachmentUpload,
} from "@webmux/shared";
import {
  buildTaskTimeline,
  timeAgo,
  formatDuration,
  taskStatusLabel,
  taskStatusColor,
  isTaskActive,
  toolLabel,
  toolIcon,
  repoName,
  MAX_ATTACHMENTS,
} from "@webmux/shared";
import {
  getProjectDetail,
  getTaskSteps,
  getTaskMessages,
  sendTaskMessage,
  retryTask,
  completeTask,
  interruptTask,
  deleteTask,
  getBaseUrl,
  getToken,
} from "../../../../../lib/api";
import { createReconnectableSocket } from "../../../../../lib/websocket";

// --- Constants ---

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

// --- Helpers ---

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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

function StatusDot({ status }: { status: TaskStatus }) {
  const color = taskStatusColor(status);
  const active = isTaskActive(status);

  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: status === "pending" ? "transparent" : color,
        borderWidth: status === "pending" ? 1.5 : 0,
        borderColor: color,
        borderStyle: status === "pending" ? "dashed" : "solid",
        opacity: active ? 1 : 0.8,
      }}
    />
  );
}

function StepItemView({ step }: { step: TaskStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!step.detail;

  const statusIcon =
    step.status === "completed" ? (
      <Text className="text-green text-xs font-bold">&#10003;</Text>
    ) : step.status === "running" ? (
      <ActivityIndicator size={10} color="#7aa2f7" />
    ) : (
      <Text className="text-red text-xs font-bold">!</Text>
    );

  return (
    <View>
      <Pressable
        className={`flex-row items-center py-2 px-3 ${hasDetail ? "" : "opacity-80"}`}
        onPress={() => hasDetail && setExpanded(!expanded)}
        disabled={!hasDetail}
      >
        <View className="w-5 items-center">{statusIcon}</View>
        <Text
          className="text-foreground text-sm flex-1 ml-2"
          numberOfLines={expanded ? undefined : 1}
        >
          {step.label}
        </Text>
        {step.durationMs != null ? (
          <Text className="text-foreground-secondary text-xs ml-2">
            {formatDuration(step.durationMs)}
          </Text>
        ) : null}
        {hasDetail ? (
          <Text className="text-foreground-secondary text-xs ml-1">
            {expanded ? "\u25BC" : "\u25B6"}
          </Text>
        ) : null}
      </Pressable>
      {expanded && step.detail ? (
        <View className="bg-background rounded-md mx-3 mb-2 p-2">
          <Text
            className="text-foreground-secondary text-xs leading-4"
            style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier" }}
            selectable
          >
            {step.detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <Text className="text-foreground text-sm leading-5" selectable>
      {content}
    </Text>
  );
}

// --- Main Screen ---

export default function TaskDetailScreen() {
  const router = useRouter();
  const { id: projectId, taskId } = useLocalSearchParams<{
    id: string;
    taskId: string;
  }>();
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 1024;

  // --- State ---

  const [project, setProject] = useState<Project | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);

  const scrollViewRef = useRef<ScrollView>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref to hold the latest send handler for the Ctrl+Enter shortcut (web only)
  const sendReplyRef = useRef<() => void>(() => {});

  // --- Reset state when navigating between tasks ---

  useEffect(() => {
    setTask(null);
    setProject(null);
    setSteps([]);
    setMessages([]);
    setReplyText("");
    setAttachments((prev) => {
      if (Platform.OS === "web") {
        for (const a of prev) URL.revokeObjectURL(a.previewUri);
      }
      return [];
    });
    setError(null);
    setIsLoading(true);
  }, [projectId, taskId]);

  // Cleanup attachment ObjectURLs on unmount
  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        if (Platform.OS === "web") {
          for (const a of prev) URL.revokeObjectURL(a.previewUri);
        }
        return [];
      });
    };
  }, []);

  // --- Data Loading ---

  const loadData = useCallback(async () => {
    if (!projectId || !taskId) return;
    try {
      const projData = await getProjectDetail(projectId);
      setProject(projData.project);

      const currentTask = projData.tasks.find((t) => t.id === taskId);
      if (!currentTask) throw new Error("Task not found");
      setTask(currentTask);

      // Load steps and messages for non-pending tasks
      if (currentTask.status !== "pending") {
        const [stepsData, msgsData] = await Promise.all([
          getTaskSteps(projectId, taskId),
          getTaskMessages(projectId, taskId),
        ]);
        setSteps(stepsData);
        setMessages(msgsData);
      } else {
        setSteps([]);
        setMessages([]);
      }

      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // --- WebSocket for real-time updates ---

  useEffect(() => {
    if (!projectId) return;

    const baseUrl = getBaseUrl();
    const token = getToken();

    let wsUrl: string;
    if (Platform.OS === "web" && !baseUrl) {
      const wsProtocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${wsProtocol}//${window.location.host}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
    } else if (baseUrl) {
      const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
      const wsHost = baseUrl.replace(/^https?:\/\//, "");
      wsUrl = `${wsProtocol}://${wsHost}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
    } else {
      return;
    }

    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(wsUrl);
      },
      onMessage(event: MessageEvent) {
        try {
          const data = JSON.parse(event.data as string) as RunEvent;
          if (data.type === "task-status" && data.task.id === taskId) {
            setTask(data.task);
          }
          if (data.type === "task-step" && data.taskId === taskId) {
            setSteps((prev) => {
              const idx = prev.findIndex((s) => s.id === data.step.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = data.step;
                return updated;
              }
              return [...prev, data.step];
            });
          }
          if (data.type === "task-message" && data.taskId === taskId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
          }
        } catch {
          // Ignore malformed messages
        }
      },
      onError() {
        void loadData();
      },
    });

    return () => controller.dispose();
  }, [projectId, taskId, loadData]);

  // --- Auto-scroll on new timeline items ---

  useEffect(() => {
    if (!scrollViewRef.current) return;
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [steps.length, messages.length]);

  // --- Auto-refresh for active tasks ---

  useEffect(() => {
    if (!task || !isTaskActive(task.status)) return;
    const interval = setInterval(() => {
      void loadData();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [task, loadData]);

  // --- Image attachment handling ---

  const handleFilesSelectedWeb = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toAdd = Array.from(files).slice(0, remaining);
    const newAttachments: DraftAttachment[] = [];
    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) continue;
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

  // --- Action handlers ---

  const handleSendReply = async () => {
    if ((!replyText.trim() && attachments.length === 0) || !task) return;
    setSendingReply(true);
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

      const content = replyText.trim() || "(image)";
      const result = await sendTaskMessage(
        projectId!,
        taskId!,
        content,
        uploadAttachments.length > 0 ? uploadAttachments : undefined
      );

      setMessages((prev) => [...prev, result.message]);
      setReplyText("");
      if (Platform.OS === "web") {
        for (const a of attachments) URL.revokeObjectURL(a.previewUri);
      }
      setAttachments([]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSendingReply(false);
    }
  };

  // Keep ref updated so the keyboard handler always calls the latest version
  sendReplyRef.current = () => void handleSendReply();

  // Ctrl+Enter / Cmd+Enter to send (web only)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
        const active = document.activeElement;
        if (active?.tagName === "TEXTAREA" || active?.tagName === "INPUT") {
          ke.preventDefault();
          sendReplyRef.current();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleRetry = async () => {
    if (!task || !projectId) return;
    try {
      setRetrying(true);
      const data = await retryTask(projectId, task.id);
      setTask(data.task);
      setSteps([]);
      setMessages([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!task || !projectId) return;
    try {
      await completeTask(projectId, task.id);
      setTask((prev) =>
        prev ? { ...prev, status: "completed" as TaskStatus } : prev
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleInterrupt = async () => {
    if (!task || !projectId) return;
    try {
      await interruptTask(projectId, task.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!task || !projectId) return;
    const active = isTaskActive(task.status);
    const label = active
      ? "This will stop the running task and remove it."
      : "This will remove the task.";

    const doDelete = async () => {
      try {
        await deleteTask(projectId, task.id);
        router.back();
      } catch (err) {
        setError((err as Error).message);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm(label)) return;
      await doDelete();
    } else {
      Alert.alert("Delete Task", label, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void doDelete(),
        },
      ]);
    }
  };

  // --- Guard for missing params ---

  if (!projectId || !taskId) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-foreground text-lg font-semibold mb-2">
          Invalid URL
        </Text>
        <Text className="text-foreground-secondary text-sm">
          Missing project or task ID.
        </Text>
      </View>
    );
  }

  // --- Derived state ---

  const hasContent = replyText.trim().length > 0 || attachments.length > 0;

  // --- Loading state ---

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading task...
        </Text>
      </View>
    );
  }

  if (!task || !project) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-foreground text-lg font-semibold mb-2">
          Task not found
        </Text>
        {error ? (
          <Text className="text-red text-sm mb-4">{error}</Text>
        ) : null}
        <Pressable
          className="bg-surface-light rounded-lg px-4 py-2"
          onPress={() => router.back()}
        >
          <Text className="text-foreground-secondary text-sm">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const active = isTaskActive(task.status);
  const statusColor = taskStatusColor(task.status);
  const timeline = buildTaskTimeline(messages, steps, task);

  // --- Render ---

  return (
    <View className="flex-1 bg-background">
      {/* Compact header (always visible) */}
      <View className="bg-surface px-4 py-2.5 border-b border-border">
        <View className="flex-row items-center gap-2">
          <Pressable
            className="bg-surface-light rounded-md px-2.5 py-1"
            onPress={() => router.back()}
          >
            <Text className="text-foreground-secondary text-sm">Back</Text>
          </Pressable>

          <Text
            className="text-foreground font-semibold text-sm flex-1"
            numberOfLines={1}
          >
            {task.title}
          </Text>

          {/* Status badge */}
          <View className="flex-row items-center gap-1.5">
            <StatusDot status={task.status} />
            <Text className="text-xs" style={{ color: statusColor }}>
              {taskStatusLabel(task.status)}
            </Text>
          </View>
        </View>
      </View>

      {/* Main body -- two-column on wide web, single column otherwise */}
      <View className={`flex-1 ${isWideScreen ? "flex-row" : ""}`}>
        {/* Sidebar (web wide only) */}
        {isWideScreen ? (
          <View className="w-72 bg-surface border-r border-border p-4">
            <SidebarSection label="Status">
              <View className="flex-row items-center gap-1.5">
                <StatusDot status={task.status} />
                <Text className="text-sm" style={{ color: statusColor }}>
                  {taskStatusLabel(task.status)}
                </Text>
              </View>
            </SidebarSection>

            <SidebarSection label="Tool">
              <View className="flex-row items-center gap-2">
                <View
                  className={`rounded px-1.5 py-0.5 ${
                    (task.tool || project.defaultTool) === "codex"
                      ? "bg-purple/20"
                      : "bg-accent/20"
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      (task.tool || project.defaultTool) === "codex"
                        ? "text-purple"
                        : "text-accent"
                    }`}
                  >
                    {toolIcon(task.tool || project.defaultTool || "claude")}
                  </Text>
                </View>
                <Text className="text-foreground text-sm">
                  {toolLabel(task.tool || project.defaultTool || "claude")}
                </Text>
              </View>
            </SidebarSection>

            <SidebarSection label="Project">
              <Text className="text-foreground text-sm font-medium">
                {project.name}
              </Text>
              <Text className="text-foreground-secondary text-xs mt-0.5">
                {repoName(project.repoPath)}
              </Text>
            </SidebarSection>

            {task.branchName ? (
              <SidebarSection label="Branch">
                <Text
                  className="text-foreground text-sm"
                  style={{
                    fontFamily:
                      Platform.OS === "web" ? "monospace" : "Courier",
                  }}
                >
                  {task.branchName}
                </Text>
              </SidebarSection>
            ) : null}

            {task.priority !== 0 ? (
              <SidebarSection label="Priority">
                <Text className="text-foreground text-sm">
                  P{task.priority}
                </Text>
              </SidebarSection>
            ) : null}

            <SidebarSection label="Created">
              <Text className="text-foreground-secondary text-sm">
                {timeAgo(task.createdAt)}
              </Text>
            </SidebarSection>

            <SidebarSection label="Updated">
              <Text className="text-foreground-secondary text-sm">
                {timeAgo(task.updatedAt)}
              </Text>
            </SidebarSection>

            {/* Prompt/description if different from title */}
            {task.prompt && task.prompt !== task.title ? (
              <SidebarSection label="Description">
                <Text className="text-foreground-secondary text-sm leading-5">
                  {task.prompt}
                </Text>
              </SidebarSection>
            ) : null}

            {/* Action buttons */}
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
              {task.status !== "completed" &&
              task.status !== "pending" &&
              !active ? (
                <Pressable
                  className="bg-green/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1"
                  onPress={() => void handleMarkComplete()}
                >
                  <Text className="text-green text-sm font-semibold">
                    Mark Complete
                  </Text>
                </Pressable>
              ) : null}
              {task.status === "failed" ? (
                <Pressable
                  className={`bg-accent/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 ${retrying ? "opacity-50" : ""}`}
                  disabled={retrying}
                  onPress={() => void handleRetry()}
                >
                  <Text className="text-accent text-sm font-semibold">
                    {retrying ? "Retrying..." : "Retry"}
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
            {/* Empty states */}
            {timeline.length === 0 && task.status === "pending" ? (
              <View className="items-center py-16">
                <Text className="text-foreground-secondary text-sm">
                  Task is pending. Waiting for agent to pick it up...
                </Text>
              </View>
            ) : null}

            {timeline.length === 0 && active ? (
              <View className="items-center py-16">
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#7aa2f7" />
                  <Text className="text-foreground-secondary text-sm">
                    Task started. Waiting for timeline events...
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Timeline items */}
            {timeline.map((item, i) => {
              if (item.type === "message") {
                const msg = item.data;
                const isAgent = msg.role === "agent";
                return (
                  <View
                    key={msg.id}
                    className={`rounded-xl p-3 mb-3 ${
                      isAgent
                        ? "bg-surface max-w-[85%]"
                        : "bg-accent/10 self-end max-w-[85%]"
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold mb-1 ${
                        isAgent
                          ? "text-green"
                          : "text-accent"
                      }`}
                    >
                      {isAgent ? "Agent" : "You"}
                    </Text>
                    <MessageContent content={msg.content} />
                    <Text className="text-foreground-secondary text-xs mt-1.5">
                      {timeAgo(msg.createdAt)}
                    </Text>
                  </View>
                );
              }

              if (item.type === "step-group") {
                const stepsInGroup = item.data;
                return (
                  <View
                    key={`sg-${i}`}
                    className="bg-surface rounded-lg mb-3 overflow-hidden"
                  >
                    {stepsInGroup.map((step, stepIdx) => (
                      <View key={step.id}>
                        {stepIdx > 0 ? (
                          <View className="border-t border-border mx-3" />
                        ) : null}
                        <StepItemView step={step} />
                      </View>
                    ))}
                  </View>
                );
              }

              if (item.type === "summary") {
                return (
                  <View
                    key={`summary-${i}`}
                    className="bg-green/10 border border-green/30 rounded-lg p-3 mb-3"
                  >
                    <Text className="text-green text-xs font-bold uppercase tracking-wider mb-1.5">
                      Summary
                    </Text>
                    <MessageContent content={item.text} />
                  </View>
                );
              }

              if (item.type === "error") {
                return (
                  <View
                    key={`error-${i}`}
                    className="bg-red/10 border border-red/30 rounded-lg p-3 mb-3"
                  >
                    <Text className="text-red text-xs font-bold uppercase tracking-wider mb-1.5">
                      Error
                    </Text>
                    <Text className="text-foreground text-sm leading-5">
                      {item.text}
                    </Text>
                  </View>
                );
              }

              return null;
            })}

            {/* Active waiting indicator */}
            {active && timeline.length > 0 ? (
              <View className="flex-row items-center gap-2 py-4">
                <ActivityIndicator size="small" color="#7aa2f7" />
                <Text className="text-foreground-secondary text-sm">
                  Agent is working...
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer / Composer */}
          <View className="bg-surface border-t border-border px-4 py-3">
            {/* Mobile action buttons (when no sidebar) */}
            {!isWideScreen && active ? (
              <Pressable
                className="bg-orange/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 mb-2"
                onPress={() => void handleInterrupt()}
              >
                <Text className="text-orange text-sm font-semibold">
                  Interrupt
                </Text>
              </Pressable>
            ) : null}

            {/* Mobile: show Mark Complete and Retry when no sidebar */}
            {!isWideScreen &&
            task.status !== "completed" &&
            task.status !== "pending" &&
            !active ? (
              <View className="flex-row gap-2 mb-2">
                <Pressable
                  className="flex-1 bg-green/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1"
                  onPress={() => void handleMarkComplete()}
                >
                  <Text className="text-green text-sm font-semibold">
                    Complete
                  </Text>
                </Pressable>
                {task.status === "failed" ? (
                  <Pressable
                    className={`flex-1 bg-accent/20 rounded-lg px-3 py-2 flex-row items-center justify-center gap-1 ${retrying ? "opacity-50" : ""}`}
                    disabled={retrying}
                    onPress={() => void handleRetry()}
                  >
                    <Text className="text-accent text-sm font-semibold">
                      {retrying ? "Retrying..." : "Retry"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

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
                <Text className="text-foreground-secondary text-sm">+Img</Text>
              </Pressable>

              {/* Text input */}
              <TextInput
                className="flex-1 bg-surface-light border border-border rounded-lg px-3 py-2 text-foreground text-sm min-h-[36px] max-h-[100px]"
                placeholder={
                  active
                    ? "Send a message to the agent..."
                    : task.status === "pending"
                      ? "Send a message before it starts..."
                      : "Message this task..."
                }
                placeholderTextColor="#565f89"
                multiline
                textAlignVertical="top"
                value={replyText}
                onChangeText={setReplyText}
                editable={!sendingReply}
              />

              {/* Send button */}
              <Pressable
                className={`rounded-lg px-4 py-2 ${sendingReply || !hasContent ? "bg-accent/40" : "bg-accent"}`}
                disabled={sendingReply || !hasContent}
                onPress={() => void handleSendReply()}
              >
                {sendingReply ? (
                  <ActivityIndicator size="small" color="#1a1b26" />
                ) : (
                  <Text className="text-background text-sm font-semibold">
                    Send
                  </Text>
                )}
              </Pressable>
            </View>

            {/* Error banner */}
            {error ? (
              <Text className="text-red text-xs mt-1">{error}</Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
