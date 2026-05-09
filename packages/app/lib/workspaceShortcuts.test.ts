import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_SHORTCUTS,
  WORKSPACE_SHORTCUT_STORAGE_KEY,
  eventToShortcut,
  findWorkspaceShortcutAction,
  formatShortcut,
  getWorkspaceShortcutConflict,
  loadWorkspaceShortcuts,
} from "./workspaceShortcuts";

type KeyboardLike = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

function key(input: Partial<KeyboardLike> & { code: string }): KeyboardLike {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...input,
  };
}

function storageWith(value: unknown): Storage {
  const values = new Map<string, string>();
  if (value !== undefined) {
    values.set(WORKSPACE_SHORTCUT_STORAGE_KEY, JSON.stringify(value));
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

describe("workspaceShortcuts", () => {
  it("matches default pane and group navigation shortcuts", () => {
    expect(
      findWorkspaceShortcutAction(key({ ctrlKey: true, code: "ArrowLeft" })),
    ).toBe("paneLeft");
    expect(
      findWorkspaceShortcutAction(
        key({ ctrlKey: true, altKey: true, code: "ArrowRight" }),
      ),
    ).toBe("groupNext");
    expect(
      findWorkspaceShortcutAction(
        key({ metaKey: true, altKey: true, code: "Digit3" }),
      ),
    ).toBe("group3");
  });

  it("allows stored shortcuts to override defaults", () => {
    const shortcuts = loadWorkspaceShortcuts(
      storageWith({
        paneLeft: "Mod+Alt+KeyH",
        groupNext: "Mod+Alt+KeyG",
      }),
    );

    expect(
      findWorkspaceShortcutAction(
        key({ ctrlKey: true, altKey: true, code: "KeyH" }),
        shortcuts,
      ),
    ).toBe("paneLeft");
    expect(
      findWorkspaceShortcutAction(
        key({ ctrlKey: true, code: "ArrowLeft" }),
        shortcuts,
      ),
    ).toBeNull();
    expect(
      findWorkspaceShortcutAction(
        key({ ctrlKey: true, altKey: true, code: "KeyG" }),
        shortcuts,
      ),
    ).toBe("groupNext");
  });

  it("falls back to defaults when stored bindings are invalid", () => {
    const shortcuts = loadWorkspaceShortcuts(
      storageWith({
        paneLeft: "not a shortcut",
        groupNext: "Mod+Alt+KeyG",
      }),
    );

    expect(shortcuts.paneLeft).toBe(DEFAULT_WORKSPACE_SHORTCUTS.paneLeft);
    expect(shortcuts.groupNext).toBe("Mod+Alt+KeyG");
  });

  it("captures and formats shortcuts consistently", () => {
    const shortcut = eventToShortcut(
      key({ ctrlKey: true, altKey: true, code: "KeyG" }),
    );

    expect(shortcut).toBe("Mod+Alt+KeyG");
    expect(formatShortcut(shortcut)).toBe("Ctrl/Cmd + Alt + G");
  });

  it("does not capture modifier-only keyboard events", () => {
    expect(eventToShortcut(key({ ctrlKey: true, code: "ControlLeft" }))).toBeNull();
  });

  it("detects duplicate bindings before saving a shortcut", () => {
    const shortcuts = {
      ...DEFAULT_WORKSPACE_SHORTCUTS,
      groupNext: "Mod+Alt+KeyG",
    };

    expect(
      getWorkspaceShortcutConflict("paneLeft", "Mod+Alt+KeyG", shortcuts),
    ).toBe("groupNext");
    expect(
      getWorkspaceShortcutConflict("groupNext", "Mod+Alt+KeyG", shortcuts),
    ).toBeNull();
  });

  it("loads new defaults when storage is empty", () => {
    const shortcuts = loadWorkspaceShortcuts(null);
    expect(shortcuts.columnWidthShrink).toBe("Mod+Comma");
    expect(shortcuts.columnWidthGrow).toBe("Mod+Period");
    expect(shortcuts.layoutModeToggle).toBe("Mod+Alt+KeyT");
  });
});
