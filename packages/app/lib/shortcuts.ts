import { useEffect, useRef } from "react";

interface ShortcutActions {
  newTerminal?: () => void;
  closeTab?: () => void;
  closePane?: () => void;
  nextTab?: () => void;
  prevTab?: () => void;
  selectTab?: (index: number) => void;
  splitVertical?: () => void;
  splitHorizontal?: () => void;
  focusPrevPane?: () => void;
  focusNextPane?: () => void;
  toggleNav?: () => void;
}

export function isAppShortcut(event: KeyboardEvent): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return false;

  if (event.shiftKey && event.code === "KeyT") return true;
  if (!event.shiftKey && event.code === "KeyW") return true;
  if (event.shiftKey && event.code === "KeyW") return true;
  if (!event.shiftKey && event.code === "Backslash") return true;
  if (event.shiftKey && event.code === "Backslash") return true;
  if (event.shiftKey && event.code === "BracketLeft") return true;
  if (event.shiftKey && event.code === "BracketRight") return true;
  if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") return true;
  if (event.key === "Tab") return true;
  if (!event.shiftKey && event.code === "KeyB") return true;

  return false;
}

export function useShortcuts(actions: ShortcutActions) {
  // Hold the latest actions in a ref so the keydown listener reads the
  // current callbacks without us having to rebind it. Callers typically
  // pass a fresh object literal on every render — without this ref the
  // effect would tear down + reattach the window listener on every state
  // change in TerminalCanvas.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const a = actionsRef.current;

      if (event.shiftKey && event.code === "KeyT") {
        event.preventDefault();
        a.newTerminal?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        a.closeTab?.();
        return;
      }

      if (event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        a.closePane?.();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) a.prevTab?.();
        else a.nextTab?.();
        return;
      }

      if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") {
        event.preventDefault();
        const index = parseInt(event.code.replace("Digit", ""), 10) - 1;
        a.selectTab?.(index);
        return;
      }

      if (!event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        a.splitVertical?.();
        return;
      }

      if (event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        a.splitHorizontal?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketLeft") {
        event.preventDefault();
        a.focusPrevPane?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketRight") {
        event.preventDefault();
        a.focusNextPane?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyB") {
        event.preventDefault();
        a.toggleNav?.();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
