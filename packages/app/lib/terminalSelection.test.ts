import { describe, expect, it } from "vitest";

import {
  mergeWrappedRows,
  trimTrailingBlankLines,
  type RawRow,
} from "./terminalSelection";

const row = (text: string, isWrapped = false): RawRow => ({ text, isWrapped });

describe("mergeWrappedRows", () => {
  it("returns plain rows untouched when nothing is wrapped", () => {
    expect(
      mergeWrappedRows([row("hello"), row("world"), row("")]),
    ).toEqual(["hello", "world", ""]);
  });

  it("joins a soft-wrapped continuation into the previous row", () => {
    expect(
      mergeWrappedRows([
        row("Work is done — PR #176 merged, container"),
        row(" deployed, service responding, memories", true),
        row(" saved. Nothing left to poll. Ending the", true),
        row(" loop.", true),
      ]),
    ).toEqual([
      "Work is done — PR #176 merged, container deployed, service responding, memories saved. Nothing left to poll. Ending the loop.",
    ]);
  });

  it("keeps real newlines between non-wrapped rows", () => {
    expect(
      mergeWrappedRows([
        row("$ ls"),
        row("file-a"),
        row("file-with-a-name-that-wrapped-onto-two-rows"),
        row("-and-here-is-the-rest", true),
        row("$"),
      ]),
    ).toEqual([
      "$ ls",
      "file-a",
      "file-with-a-name-that-wrapped-onto-two-rows-and-here-is-the-rest",
      "$",
    ]);
  });

  it("does not crash when the first row is marked wrapped", () => {
    // Defensive: terminals shouldn't emit this, but if isWrapped is true on
    // row 0 (e.g. viewport starts mid-wrap), treat it as a fresh logical
    // line rather than blowing up.
    expect(mergeWrappedRows([row("orphan continuation", true)])).toEqual([
      "orphan continuation",
    ]);
  });
});

describe("trimTrailingBlankLines", () => {
  it("removes empty trailing rows", () => {
    expect(trimTrailingBlankLines(["a", "b", "", ""])).toEqual(["a", "b"]);
  });

  it("removes trailing whitespace-only rows", () => {
    expect(trimTrailingBlankLines(["a", "   ", ""])).toEqual(["a"]);
  });

  it("keeps blanks in the middle", () => {
    expect(trimTrailingBlankLines(["a", "", "b"])).toEqual(["a", "", "b"]);
  });
});
