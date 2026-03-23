import type { RunTool } from "@webmux/shared";

export function buildImportableSessionsPath(
  agentId: string,
  tool: RunTool,
  repoPath: string,
): string {
  const query = new URLSearchParams({
    tool,
    repoPath,
  });

  return `/api/agents/${agentId}/importable-sessions?${query.toString()}`;
}
