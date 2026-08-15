export interface DisplayMode {
  isCompact: boolean;
  isTouch: boolean;
}

export const COMPACT_WINDOW_WIDTH_PX = 768;

/**
 * Pure display-mode classifier.
 *
 * Touch devices are always compact: the touch-workspace experiment routed
 * large touch screens (Fold inner, ~757×840) to the desktop chrome, but
 * real-device use showed the single-column mobile layout works better there
 * too. Ignoring screen/window size on touch also means neither rotation nor
 * a soft keyboard shrinking `innerWidth` can flip the chrome mid-session.
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
    return { isTouch: true, isCompact: true };
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
