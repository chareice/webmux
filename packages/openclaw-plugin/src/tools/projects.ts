import type { WebmuxClient } from "../api-client.js";

export function registerProjectTools(api: any, client: WebmuxClient) {
  api.registerTool(() => ({
    name: "webmux_list_projects",
    label: "List Remote Projects",
    description: "List all Webmux projects.",
    parameters: { type: "object" as const, properties: {} },
    async execute() {
      const { projects } = await client.listProjects();
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No projects." }], details: {} };
      }
      const lines = projects.map(
        (p) => `- **${p.name}** (id: \`${p.id}\`) — ${p.description || "no description"} — agent: \`${p.agentId}\``
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { projects } };
    },
  }));

  api.registerTool(() => ({
    name: "webmux_create_task",
    label: "Create Remote Task",
    description: "Queue a coding task in a Webmux project. The task will be picked up by the project's agent automatically.",
    parameters: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Project ID (from webmux_list_projects)" },
        title: { type: "string", description: "Short task title" },
        prompt: { type: "string", description: "Detailed coding instruction" },
        tool: { type: "string", enum: ["claude", "codex"], description: "AI tool (default: project default)" },
      },
      required: ["projectId", "title", "prompt"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const task = await client.createTask(params.projectId as string, {
        title: params.title as string,
        prompt: params.prompt as string,
        tool: params.tool as string | undefined,
      });
      return {
        content: [{
          type: "text" as const,
          text: `Task created: **${task.title}** (id: \`${task.id}\`, status: ${task.status})`,
        }],
        details: { task },
      };
    },
  }));

  api.registerTool(() => ({
    name: "webmux_list_tasks",
    label: "List Project Tasks",
    description: "List all tasks in a Webmux project with their status.",
    parameters: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const { tasks } = await client.listTasks(params.projectId as string);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No tasks in this project." }], details: {} };
      }
      const lines = tasks.map(
        (t) => `- [${t.status}] **${t.title}** (id: \`${t.id}\`)${t.summary ? ` — ${t.summary}` : ""}`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { count: tasks.length } };
    },
  }));
}
