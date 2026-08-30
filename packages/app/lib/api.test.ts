import { afterEach, describe, expect, test, vi } from "vitest";

import {
  configure,
  deleteWorkspaceGroup,
  deleteMachine,
  createApiToken,
  deleteApiToken,
  createAgentSession,
  cancelAgentSession,
  getAgentSessionEvents,
  putAgentSessionSeen,
} from "./api";

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

  test("deletes a machine with 204", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteMachine("machine-a")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/machines/machine-a",
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

  test("creates an agent session with snake_case body and omits auto_run when unset", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "sess-1" }), { status: 200 }),
        ),
      );

    await createAgentSession(
      "machine-a",
      { agentKind: "kimi", cwd: "/work/repo" },
      "device-a",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/machines/machine-a/agent-sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agent_kind: "kimi",
          cwd: "/work/repo",
          device_id: "device-a",
        }),
      }),
    );

    await createAgentSession("machine-a", {
      agentKind: "claude",
      cwd: "/work/repo",
      autoRun: false,
      workspaceGroupId: "tab-main",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/machines/machine-a/agent-sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agent_kind: "claude",
          cwd: "/work/repo",
          auto_run: false,
          workspace_group_id: "tab-main",
        }),
      }),
    );
  });

  test("cancels an agent session with device_id as a query param", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      cancelAgentSession("machine-a", "sess-1", "device-a"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/machines/machine-a/agent-sessions/sess-1/cancel?device_id=device-a",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("pages agent session events and marks seen", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [
              { seq: 1, event: { type: "user_message", text: "hi" } },
            ],
            last_seq: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ last_seen_seq: 3 }), { status: 200 }),
      );

    await expect(
      getAgentSessionEvents("machine-a", "sess-1", 0, 100),
    ).resolves.toMatchObject({ last_seq: 1 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/machines/machine-a/agent-sessions/sess-1/events?from_seq=0&limit=100",
      expect.objectContaining({ method: "GET" }),
    );

    await expect(putAgentSessionSeen("sess-1", 3)).resolves.toEqual({
      last_seen_seq: 3,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agent-sessions/sess-1/seen",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ last_seen_seq: 3 }),
      }),
    );
  });
});
