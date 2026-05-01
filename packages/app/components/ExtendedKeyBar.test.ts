import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExtendedKeyBar } from "./ExtendedKeyBar";

const baseProps = {
  onKey: () => {},
  onToggleKeyboard: () => {},
  keyboardVisible: false,
  isController: true,
};

describe("ExtendedKeyBar", () => {
  it("renders ^C as a pinned button so it can't scroll out of view", () => {
    const html = renderToStaticMarkup(createElement(ExtendedKeyBar, baseProps));
    expect(html).toContain('data-testid="extended-keybar-ctrl-c"');
    expect(html).toContain("^C");
  });

  it("hides the attach button when onAttachFile is not provided", () => {
    const html = renderToStaticMarkup(createElement(ExtendedKeyBar, baseProps));
    expect(html).not.toContain('data-testid="extended-keybar-attach"');
    expect(html).not.toContain('data-testid="extended-keybar-file-input"');
  });

  it("renders an attach button + image-only file input when onAttachFile is provided", () => {
    const html = renderToStaticMarkup(
      createElement(ExtendedKeyBar, {
        ...baseProps,
        onAttachFile: () => {},
      }),
    );
    expect(html).toContain('data-testid="extended-keybar-attach"');
    expect(html).toContain('data-testid="extended-keybar-file-input"');
    expect(html).toContain('accept="image/*"');
  });

  it("disables key buttons when not in control", () => {
    const html = renderToStaticMarkup(
      createElement(ExtendedKeyBar, { ...baseProps, isController: false }),
    );
    // Pinned ^C still renders but is disabled.
    expect(html).toContain('data-testid="extended-keybar-ctrl-c"');
    // The keyboard toggle is hidden entirely when not in control.
    expect(html).not.toContain('aria-label="Show keyboard"');
    expect(html).not.toContain('aria-label="Hide keyboard"');
  });
});
