import { describe, it, expect, beforeEach, vi } from "vitest";
import { readPanelOpen, writePanelOpen, PANEL_OPEN_KEY } from "./panelOpenStorage";
describe("panelOpenStorage", () => {
    let store;
    beforeEach(() => {
        store = {};
        vi.stubGlobal("localStorage", {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
            removeItem: (k) => { delete store[k]; },
        });
    });
    it("returns the default when nothing is stored", () => {
        expect(readPanelOpen(true)).toBe(true);
        expect(readPanelOpen(false)).toBe(false);
    });
    it("returns the stored value when present", () => {
        store[PANEL_OPEN_KEY] = "false";
        expect(readPanelOpen(true)).toBe(false);
        store[PANEL_OPEN_KEY] = "true";
        expect(readPanelOpen(false)).toBe(true);
    });
    it("returns the default when the stored value is malformed", () => {
        store[PANEL_OPEN_KEY] = "garbage";
        expect(readPanelOpen(true)).toBe(true);
    });
    it("writePanelOpen persists the value", () => {
        writePanelOpen(false);
        expect(store[PANEL_OPEN_KEY]).toBe("false");
        writePanelOpen(true);
        expect(store[PANEL_OPEN_KEY]).toBe("true");
    });
    it("returns the default when localStorage throws", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => { throw new Error("disabled"); },
            setItem: () => { },
            removeItem: () => { },
        });
        expect(readPanelOpen(true)).toBe(true);
    });
});
