export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createExternalUrlOpener(deps: {
  isTauri: () => boolean;
  tauriOpenUrl: (url: string) => Promise<unknown>;
  tauriShellOpen: (url: string) => Promise<unknown>;
  windowOpen: (url: string) => void;
}): (url: string) => void {
  return (url) => {
    if (!isSafeExternalUrl(url)) return;
    if (!deps.isTauri()) {
      deps.windowOpen(url);
      return;
    }
    // The UI is served remotely by the hub, so new JS can run inside old
    // installed Tauri shells that do not have the opener plugin registered
    // (the dynamic import / invoke can throw).
    void (async () => {
      try {
        await deps.tauriOpenUrl(url);
      } catch {
        try {
          await deps.tauriShellOpen(url);
        } catch {
          deps.windowOpen(url);
        }
      }
    })();
  };
}
