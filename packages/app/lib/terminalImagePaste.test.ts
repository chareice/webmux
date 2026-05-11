import { describe, expect, it } from "vitest";

import {
  buildImagePasteMessage,
  readFileAsBase64,
  safeFilename,
  waitForWsOpen,
} from "./terminalImagePaste";

describe("safeFilename", () => {
  it("keeps a plain basename intact", () => {
    expect(safeFilename("photo.png")).toBe("photo.png");
  });

  it("strips path segments", () => {
    expect(safeFilename("/etc/passwd")).toBe("passwd");
    expect(safeFilename("a/b/c\\d.jpg")).toBe("d.jpg");
  });

  it("removes leading dots so dotfiles don't slip in", () => {
    expect(safeFilename("..secret")).toBe("secret");
  });

  it("strips control bytes", () => {
    expect(safeFilename("a\x00b\x07c.txt")).toBe("abc.txt");
  });

  it("falls back to a synthetic name when stripping leaves nothing", () => {
    const out = safeFilename("", ".png");
    expect(out.startsWith("tc-paste-")).toBe(true);
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("buildImagePasteMessage", () => {
  it("packs into the wire shape the hub expects", () => {
    expect(buildImagePasteMessage("Zm9v", "image/png", "x.png")).toEqual({
      type: "image_paste",
      data: "Zm9v",
      mime: "image/png",
      filename: "x.png",
    });
  });
});

describe("waitForWsOpen", () => {
  const OPEN = WebSocket.OPEN;
  const CLOSED = WebSocket.CLOSED;

  function fakeClock(start = 0) {
    let t = start;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("returns immediately when the socket is already OPEN", async () => {
    const ws = { readyState: OPEN } as unknown as WebSocket;
    const got = await waitForWsOpen(() => ws, 1000);
    expect(got).toBe(ws);
  });

  it("returns the new socket once reconnect lands", async () => {
    const closed = { readyState: CLOSED } as unknown as WebSocket;
    const opened = { readyState: OPEN } as unknown as WebSocket;
    let current: WebSocket = closed;
    const clock = fakeClock();
    let polls = 0;
    const got = await waitForWsOpen(
      () => current,
      5000,
      100,
      clock.now,
      async (ms) => {
        clock.advance(ms);
        polls++;
        if (polls === 3) current = opened;
      },
    );
    expect(got).toBe(opened);
  });

  it("returns null when the socket never re-opens before the deadline", async () => {
    const ws = { readyState: CLOSED } as unknown as WebSocket;
    const clock = fakeClock();
    const got = await waitForWsOpen(
      () => ws,
      300,
      100,
      clock.now,
      async (ms) => clock.advance(ms),
    );
    expect(got).toBeNull();
  });

  it("tolerates a missing socket reference while polling", async () => {
    let ws: WebSocket | null = null;
    const clock = fakeClock();
    let polls = 0;
    const opened = { readyState: OPEN } as unknown as WebSocket;
    const got = await waitForWsOpen(
      () => ws,
      5000,
      100,
      clock.now,
      async (ms) => {
        clock.advance(ms);
        polls++;
        if (polls === 2) ws = opened;
      },
    );
    expect(got).toBe(opened);
  });
});

describe("readFileAsBase64", () => {
  it("returns the base64 payload without the data URL prefix", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const { base64, mime } = await readFileAsBase64(blob);
    expect(mime).toBe("image/png");
    // Decode and confirm round-trip.
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual([1, 2, 3]);
  });

  it("falls back to application/octet-stream when blob has no mime", async () => {
    const blob = new Blob([new Uint8Array([0])]);
    const { mime } = await readFileAsBase64(blob);
    expect(mime).toBe("application/octet-stream");
  });
});
