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
  tauriOpen: (url: string) => Promise<unknown> | unknown;
  windowOpen: (url: string) => void;
}): (url: string) => void {
  return (url) => {
    if (!isSafeExternalUrl(url)) return;
    if (deps.isTauri()) {
      void deps.tauriOpen(url);
      return;
    }
    deps.windowOpen(url);
  };
}
