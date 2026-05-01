import { describe, expect, it } from "vitest";

import {
  buildImagePasteMessage,
  readFileAsBase64,
  safeFilename,
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
