import type { Run, RunDetailResponse, RunTimelineEvent } from './types';

type RunDetailResponseLike = {
  run?: Run;
  items?: RunTimelineEvent[] | null;
};

export function normalizeRunDetailResponse(
  response: RunDetailResponseLike,
): RunDetailResponse {
  return {
    run: response.run as Run,
    items: Array.isArray(response.items) ? response.items : [],
  };
}

export function isRunTimelineEvent(value: unknown): value is RunTimelineEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<RunTimelineEvent>;
  return typeof item.id === 'number' && typeof item.createdAt === 'number' && typeof item.type === 'string';
}
