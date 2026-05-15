interface SelectionAutoCopyControllerOptions {
  hasSelection: () => boolean;
  getSelection: () => string;
  writeText: (text: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
  delayMs?: number;
}

export interface SelectionAutoCopyController {
  selectionChanged: () => void;
  pointerSelectionStarted: () => void;
  pointerSelectionFinished: () => void;
  dispose: () => void;
}

const DEFAULT_COPY_DELAY_MS = 30;

export function createSelectionAutoCopyController({
  hasSelection,
  getSelection,
  writeText,
  onError,
  delayMs = DEFAULT_COPY_DELAY_MS,
}: SelectionAutoCopyControllerOptions): SelectionAutoCopyController {
  let disposed = false;
  let pointerSelecting = false;
  let lastCopiedSelection = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingCopy = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const copyCurrentSelection = () => {
    timer = null;
    if (disposed || !hasSelection()) return;

    const text = getSelection();
    if (!text || text === lastCopiedSelection) return;

    lastCopiedSelection = text;
    void Promise.resolve(writeText(text)).catch((error) => {
      onError?.(error);
    });
  };

  const scheduleCopy = () => {
    if (disposed) return;
    clearPendingCopy();
    timer = setTimeout(copyCurrentSelection, delayMs);
  };

  return {
    selectionChanged() {
      if (!hasSelection()) {
        lastCopiedSelection = "";
        clearPendingCopy();
        return;
      }
      if (!pointerSelecting) {
        scheduleCopy();
      }
    },

    pointerSelectionStarted() {
      pointerSelecting = true;
      clearPendingCopy();
    },

    pointerSelectionFinished() {
      pointerSelecting = false;
      scheduleCopy();
    },

    dispose() {
      disposed = true;
      clearPendingCopy();
    },
  };
}
