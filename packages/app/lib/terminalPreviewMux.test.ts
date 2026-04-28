import { describe, expect, it } from "vitest";

import {
  createTerminalPreviewSubscriptionRegistry,
  decodeTerminalPreviewFrame,
  encodeTerminalPreviewFrameForTest,
} from "./terminalPreviewMux";

describe("terminal preview mux frames", () => {
  it("decodes terminal id and terminal bytes from a binary frame", () => {
    const payload = new Uint8Array([0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x00, 0xff]);
    const frame = encodeTerminalPreviewFrameForTest("terminal-x", payload);

    const decoded = decodeTerminalPreviewFrame(frame);

    expect(decoded.terminalId).toBe("terminal-x");
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
  });

  it("rejects non-preview binary frames", () => {
    const frame = new Uint8Array([0x01, 0x00, 0x01, 0x61]);

    expect(() => decodeTerminalPreviewFrame(frame)).toThrow(
      /preview frame magic/i,
    );
  });
});

describe("terminal preview subscription registry", () => {
  it("shares one upstream subscription across multiple local subscribers", () => {
    const sentMessages: unknown[] = [];
    const registry = createTerminalPreviewSubscriptionRegistry((message) => {
      sentMessages.push(message);
    });
    const firstChunks: number[][] = [];
    const secondChunks: number[][] = [];
    const subscription = {
      machineId: "machine-1",
      terminalId: "terminal-1",
      cols: 120,
      rows: 40,
    };

    const unsubscribeFirst = registry.subscribe(subscription, (chunk) => {
      firstChunks.push(Array.from(chunk));
    });
    const unsubscribeSecond = registry.subscribe(subscription, (chunk) => {
      secondChunks.push(Array.from(chunk));
    });
    expect(registry.subscriptionCount()).toBe(1);

    expect(sentMessages).toEqual([
      {
        type: "subscribe",
        machine_id: "machine-1",
        terminal_id: "terminal-1",
        cols: 120,
        rows: 40,
      },
    ]);

    registry.dispatchFrame({
      terminalId: "terminal-1",
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(firstChunks).toEqual([[1, 2, 3]]);
    expect(secondChunks).toEqual([[1, 2, 3]]);

    unsubscribeFirst();
    expect(sentMessages).toHaveLength(1);
    expect(registry.subscriptionCount()).toBe(1);

    unsubscribeSecond();
    expect(registry.subscriptionCount()).toBe(0);
    expect(sentMessages).toEqual([
      {
        type: "subscribe",
        machine_id: "machine-1",
        terminal_id: "terminal-1",
        cols: 120,
        rows: 40,
      },
      {
        type: "unsubscribe",
        terminal_id: "terminal-1",
      },
    ]);
  });
});
