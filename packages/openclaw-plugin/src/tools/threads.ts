import type { WebmuxClient } from "../api-client.js";
import type { RunTool } from "../types.js";
import { formatRunSummary, formatTimeline } from "../format.js";

export function registerThreadTools(api: any, client: WebmuxClient) {

  // 1. webmux_run — Start a coding task
  api.registerTool(() => ({
    name: "webmux_run",
    label: "Run Remote Coding Task",
    description:
      "Start an AI coding task on a remote agent. Returns immediately with a thread ID; use webmux_get_result to check progress.",
    parameters: {
      type: "object" as const,
      properties: {
        agentId: { type: "string", description: "Agent ID (from webmux_list_agents)" },
        repoPath: { type: "string", description: "Absolute path to the repository on the remote machine" },
        prompt: { type: "string", description: "The coding instruction" },
        tool: { type: "string", enum: ["claude", "codex"], description: "AI tool to use (default: claude)" },
        model: { type: "string", description: "Model override (optional)" },
      },
      required: ["agentId", "repoPath", "prompt"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const { run } = await client.createThread(params.agentId as string, {
        tool: (params.tool as RunTool) ?? "claude",
        repoPath: params.repoPath as string,
        prompt: params.prompt as string,
        options: params.model ? { model: params.model as string } : undefined,
      });
      return {
        content: [{
          type: "text" as const,
          text: `Task started.\n\n- Thread ID: \`${run.id}\`\n- Agent: \`${run.agentId}\`\n- Status: ${run.status}\n\nUse \`webmux_get_result\` with this thread ID to check progress.`,
        }],
        details: { run },
      };
    },
  }));

  // 2. webmux_get_result — Check task status and results
  api.registerTool(() => ({
    name: "webmux_get_result",
    label: "Get Remote Task Result",
    description:
      "Check the status and results of a remote coding task. If status is 'running', call again later.",
    parameters: {
      type: "object" as const,
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        threadId: { type: "string", description: "Thread ID (from webmux_run)" },
      },
      required: ["agentId", "threadId"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const { run, turns } = await client.getThread(
        params.agentId as string,
        params.threadId as string,
      );
      const header = formatRunSummary(run);
      const timeline = formatTimeline(turns);
      return {
        content: [{ type: "text" as const, text: `${header}\n\n${timeline}` }],
        details: { run, turnCount: turns.length },
      };
    },
  }));

  // 3. webmux_continue — Follow-up message
  api.registerTool(() => ({
    name: "webmux_continue",
    label: "Continue Remote Task",
    description: "Send a follow-up message to an existing remote coding session.",
    parameters: {
      type: "object" as const,
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        threadId: { type: "string", description: "Thread ID" },
        prompt: { type: "string", description: "Follow-up instruction" },
      },
      required: ["agentId", "threadId", "prompt"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const { run } = await client.continueThread(
        params.agentId as string,
        params.threadId as string,
        { prompt: params.prompt as string },
      );
      return {
        content: [{
          type: "text" as const,
          text: `Follow-up sent. Status: ${run.status}. Use \`webmux_get_result\` to check progress.`,
        }],
        details: { run },
      };
    },
  }));

  // 4. webmux_interrupt — Stop a running task
  api.registerTool(() => ({
    name: "webmux_interrupt",
    label: "Interrupt Remote Task",
    description: "Stop a running remote coding task.",
    parameters: {
      type: "object" as const,
      properties: {
        agentId: { type: "string", description: "Agent ID" },
        threadId: { type: "string", description: "Thread ID" },
      },
      required: ["agentId", "threadId"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      await client.interruptThread(params.agentId as string, params.threadId as string);
      return {
        content: [{ type: "text" as const, text: "Task interrupted." }],
        details: {},
      };
    },
  }));

  // 5. webmux_list_threads — List all sessions
  api.registerTool(() => ({
    name: "webmux_list_threads",
    label: "List Remote Threads",
    description: "List all remote coding sessions with their status.",
    parameters: { type: "object" as const, properties: {} },
    async execute() {
      const { runs } = await client.listThreads();
      if (runs.length === 0) {
        return { content: [{ type: "text" as const, text: "No threads." }], details: {} };
      }
      const lines = runs.map((r) =>
        `- \`${r.id}\` | ${r.status} | ${r.tool} on \`${r.repoPath}\` | ${r.summary ?? r.prompt.slice(0, 60)}`
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { count: runs.length },
      };
    },
  }));
}
