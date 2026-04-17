import { describe, it, expect } from "vitest";
import { computeWorkpathTags } from "./workpathTag";

// Convenience: build {id, label} pairs where id == label, for tests where
// labels are unique and stand in as their own ids.
const fromLabels = (labels: string[]) =>
  labels.map((label) => ({ id: label, label }));

describe("computeWorkpathTags", () => {
  it("returns 2-char lowercase tag for a single label", () => {
    expect(computeWorkpathTags(fromLabels(["webmux"]))).toEqual({ webmux: "wm" });
  });

  it("preserves 2-char labels verbatim", () => {
    expect(computeWorkpathTags(fromLabels(["z1"]))).toEqual({ z1: "z1" });
  });

  it("collapses hyphens/dots when picking letters", () => {
    expect(computeWorkpathTags(fromLabels(["tag-tracing"]))).toEqual({
      "tag-tracing": "tt",
    });
    expect(computeWorkpathTags(fromLabels(["app.zalify.com"]))).toEqual({
      "app.zalify.com": "az",
    });
  });

  it("disambiguates colliding prefixes by extending to 3 chars", () => {
    const result = computeWorkpathTags(fromLabels(["webmux", "weblog"]));
    expect(result.webmux).not.toEqual(result.weblog);
    expect(result.webmux).toMatch(/^w[a-z0-9]{1,2}$/);
    expect(result.weblog).toMatch(/^w[a-z0-9]{1,2}$/);
  });

  it("falls back to index-suffixed tag when still colliding", () => {
    // Three distinct labels whose 2-char and 3-char tags all collapse to
    // the same prefix, forcing the index-suffixed fallback for the third.
    const result = computeWorkpathTags(fromLabels(["abcx", "abcy", "abcz"]));
    const tags = Object.values(result);
    expect(new Set(tags).size).toBe(3);
  });

  it("is deterministic across calls", () => {
    const inputs = fromLabels([
      "webmux",
      "z1",
      "tag-tracing",
      "app.zalify.com",
    ]);
    expect(computeWorkpathTags(inputs)).toEqual(computeWorkpathTags(inputs));
  });

  it("handles single-char labels", () => {
    const result = computeWorkpathTags(fromLabels(["a"]));
    expect(result.a).toBe("a");
  });

  it("disambiguates two workpaths sharing a label by their distinct ids", () => {
    // Two bookmarks both labelled "src" but with different ids — each one
    // gets its own entry instead of one overwriting the other.
    const result = computeWorkpathTags([
      { id: "bm-1", label: "src" },
      { id: "bm-2", label: "src" },
    ]);
    expect(Object.keys(result).sort()).toEqual(["bm-1", "bm-2"]);
    expect(result["bm-1"]).not.toEqual(result["bm-2"]);
  });
});
