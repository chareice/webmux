import type { RootStackParamList } from './navigation';

export function parseThreadNotificationTarget(
  data: unknown,
): RootStackParamList['ThreadDetail'] | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as { agentId?: unknown; runId?: unknown };
  if (
    typeof candidate.agentId !== 'string' ||
    candidate.agentId.trim().length === 0 ||
    typeof candidate.runId !== 'string' ||
    candidate.runId.trim().length === 0
  ) {
    return null;
  }

  return {
    agentId: candidate.agentId,
    runId: candidate.runId,
  };
}
