export const AUTOCOMPLETE_CACHE_TTL_MS = 30_000;
function cacheKey(machineId, parentDir) {
    return `${machineId}:${parentDir}`;
}
export function createDirectoryCache() {
    return new Map();
}
export function writeCachedDirectoryEntries(cache, machineId, parentDir, entries, now = Date.now()) {
    cache.set(cacheKey(machineId, parentDir), {
        entries,
        timestamp: now,
    });
}
export function readCachedDirectoryEntries(cache, machineId, parentDir, now = Date.now()) {
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
export function buildDirectorySuggestions(entries, prefix, limit = 8) {
    const normalizedPrefix = prefix.toLowerCase();
    return entries
        .filter((entry) => entry.is_dir &&
        (normalizedPrefix === "" ||
            entry.name.toLowerCase().startsWith(normalizedPrefix)))
        .map((entry) => entry.path)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, limit);
}
