import { describe, expect, it } from "vitest";

import { ctrlLatchTransform } from "./ctrlLatch";

describe("ctrlLatchTransform", () => {
  it("maps lowercase letters to their control byte", () => {
    expect(ctrlLatchTransform("c")).toBe("\x03");
    expect(ctrlLatchTransform("d")).toBe("\x04");
    expect(ctrlLatchTransform("z")).toBe("\x1a");
    expect(ctrlLatchTransform("l")).toBe("\x0c");
    expect(ctrlLatchTransform("a")).toBe("\x01");
    expect(ctrlLatchTransform("e")).toBe("\x05");
    expect(ctrlLatchTransform("r")).toBe("\x12");
    expect(ctrlLatchTransform("w")).toBe("\x17");
  });

  it("maps uppercase letters the same as lowercase", () => {
    expect(ctrlLatchTransform("C")).toBe("\x03");
    expect(ctrlLatchTransform("D")).toBe("\x04");
  });

  it("maps the classic Ctrl punctuation set", () => {
    expect(ctrlLatchTransform("@")).toBe("\x00");
    expect(ctrlLatchTransform("[")).toBe("\x1b");
    expect(ctrlLatchTransform("\\")).toBe("\x1c");
    expect(ctrlLatchTransform("]")).toBe("\x1d");
    expect(ctrlLatchTransform("^")).toBe("\x1e");
    expect(ctrlLatchTransform("_")).toBe("\x1f");
  });

  it("returns null for keys that must send as-is", () => {
    expect(ctrlLatchTransform("/")).toBeNull();
    expect(ctrlLatchTransform("1")).toBeNull();
    expect(ctrlLatchTransform(" ")).toBeNull();
    expect(ctrlLatchTransform("\t")).toBeNull();
    expect(ctrlLatchTransform("\x1b")).toBeNull();
    expect(ctrlLatchTransform("|")).toBeNull();
    expect(ctrlLatchTransform("-")).toBeNull();
    expect(ctrlLatchTransform("~")).toBeNull();
  });

  it("returns null for multi-character input (escape sequences, IME commits)", () => {
    expect(ctrlLatchTransform("\x1b[A")).toBeNull();
    expect(ctrlLatchTransform("ab")).toBeNull();
    expect(ctrlLatchTransform("")).toBeNull();
  });
});
