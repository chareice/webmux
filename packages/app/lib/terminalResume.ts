// Pure helpers for the terminal resume protocol.
// See docs/superpowers/specs/2026-04-17-terminal-resume-protocol-design.md.

export type AttachMode = "full" | "delta" | "reset";

export interface AttachFrame {
  seq: number;
  mode: AttachMode;
  replayBytes: number;
}

const VALID_MODES: ReadonlySet<AttachMode> = new Set(["full", "delta", "reset"]);

function isValidMode(value: unknown): value is AttachMode {
  return typeof value === "string" && VALID_MODES.has(value as AttachMode);
}

/**
 * Parse a WebSocket text frame as an attach control message.
 * Returns null when the frame is not an attach or is malformed — callers
 * should treat that as "this isn't for me" rather than an error.
 */
export function parseAttachFrame(text: string): AttachFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as Record<string, unknown>;
  if (msg.type !== "attach") return null;
  if (typeof msg.seq !== "number" || !Number.isFinite(msg.seq)) return null;
  if (typeof msg.replay_bytes !== "number" || !Number.isFinite(msg.replay_bytes)) return null;
  if (!isValidMode(msg.mode)) return null;
  return {
    seq: msg.seq,
    mode: msg.mode,
    replayBytes: msg.replay_bytes,
  };
}

/**
 * Append an `after_seq=<n>` query param when the client has a non-zero seq
 * to resume from. Returns the URL unchanged when seq is zero (initial attach).
 * If `after_seq` is already present, it is replaced.
 */
export function appendResumeSeq(baseUrl: string, lastSeenSeq: number): string {
  if (lastSeenSeq <= 0) return baseUrl;
  const [path, query = ""] = baseUrl.split("?", 2);
  const pairs = query ? query.split("&").filter(Boolean) : [];
  const filtered = pairs.filter((p) => !p.startsWith("after_seq="));
  filtered.push(`after_seq=${lastSeenSeq}`);
  return `${path}?${filtered.join("&")}`;
}

/**
 * Compute the client's initial `lastSeenSeq` value after an attach frame
 * has been parsed, *before* any replay binary bytes have been consumed.
 * Per-chunk accumulation on every binary byte will carry the counter up
 * to `attach.seq` after all replay bytes land.
 */
export function initialSeqAfterAttach(attach: AttachFrame): number {
  return attach.seq - attach.replayBytes;
}
