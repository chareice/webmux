export type TerminalSurfaceMode = "live" | "preview";

interface TerminalLike {
  id: string;
}

export function getLiveTerminalIds(
  terminals: TerminalLike[],
  _maximizedId: string | null,
): string[] {
  return terminals.map((terminal) => terminal.id);
}

export function getTerminalSurfaceMode(
  _terminalId: string,
  _maximizedId: string | null,
): TerminalSurfaceMode {
  return "live";
}
