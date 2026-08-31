// One-time localStorage rename, webmux: -> offdesk:. Without it an upgrading
// client forgets its hub URL, fonts, panel state and session defaults.
//
// Imported for its side effect at the top of app/_layout.tsx, before anything
// else reads storage. Keys are copied, not moved, so a downgrade still works;
// a marker key stops it re-running on every boot. Delete this module once
// nobody is upgrading from webmux.

const LEGACY_PREFIX = "webmux:";
const PREFIX = "offdesk:";
const MARKER = "offdesk:legacy-storage-migrated";

export function migrateLegacyStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(MARKER)) return;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_PREFIX)) continue;
      const renamed = PREFIX + key.slice(LEGACY_PREFIX.length);
      if (localStorage.getItem(renamed) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(renamed, value);
    }
    localStorage.setItem(MARKER, "1");
  } catch {
    // Private mode or a storage quota error. Nothing to migrate, and the
    // app works fine from defaults.
  }
}

migrateLegacyStorage();
