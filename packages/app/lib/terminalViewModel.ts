export type TerminalDisplayMode = "card" | "immersive";

export interface TerminalControlCopy {
  modeLabel: string;
  toggleLabel: string;
  sizeActionLabel: string;
}

export interface TerminalViewportLayout {
  scale: number;
  frameWidth: number;
  frameHeight: number;
  justifyContent: "flex-start" | "center";
}

interface TerminalViewportLayoutInput {
  displayMode: TerminalDisplayMode;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}

interface TerminalFitDimensionsInput {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  cols: number;
  rows: number;
}

export function getTerminalControlCopy(
  isController: boolean,
): TerminalControlCopy {
  return {
    modeLabel: isController ? "Controlling" : "Viewing",
    toggleLabel: isController ? "Stop Control" : "Control Here",
    sizeActionLabel: "Fit to Window",
  };
}

export function getTerminalViewportLayout({
  displayMode,
  viewportWidth,
  viewportHeight: _viewportHeight,
  contentWidth,
  contentHeight,
}: TerminalViewportLayoutInput): TerminalViewportLayout {
  if (
    displayMode !== "immersive" ||
    viewportWidth <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return {
      scale: 1,
      frameWidth: Math.max(contentWidth, 0),
      frameHeight: Math.max(contentHeight, 0),
      justifyContent: "flex-start",
    };
  }

  const scale = Math.min(1, viewportWidth / contentWidth);

  return {
    scale,
    frameWidth: contentWidth * scale,
    frameHeight: contentHeight * scale,
    justifyContent: "center",
  };
}

/**
 * Estimate cols/rows for a *new* terminal from a pixel viewport before any
 * xterm instance exists to measure. Uses the default font metrics
 * (monospace 14px) so the server creates the tmux session close to the
 * size it will actually be shown at — the alternative (hardcoded 80x24)
 * makes TUIs like Claude Code draw their welcome banner narrow, which
 * SIGWINCH on later resize can't repaint.
 */
export function estimateInitialTerminalDimensions(
  viewportWidthPx: number,
  viewportHeightPx: number,
): { cols: number; rows: number } {
  const CELL_W = 8.5;
  const CELL_H = 17;
  const cols = Math.max(80, Math.min(400, Math.floor(viewportWidthPx / CELL_W)));
  const rows = Math.max(24, Math.min(200, Math.floor(viewportHeightPx / CELL_H)));
  return { cols, rows };
}

export function getTerminalFitDimensions({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
  cols,
  rows,
}: TerminalFitDimensionsInput): { cols: number; rows: number } | null {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0 ||
    cols <= 0 ||
    rows <= 0
  ) {
    return null;
  }

  const cellWidth = contentWidth / cols;
  const cellHeight = contentHeight / rows;
  if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight)) {
    return null;
  }

  const nextCols = Math.floor(viewportWidth / cellWidth);
  const nextRows = Math.floor(viewportHeight / cellHeight);
  if (nextCols <= 0 || nextRows <= 0) {
    return null;
  }

  return {
    cols: nextCols,
    rows: nextRows,
  };
}
