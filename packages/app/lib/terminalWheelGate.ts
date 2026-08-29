// Wheel direction hysteresis for the terminal.
//
// Scrollback lives in tmux: wheel events become SGR mouse reports, wheel-up
// enters tmux copy-mode (`copy-mode -e`) and scrolling back to the bottom
// exits it. xterm accumulates sub-line wheel deltas into reports, so the
// few-pixel backward wobble at the end of a trackpad gesture emits a
// wheel-up report that instantly re-enters copy-mode. To the user the
// terminal looks stuck in scroll state ("[0/N]" badge that never clears).
//
// The gate swallows direction reversals that are both immediate (within
// QUIET_GAP_MS of the previous event) and small (cumulative opposite travel
// under REVERSAL_THRESHOLD_PX). Deliberate reversals — after a pause, from a
// notched mouse wheel, or with real finger travel — pass through.

const QUIET_GAP_MS = 150;
const REVERSAL_THRESHOLD_PX = 24;
const LARGE_DELTA_PX = 50;

// Rough px-per-unit for non-pixel deltaMode values (DOM_DELTA_LINE / _PAGE).
const LINE_PX = 16;
const PAGE_PX = 400;

export type WheelDirectionGate = (deltaY: number, deltaMode: number) => boolean;

export function createWheelDirectionGate(
  now: () => number = () => performance.now(),
): WheelDirectionGate {
  let direction = 0; // -1 scrolling up, +1 scrolling down, 0 no gesture yet
  let lastEventAt = -Infinity;
  let oppositeTravel = 0;

  return function allowWheelEvent(deltaY: number, deltaMode: number): boolean {
    if (deltaY === 0) {
      return true;
    }
    const t = now();
    const gap = t - lastEventAt;
    lastEventAt = t;

    const sign = deltaY > 0 ? 1 : -1;
    const px =
      Math.abs(deltaY) * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1);

    if (
      direction === 0 ||
      sign === direction ||
      gap > QUIET_GAP_MS ||
      px >= LARGE_DELTA_PX
    ) {
      direction = sign;
      oppositeTravel = 0;
      return true;
    }

    oppositeTravel += px;
    if (oppositeTravel >= REVERSAL_THRESHOLD_PX) {
      direction = sign;
      oppositeTravel = 0;
      return true;
    }
    return false;
  };
}
