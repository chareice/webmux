// Lightweight terminal-output tail buffer for the mobile card preview.
// Decodes UTF-8 chunks, strips ANSI control sequences, and keeps the
// last N non-blank lines. Designed to be cheap (no xterm instance) and
// pure (no React / DOM coupling) so the parsing is unit-testable.
//
// Trade-off: this is line-stream rendering. Output from a TUI that
// repaints in place via cursor positioning (vim, htop) won't render
// faithfully — we'll just see the raw text fragments. That's acceptable
// for the preview's "what's happening here" cue; the real terminal is
// one tap away.

const ANSI_CSI = /\x1b\[[0-9;?]*[a-zA-Z]/g; // CSI: ESC [ ... letter
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g; // OSC ... BEL or ST
const ANSI_DCS_PM_APC_SOS = /\x1b[PX^_][^\x1b]*\x1b\\/g; // DCS/PM/APC/SOS
const ANSI_OTHER_ESC = /\x1b[()][\x20-\x7E]/g; // charset designators
// Other control bytes we want to drop (everything except \t \n \r).
const CTRL_KEEP_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripAnsi(input: string): string {
  return input
    .replace(ANSI_OSC, "")
    .replace(ANSI_DCS_PM_APC_SOS, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_OTHER_ESC, "")
    .replace(CTRL_KEEP_REGEX, "");
}

// Maximum chars we keep in the rolling buffer. Bigger than ~maxLines ×
// terminal_width so we always have enough history to extract maxLines
// of content even after stripping.
const MAX_BUFFER_CHARS = 8000;

export interface TailBufferOptions {
  /** How many trailing non-blank lines to expose. */
  maxLines: number;
  /** Truncate each line to this many characters before storing. */
  maxLineWidth?: number;
}

export class TerminalTailBuffer {
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: false });
  private readonly maxLines: number;
  private readonly maxLineWidth: number;

  constructor(opts: TailBufferOptions) {
    this.maxLines = opts.maxLines;
    this.maxLineWidth = opts.maxLineWidth ?? 200;
  }

  /** Append a UTF-8 chunk; returns the current tail lines after the append. */
  append(chunk: Uint8Array): string[] {
    const text = this.decoder.decode(chunk, { stream: true });
    const cleaned = stripAnsi(text).replace(/\r\n?/g, "\n");
    this.buffer += cleaned;
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_CHARS);
    }
    return this.snapshot();
  }

  snapshot(): string[] {
    const lines = this.buffer.split("\n");
    const tail: string[] = [];
    for (let i = lines.length - 1; i >= 0 && tail.length < this.maxLines; i--) {
      const line = lines[i];
      // Skip leading/trailing blank lines so the tail is informative
      // even when the program just emitted a few \n. Blank lines IN the
      // middle of the kept range are preserved.
      if (tail.length === 0 && line.trim() === "") continue;
      const truncated =
        line.length > this.maxLineWidth
          ? line.slice(0, this.maxLineWidth - 1) + "…"
          : line;
      tail.unshift(truncated);
    }
    return tail;
  }

  reset(): void {
    this.buffer = "";
  }
}
