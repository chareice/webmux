import { describe, expect, it } from "vitest";

import { baseUrlFor, codeFromLink, hubIsReady, portOf, tokenFromLink } from "./desktopHub";

describe("the sign-in link", () => {
  it("gives up its token", () => {
    expect(tokenFromLink("http://192.168.1.10:4317/?token=abc.def")).toBe("abc.def");
  });

  it("is null without one, and on junk", () => {
    expect(tokenFromLink("http://192.168.1.10:4317/")).toBeNull();
    expect(tokenFromLink(null)).toBeNull();
    expect(tokenFromLink("not a link")).toBeNull();
  });

  it("carries a code in its short form", () => {
    expect(codeFromLink("http://192.168.1.10:4317/?code=EQRFN4H9")).toBe("EQRFN4H9");
    expect(codeFromLink("http://192.168.1.10:4317/?token=x")).toBeNull();
  });
});

describe("the hub's port", () => {
  it("is read off the address, 4317 when unstated", () => {
    expect(portOf("http://192.168.1.10:4317")).toBe("4317");
    expect(portOf("http://192.168.1.10:8080")).toBe("8080");
    expect(portOf("http://hub.local")).toBe("4317");
    expect(portOf("")).toBe("4317");
  });

  it("makes a base URL from a picked address", () => {
    expect(baseUrlFor("10.0.0.5", "4317")).toBe("http://10.0.0.5:4317");
  });
});

describe("a ready hub", () => {
  it("has both services and answers", () => {
    const status = { supported: true, bundled: true, hub_installed: true, node_installed: true, listening: true };
    expect(hubIsReady(status)).toBe(true);
    expect(hubIsReady({ ...status, listening: false })).toBe(false);
    expect(hubIsReady({ ...status, node_installed: false })).toBe(false);
  });
});
