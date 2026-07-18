const VIEW_ONLY_LOCK_KEY = "webmux:view-only-lock";

export interface ViewOnlyLockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readViewOnlyLock(storage: ViewOnlyLockStorage): boolean {
  try {
    return storage.getItem(VIEW_ONLY_LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeViewOnlyLock(
  storage: ViewOnlyLockStorage,
  locked: boolean,
): void {
  try {
    if (locked) {
      storage.setItem(VIEW_ONLY_LOCK_KEY, "1");
    } else {
      storage.removeItem(VIEW_ONLY_LOCK_KEY);
    }
  } catch {
    /* ignore unavailable browser storage */
  }
}
