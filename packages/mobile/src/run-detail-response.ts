import type {
  RunImageAttachment,
  Run,
  RunDetailResponse,
  RunTimelineEvent,
  RunTurn,
  RunTurnDetail,
} from './types';

type RunDetailResponseLike = {
  run?: Run;
  turns?: Array<{
    items?: RunTimelineEvent[] | null;
    attachments?: RunImageAttachment[] | null;
  } & Partial<RunTurn>> | null;
};

export function normalizeRunDetailResponse(
  response: RunDetailResponseLike,
): RunDetailResponse {
  return {
    run: response.run as Run,
    turns: Array.isArray(response.turns)
      ? response.turns
          .filter(isRunTurn)
          .map((turn) => ({
            ...turn,
            attachments: Array.isArray(turn.attachments) ? turn.attachments : [],
            items: Array.isArray(turn.items) ? turn.items : [],
          }))
      : [],
  };
}

export function isRunTimelineEvent(value: unknown): value is RunTimelineEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<RunTimelineEvent>;
  return typeof item.id === 'number' && typeof item.createdAt === 'number' && typeof item.type === 'string';
}

export function isRunTurn(value: unknown): value is RunTurnDetail {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const turn = value as Partial<RunTurnDetail>;
  return (
    typeof turn.id === 'string' &&
    typeof turn.runId === 'string' &&
    typeof turn.index === 'number' &&
    typeof turn.prompt === 'string' &&
    typeof turn.status === 'string' &&
    typeof turn.createdAt === 'number' &&
    typeof turn.updatedAt === 'number' &&
    typeof turn.hasDiff === 'boolean'
  );
}
