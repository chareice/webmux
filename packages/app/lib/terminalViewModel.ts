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
    sizeActionLabel: "Use This Size",
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
