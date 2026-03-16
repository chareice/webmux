import type { RunStatus, RunTimelineEvent, RunTurn, RunTurnDetail } from './types';

export function upsertRunTurn(
  turns: RunTurnDetail[],
  turn: RunTurn,
): RunTurnDetail[] {
  const existing = turns.find((item) => item.id === turn.id);
  const nextTurns = existing
    ? turns.map((item) =>
        item.id === turn.id
          ? {
              ...turn,
              items: item.items,
            }
          : item,
      )
    : [...turns, { ...turn, items: [] }];

  return [...nextTurns].sort((left, right) => left.index - right.index);
}

export function appendTurnItem(
  turns: RunTurnDetail[],
  turnId: string,
  item: RunTimelineEvent,
): RunTurnDetail[] {
  let found = false;

  const nextTurns = turns.map((turn) => {
    if (turn.id !== turnId) {
      return turn;
    }

    found = true;
    return {
      ...turn,
      items: [...turn.items, item],
    };
  });

  return found ? nextTurns : turns;
}

export function latestRunTurn(turns: RunTurnDetail[]): RunTurnDetail | null {
  return turns.length > 0 ? turns[turns.length - 1] : null;
}

export function isRunActive(status: RunStatus): boolean {
  return status === 'starting' || status === 'running';
}

export function canContinueRun(turn: RunTurnDetail | null): boolean {
  return turn !== null && !isRunActive(turn.status);
}
