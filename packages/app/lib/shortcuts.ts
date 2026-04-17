import { useEffect } from "react";

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
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.shiftKey && event.code === "KeyT") {
        event.preventDefault();
        actions.newTerminal?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        actions.closeTab?.();
        return;
      }

      if (event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        actions.closePane?.();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) actions.prevTab?.();
        else actions.nextTab?.();
        return;
      }

      if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") {
        event.preventDefault();
        const index = parseInt(event.code.replace("Digit", ""), 10) - 1;
        actions.selectTab?.(index);
        return;
      }

      if (!event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        actions.splitVertical?.();
        return;
      }

      if (event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        actions.splitHorizontal?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketLeft") {
        event.preventDefault();
        actions.focusPrevPane?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketRight") {
        event.preventDefault();
        actions.focusNextPane?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyB") {
        event.preventDefault();
        actions.toggleNav?.();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
