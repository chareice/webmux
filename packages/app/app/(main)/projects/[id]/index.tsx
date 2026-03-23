import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type {
  Project,
  Task,
  TaskStatus,
  ProjectAction,
  RunEvent,
  RunTool,
  CreateTaskRequest,
  CreateProjectActionRequest,
} from "@webmux/shared";
import {
  timeAgo,
  taskStatusLabel,
  taskStatusColor,
  isTaskActive,
  toolIcon,
  repoName,
  toolLabel,
} from "@webmux/shared";
import {
  getProjectDetail,
  updateProject,
  deleteProject,
  createTask,
  deleteTask,
  retryTask,
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
  generateProjectAction,
  runProjectAction,
  getBaseUrl,
  getToken,
} from "../../../../lib/api";
import { getProjectsRoute } from "../../../../lib/route-utils";
import { createReconnectableSocket } from "../../../../lib/websocket";

// --- Constants ---

const AUTO_REFRESH_INTERVAL = 5000;

const TOOLS: { value: RunTool; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

// --- Status dot component ---

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

// --- Modal wrapper ---

function ModalOverlay({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 items-center justify-center p-4"
        onPress={onClose}
      >
        <Pressable
          className="bg-surface rounded-xl w-full max-w-lg border border-border"
          onPress={() => {
            /* prevent close */
          }}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// --- Tool selector ---

function ToolSelector({
  value,
  onChange,
}: {
  value: RunTool;
  onChange: (tool: RunTool) => void;
}) {
  return (
    <View className="flex-row gap-2 mb-3">
      {TOOLS.map((t) => (
        <Pressable
          key={t.value}
          className={`flex-1 rounded-lg px-3 py-2 border ${
            value === t.value
              ? "bg-accent/20 border-accent"
              : "bg-surface-light border-border"
          }`}
          onPress={() => onChange(t.value)}
        >
          <Text
            className={`text-sm font-semibold text-center ${
              value === t.value ? "text-accent" : "text-foreground"
            }`}
          >
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// --- Add Task Modal ---

function AddTaskModal({
  visible,
  onClose,
  onSubmit,
  isSubmitting,
  formError,
  defaultTool,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (
    title: string,
    prompt: string,
    priority: number,
    tool: RunTool,
  ) => void;
  isSubmitting: boolean;
  formError: string | null;
  defaultTool: RunTool;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState("0");
  const [showPriority, setShowPriority] = useState(false);
  const [tool, setTool] = useState<RunTool>(defaultTool);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setTitle("");
      setPrompt("");
      setPriority("0");
      setShowPriority(false);
      setTool(defaultTool);
    }
  }, [visible, defaultTool]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    const prio = parseInt(priority, 10);
    onSubmit(title.trim(), prompt.trim(), isNaN(prio) ? 0 : prio, tool);
  };

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <Text className="text-foreground text-lg font-bold">Add Task</Text>
        <Pressable
          className="bg-surface-light rounded-md px-2.5 py-1"
          onPress={onClose}
        >
          <Text className="text-foreground-secondary text-sm">Close</Text>
        </Pressable>
      </View>

      {/* Body */}
      <View className="px-5 py-4">
        <TextInput
          className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
          placeholder="Task title"
          placeholderTextColor="#565f89"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={handleSubmit}
          autoFocus
        />

        <TextInput
          className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3 min-h-[80px]"
          placeholder="Description (optional)"
          placeholderTextColor="#565f89"
          multiline
          textAlignVertical="top"
          value={prompt}
          onChangeText={setPrompt}
        />

        <Pressable
          className="mb-3"
          onPress={() => setShowPriority(!showPriority)}
        >
          <Text className="text-foreground-secondary text-sm">
            Priority {showPriority ? "−" : "+"}
          </Text>
        </Pressable>

        {showPriority && (
          <TextInput
            className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
            placeholder="0"
            placeholderTextColor="#565f89"
            keyboardType="numeric"
            value={priority}
            onChangeText={setPriority}
          />
        )}

        <ToolSelector value={tool} onChange={setTool} />

        {formError ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
            <Text className="text-red text-sm">{formError}</Text>
          </View>
        ) : null}

        {/* Footer */}
        <View className="flex-row gap-3 justify-end">
          <Pressable
            className="bg-surface-light rounded-lg px-4 py-2.5"
            onPress={onClose}
          >
            <Text className="text-foreground-secondary font-medium">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
              isSubmitting || !title.trim() ? "bg-accent/40" : "bg-accent"
            }`}
            disabled={isSubmitting || !title.trim()}
            onPress={handleSubmit}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#1a1b26" />
            ) : null}
            <Text className="text-background font-semibold">
              {isSubmitting ? "Creating..." : "Add Task"}
            </Text>
          </Pressable>
        </View>
      </View>
    </ModalOverlay>
  );
}

// --- Confirm Delete Modal ---

function ConfirmDeleteModal({
  visible,
  onClose,
  onConfirm,
  isDeleting,
  title,
  subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      <View className="px-5 py-6">
        <Text className="text-foreground text-lg font-bold mb-2">{title}</Text>
        <Text className="text-foreground-secondary text-sm mb-5">
          {subtitle}
        </Text>
        <View className="flex-row gap-3 justify-end">
          <Pressable
            className="bg-surface-light rounded-lg px-4 py-2.5"
            onPress={onClose}
          >
            <Text className="text-foreground-secondary font-medium">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
              isDeleting ? "bg-red/40" : "bg-red"
            }`}
            disabled={isDeleting}
            onPress={onConfirm}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : null}
            <Text className="text-white font-semibold">
              {isDeleting ? "Deleting..." : "Delete"}
            </Text>
          </Pressable>
        </View>
      </View>
    </ModalOverlay>
  );
}

// --- New Action Modal ---

function NewActionModal({
  visible,
  onClose,
  onCreateManual,
  onGenerate,
  isSubmitting,
  formError,
  defaultTool,
}: {
  visible: boolean;
  onClose: () => void;
  onCreateManual: (
    name: string,
    prompt: string,
    description: string,
    tool: RunTool,
  ) => void;
  onGenerate: (description: string) => void;
  isSubmitting: boolean;
  formError: string | null;
  defaultTool: RunTool;
}) {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [aiDescription, setAiDescription] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [description, setDescription] = useState("");
  const [tool, setTool] = useState<RunTool>(defaultTool);

  useEffect(() => {
    if (visible) {
      setMode("ai");
      setAiDescription("");
      setName("");
      setPrompt("");
      setDescription("");
      setTool(defaultTool);
    }
  }, [visible, defaultTool]);

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <Text className="text-foreground text-lg font-bold">New Action</Text>
        <Pressable
          className="bg-surface-light rounded-md px-2.5 py-1"
          onPress={onClose}
        >
          <Text className="text-foreground-secondary text-sm">Close</Text>
        </Pressable>
      </View>

      <View className="px-5 py-4">
        {/* Mode tabs */}
        <View className="flex-row gap-2 mb-4">
          <Pressable
            className={`flex-1 rounded-lg py-2 items-center border ${
              mode === "ai"
                ? "bg-accent/20 border-accent"
                : "bg-surface-light border-border"
            }`}
            onPress={() => setMode("ai")}
          >
            <Text
              className={`text-sm font-semibold ${
                mode === "ai" ? "text-accent" : "text-foreground-secondary"
              }`}
            >
              AI Generate
            </Text>
          </Pressable>
          <Pressable
            className={`flex-1 rounded-lg py-2 items-center border ${
              mode === "manual"
                ? "bg-accent/20 border-accent"
                : "bg-surface-light border-border"
            }`}
            onPress={() => setMode("manual")}
          >
            <Text
              className={`text-sm font-semibold ${
                mode === "manual" ? "text-accent" : "text-foreground-secondary"
              }`}
            >
              Manual
            </Text>
          </Pressable>
        </View>

        {mode === "ai" ? (
          <>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3 min-h-[100px]"
              placeholder="Describe the action you want (e.g., 'deploy to production')"
              placeholderTextColor="#565f89"
              multiline
              textAlignVertical="top"
              value={aiDescription}
              onChangeText={setAiDescription}
              autoFocus
            />

            {formError ? (
              <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
                <Text className="text-red text-sm">{formError}</Text>
              </View>
            ) : null}

            <View className="flex-row gap-3 justify-end">
              <Pressable
                className="bg-surface-light rounded-lg px-4 py-2.5"
                onPress={onClose}
              >
                <Text className="text-foreground-secondary font-medium">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
                  isSubmitting || !aiDescription.trim()
                    ? "bg-accent/40"
                    : "bg-accent"
                }`}
                disabled={isSubmitting || !aiDescription.trim()}
                onPress={() => onGenerate(aiDescription.trim())}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#1a1b26" />
                ) : null}
                <Text className="text-background font-semibold">
                  {isSubmitting ? "Generating..." : "Generate with AI"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              placeholder="Action name"
              placeholderTextColor="#565f89"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              placeholder="Description (optional)"
              placeholderTextColor="#565f89"
              value={description}
              onChangeText={setDescription}
            />
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3 min-h-[100px]"
              placeholder="Prompt (instructions for this action)"
              placeholderTextColor="#565f89"
              multiline
              textAlignVertical="top"
              value={prompt}
              onChangeText={setPrompt}
            />

            <ToolSelector value={tool} onChange={setTool} />

            {formError ? (
              <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
                <Text className="text-red text-sm">{formError}</Text>
              </View>
            ) : null}

            <View className="flex-row gap-3 justify-end">
              <Pressable
                className="bg-surface-light rounded-lg px-4 py-2.5"
                onPress={onClose}
              >
                <Text className="text-foreground-secondary font-medium">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
                  isSubmitting || !name.trim() || !prompt.trim()
                    ? "bg-accent/40"
                    : "bg-accent"
                }`}
                disabled={isSubmitting || !name.trim() || !prompt.trim()}
                onPress={() =>
                  onCreateManual(
                    name.trim(),
                    prompt.trim(),
                    description.trim(),
                    tool,
                  )
                }
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#1a1b26" />
                ) : null}
                <Text className="text-background font-semibold">
                  {isSubmitting ? "Creating..." : "Create Action"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ModalOverlay>
  );
}

