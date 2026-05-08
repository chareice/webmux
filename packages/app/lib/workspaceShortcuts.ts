export const WORKSPACE_SHORTCUT_STORAGE_KEY = "webmux:workspace-shortcuts";

export type WorkspaceShortcutActionId =
  | "paneLeft"
  | "paneRight"
  | "paneUp"
  | "paneDown"
  | "groupPrevious"
  | "groupNext"
  | "group1"
  | "group2"
  | "group3"
  | "group4"
  | "group5"
  | "group6"
  | "group7"
  | "group8"
  | "group9";

export type WorkspaceShortcuts = Record<WorkspaceShortcutActionId, string>;

interface ShortcutBinding {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  code: string;
}

export const DEFAULT_WORKSPACE_SHORTCUTS: WorkspaceShortcuts = {
  paneLeft: "Mod+ArrowLeft",
  paneRight: "Mod+ArrowRight",
  paneUp: "Mod+ArrowUp",
  paneDown: "Mod+ArrowDown",
  groupPrevious: "Mod+Alt+ArrowLeft",
  groupNext: "Mod+Alt+ArrowRight",
  group1: "Mod+Alt+Digit1",
  group2: "Mod+Alt+Digit2",
  group3: "Mod+Alt+Digit3",
  group4: "Mod+Alt+Digit4",
  group5: "Mod+Alt+Digit5",
  group6: "Mod+Alt+Digit6",
  group7: "Mod+Alt+Digit7",
  group8: "Mod+Alt+Digit8",
  group9: "Mod+Alt+Digit9",
};

export const WORKSPACE_SHORTCUT_DEFINITIONS: Array<{
  id: WorkspaceShortcutActionId;
  label: string;
}> = [
  { id: "paneLeft", label: "Focus pane left" },
  { id: "paneRight", label: "Focus pane right" },
  { id: "paneUp", label: "Focus pane up" },
  { id: "paneDown", label: "Focus pane down" },
  { id: "groupPrevious", label: "Previous group" },
  { id: "groupNext", label: "Next group" },
  { id: "group1", label: "Switch to group 1" },
  { id: "group2", label: "Switch to group 2" },
  { id: "group3", label: "Switch to group 3" },
  { id: "group4", label: "Switch to group 4" },
  { id: "group5", label: "Switch to group 5" },
  { id: "group6", label: "Switch to group 6" },
  { id: "group7", label: "Switch to group 7" },
  { id: "group8", label: "Switch to group 8" },
  { id: "group9", label: "Switch to group 9" },
];

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

export function loadWorkspaceShortcuts(
  storage: Pick<Storage, "getItem"> | null = getBrowserStorage(),
): WorkspaceShortcuts {
  if (!storage) return { ...DEFAULT_WORKSPACE_SHORTCUTS };
  let saved: Partial<Record<WorkspaceShortcutActionId, string>> = {};
  try {
    const raw = storage.getItem(WORKSPACE_SHORTCUT_STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }

  const shortcuts = { ...DEFAULT_WORKSPACE_SHORTCUTS };
  for (const definition of WORKSPACE_SHORTCUT_DEFINITIONS) {
    const value = saved[definition.id];
    if (value && parseShortcut(value)) {
      shortcuts[definition.id] = normalizeShortcut(value);
    }
  }
  return shortcuts;
}

export function saveWorkspaceShortcuts(
  shortcuts: WorkspaceShortcuts,
  storage: Pick<Storage, "setItem"> | null = getBrowserStorage(),
) {
  if (!storage) return;
  storage.setItem(WORKSPACE_SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
}

export function saveWorkspaceShortcut(
  action: WorkspaceShortcutActionId,
  shortcut: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = getBrowserStorage(),
): WorkspaceShortcuts {
  const next = {
    ...loadWorkspaceShortcuts(storage),
    [action]: normalizeShortcut(shortcut),
  };
  saveWorkspaceShortcuts(next, storage);
  return next;
}

export function getWorkspaceShortcutConflict(
  action: WorkspaceShortcutActionId,
  shortcut: string,
  shortcuts: WorkspaceShortcuts = loadWorkspaceShortcuts(),
): WorkspaceShortcutActionId | null {
  const binding = parseShortcut(shortcut);
  if (!binding) return null;
  const normalizedShortcut = normalizeShortcut(shortcut);
  for (const definition of WORKSPACE_SHORTCUT_DEFINITIONS) {
    if (definition.id === action) continue;
    const existingShortcut = shortcuts[definition.id];
    if (
      parseShortcut(existingShortcut) &&
      normalizeShortcut(existingShortcut) === normalizedShortcut
    ) {
      return definition.id;
    }
  }
  return null;
}

export function resetWorkspaceShortcuts(
  storage: Pick<Storage, "removeItem"> | null = getBrowserStorage(),
): WorkspaceShortcuts {
  if (storage) storage.removeItem(WORKSPACE_SHORTCUT_STORAGE_KEY);
  return { ...DEFAULT_WORKSPACE_SHORTCUTS };
}

export function eventToShortcut(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(event.code);
  return parts.join("+");
}

export function findWorkspaceShortcutAction(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  shortcuts: WorkspaceShortcuts = loadWorkspaceShortcuts(),
): WorkspaceShortcutActionId | null {
  for (const definition of WORKSPACE_SHORTCUT_DEFINITIONS) {
    if (eventMatchesShortcut(event, shortcuts[definition.id])) {
      return definition.id;
    }
  }
  return null;
}

export function getWorkspaceGroupShortcutIndex(
  action: WorkspaceShortcutActionId,
): number | null {
  if (!action.startsWith("group")) return null;
  const index = Number(action.replace("group", ""));
  return Number.isInteger(index) && index >= 1 && index <= 9 ? index - 1 : null;
}

export function formatShortcut(shortcut: string | null | undefined): string {
  const binding = shortcut ? parseShortcut(shortcut) : null;
  if (!binding) return "Unassigned";
  const parts: string[] = [];
  if (binding.mod) parts.push("Ctrl/Cmd");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(formatCode(binding.code));
  return parts.join(" + ");
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function eventMatchesShortcut(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  shortcut: string,
): boolean {
  const binding = parseShortcut(shortcut);
  if (!binding) return false;
  return (
    event.code === binding.code &&
    (event.ctrlKey || event.metaKey) === binding.mod &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  );
}

function parseShortcut(shortcut: string): ShortcutBinding | null {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  let mod = false;
  let alt = false;
  let shift = false;
  let code: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "ctrl/cmd" || lower === "cmd/ctrl") {
      mod = true;
      continue;
    }
    if (lower === "ctrl" || lower === "control" || lower === "meta" || lower === "cmd") {
      mod = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      alt = true;
      continue;
    }
    if (lower === "shift") {
      shift = true;
      continue;
    }
    if (code) return null;
    code = part;
  }

  if (!code || (!mod && !alt && !shift) || MODIFIER_CODES.has(code)) return null;
  return { mod, alt, shift, code };
}

function normalizeShortcut(shortcut: string): string {
  const binding = parseShortcut(shortcut);
  if (!binding) return shortcut;
  const parts: string[] = [];
  if (binding.mod) parts.push("Mod");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(binding.code);
  return parts.join("+");
}

function formatCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  switch (code) {
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "Backslash":
      return "\\";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Backquote":
      return "`";
    case "Space":
      return "Space";
    case "Tab":
      return "Tab";
    case "Enter":
      return "Enter";
    default:
      return code;
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
