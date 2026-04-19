import { describe, expect, it } from "vitest";
import { storePendingControlRelease, takePendingControlRelease, } from "./unloadControlRelease";
function fakeStorage() {
    const store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = value; },
        removeItem: (key) => { delete store[key]; },
    };
}
describe("storePendingControlRelease", () => {
    it("stores machine ids in storage", () => {
        const storage = fakeStorage();
        storePendingControlRelease(storage, ["m1", "m2"]);
        const raw = storage.getItem("tc-release-control-on-next-load");
        expect(JSON.parse(raw)).toEqual(["m1", "m2"]);
    });
    it("removes key when list is empty", () => {
        const storage = fakeStorage();
        storePendingControlRelease(storage, ["m1"]);
        storePendingControlRelease(storage, []);
        expect(storage.getItem("tc-release-control-on-next-load")).toBeNull();
    });
});
describe("takePendingControlRelease", () => {
    it("returns stored ids and clears storage", () => {
        const storage = fakeStorage();
        storePendingControlRelease(storage, ["m1", "m2"]);
        const ids = takePendingControlRelease(storage);
        expect(ids).toEqual(["m1", "m2"]);
        expect(storage.getItem("tc-release-control-on-next-load")).toBeNull();
    });
    it("returns empty array when nothing stored", () => {
        const storage = fakeStorage();
        expect(takePendingControlRelease(storage)).toEqual([]);
    });
    it("returns empty array for invalid JSON", () => {
        const storage = fakeStorage();
        storage.setItem("tc-release-control-on-next-load", "not-json");
        expect(takePendingControlRelease(storage)).toEqual([]);
    });
    it("filters out non-string values", () => {
        const storage = fakeStorage();
        storage.setItem("tc-release-control-on-next-load", JSON.stringify(["m1", 42, null, "m2"]));
        expect(takePendingControlRelease(storage)).toEqual(["m1", "m2"]);
    });
});
