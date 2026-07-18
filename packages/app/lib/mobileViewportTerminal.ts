export type MobileViewportTerminalAction =
  | "refit"
  | "scroll-to-bottom"
  | null;

export function getMobileViewportTerminalAction(input: {
  isMobile: boolean;
  isActive: boolean;
  isController: boolean;
  previousHeight: number | null;
  nextHeight: number | null;
}): MobileViewportTerminalAction {
  if (
    !input.isMobile ||
    !input.isActive ||
    input.previousHeight === null ||
    input.nextHeight === null ||
    input.previousHeight === input.nextHeight
  ) {
    return null;
  }
  if (input.isController) return "refit";
  return input.nextHeight < input.previousHeight ? "scroll-to-bottom" : null;
}
