export type TerminalSurfaceMode = "live" | "preview";

interface TerminalLike {
  id: string;
}

export function getLiveTerminalIds(
  terminals: TerminalLike[],
  maximizedId: string | null,
): string[] {
  if (!maximizedId) {
    return [];
  }

  return terminals.some((terminal) => terminal.id === maximizedId)
    ? [maximizedId]
    : [];
}

export function getTerminalSurfaceMode(
  terminalId: string,
  maximizedId: string | null,
): TerminalSurfaceMode {
  return maximizedId === terminalId ? "live" : "preview";
}
