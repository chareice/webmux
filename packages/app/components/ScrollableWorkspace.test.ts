import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScrollableWorkspace } from "./ScrollableWorkspace";

const noop = () => {};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    columns: [] as { terminalId: string; width: { kind: "preset"; value: "half" | "two_thirds" | "full" } | { kind: "fraction"; value: number } }[],
    terminalsById: new Map(),
    activeTerminalId: null,
    isController: true,
    deviceId: "d1",
    isMobile: false,
    fitRequest: null,
    onActiveRef: noop,
    onFitRequestHandled: noop,
    onFocus: noop,
    onDestroy: noop,
    onResizeColumn: noop,
    onReorderColumns: noop,
    ...overrides,
  };
}

describe("ScrollableWorkspace", () => {
  it("renders one column per scrollable layout entry", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollableWorkspace, makeProps({
        columns: [
          { terminalId: "a", width: { kind: "preset", value: "half" } },
          { terminalId: "b", width: { kind: "preset", value: "full" } },
        ],
      })),
    );
    const matches = html.match(/data-testid="scrollable-column"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("renders resize handles between columns on desktop", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollableWorkspace, makeProps({
        isMobile: false,
        columns: [
          { terminalId: "a", width: { kind: "preset", value: "half" } },
          { terminalId: "b", width: { kind: "preset", value: "half" } },
          { terminalId: "c", width: { kind: "preset", value: "half" } },
        ],
      })),
    );
    const matches = html.match(/data-testid="column-resize-handle"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("does not render resize handles on mobile", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollableWorkspace, makeProps({
        isMobile: true,
        columns: [
          { terminalId: "a", width: { kind: "preset", value: "half" } },
          { terminalId: "b", width: { kind: "preset", value: "half" } },
        ],
      })),
    );
    expect(html).not.toContain('data-testid="column-resize-handle"');
  });
});
