export interface DisplayMode {
  isCompact: boolean;
  isTouch: boolean;
}

export const COMPACT_TOUCH_MIN_EDGE_PX = 600;
export const COMPACT_WINDOW_WIDTH_PX = 768;

/**
 * Pure display-mode classifier.
 *
 * Touch devices use the screen's short edge (not window width) so a Fold
 * cover-screen landscape (~832–940 CSS px wide) stays compact, and a soft
 * keyboard shrinking `innerWidth`/`visualViewport` cannot flip the chrome.
 * Folding/unfolding changes `screen.width`/`height` on Android and is
 * therefore picked up on the next classify.
 *
 * Non-touch keeps the legacy `window.innerWidth <= 768` desktop breakpoint.
 */
export function classifyDisplayMode(input: {
  isTouch: boolean;
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
}): DisplayMode {
  if (input.isTouch) {
    return {
      isTouch: true,
      isCompact:
        Math.min(input.screenWidth, input.screenHeight) <
        COMPACT_TOUCH_MIN_EDGE_PX,
    };
  }
  return {
    isTouch: false,
    isCompact: input.windowWidth <= COMPACT_WINDOW_WIDTH_PX,
  };
}

/**
 * Primary pointer is coarse (`(pointer: coarse)`). Falls back to
 * `navigator.maxTouchPoints` when matchMedia is unavailable.
 */
export function detectIsTouch(input?: {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  maxTouchPoints?: number;
}): boolean {
  if (input?.matchMedia) {
    return input.matchMedia("(pointer: coarse)").matches;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(pointer: coarse)").matches;
  }
  const maxTouchPoints =
    input?.maxTouchPoints ??
    (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);
  return (maxTouchPoints ?? 0) > 0;
}
