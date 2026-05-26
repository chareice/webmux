import { describe, expect, it } from "vitest";

import { stripAnsi, TerminalTailBuffer } from "./terminalTailBuffer";

const enc = (s: string) => new TextEncoder().encode(s);

describe("stripAnsi", () => {
  it("strips CSI color sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
  });

  it("strips OSC title-bar updates", () => {
    expect(stripAnsi("\x1b]0;new title\x07rest")).toBe("rest");
  });

  it("strips cursor-positioning escapes", () => {
    expect(stripAnsi("a\x1b[2Jb\x1b[Hc")).toBe("abc");
  });

  it("strips CSI sequences with intermediate bytes and non-letter finals", () => {
    expect(stripAnsi("a\x1b[!pb\x1b[?2026;1$yc\x1b[200~d")).toBe(
      "abcd",
    );
  });

  it("strips bare DEC private modes", () => {
    expect(stripAnsi("\x1b[?1003hhello\x1b[?1003l")).toBe("hello");
  });

  it("preserves newlines and tabs", () => {
    expect(stripAnsi("a\n\tb")).toBe("a\n\tb");
  });

  it("drops other control bytes", () => {
    expect(stripAnsi("a\x07b\x00c")).toBe("abc");
  });
});

describe("TerminalTailBuffer", () => {
  it("returns the most recent N non-blank lines", () => {
    const tail = new TerminalTailBuffer({ maxLines: 3 });
    tail.append(enc("first\nsecond\nthird\nfourth\nfifth\n"));
    expect(tail.snapshot()).toEqual(["third", "fourth", "fifth"]);
  });

  it("preserves blank lines in the middle of the kept window", () => {
    const tail = new TerminalTailBuffer({ maxLines: 4 });
    tail.append(enc("a\nb\n\nd\ne\n"));
    expect(tail.snapshot()).toEqual(["b", "", "d", "e"]);
  });

  it("ignores trailing blank lines so the tail stays informative", () => {
    const tail = new TerminalTailBuffer({ maxLines: 3 });
    tail.append(enc("alpha\nbeta\ngamma\n\n\n\n"));
    expect(tail.snapshot()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("strips ANSI from incoming chunks", () => {
    const tail = new TerminalTailBuffer({ maxLines: 2 });
    tail.append(enc("\x1b[32m$ ls\x1b[0m\nfile-a  file-b\n"));
    expect(tail.snapshot()).toEqual(["$ ls", "file-a  file-b"]);
  });

  it("truncates over-wide lines so a giant single line doesn't dominate", () => {
    const tail = new TerminalTailBuffer({ maxLines: 1, maxLineWidth: 10 });
    tail.append(enc("0123456789abcdef\n"));
    expect(tail.snapshot()).toEqual(["012345678…"]);
  });

  it("normalises CRLF to LF", () => {
    const tail = new TerminalTailBuffer({ maxLines: 2 });
    tail.append(enc("a\r\nb\r\n"));
    expect(tail.snapshot()).toEqual(["a", "b"]);
  });

  it("returns an empty array when nothing has been written", () => {
    const tail = new TerminalTailBuffer({ maxLines: 4 });
    expect(tail.snapshot()).toEqual([]);
  });

  it("survives multi-chunk UTF-8 sequences without corruption", () => {
    // "你好" in UTF-8 is E4 BD A0 E5 A5 BD. Split mid-codepoint.
    const tail = new TerminalTailBuffer({ maxLines: 1 });
    tail.append(new Uint8Array([0xe4, 0xbd]));
    tail.append(new Uint8Array([0xa0, 0xe5, 0xa5, 0xbd, 0x0a]));
    expect(tail.snapshot()).toEqual(["你好"]);
  });

  it("holds split ANSI control sequences instead of leaking fragments", () => {
    const tail = new TerminalTailBuffer({ maxLines: 1 });
    tail.append(enc("\x1b["));
    tail.append(enc("?2026;1$yready\n"));
    expect(tail.snapshot()).toEqual(["ready"]);
  });

  it("holds split OSC sequences instead of leaking title text", () => {
    const tail = new TerminalTailBuffer({ maxLines: 1 });
    tail.append(enc("\x1b]0;"));
    tail.append(enc("temporary title\x07prompt\n"));
    expect(tail.snapshot()).toEqual(["prompt"]);
  });
});
