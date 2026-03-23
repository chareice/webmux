import type { RunTool } from "@webmux/shared";

export function buildInstructionsPath(agentId: string, tool: RunTool): string {
  const params = new URLSearchParams({ tool });

  return `/api/agents/${agentId}/instructions?${params.toString()}`;
}

export function buildSaveInstructionsBody(
  tool: RunTool,
  content: string,
): string {
  return JSON.stringify({ tool, content });
}
