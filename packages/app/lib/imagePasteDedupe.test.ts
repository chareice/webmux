import { describe, expect, it } from "vitest";

import { shouldSendClipboardImagePaste } from "./imagePasteDedupe";

describe("shouldSendClipboardImagePaste", () => {
  it("suppresses the same clipboard image inside the dedupe window", () => {
    const first = shouldSendClipboardImagePaste(
      null,
      { data: "abc", mime: "image/png" },
      1_000,
      2_000,
    );
    expect(first.send).toBe(true);

    const second = shouldSendClipboardImagePaste(
      first.recent,
      { data: "abc", mime: "image/png" },
      1_500,
      2_000,
    );
    expect(second.send).toBe(false);
    expect(second.recent).toBe(first.recent);
  });

  it("allows the same clipboard image after the dedupe window", () => {
    const first = shouldSendClipboardImagePaste(
      null,
      { data: "abc", mime: "image/png" },
      1_000,
      2_000,
    );

    const second = shouldSendClipboardImagePaste(
      first.recent,
      { data: "abc", mime: "image/png" },
      3_000,
      2_000,
    );
    expect(second.send).toBe(true);
  });

  it("allows different clipboard images inside the dedupe window", () => {
    const first = shouldSendClipboardImagePaste(
      null,
      { data: "abc", mime: "image/png" },
      1_000,
      2_000,
    );

    const second = shouldSendClipboardImagePaste(
      first.recent,
      { data: "def", mime: "image/png" },
      1_500,
      2_000,
    );
    expect(second.send).toBe(true);
  });
});
