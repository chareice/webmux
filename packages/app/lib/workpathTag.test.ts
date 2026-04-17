import { describe, it, expect } from "vitest";
import { computeWorkpathTags } from "./workpathTag";

describe("computeWorkpathTags", () => {
  it("returns 2-char lowercase tag for a single label", () => {
    expect(computeWorkpathTags(["webmux"])).toEqual({ webmux: "wm" });
  });

  it("preserves 2-char labels verbatim", () => {
    expect(computeWorkpathTags(["z1"])).toEqual({ z1: "z1" });
  });

  it("collapses hyphens/dots when picking letters", () => {
    expect(computeWorkpathTags(["tag-tracing"])).toEqual({ "tag-tracing": "tt" });
    expect(computeWorkpathTags(["app.zalify.com"])).toEqual({ "app.zalify.com": "az" });
  });

  it("disambiguates colliding prefixes by extending to 3 chars", () => {
    const result = computeWorkpathTags(["webmux", "weblog"]);
    expect(result.webmux).not.toEqual(result.weblog);
    expect(result.webmux).toMatch(/^w[a-z0-9]{1,2}$/);
    expect(result.weblog).toMatch(/^w[a-z0-9]{1,2}$/);
  });

  it("falls back to index-suffixed tag when still colliding", () => {
    // Three distinct labels whose 2-char and 3-char tags all collapse to
    // the same prefix, forcing the index-suffixed fallback for the third.
    const result = computeWorkpathTags(["abcx", "abcy", "abcz"]);
    const tags = Object.values(result);
    expect(new Set(tags).size).toBe(3);
  });

  it("is deterministic across calls", () => {
    const labels = ["webmux", "z1", "tag-tracing", "app.zalify.com"];
    expect(computeWorkpathTags(labels)).toEqual(computeWorkpathTags(labels));
  });

  it("handles single-char labels by padding with next char of nothing", () => {
    const result = computeWorkpathTags(["a"]);
    expect(result.a).toBe("a");
  });
});
