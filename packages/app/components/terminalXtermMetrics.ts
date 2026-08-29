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

function cellFromUnknown(
  cell: { width?: number; height?: number } | undefined,
): CellMetrics | null {
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

// Prefer the public 6.1 `term.dimensions` API (what @xterm/addon-fit reads)
// and fall back to the private renderer path used before that existed.
// Deriving cell size from a surface measurement races against terminal.resize().
export function readXtermCellMetrics(term: Terminal): CellMetrics | null {
  const fromPublic = cellFromUnknown(term.dimensions?.css?.cell);
  if (fromPublic) return fromPublic;
  return cellFromUnknown(
    (term as TerminalWithRenderService)._core?._renderService?.dimensions?.css
      ?.cell,
  );
}
