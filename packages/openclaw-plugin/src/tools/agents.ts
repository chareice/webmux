import type { WebmuxClient } from "../api-client.js";

export function registerAgentTools(api: any, client: WebmuxClient) {
  api.registerTool(() => ({
    name: "webmux_list_agents",
    label: "List Remote Agents",
    description: "List all available remote coding agents and their online/offline status.",
    parameters: { type: "object" as const, properties: {} },
    async execute() {
      const { agents } = await client.listAgents();
      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents registered." }], details: {} };
      }
      const lines = agents.map(
        (a) => `- **${a.name}** (id: \`${a.id}\`) — ${a.status === "online" ? "ONLINE" : "offline"}`
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { agents },
      };
    },
  }));
}
