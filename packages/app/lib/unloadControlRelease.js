const PENDING_CONTROL_RELEASE_KEY = "tc-release-control-on-next-load";
export function storePendingControlRelease(storage, machineIds) {
    if (machineIds.length === 0) {
        storage.removeItem(PENDING_CONTROL_RELEASE_KEY);
        return;
    }
    storage.setItem(PENDING_CONTROL_RELEASE_KEY, JSON.stringify(machineIds));
}
export function takePendingControlRelease(storage) {
    const raw = storage.getItem(PENDING_CONTROL_RELEASE_KEY);
    storage.removeItem(PENDING_CONTROL_RELEASE_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((value) => typeof value === "string");
    }
    catch {
        return [];
    }
}
