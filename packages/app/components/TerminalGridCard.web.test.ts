import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TerminalGridCard } from "./TerminalGridCard.web";

describe("TerminalGridCard", () => {
  it("shows a paused preview placeholder for reachable terminals", () => {
    const html = renderToStaticMarkup(
      createElement(TerminalGridCard, {
        terminal: {
          id: "term-1",
          machine_id: "machine-1",
          title: "Webmux",
          cwd: "/home/chareice/projects/webmux",
          cols: 120,
          rows: 40,
          reachable: true,
        },
        isController: true,
        onExpand: () => {},
        onDestroy: () => {},
      }),
    );

    expect(html).toContain("Live preview paused");
  });
});
