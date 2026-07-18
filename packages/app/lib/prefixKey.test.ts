import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFIX_BINDINGS,
  PREFIX_ACTION_DEFINITIONS,
  PREFIX_BINDINGS_STORAGE_KEY,
  createPrefixEngine,
  formatPrefixBinding,
  getPrefixBindingConflict,
  loadPrefixBindings,
  normalizePrefixKey,
  resetPrefixBindings,
  savePrefixBinding,
  type PrefixBindings,
  type PrefixKeyEventLike,
} from "./prefixKey";

function key(input: Partial<PrefixKeyEventLike> & { key: string }): PrefixKeyEventLike {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...input,
  };
}

function ctrlB(): PrefixKeyEventLike {
  return key({ key: "b", ctrlKey: true });
}

function storageWith(value: unknown): Storage {
  const values = new Map<string, string>();
  if (value !== undefined) {
    values.set(PREFIX_BINDINGS_STORAGE_KEY, JSON.stringify(value));
  }
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, next) => values.set(name, next),
    removeItem: (name) => values.delete(name),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("prefix engine arming", () => {
  it("arms on Ctrl+B and swallows it", () => {
    const engine = createPrefixEngine();
    expect(engine.handleKeydown(ctrlB())).toEqual({ type: "arm" });
    expect(engine.isArmed()).toBe(true);
  });

  it("does not arm on Ctrl+Shift+B, Ctrl+Alt+B or Cmd+B", () => {
    const engine = createPrefixEngine();
    expect(
      engine.handleKeydown(key({ key: "B", ctrlKey: true, shiftKey: true })),
    ).toEqual({ type: "pass" });
    expect(
      engine.handleKeydown(key({ key: "b", ctrlKey: true, altKey: true })),
    ).toEqual({ type: "pass" });
    expect(
      engine.handleKeydown(key({ key: "b", metaKey: true })),
    ).toEqual({ type: "pass" });
    expect(engine.isArmed()).toBe(false);
  });

  it("passes keys through when not armed", () => {
    const engine = createPrefixEngine();
    expect(engine.handleKeydown(key({ key: "c" }))).toEqual({ type: "pass" });
    expect(engine.handleKeydown(key({ key: "Enter" }))).toEqual({ type: "pass" });
  });

  it("passes every bare Ctrl+<letter> through when not armed", () => {
    const engine = createPrefixEngine();
    for (const letter of ["w", "c", "a", "t", "n", "v", "x", "z"]) {
      expect(engine.handleKeydown(key({ key: letter, ctrlKey: true }))).toEqual({
        type: "pass",
      });
    }
    expect(engine.isArmed()).toBe(false);
  });

  it("reset() leaves the armed state", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    engine.reset();
    expect(engine.isArmed()).toBe(false);
    expect(engine.handleKeydown(key({ key: "c" }))).toEqual({ type: "pass" });
  });
});

describe("prefix engine while armed", () => {
  it("⌃B ⌃B produces a literal and disarms", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(ctrlB())).toEqual({ type: "literal" });
    expect(engine.isArmed()).toBe(false);
  });

  it("dispatches every default binding to its action", () => {
    for (const definition of PREFIX_ACTION_DEFINITIONS) {
      const engine = createPrefixEngine();
      engine.handleKeydown(ctrlB());
      expect(
        engine.handleKeydown(key({ key: DEFAULT_PREFIX_BINDINGS[definition.id] })),
        definition.id,
      ).toEqual({ type: "action", action: definition.id });
      expect(engine.isArmed()).toBe(false);
    }
  });

  it("matches a shifted symbol binding (% = Shift+5)", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    // Holding Shift first must not disarm; the shifted symbol then matches.
    expect(engine.handleKeydown(key({ key: "Shift", shiftKey: true }))).toEqual({
      type: "pass",
    });
    expect(engine.isArmed()).toBe(true);
    expect(
      engine.handleKeydown(key({ key: "%", shiftKey: true })),
    ).toEqual({ type: "action", action: "splitRight" });
  });

  it("keeps armed state on plain modifier keydowns", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    for (const modifier of ["Shift", "Control", "Alt", "Meta"]) {
      expect(engine.handleKeydown(key({ key: modifier }))).toEqual({ type: "pass" });
      expect(engine.isArmed()).toBe(true);
    }
  });

  it("swallows and disarms on an unbound key", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "q" }))).toEqual({ type: "swallow" });
    expect(engine.isArmed()).toBe(false);
    // Engine is fully disarmed afterwards: following keys pass through.
    expect(engine.handleKeydown(key({ key: "c" }))).toEqual({ type: "pass" });
  });

  it("disarms on Escape", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "Escape" }))).toEqual({
      type: "disarm",
    });
    expect(engine.isArmed()).toBe(false);
  });

  it("ignores ctrl/alt modifiers when matching a bound key", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "c", ctrlKey: true }))).toEqual({
      type: "action",
      action: "newTerminal",
    });
  });

  it("matches letter bindings case-insensitively", () => {
    const engine = createPrefixEngine();
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "C", shiftKey: true }))).toEqual({
      type: "action",
      action: "newTerminal",
    });
  });

  it("honors custom bindings", () => {
    const custom: PrefixBindings = {
      ...DEFAULT_PREFIX_BINDINGS,
      newTerminal: "t",
    };
    const engine = createPrefixEngine(custom);
    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "t" }))).toEqual({
      type: "action",
      action: "newTerminal",
    });

    engine.handleKeydown(ctrlB());
    expect(engine.handleKeydown(key({ key: "c" }))).toEqual({ type: "swallow" });
  });
});

