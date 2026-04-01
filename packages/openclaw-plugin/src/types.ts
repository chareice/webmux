// -- Agent --
export type AgentInfo = {
  id: string;
  name: string;
  status: "online" | "offline";
  lastSeenAt: number | null;
};

// -- Run (Thread) --
export type RunTool = "codex" | "claude";

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "success"
  | "failed"
  | "interrupted";

export type Run = {
  id: string;
  agentId: string;
  tool: RunTool;
  repoPath: string;
  branch: string;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  hasDiff: boolean;
  unread: boolean;
};

export type RunTimelineEvent = {
  id: number;
  createdAt: number;
} & (
  | { type: "message"; role: "assistant" | "user" | "system"; text: string }
  | {
      type: "command";
      status: "started" | "completed" | "failed";
      command: string;
      output: string;
      exitCode: number | null;
    }
  | {
      type: "activity";
      status: "info" | "success" | "warning" | "error";
      label: string;
      detail?: string;
    }
  | {
      type: "todo";
      items: Array<{ text: string; status: "pending" | "in_progress" | "completed" }>;
    }
);

export type RunTurnDetail = {
  id: string;
  runId: string;
  index: number;
  prompt: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  hasDiff: boolean;
  items: RunTimelineEvent[];
};

export type StartRunRequest = {
  tool: RunTool;
  repoPath: string;
  prompt: string;
  options?: {
    model?: string;
    claudeEffort?: "low" | "medium" | "high" | "max";
    codexEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    clearSession?: boolean;
  };
};

export type ContinueRunRequest = {
  prompt: string;
  options?: StartRunRequest["options"];
};

// -- Project & Task --
export type Project = {
  id: string;
  name: string;
  description: string;
  repoPath: string;
  agentId: string;
  defaultTool: RunTool;
  createdAt: number;
  updatedAt: number;
};

export type TaskStatus =
  | "pending"
  | "dispatched"
  | "running"
  | "waiting"
  | "completed"
  | "failed";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  tool: RunTool;
  status: TaskStatus;
  priority: number;
  branchName: string | null;
  worktreePath: string | null;
  runId: string | null;
  errorMessage: string | null;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
  claimedAt: number | null;
  completedAt: number | null;
};
