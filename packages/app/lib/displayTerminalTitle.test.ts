import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "@webmux/shared";

import { displayTerminalTitle } from "./displayTerminalTitle";

function terminal(title?: string): TerminalInfo {
  return {
    id: "01234567-89ab-cdef-0123-456789abcdef",
    machine_id: "machine-1",
    title: title as string,
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    reachable: true,
  };
}

describe("displayTerminalTitle", () => {
  it("returns a meaningful terminal title", () => {
    expect(displayTerminalTitle(terminal("my-task"))).toBe("my-task");
  });

  it("falls back to shell for an empty or missing title", () => {
    expect(displayTerminalTitle(terminal(""))).toBe("shell");
    expect(displayTerminalTitle(terminal("   "))).toBe("shell");
    expect(displayTerminalTitle(terminal())).toBe("shell");
  });

  it("hides legacy generated terminal ids", () => {
    expect(displayTerminalTitle(terminal("Terminal deadbeef"))).toBe("shell");
  });
});
