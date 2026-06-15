import type { Terminal } from "@xterm/xterm";

export interface CellMetrics {
  width: number;
  height: number;
}

type TerminalWithRenderService = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: { width?: number; height?: number };
        };
      };
    };
  };
};

export function measureTerminalSurface(
  container: HTMLDivElement | null,
): { width: number; height: number } {
  if (!container) {
    return { width: 0, height: 0 };
  }

  const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
  const width = Math.max(
    screen?.scrollWidth ?? 0,
    screen?.clientWidth ?? 0,
    container.scrollWidth,
    container.clientWidth,
  );
  const height = Math.max(
    screen?.scrollHeight ?? 0,
    screen?.clientHeight ?? 0,
    container.scrollHeight,
    container.clientHeight,
  );

  return { width, height };
}

// Match the private renderer path used by @xterm/addon-fit. Public xterm APIs
// do not expose CSS cell metrics, and deriving them from surface size races
// against terminal.resize().
export function readXtermCellMetrics(term: Terminal): CellMetrics | null {
  const cell = (term as TerminalWithRenderService)._core?._renderService
    ?.dimensions?.css?.cell;
  if (!cell) return null;
  const { width, height } = cell;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height };
}
