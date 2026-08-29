import { describe, expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";

import { readXtermCellMetrics } from "./terminalXtermMetrics";

function fakeTerm(partial: {
  dimensions?: { css?: { cell?: { width: number; height: number } } };
  _core?: {
    _renderService?: {
      dimensions?: { css?: { cell?: { width: number; height: number } } };
    };
  };
}): Terminal {
  return partial as unknown as Terminal;
}

describe("readXtermCellMetrics", () => {
  it("prefers the public 6.1 dimensions API", () => {
    expect(
      readXtermCellMetrics(
        fakeTerm({
          dimensions: { css: { cell: { width: 8.4, height: 17 } } },
          _core: {
            _renderService: {
              dimensions: { css: { cell: { width: 1, height: 1 } } },
            },
          },
        }),
      ),
    ).toEqual({ width: 8.4, height: 17 });
  });

  it("falls back to the private renderer path", () => {
    expect(
      readXtermCellMetrics(
        fakeTerm({
          _core: {
            _renderService: {
              dimensions: { css: { cell: { width: 7.1, height: 16 } } },
            },
          },
        }),
      ),
    ).toEqual({ width: 7.1, height: 16 });
  });

  it("returns null when neither path has a positive cell size", () => {
    expect(readXtermCellMetrics(fakeTerm({}))).toBeNull();
    expect(
      readXtermCellMetrics(
        fakeTerm({
          dimensions: { css: { cell: { width: 0, height: 17 } } },
        }),
      ),
    ).toBeNull();
  });
});
