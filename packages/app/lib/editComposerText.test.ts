import { describe, expect, it } from "vitest";
import { editComposerText } from "./editComposerText";

describe("local toolbar editing", () => {
  it("replaces the selected range for symbols and Tab", () => {
    expect(editComposerText("before after", 7, 12, "/")).toEqual({ text: "before /", caret: 8 });
    expect(editComposerText("ab", 1, 1, "\t")).toEqual({ text: "a\tb", caret: 2 });
  });
  it("moves across whole emoji graphemes and collapses selections", () => {
    const emoji = "👩‍💻";
    expect(editComposerText(`a${emoji}b`, 1, 1, "\x1b[C")?.caret).toBe(1 + emoji.length);
    expect(editComposerText(`a${emoji}b`, 1 + emoji.length, 1 + emoji.length, "\x1b[D")?.caret).toBe(1);
    expect(editComposerText("abcd", 1, 3, "\x1b[C")?.caret).toBe(3);
  });
  it("handles the empty first line and clamps vertical movement to line length", () => {
    expect(editComposerText("\na", 2, 2, "\x1b[A")?.caret).toBe(0);
    expect(editComposerText("long\nx", 3, 3, "\x1b[B")?.caret).toBe(6);
    expect(editComposerText("\na", 0, 0, "\x1b[B")?.caret).toBe(1);
  });
  it("does not insert terminal control bytes or exceed the draft limit", () => {
    expect(editComposerText("draft", 0, 0, "\x03")).toBeNull();
    expect(editComposerText("draft", 0, 0, "\r")).toBeNull();
    expect(editComposerText("x".repeat(65536), 0, 0, "/")).toBeNull();
  });
});
