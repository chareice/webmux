import { describe, it, expect } from "vitest";
import {
  createInitialMainLayout,
  mainLayoutReducer,
} from "./mainLayoutReducer";

describe("mainLayoutReducer", () => {
  const initial = createInitialMainLayout();

  it("starts with All selected and no zoomed terminal", () => {
    expect(initial.selectedWorkpathId).toBe("all");
    expect(initial.zoomedTerminalId).toBeNull();
    expect(initial.columnForceExpanded).toBe(false);
  });

  it("SELECT_WORKPATH sets workpath and clears zoom", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "SELECT_WORKPATH", workpathId: "wp-webmux" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("ZOOM_TERMINAL sets zoomed terminal without touching workpath", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "ZOOM_TERMINAL", terminalId: "t1" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
    expect(next.zoomedTerminalId).toBe("t1");
  });

  it("UNZOOM clears zoomed terminal", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "UNZOOM" },
    );
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("TERMINAL_CREATED selects workpath and zooms to new terminal", () => {
    const next = mainLayoutReducer(initial, {
      type: "TERMINAL_CREATED",
      terminalId: "t-new",
      workpathId: "wp-z1",
    });
    expect(next.selectedWorkpathId).toBe("wp-z1");
    expect(next.zoomedTerminalId).toBe("t-new");
  });

  it("TERMINAL_DESTROYED clears zoom if it was the zoomed one", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "TERMINAL_DESTROYED", terminalId: "t1" },
    );
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("TERMINAL_DESTROYED leaves zoom alone if a different terminal was closed", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "TERMINAL_DESTROYED", terminalId: "t2" },
    );
    expect(next.zoomedTerminalId).toBe("t1");
  });

  it("WORKPATH_DELETED falls back to All if the deleted one was selected", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "WORKPATH_DELETED", workpathId: "wp-webmux" },
    );
    expect(next.selectedWorkpathId).toBe("all");
  });

  it("WORKPATH_DELETED leaves selection alone if a different workpath was deleted", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "WORKPATH_DELETED", workpathId: "wp-z1" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
  });

  it("TOGGLE_NAV_FORCE_EXPANDED flips the flag", () => {
    const once = mainLayoutReducer(initial, { type: "TOGGLE_NAV_FORCE_EXPANDED" });
    expect(once.columnForceExpanded).toBe(true);
    const twice = mainLayoutReducer(once, { type: "TOGGLE_NAV_FORCE_EXPANDED" });
    expect(twice.columnForceExpanded).toBe(false);
  });
});
