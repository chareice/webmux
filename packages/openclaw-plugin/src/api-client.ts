import type {
  AgentInfo, Run, RunTurnDetail,
  StartRunRequest, ContinueRunRequest,
  Project, Task,
} from "./types.js";

export type WebmuxClient = ReturnType<typeof createWebmuxClient>;

type Logger = {
  debug: (msg: string) => void;
};

export function createWebmuxClient(
  config: { webmuxUrl: string; webmuxToken: string; requestTimeoutMs: number },
  logger: Logger,
) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.webmuxUrl}${path}`;
    logger.debug(`webmux ${method} ${path}`);

    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.webmuxToken}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!resp.ok) {
      let message = "";
      try {
        const data = await resp.json() as Record<string, unknown>;
        message = typeof data.error === "string" ? data.error : JSON.stringify(data);
      } catch {
        message = await resp.text().catch(() => "");
      }
      throw new Error(`Webmux API error ${resp.status}: ${message}`);
    }

    if (resp.status === 204) return undefined as T;
    return resp.json() as Promise<T>;
  }

  return {
    listAgents: () =>
      request<{ agents: AgentInfo[] }>("GET", "/api/agents"),

    createThread: (agentId: string, body: StartRunRequest) =>
      request<{ run: Run }>("POST", `/api/agents/${encodeURIComponent(agentId)}/threads`, body),

    getThread: (agentId: string, threadId: string) =>
      request<{ run: Run; turns: RunTurnDetail[] }>("GET", `/api/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}`),

    continueThread: (agentId: string, threadId: string, body: ContinueRunRequest) =>
      request<{ run: Run; turns: RunTurnDetail[] }>("POST", `/api/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/turns`, body),

    interruptThread: (agentId: string, threadId: string) =>
      request<void>("POST", `/api/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(threadId)}/interrupt`),

    listThreads: () =>
      request<{ runs: Run[] }>("GET", "/api/threads"),

    listProjects: () =>
      request<{ projects: Project[] }>("GET", "/api/projects"),

    createProject: (body: { name: string; description?: string; repoPath: string; agentId: string; defaultTool?: string }) =>
      request<{ project: Project }>("POST", "/api/projects", body).then((res) => res.project),

    listTasks: (projectId: string) =>
      request<{ tasks: Task[] }>("GET", `/api/projects/${encodeURIComponent(projectId)}/tasks`),

    createTask: (projectId: string, body: { title: string; prompt?: string; priority?: number; tool?: string }) =>
      request<{ task: Task }>("POST", `/api/projects/${encodeURIComponent(projectId)}/tasks`, body).then((res) => res.task),
  };
}
