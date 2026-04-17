import { describe, expect, it } from "vitest";
import type { Bookmark } from "@webmux/shared";

// Pins the wire shape of `GET /api/machines/{id}/bookmarks` against the TS
// type. The Rust handler (crates/hub/src/routes/bookmarks.rs) returns
// `BookmarkResponse` as snake_case JSON with no `rename_all` attribute, so
// the TS interface must match — the previous camelCase declaration meant
// every API-returned bookmark deserialized to `{ machineId: undefined,
// sortOrder: undefined }`, which the NavColumn machine filter then dropped.
describe("Bookmark wire contract", () => {
  it("accepts a snake_case payload from the API", () => {
    // The Rust handler also emits `created_at`, but `Bookmark` deliberately
    // doesn't surface it (no consumer reads it) — extra wire fields are
    // safely ignored by JSON.parse, so we don't include it in the sample.
    const wire = JSON.parse(
      `{
        "id": "bm-1",
        "machine_id": "m-1",
        "path": "/tmp",
        "label": "tmp",
        "sort_order": 0
      }`,
    ) as Bookmark;

    expect(wire.id).toBe("bm-1");
    expect(wire.machine_id).toBe("m-1");
    expect(wire.path).toBe("/tmp");
    expect(wire.label).toBe("tmp");
    expect(wire.sort_order).toBe(0);
  });

  it("a snake_case bookmark survives the active-machine filter", () => {
    // This is the exact shape the API serves and the filter NavColumn /
    // TerminalCanvas use to scope bookmarks to the active machine. Before
    // the type fix the filter returned [] for every API-loaded bookmark.
    const apiBookmarks: Bookmark[] = [
      {
        id: "bm-1",
        machine_id: "m-1",
        path: "/tmp",
        label: "tmp",
        sort_order: 0,
      },
      {
        id: "bm-2",
        machine_id: "m-2",
        path: "/var",
        label: "var",
        sort_order: 1,
      },
    ];

    const activeMachineId = "m-1";
    const filtered = apiBookmarks.filter(
      (b) => b.machine_id === activeMachineId,
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("bm-1");
  });
});
