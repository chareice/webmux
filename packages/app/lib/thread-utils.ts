import type { RunTurnDetail } from "@webmux/shared";

type ContinuableTurn = Pick<RunTurnDetail, "status"> | undefined;
type RetryableTurn = Pick<RunTurnDetail, "status" | "prompt"> | undefined;

export function canContinueTurn(turn: ContinuableTurn): boolean {
  if (!turn) {
    return false;
  }

  return (
    turn.status === "success" ||
    turn.status === "failed" ||
    turn.status === "interrupted"
  );
}

export function canRetryTurn(
  turn: RetryableTurn,
  queuedTurnCount: number,
): boolean {
  if (!turn || !turn.prompt.trim()) {
    return false;
  }

  if (queuedTurnCount > 0 && turn.status === "interrupted") {
    return false;
  }

  return turn.status === "failed" || turn.status === "interrupted";
}
