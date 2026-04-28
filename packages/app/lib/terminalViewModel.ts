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

interface EstimateInitialTerminalDimensionsOptions {
  cellWidth?: number;
  cellHeight?: number;
  minCols?: number;
  minRows?: number;
  maxCols?: number;
  maxRows?: number;
}

const DESKTOP_ESTIMATE_CELL_WIDTH = 8.5;
const DESKTOP_ESTIMATE_CELL_HEIGHT = 17;

// Mobile fullscreen terminals sit inside ExpandedTerminal + TerminalCard
// chrome before xterm exists, so creation needs to estimate the inner terminal
// viewport rather than the whole screen.
const MOBILE_TERMINAL_HORIZONTAL_CHROME_PX = 20;
const MOBILE_TERMINAL_VERTICAL_CHROME_PX = 194;
const MOBILE_ESTIMATE_CELL_WIDTH = 7.1;
const MOBILE_ESTIMATE_CELL_HEIGHT = 17;

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
  options: EstimateInitialTerminalDimensionsOptions = {},
): { cols: number; rows: number } {
  const cellWidth = options.cellWidth ?? DESKTOP_ESTIMATE_CELL_WIDTH;
  const cellHeight = options.cellHeight ?? DESKTOP_ESTIMATE_CELL_HEIGHT;
  const minCols = options.minCols ?? 80;
  const minRows = options.minRows ?? 24;
  const maxCols = options.maxCols ?? 400;
  const maxRows = options.maxRows ?? 200;
  const cols = Math.max(
    minCols,
    Math.min(maxCols, Math.floor(viewportWidthPx / cellWidth)),
  );
  const rows = Math.max(
    minRows,
    Math.min(maxRows, Math.floor(viewportHeightPx / cellHeight)),
  );
  return { cols, rows };
}

export function estimateMobileInitialTerminalDimensions(
  viewportWidthPx: number,
  viewportHeightPx: number,
): { cols: number; rows: number } {
  return estimateInitialTerminalDimensions(
    Math.max(0, viewportWidthPx - MOBILE_TERMINAL_HORIZONTAL_CHROME_PX),
    Math.max(0, viewportHeightPx - MOBILE_TERMINAL_VERTICAL_CHROME_PX),
    {
      cellWidth: MOBILE_ESTIMATE_CELL_WIDTH,
      cellHeight: MOBILE_ESTIMATE_CELL_HEIGHT,
      minCols: 40,
      minRows: 12,
    },
  );
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
