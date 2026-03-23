export interface ThreadNotificationTarget {
  agentId: string;
  threadId: string;
}

export function parseThreadNotificationTarget(
  data: unknown,
): ThreadNotificationTarget | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as {
    agentId?: unknown;
    runId?: unknown;
    threadId?: unknown;
  };

  if (typeof candidate.agentId !== "string" || candidate.agentId.trim() === "") {
    return null;
  }

  const threadId =
    typeof candidate.threadId === "string" && candidate.threadId.trim() !== ""
      ? candidate.threadId
      : typeof candidate.runId === "string" && candidate.runId.trim() !== ""
        ? candidate.runId
        : null;

  if (!threadId) {
    return null;
  }

  return {
    agentId: candidate.agentId,
    threadId,
  };
}

export function buildThreadRoute(target: ThreadNotificationTarget): string {
  return `/(main)/threads/${encodeURIComponent(target.agentId)}/${encodeURIComponent(target.threadId)}`;
}
