export interface TerminalDimensionsLike {
  cols: number
  rows: number
}

export interface TerminalResizeMessage {
  type: "resize"
  cols: number
  rows: number
}

function isFiniteColumn(value: number): boolean {
  return Number.isFinite(value) && value >= 2
}

function isFiniteRow(value: number): boolean {
  return Number.isFinite(value) && value >= 1
}

export function buildResizeMessage(
  dims: TerminalDimensionsLike | null | undefined,
): TerminalResizeMessage | null {
  if (!dims) return null

  const cols = Math.floor(dims.cols)
  const rows = Math.floor(dims.rows)
  if (!isFiniteColumn(cols) || !isFiniteRow(rows)) {
    return null
  }

  return {
    type: "resize",
    cols,
    rows,
  }
}

export function didGainControl(previous: boolean, next: boolean): boolean {
  return !previous && next
}