describe("prefix bindings persistence", () => {
  it("loads defaults when storage is empty or unavailable", () => {
    expect(loadPrefixBindings(null)).toEqual(DEFAULT_PREFIX_BINDINGS);
    expect(loadPrefixBindings(storageWith(undefined))).toEqual(
      DEFAULT_PREFIX_BINDINGS,
    );
  });

  it("round-trips a saved binding through storage", () => {
    const storage = storageWith(undefined);
    const next = savePrefixBinding("newTerminal", "t", storage);
    expect(next.newTerminal).toBe("t");
    expect(loadPrefixBindings(storage).newTerminal).toBe("t");
    // Other bindings stay at their defaults.
    expect(loadPrefixBindings(storage).splitRight).toBe("%");
  });

  it("falls back to defaults for invalid stored values", () => {
    const bindings = loadPrefixBindings(
      storageWith({ newTerminal: "Shift", splitRight: 42, prevTab: "o" }),
    );
    expect(bindings.newTerminal).toBe(DEFAULT_PREFIX_BINDINGS.newTerminal);
    expect(bindings.splitRight).toBe(DEFAULT_PREFIX_BINDINGS.splitRight);
    expect(bindings.prevTab).toBe("o");
  });

  it("normalizes letters to lowercase when saving", () => {
    const storage = storageWith(undefined);
    const next = savePrefixBinding("newTerminal", "T", storage);
    expect(next.newTerminal).toBe("t");
  });

  it("detects conflicts against other actions only", () => {
    const bindings: PrefixBindings = {
      ...DEFAULT_PREFIX_BINDINGS,
      newTerminal: "t",
    };
    expect(getPrefixBindingConflict("nextTab", "t", bindings)).toBe("newTerminal");
    expect(getPrefixBindingConflict("newTerminal", "t", bindings)).toBeNull();
  });

  it("reset restores defaults and clears storage", () => {
    const storage = storageWith({ newTerminal: "t" });
    expect(resetPrefixBindings(storage)).toEqual(DEFAULT_PREFIX_BINDINGS);
    expect(loadPrefixBindings(storage)).toEqual(DEFAULT_PREFIX_BINDINGS);
  });

  it("formats bindings as ⌃B <key>", () => {
    expect(formatPrefixBinding("newTerminal", DEFAULT_PREFIX_BINDINGS)).toBe("⌃B c");
    expect(formatPrefixBinding("paneLeft", DEFAULT_PREFIX_BINDINGS)).toBe("⌃B ←");
    expect(formatPrefixBinding("cheatSheet", DEFAULT_PREFIX_BINDINGS)).toBe("⌃B ?");
  });

  it("rejects modifier-only and Escape keys as bindings", () => {
    expect(normalizePrefixKey("Shift")).toBeNull();
    expect(normalizePrefixKey("Control")).toBeNull();
    expect(normalizePrefixKey("Escape")).toBeNull();
    expect(normalizePrefixKey("?")).toBe("?");
    expect(normalizePrefixKey("ArrowLeft")).toBe("ArrowLeft");
  });
});