// --- Edit Action Modal ---

function EditActionModal({
  action,
  visible,
  onClose,
  onSave,
  isSubmitting,
  formError,
}: {
  action: ProjectAction;
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description: string;
    prompt: string;
    tool: RunTool;
  }) => void;
  isSubmitting: boolean;
  formError: string | null;
}) {
  const [name, setName] = useState(action.name);
  const [description, setDescription] = useState(action.description);
  const [prompt, setPrompt] = useState(action.prompt);
  const [tool, setTool] = useState<RunTool>(action.tool);

  useEffect(() => {
    if (visible) {
      setName(action.name);
      setDescription(action.description);
      setPrompt(action.prompt);
      setTool(action.tool);
    }
  }, [visible, action]);

  return (
    <ModalOverlay visible={visible} onClose={onClose}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <Text className="text-foreground text-lg font-bold">Edit Action</Text>
        <Pressable
          className="bg-surface-light rounded-md px-2.5 py-1"
          onPress={onClose}
        >
          <Text className="text-foreground-secondary text-sm">Close</Text>
        </Pressable>
      </View>

      <ScrollView className="px-5 py-4" keyboardShouldPersistTaps="handled">
        <TextInput
          className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
          placeholder="Action name"
          placeholderTextColor="#565f89"
          value={name}
          onChangeText={setName}
          autoFocus
        />
        <TextInput
          className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
          placeholder="Description (optional)"
          placeholderTextColor="#565f89"
          value={description}
          onChangeText={setDescription}
        />
        <TextInput
          className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3 min-h-[100px]"
          placeholder="Prompt"
          placeholderTextColor="#565f89"
          multiline
          textAlignVertical="top"
          value={prompt}
          onChangeText={setPrompt}
        />

        <ToolSelector value={tool} onChange={setTool} />

        {formError ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-3">
            <Text className="text-red text-sm">{formError}</Text>
          </View>
        ) : null}

        <View className="flex-row gap-3 justify-end">
          <Pressable
            className="bg-surface-light rounded-lg px-4 py-2.5"
            onPress={onClose}
          >
            <Text className="text-foreground-secondary font-medium">
              Cancel
            </Text>
          </Pressable>
          <Pressable
            className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
              isSubmitting || !name.trim() || !prompt.trim()
                ? "bg-accent/40"
                : "bg-accent"
            }`}
            disabled={isSubmitting || !name.trim() || !prompt.trim()}
            onPress={() =>
              onSave({
                name: name.trim(),
                description: description.trim(),
                prompt: prompt.trim(),
                tool,
              })
            }
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#1a1b26" />
            ) : null}
            <Text className="text-background font-semibold">
              {isSubmitting ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </ModalOverlay>
  );
}

// --- Task Card ---

function TaskCard({
  task,
  onPress,
  onRetry,
  onDelete,
  isRetrying,
}: {
  task: Task;
  onPress: () => void;
  onRetry: () => void;
  onDelete: () => void;
  isRetrying: boolean;
}) {
  const active = isTaskActive(task.status);
  const statusColor = taskStatusColor(task.status);

  return (
    <Pressable
      className={`bg-surface rounded-xl p-4 border ${
        active ? "border-accent/40" : "border-border"
      }`}
      onPress={onPress}
    >
      {/* Row 1: status dot + title + tool badge */}
      <View className="flex-row items-center gap-3">
        <StatusDot status={task.status} />
        <Text
          className="text-foreground text-base font-medium flex-1 flex-shrink"
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <View
          className={`rounded px-1.5 py-0.5 ${
            task.tool === "codex" ? "bg-purple/20" : "bg-accent/20"
          }`}
        >
          <Text
            className={`text-xs font-bold ${
              task.tool === "codex" ? "text-purple" : "text-accent"
            }`}
          >
            {toolIcon(task.tool)}
          </Text>
        </View>
      </View>

      {/* Row 2: summary preview for completed tasks */}
      {task.status === "completed" && task.summary ? (
        <Text
          className="text-foreground-secondary text-sm mt-1.5 ml-[22px]"
          numberOfLines={2}
        >
          {task.summary}
        </Text>
      ) : null}

      {/* Row 3: status label + branch + priority + time + actions */}
      <View className="flex-row items-center gap-2 mt-2 ml-[22px]">
        <View
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: statusColor + "20" }}
        >
          <Text className="text-xs font-semibold" style={{ color: statusColor }}>
            {taskStatusLabel(task.status)}
          </Text>
        </View>

        {task.branchName ? (
          <Text
            className="text-foreground-secondary text-xs flex-shrink"
            numberOfLines={1}
          >
            {task.branchName}
          </Text>
        ) : null}

        {task.priority > 0 ? (
          <Text className="text-orange text-xs font-semibold">
            P{task.priority}
          </Text>
        ) : null}

        <View className="flex-1" />

        <Text className="text-foreground-secondary text-xs">
          {timeAgo(task.updatedAt)}
        </Text>
      </View>

      {/* Row 4: action buttons for failed tasks */}
      {task.status === "failed" ? (
        <View className="flex-row gap-2 mt-3 ml-[22px]">
          <Pressable
            className="bg-accent/20 rounded-lg px-3 py-1.5 flex-row items-center gap-1"
            onPress={(e) => {
              e.stopPropagation?.();
              onRetry();
            }}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#7aa2f7" />
            ) : (
              <Text className="text-accent text-xs font-semibold">Retry</Text>
            )}
          </Pressable>
          <Pressable
            className="bg-red/10 rounded-lg px-3 py-1.5"
            onPress={(e) => {
              e.stopPropagation?.();
              onDelete();
            }}
          >
            <Text className="text-red text-xs font-semibold">Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

// --- Action Card ---

function ActionCard({
  action,
  onRun,
  onEdit,
  onDelete,
  isRunning,
}: {
  action: ProjectAction;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isRunning: boolean;
}) {
  return (
    <View className="bg-surface rounded-xl p-3 border border-border">
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Text className="text-foreground text-sm font-semibold">
            {action.name}
          </Text>
          {action.description ? (
            <Text
              className="text-foreground-secondary text-xs mt-0.5"
              numberOfLines={2}
            >
              {action.description}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable
            className={`rounded-lg px-3 py-1.5 ${
              isRunning ? "bg-accent/40" : "bg-accent"
            }`}
            onPress={onRun}
            disabled={isRunning}
          >
            {isRunning ? (
              <ActivityIndicator size="small" color="#1a1b26" />
            ) : (
              <Text className="text-background text-xs font-bold">Run</Text>
            )}
          </Pressable>
          <Pressable
            className="bg-surface-light rounded-lg px-2.5 py-1.5"
            onPress={onEdit}
          >
            <Text className="text-foreground-secondary text-xs">Edit</Text>
          </Pressable>
          <Pressable
            className="bg-red/10 rounded-lg px-2.5 py-1.5"
            onPress={onDelete}
          >
            <Text className="text-red text-xs">Del</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// --- Main Page ---

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actions, setActions] = useState<ProjectAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Project edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTool, setEditTool] = useState<RunTool>("claude");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Modal states
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState(false);

  // Action modals
  const [showNewActionModal, setShowNewActionModal] = useState(false);
  const [editingAction, setEditingAction] = useState<ProjectAction | null>(
    null,
  );
  const [deleteActionId, setDeleteActionId] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionFormError, setActionFormError] = useState<string | null>(null);
  const [executingActionId, setExecutingActionId] = useState<string | null>(
    null,
  );

  // Task form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deletingActionIdInProgress, setDeletingActionIdInProgress] = useState<
    string | null
  >(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Data loading ---

  const loadData = useCallback(
    async (showLoading = false) => {
      if (!projectId) return;
      if (showLoading) setIsLoading(true);
      try {
        const data = await getProjectDetail(projectId);
        setProject(data.project);
        setTasks(data.tasks);
        setActions(data.actions || []);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  // Auto-refresh when there are active tasks
  useEffect(() => {
    const hasActive = tasks.some((t) => isTaskActive(t.status));
    if (hasActive) {
      intervalRef.current = setInterval(() => {
        void loadData(false);
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [tasks, loadData]);

  // WebSocket for real-time task status updates
  useEffect(() => {
    if (!projectId) return;

    const baseUrl = getBaseUrl();
    const token = getToken();
    if (!token) return;

    const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = baseUrl.replace(/^https?:\/\//, "");

    // On web with empty baseUrl, use same-origin
    let wsUrl: string;
    if (!baseUrl && Platform.OS === "web" && typeof window !== "undefined") {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${proto}//${window.location.host}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
    } else {
      wsUrl = `${wsProtocol}://${wsHost}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;
    }

    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(wsUrl);
      },
      onMessage(event: MessageEvent) {
        try {
          const data = JSON.parse(event.data as string) as RunEvent;
          if (data.type === "task-status") {
            setTasks((prev) =>
              prev.map((t) => (t.id === data.task.id ? data.task : t)),
            );
          }
          if (data.type === "project-status") {
            setProject(data.project);
          }
        } catch {
          // ignore parse errors
        }
      },
    });

    return () => controller.dispose();
  }, [projectId]);

  // --- Project edit handlers ---

  const startEditing = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description);
    setEditTool(project.defaultTool);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveEditing = async () => {
    if (!project || !projectId) return;
    setIsSavingEdit(true);
    try {
      const res = await updateProject(projectId, {
        name: editName.trim() || project.name,
        description: editDescription.trim(),
        defaultTool: editTool,
      });
      setProject(res.project);
      setIsEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId) return;
    setIsDeletingProject(true);
    try {
      await deleteProject(projectId);
      router.replace(getProjectsRoute() as never);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeletingProject(false);
    }
  };

  // --- Task handlers ---

  const handleAddTask = async (
    title: string,
    prompt: string,
    priority: number,
    tool: RunTool,
  ) => {
    if (!projectId) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const body: CreateTaskRequest = { title, tool };
      if (prompt) body.prompt = prompt;
      if (priority !== 0) body.priority = priority;

      const data = await createTask(projectId, body);
      setTasks((prev) => [...prev, data.task]);
      setShowAddTaskModal(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    if (!projectId) return;
    setRetryingId(taskId);
    try {
      const data = await retryTask(projectId, taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetryingId(null);
    }
  };

  const handleDeleteTaskConfirm = async () => {
    if (!projectId || !deleteTaskId) return;
    setDeletingTaskId(deleteTaskId);
    try {
      await deleteTask(projectId, deleteTaskId);
      setTasks((prev) => prev.filter((t) => t.id !== deleteTaskId));
      setDeleteTaskId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  // --- Action handlers ---

  const handleExecuteAction = async (action: ProjectAction) => {
    if (!projectId || executingActionId) return;
    setExecutingActionId(action.id);
    try {
      const data = await runProjectAction(projectId, action.id);
      router.push(
        `/(main)/threads/${project!.agentId}/${data.runId}` as never,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleCreateActionManual = async (
    name: string,
    prompt: string,
    description: string,
    tool: RunTool,
  ) => {
    if (!projectId) return;
    setActionFormError(null);
    setActionSubmitting(true);
    try {
      const body: CreateProjectActionRequest = { name, prompt, tool };
      if (description) body.description = description;

      const data = await createProjectAction(projectId, body);
      setActions((prev) => [...prev, data.action]);
      setShowNewActionModal(false);
    } catch (err) {
      setActionFormError((err as Error).message);
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleGenerateAction = async (description: string) => {
    if (!projectId) return;
    setActionFormError(null);
    setActionSubmitting(true);
    try {
      const data = await generateProjectAction(projectId, { description });
      setActions((prev) => [...prev, data.action]);
      setShowNewActionModal(false);
    } catch (err) {
      setActionFormError((err as Error).message);
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleUpdateAction = async (data: {
    name: string;
    description: string;
    prompt: string;
    tool: RunTool;
  }) => {
    if (!projectId || !editingAction) return;
    setActionFormError(null);
    setActionSubmitting(true);
    try {
      await updateProjectAction(projectId, editingAction.id, data);
      setActions((prev) =>
        prev.map((a) => (a.id === editingAction.id ? { ...a, ...data } : a)),
      );
      setEditingAction(null);
    } catch (err) {
      setActionFormError((err as Error).message);
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleDeleteActionConfirm = async () => {
    if (!projectId || !deleteActionId) return;
    setDeletingActionIdInProgress(deleteActionId);
    try {
      await deleteProjectAction(projectId, deleteActionId);
      setActions((prev) => prev.filter((a) => a.id !== deleteActionId));
      setDeleteActionId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingActionIdInProgress(null);
    }
  };

  // --- Sorted tasks: active first, then by updatedAt desc ---

  const sortedTasks = [...tasks].sort((a, b) => {
    const aActive = isTaskActive(a.status) ? 1 : 0;
    const bActive = isTaskActive(b.status) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.updatedAt - a.updatedAt;
  });

  // --- Loading state ---

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text className="text-foreground-secondary mt-3 text-sm">
          Loading project...
        </Text>
      </View>
    );
  }

  // --- Error / not found state ---

  if (!project) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-red text-base mb-4">
          {error || "Project not found"}
        </Text>
        <Pressable
          className="bg-surface-light rounded-lg px-4 py-2.5"
          onPress={() => router.replace(getProjectsRoute() as never)}
        >
          <Text className="text-foreground font-medium">Back to Projects</Text>
        </Pressable>
      </View>
    );
  }

  // --- Main render ---

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="flex-row items-center gap-3 mb-2">
          <Pressable
            className="bg-surface-light rounded-lg px-3 py-2"
            onPress={() => router.replace(getProjectsRoute() as never)}
          >
            <Text className="text-foreground-secondary text-sm">Back</Text>
          </Pressable>
          <View className="flex-1" />
          {!isEditing && (
            <>
              <Pressable
                className="bg-surface-light rounded-lg px-3 py-2"
                onPress={startEditing}
              >
                <Text className="text-accent text-sm font-medium">Edit</Text>
              </Pressable>
              <Pressable
                className="bg-red/10 rounded-lg px-3 py-2"
                onPress={() => setShowDeleteProjectModal(true)}
              >
                <Text className="text-red text-sm font-medium">Delete</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Project Info (view mode) */}
        {!isEditing ? (
          <View className="mb-6">
            <Text className="text-foreground text-2xl font-bold mb-1">
              {project.name}
            </Text>
            {project.description ? (
              <Text className="text-foreground-secondary text-sm mb-2">
                {project.description}
              </Text>
            ) : null}
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-foreground-secondary text-xs">
                {project.repoPath}
              </Text>
              <View
                className={`rounded px-1.5 py-0.5 ${
                  project.defaultTool === "codex"
                    ? "bg-purple/20"
                    : "bg-accent/20"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    project.defaultTool === "codex"
                      ? "text-purple"
                      : "text-accent"
                  }`}
                >
                  {toolLabel(project.defaultTool)}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          /* Project Info (edit mode) */
          <View className="mb-6 bg-surface rounded-xl p-4 border border-accent/30">
            <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
              Project Name
            </Text>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3"
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor="#565f89"
            />

            <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
              Description
            </Text>
            <TextInput
              className="bg-surface-light border border-border rounded-lg px-4 py-3 text-foreground mb-3 min-h-[60px]"
              value={editDescription}
              onChangeText={setEditDescription}
              multiline
              textAlignVertical="top"
              placeholderTextColor="#565f89"
            />

            <Text className="text-foreground-secondary text-sm uppercase tracking-wider mb-2">
              Default Tool
            </Text>
            <ToolSelector value={editTool} onChange={setEditTool} />

            <View className="flex-row gap-3 justify-end mt-2">
              <Pressable
                className="bg-surface-light rounded-lg px-4 py-2.5"
                onPress={cancelEditing}
              >
                <Text className="text-foreground-secondary font-medium">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className={`rounded-lg px-4 py-2.5 flex-row items-center gap-2 ${
                  isSavingEdit ? "bg-accent/40" : "bg-accent"
                }`}
                disabled={isSavingEdit}
                onPress={() => void saveEditing()}
              >
                {isSavingEdit ? (
                  <ActivityIndicator size="small" color="#1a1b26" />
                ) : null}
                <Text className="text-background font-semibold">
                  {isSavingEdit ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Error banner */}
        {error ? (
          <View className="bg-red/10 border border-red rounded-lg px-3 py-2 mb-4">
            <Text className="text-red text-sm">{error}</Text>
          </View>
        ) : null}

        {/* Actions Section */}
        <View className="mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-foreground-secondary text-xs uppercase tracking-wider font-semibold">
              Actions
            </Text>
            <Pressable
              className="flex-row items-center gap-1 bg-surface-light rounded-lg px-3 py-1.5"
              onPress={() => {
                setActionFormError(null);
                setShowNewActionModal(true);
              }}
            >
              <Text className="text-accent text-xs font-semibold">
                + New Action
              </Text>
            </Pressable>
          </View>

          {actions.length > 0 ? (
            <View className="gap-2">
              {actions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onRun={() => void handleExecuteAction(action)}
                  onEdit={() => {
                    setActionFormError(null);
                    setEditingAction(action);
                  }}
                  onDelete={() => setDeleteActionId(action.id)}
                  isRunning={executingActionId === action.id}
                />
              ))}
            </View>
          ) : (
            <Text className="text-foreground-secondary text-sm">
              No actions yet. Create one to run predefined tasks.
            </Text>
          )}
        </View>

        {/* Tasks Section */}
        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-foreground-secondary text-xs uppercase tracking-wider font-semibold">
              Tasks
            </Text>
            <Pressable
              className="flex-row items-center gap-1 bg-accent rounded-lg px-3 py-1.5"
              onPress={() => {
                setFormError(null);
                setShowAddTaskModal(true);
              }}
            >
              <Text className="text-background text-xs font-bold">
                + New Task
              </Text>
            </Pressable>
          </View>

          {sortedTasks.length === 0 ? (
            <Text className="text-foreground-secondary text-sm">
              No tasks yet. Add one to get started.
            </Text>
          ) : (
            <View className="gap-3">
              {sortedTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onPress={() =>
                    router.push(
                      `/(main)/projects/${projectId}/tasks/${task.id}` as never,
                    )
                  }
                  onRetry={() => void handleRetryTask(task.id)}
                  onDelete={() => setDeleteTaskId(task.id)}
                  isRetrying={retryingId === task.id}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modals */}
      <AddTaskModal
        visible={showAddTaskModal}
        onClose={() => setShowAddTaskModal(false)}
        onSubmit={(t, d, p, tool) => void handleAddTask(t, d, p, tool)}
        defaultTool={project.defaultTool || "claude"}
        isSubmitting={isSubmitting}
        formError={formError}
      />

      <ConfirmDeleteModal
        visible={!!deleteTaskId}
        onClose={() => setDeleteTaskId(null)}
        onConfirm={() => void handleDeleteTaskConfirm()}
        isDeleting={deletingTaskId === deleteTaskId}
        title="Delete task?"
        subtitle="This action cannot be undone."
      />

      <ConfirmDeleteModal
        visible={showDeleteProjectModal}
        onClose={() => setShowDeleteProjectModal(false)}
        onConfirm={() => void handleDeleteProject()}
        isDeleting={isDeletingProject}
        title="Delete project?"
        subtitle="This will delete the project and all its tasks. This action cannot be undone."
      />

      <NewActionModal
        visible={showNewActionModal}
        onClose={() => setShowNewActionModal(false)}
        onCreateManual={(n, p, d, t) =>
          void handleCreateActionManual(n, p, d, t)
        }
        onGenerate={(d) => void handleGenerateAction(d)}
        isSubmitting={actionSubmitting}
        formError={actionFormError}
        defaultTool={project.defaultTool || "claude"}
      />

      {editingAction ? (
        <EditActionModal
          action={editingAction}
          visible={!!editingAction}
          onClose={() => setEditingAction(null)}
          onSave={(data) => void handleUpdateAction(data)}
          isSubmitting={actionSubmitting}
          formError={actionFormError}
        />
      ) : null}

      <ConfirmDeleteModal
        visible={!!deleteActionId}
        onClose={() => setDeleteActionId(null)}
        onConfirm={() => void handleDeleteActionConfirm()}
        isDeleting={deletingActionIdInProgress === deleteActionId}
        title="Delete action?"
        subtitle="This action cannot be undone."
      />
    </View>
  );
}
