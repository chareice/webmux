// Helpers for the mobile select-mode overlay. Pure utilities so the
// wrap-merging logic is testable without a real xterm instance.

export interface RawRow {
  text: string;
  /** True when this terminal row is the soft-wrap continuation of the previous row. */
  isWrapped: boolean;
}

// Collapse soft-wrapped continuations back into single logical lines.
// xterm wraps long output across multiple terminal rows when it doesn't
// fit the column count, marking each continuation with isWrapped=true.
// For copy-out we want the original logical lines so the user doesn't
// paste artificial mid-sentence newlines into chat / docs.
export function mergeWrappedRows(rows: RawRow[]): string[] {
  const merged: string[] = [];
  for (const row of rows) {
    if (row.isWrapped && merged.length > 0) {
      merged[merged.length - 1] += row.text;
    } else {
      merged.push(row.text);
    }
  }
  return merged;
}

// Drop trailing rows that are fully blank so the overlay doesn't render
// a tall expanse of empty lines below the actual content.
export function trimTrailingBlankLines(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === "") {
    out.pop();
  }
  return out;
}
