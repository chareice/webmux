import { describe, it, expect } from "vitest";
import {
  parseAttachFrame,
  appendResumeSeq,
  initialSeqAfterAttach,
} from "./terminalResume";

describe("parseAttachFrame", () => {
  it("parses a full attach", () => {
    const frame = parseAttachFrame(
      JSON.stringify({ type: "attach", seq: 1234, mode: "full", replay_bytes: 1000 }),
    );
    expect(frame).toEqual({ seq: 1234, mode: "full", replayBytes: 1000 });
  });

  it("parses a delta attach", () => {
    const frame = parseAttachFrame(
      JSON.stringify({ type: "attach", seq: 50, mode: "delta", replay_bytes: 10 }),
    );
    expect(frame).toEqual({ seq: 50, mode: "delta", replayBytes: 10 });
  });

  it("parses a reset attach", () => {
    const frame = parseAttachFrame(
      JSON.stringify({ type: "attach", seq: 99999, mode: "reset", replay_bytes: 65536 }),
    );
    expect(frame).toEqual({ seq: 99999, mode: "reset", replayBytes: 65536 });
  });

  it("returns null on an error frame", () => {
    const frame = parseAttachFrame(
      JSON.stringify({ type: "error", message: "nope" }),
    );
    expect(frame).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseAttachFrame("{not json")).toBeNull();
  });

  it("returns null on missing fields", () => {
    expect(
      parseAttachFrame(JSON.stringify({ type: "attach", seq: 1 })),
    ).toBeNull();
  });

  it("returns null on unknown mode", () => {
    expect(
      parseAttachFrame(
        JSON.stringify({ type: "attach", seq: 1, mode: "wat", replay_bytes: 0 }),
      ),
    ).toBeNull();
  });
});

describe("appendResumeSeq", () => {
  it("appends after_seq as the first query param", () => {
    expect(appendResumeSeq("ws://h/ws/t/m/t", 100)).toBe(
      "ws://h/ws/t/m/t?after_seq=100",
    );
  });

  it("appends after_seq as an additional query param", () => {
    expect(appendResumeSeq("ws://h/ws/t/m/t?device_id=d", 100)).toBe(
      "ws://h/ws/t/m/t?device_id=d&after_seq=100",
    );
  });

  it("returns the base URL unchanged when seq is zero", () => {
    expect(appendResumeSeq("ws://h/ws/t/m/t?device_id=d", 0)).toBe(
      "ws://h/ws/t/m/t?device_id=d",
    );
  });

  it("replaces an existing after_seq rather than duplicating", () => {
    expect(
      appendResumeSeq("ws://h/ws/t/m/t?device_id=d&after_seq=50", 100),
    ).toBe("ws://h/ws/t/m/t?device_id=d&after_seq=100");
  });
});

describe("initialSeqAfterAttach", () => {
  it("subtracts replay bytes from the hub's seq", () => {
    expect(
      initialSeqAfterAttach({ seq: 1000, mode: "full", replayBytes: 400 }),
    ).toBe(600);
  });

  it("returns seq when the client is caught up (empty delta)", () => {
    expect(
      initialSeqAfterAttach({ seq: 1000, mode: "delta", replayBytes: 0 }),
    ).toBe(1000);
  });

  it("handles reset mode same as full", () => {
    expect(
      initialSeqAfterAttach({ seq: 65536, mode: "reset", replayBytes: 65536 }),
    ).toBe(0);
  });
});
