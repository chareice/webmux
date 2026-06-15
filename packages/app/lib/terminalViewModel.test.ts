import { describe, expect, it } from "vitest";

import {
  getTerminalFitResizeDecision,
} from "./terminalViewModel";

describe("getTerminalFitResizeDecision", () => {
  it("suppresses only the remote resize frame when auto-fit dimensions are unchanged", () => {
    expect(
      getTerminalFitResizeDecision({
        currentCols: 52,
        currentRows: 27,
        nextCols: 52,
        nextRows: 27,
        skipIfUnchanged: true,
      }),
    ).toEqual({
      sendResizeFrame: false,
      refreshLocalSurface: true,
    });
  });
});
