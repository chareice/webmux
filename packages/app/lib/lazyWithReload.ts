export const CHUNK_RELOAD_KEY = "webmux:chunk-reload";

export async function lazyWithReload<T>(loader: () => Promise<T>): Promise<T> {
  try {
    const module = await loader();
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      }
    } catch {
      // A successful chunk load must not fail because storage is unavailable.
    }
    return module;
  } catch (error) {
    if (
      typeof sessionStorage === "undefined" ||
      typeof location === "undefined"
    ) {
      throw error;
    }

    let alreadyAttempted: boolean;
    try {
      alreadyAttempted = Boolean(sessionStorage.getItem(CHUNK_RELOAD_KEY));
    } catch {
      throw error;
    }
    if (alreadyAttempted) {
      throw error;
    }
    try {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
    } catch {
      throw error;
    }

    location.reload();

    // Keep React.lazy suspended while the browser replaces this document.
    return new Promise<T>(() => {});
  }
}
