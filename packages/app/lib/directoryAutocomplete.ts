import type { DirEntry } from "@webmux/shared";

export const AUTOCOMPLETE_CACHE_TTL_MS = 30_000;

interface CachedDirectoryEntries {
  entries: DirEntry[];
  timestamp: number;
}

type DirectoryCache = Map<string, CachedDirectoryEntries>;

function cacheKey(machineId: string, parentDir: string): string {
  return `${machineId}:${parentDir}`;
}

export function createDirectoryCache(): DirectoryCache {
  return new Map();
}

export function writeCachedDirectoryEntries(
  cache: DirectoryCache,
  machineId: string,
  parentDir: string,
  entries: DirEntry[],
  now = Date.now(),
): void {
  cache.set(cacheKey(machineId, parentDir), {
    entries,
    timestamp: now,
  });
}

export function readCachedDirectoryEntries(
  cache: DirectoryCache,
  machineId: string,
  parentDir: string,
  now = Date.now(),
): DirEntry[] | null {
  const cached = cache.get(cacheKey(machineId, parentDir));
  if (!cached) {
    return null;
  }

  if (now - cached.timestamp > AUTOCOMPLETE_CACHE_TTL_MS) {
    cache.delete(cacheKey(machineId, parentDir));
    return null;
  }

  return cached.entries;
}

export function buildDirectorySuggestions(
  entries: DirEntry[],
  prefix: string,
  limit = 8,
): string[] {
  const normalizedPrefix = prefix.toLowerCase();

  return entries
    .filter(
      (entry) =>
        entry.is_dir &&
        (normalizedPrefix === "" ||
          entry.name.toLowerCase().startsWith(normalizedPrefix)),
    )
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}
