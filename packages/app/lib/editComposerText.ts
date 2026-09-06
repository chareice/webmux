/** Edit a local draft without translating terminal escape sequences into text. */
export function editComposerText(text: string, start: number, end: number, data: string): { text: string; caret: number } | null {
  if (data === "\x1b[D" || data === "\x1b[C") {
    const boundaries = [0];
    if (typeof Intl.Segmenter === "function") {
      for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) boundaries.push(part.index + part.segment.length);
    } else { let offset = 0; for (const char of text) { offset += char.length; boundaries.push(offset); } }
    const caret = data === "\x1b[D"
      ? start !== end ? start : [...boundaries].reverse().find(n => n < start) ?? 0
      : start !== end ? end : boundaries.find(n => n > end) ?? text.length;
    return { text, caret };
  }
  if (data === "\x1b[A" || data === "\x1b[B") {
    const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const column = start - lineStart;
    if (data === "\x1b[A") {
      if (lineStart === 0) return { text, caret: 0 };
      const previousEnd = lineStart - 1;
      const previousStart = previousEnd === 0 ? 0 : text.lastIndexOf("\n", previousEnd - 1) + 1;
      return { text, caret: Math.min(previousStart + column, previousEnd) };
    }
    const lineEnd = text.indexOf("\n", end);
    if (lineEnd < 0) return { text, caret: text.length };
    const nextEnd = text.indexOf("\n", lineEnd + 1);
    return { text, caret: Math.min(lineEnd + 1 + column, nextEnd < 0 ? text.length : nextEnd) };
  }
  if (data !== "\t" && /[\x00-\x1f\x7f]/.test(data)) return null;
  const next = text.slice(0, start) + data + text.slice(end);
  return next.length <= 65536 ? { text: next, caret: start + data.length } : null;
}
