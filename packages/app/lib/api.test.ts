import { afterEach, describe, expect, test, vi } from "vitest";

import { configure, deleteWorkspaceGroup, createApiToken, deleteApiToken } from "./api";

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

  test("creates and deletes api tokens", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "tok-1",
            name: "cli",
            token: "wmx_abc",
            created_at: 123,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(createApiToken("cli")).resolves.toMatchObject({
      token: "wmx_abc",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/api-tokens",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "cli" }),
      }),
    );

    await expect(deleteApiToken("tok-1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/api-tokens/tok-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
