import { Inflate } from "fflate";

// deflate-raw-v1 browser side: the hub acks with a
// {"type":"compression_enabled","algo":"deflate-raw-v1"} JSON text frame
// BEFORE any binary frame, and from then on every binary frame on the
// socket is one raw-DEFLATE message (sync flush per message, context
// takeover across them, `00 00 ff ff` tail kept on the wire). Without the
// ack — old hub, old machine, or no `compress` query param — binary frames
// are raw PTY bytes and must pass through untouched.
export const DEFLATE_RAW_V1_ALGO = "deflate-raw-v1";

export interface DeflateRawV1Session {
  /** True once the hub's CompressionEnabled ack has been seen. */
  readonly active: boolean;
  /**
   * Handle a JSON text frame. Returns true when it was the compression ack
   * (and the inflater is now active); all other text frames return false.
   */
  handleText(text: string): boolean;
  /**
   * Handle a binary frame. Returns null only when compression was never
   * activated (no ack seen — caller treats the frame as raw PTY bytes).
   * Once active, returns the inflated chunks. After an inflate error the
   * stream is unrecoverable: onError fires once, and the failing frame and
   * all further frames return an empty array — they are swallowed, never
   * passed to the caller as raw bytes, since the still-compressed payloads
   * would render as garbage while the socket close is in flight.
   */
  handleBinary(data: ArrayBuffer): Uint8Array[] | null;
}

export function createDeflateRawV1Session(options: {
  onAck?: () => void;
  onError?: (error: unknown) => void;
}): DeflateRawV1Session {
  let inflater: Inflate | null = null;
  let failed = false;

  return {
    get active() {
      return inflater !== null && !failed;
    },
    handleText(text) {
      if (inflater !== null) return false;
      let parsed: { type?: string; algo?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        return false;
      }
      if (parsed?.type !== "compression_enabled") return false;
      if (parsed.algo !== DEFLATE_RAW_V1_ALGO) {
        // Unknown algo: never inflate bytes we can't decode.
        return false;
      }
      inflater = new Inflate();
      options.onAck?.();
      return true;
    },
    handleBinary(data) {
      if (inflater === null) return null;
      if (failed) return [];
      const chunks: Uint8Array[] = [];
      // fflate's ondata chunks are views into the inflater's 32 KiB sliding
      // window, which later pushes overwrite — copy before handing off, since
      // the caller may defer writes to the next animation frame.
      inflater.ondata = (chunk) => chunks.push(chunk.slice());
      try {
        // Synchronous push: ondata fires inline, so output order across
        // messages is preserved without a queue. Invalid data throws.
        inflater.push(new Uint8Array(data));
      } catch (error) {
        failed = true;
        options.onError?.(error);
        return [];
      }
      return chunks;
    },
  };
}
