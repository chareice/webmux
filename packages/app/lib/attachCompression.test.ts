import { describe, expect, it } from "vitest";
import { Deflate } from "fflate";

import {
  createDeflateRawV1Session,
  DEFLATE_RAW_V1_ALGO,
} from "@/lib/attachCompression";

/** Compress messages as one context-takeover raw-deflate stream. */
function compressStream(messages: Uint8Array[]): Uint8Array {
  const compressed: Uint8Array[] = [];
  const deflator = new Deflate((chunk) => compressed.push(chunk));
  for (const message of messages) deflator.push(message);
  deflator.push(new Uint8Array(0), true);
  const total = compressed.reduce((sum, chunk) => sum + chunk.length, 0);
  const wire = new Uint8Array(total);
  let offset = 0;
  for (const chunk of compressed) {
    wire.set(chunk, offset);
    offset += chunk.length;
  }
  return wire;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const MESSAGES = [
  new TextEncoder().encode("\x1b[38;5;246mdrwxr-xr-x 2 user user dir\x1b[0m\r\n"),
  new TextEncoder().encode("\x1b[2K\rbuilding crate webmux ... 128/256\r\n"),
  new TextEncoder().encode("\x1b[38;5;246mdrwxr-xr-x 2 user user dir\x1b[0m\r\n"),
];

describe("createDeflateRawV1Session", () => {
  it("passes binary frames through as raw bytes before the ack", () => {
    const session = createDeflateRawV1Session({});
    expect(session.active).toBe(false);
    expect(session.handleBinary(toArrayBuffer(MESSAGES[0]))).toBeNull();
  });

  it("ignores unrelated text frames and unknown algos", () => {
    const session = createDeflateRawV1Session({});
    expect(session.handleText(JSON.stringify({ type: "error", message: "x" }))).toBe(false);
    expect(session.handleText("not json")).toBe(false);
    expect(
      session.handleText(
        JSON.stringify({ type: "compression_enabled", algo: "gzip" }),
      ),
    ).toBe(false);
    expect(session.active).toBe(false);
  });

  it("inflates the stream after the ack, across splits and merges", () => {
    let acked = 0;
    const session = createDeflateRawV1Session({ onAck: () => (acked += 1) });
    expect(
      session.handleText(
        JSON.stringify({ type: "compression_enabled", algo: DEFLATE_RAW_V1_ALGO }),
      ),
    ).toBe(true);
    expect(acked).toBe(1);
    expect(session.active).toBe(true);

    const wire = compressStream(MESSAGES);
    const inflated: number[] = [];
    // Feed the stream in awkward slices: 3 bytes, then 17, then the rest —
    // the inflater must tolerate boundaries unrelated to message framing.
    for (const [start, end] of [
      [0, 3],
      [3, 20],
      [20, wire.length],
    ]) {
      const chunks = session.handleBinary(toArrayBuffer(wire.slice(start, end)));
      expect(chunks).not.toBeNull();
      for (const chunk of chunks ?? []) inflated.push(...chunk);
    }
    const expected = Uint8Array.from(MESSAGES.flatMap((m) => [...m]));
    expect(Uint8Array.from(inflated)).toEqual(expected);
  });

  it("reports an inflate error once and then swallows frames", () => {
    const errors: unknown[] = [];
    const session = createDeflateRawV1Session({
      onError: (error) => errors.push(error),
    });
    session.handleText(
      JSON.stringify({ type: "compression_enabled", algo: DEFLATE_RAW_V1_ALGO }),
    );
    // 0xff.. is not a valid deflate block header; fflate's push throws. The
    // failing frame is swallowed (empty array), not returned as null — the
    // caller would otherwise push its compressed bytes to the terminal.
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(session.handleBinary(toArrayBuffer(garbage))).toEqual([]);
    expect(errors.length).toBe(1);
    expect(session.active).toBe(false);
    // Frames still arriving before the socket close lands are swallowed too,
    // without reporting again.
    expect(session.handleBinary(toArrayBuffer(MESSAGES[0]))).toEqual([]);
    expect(errors.length).toBe(1);
  });
});
