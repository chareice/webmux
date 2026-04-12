import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOCOMPLETE_CACHE_TTL_MS,
  buildDirectorySuggestions,
  createDirectoryCache,
  readCachedDirectoryEntries,
  writeCachedDirectoryEntries,
} from "./directoryAutocomplete.ts";

test("directory suggestions filter by prefix and cap the result set", () => {
  const entries = [
    { name: "apps", path: "/srv/apps", is_dir: true },
    { name: "api", path: "/srv/api", is_dir: true },
    { name: "archive", path: "/srv/archive", is_dir: true },
    { name: "assets", path: "/srv/assets", is_dir: true },
    { name: "auth", path: "/srv/auth", is_dir: true },
    { name: "admin", path: "/srv/admin", is_dir: true },
    { name: "analytics", path: "/srv/analytics", is_dir: true },
    { name: "alerts", path: "/srv/alerts", is_dir: true },
    { name: "audit", path: "/srv/audit", is_dir: true },
    { name: "README.md", path: "/srv/README.md", is_dir: false },
  ];

  assert.deepEqual(buildDirectorySuggestions(entries, "a"), [
    "/srv/admin",
    "/srv/alerts",
    "/srv/analytics",
    "/srv/api",
    "/srv/apps",
    "/srv/archive",
    "/srv/assets",
    "/srv/audit",
  ]);
});

test("directory cache returns fresh entries and expires stale ones", () => {
  const cache = createDirectoryCache();
  const now = 1_700_000_000_000;

  writeCachedDirectoryEntries(cache, "machine-a", "/srv", [{ name: "api", path: "/srv/api", is_dir: true }], now);

  assert.deepEqual(
    readCachedDirectoryEntries(cache, "machine-a", "/srv", now + 1000),
    [{ name: "api", path: "/srv/api", is_dir: true }],
  );
  assert.equal(
    readCachedDirectoryEntries(
      cache,
      "machine-a",
      "/srv",
      now + AUTOCOMPLETE_CACHE_TTL_MS + 1,
    ),
    null,
  );
});
