import { afterEach, describe, expect, test, vi } from "vitest";

import { configure, deleteWorkspaceGroup } from "./api";

describe("api request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    configure("", null);
  });

  test("resolves void requests with 204 responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      deleteWorkspaceGroup("machine-a", "group-a"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/machines/machine-a/workspace-groups/group-a",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
