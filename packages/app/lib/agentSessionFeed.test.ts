import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@webmux/shared";

vi.mock("./api", () => ({
  getAgentSessionEvents: vi.fn(),
}));

import { getAgentSessionEvents } from "./api";
import {
  applyLiveAgentSessionEvent,
  ensureAgentSessionFeed,
  getAgentSessionFeedSnapshot,
  getAgentSessionPendingQuestion,
  removeAgentSessionFeed,
  resetAgentSessionFeedsForTests,
} from "./agentSessionFeed";

const mockGetEvents = vi.mocked(getAgentSessionEvents);

function userMessage(text: string): AgentEvent {
  return { type: "user_message", text };
}

function page(
  events: { seq: number; event: AgentEvent }[],
): { events: { seq: number; event: AgentEvent }[]; last_seq: number } {
  return { events, last_seq: events.length ? events[events.length - 1].seq : 0 };
}

/** Flush microtasks so a resolved/rejected backfill promise settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("agentSessionFeed", () => {
  beforeEach(() => {
    resetAgentSessionFeedsForTests();
    mockGetEvents.mockReset();
  });

  it("backfill seeds blocks and marks the feed backfilled", async () => {
    mockGetEvents.mockResolvedValue(
      page([
        { seq: 1, event: userMessage("hi") },
        { seq: 2, event: { type: "agent_message_chunk", text: "hello" } },
      ]),
    );

    ensureAgentSessionFeed("m1", "s1");
    // Concurrent calls share the in-flight fetch.
    ensureAgentSessionFeed("m1", "s1");
    await flush();

    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(mockGetEvents).toHaveBeenCalledWith("m1", "s1", 0, 500);

    const snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot.backfilled).toBe(true);
    expect(snapshot.lastSeq).toBe(2);
    expect(snapshot.blocks.map((b) => b.kind)).toEqual(["user", "assistant"]);
    // Snapshot identity is stable between changes.
    expect(getAgentSessionFeedSnapshot("s1")).toBe(snapshot);
  });

  it("dedupes live events overlapping the backfill page", async () => {
    let resolveFetch!: (value: ReturnType<typeof page>) => void;
    mockGetEvents.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    // Live events 5 and 6 arrive before/during the backfill.
    applyLiveAgentSessionEvent("m1", "s1", 5, userMessage("five"));
    applyLiveAgentSessionEvent("m1", "s1", 6, userMessage("six"));
    ensureAgentSessionFeed("m1", "s1");

    // The backfill page covers 1..6, overlapping the live events.
    resolveFetch(
      page([
        { seq: 1, event: userMessage("one") },
        { seq: 2, event: userMessage("two") },
        { seq: 3, event: userMessage("three") },
        { seq: 4, event: userMessage("four") },
        { seq: 5, event: userMessage("five") },
        { seq: 6, event: userMessage("six") },
      ]),
    );
    await flush();

    // Live event 7 then applies cleanly on top.
    applyLiveAgentSessionEvent("m1", "s1", 7, userMessage("seven"));

    const snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot.lastSeq).toBe(7);
    // Live events arriving before the backfill lands are buffered, so the
    // backfill applies first and no history is lost; the overlapping 5/6 are
    // dropped by the transcript's `seq <= lastSeq` dedup on flush.
    const texts = snapshot.blocks.map((b) => (b.kind === "user" ? b.text : ""));
    expect(texts).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
    ]);
  });

  it("buffers live events received before any ensure call until backfill", async () => {
    applyLiveAgentSessionEvent("m1", "s1", 1, userMessage("early"));
    applyLiveAgentSessionEvent("m1", "s1", 2, userMessage("events"));

    // Not yet backfilled: buffered events are not applied to the transcript.
    let snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot.backfilled).toBe(false);
    expect(snapshot.lastSeq).toBe(0);
    expect(snapshot.blocks).toHaveLength(0);

    // A later backfill overlapping them loses nothing.
    mockGetEvents.mockResolvedValue(
      page([
        { seq: 1, event: userMessage("early") },
        { seq: 2, event: userMessage("events") },
      ]),
    );
    ensureAgentSessionFeed("m1", "s1");
    await flush();

    snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot.backfilled).toBe(true);
    expect(snapshot.lastSeq).toBe(2);
    expect(snapshot.blocks).toHaveLength(2);
  });

  it("leaves backfilled=false after a fetch failure and retries on the next ensure", async () => {
    mockGetEvents.mockRejectedValueOnce(new Error("boom"));
    ensureAgentSessionFeed("m1", "s1");
    await flush();

    expect(getAgentSessionFeedSnapshot("s1").backfilled).toBe(false);

    mockGetEvents.mockResolvedValue(page([{ seq: 1, event: userMessage("hi") }]));
    ensureAgentSessionFeed("m1", "s1");
    await flush();

    const snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot.backfilled).toBe(true);
    expect(snapshot.lastSeq).toBe(1);
    expect(mockGetEvents).toHaveBeenCalledTimes(2);
  });

  it("removeAgentSessionFeed drops transcript and pending-question state", async () => {
    applyLiveAgentSessionEvent("m1", "s1", 1, {
      type: "question",
      request_id: "r1",
      prompt: "pick one",
      options: [],
    });
    expect(getAgentSessionPendingQuestion("s1")).not.toBeNull();

    removeAgentSessionFeed("s1");

    const snapshot = getAgentSessionFeedSnapshot("s1");
    expect(snapshot).toEqual({ blocks: [], lastSeq: 0, backfilled: false });
    // Absent sessions return a stable cached snapshot.
    expect(getAgentSessionFeedSnapshot("s1")).toBe(snapshot);
    expect(getAgentSessionPendingQuestion("s1")).toBeNull();
  });

  it("tracks pending questions from live events alone", () => {
    expect(getAgentSessionPendingQuestion("s1")).toBeNull();

    applyLiveAgentSessionEvent("m1", "s1", 1, {
      type: "question",
      request_id: "r1",
      prompt: "allow?",
      options: [],
    });
    expect(getAgentSessionPendingQuestion("s1")).toEqual({
      requestId: "r1",
      prompt: "allow?",
    });

    applyLiveAgentSessionEvent("m1", "s1", 2, {
      type: "question_resolved",
      request_id: "r1",
    });
    expect(getAgentSessionPendingQuestion("s1")).toBeNull();
  });

  it("reconciles the pending-question map from the transcript after backfill", async () => {
    // Backfill history ends with an unresolved question: map picks it up.
    mockGetEvents.mockResolvedValue(
      page([
        {
          seq: 1,
          event: {
            type: "question",
            request_id: "r9",
            prompt: "from history",
            options: [],
          },
        },
      ]),
    );
    ensureAgentSessionFeed("m1", "s1");
    await flush();
    expect(getAgentSessionPendingQuestion("s1")).toEqual({
      requestId: "r9",
      prompt: "from history",
    });

    // History where the question was already resolved: map stays clear.
    mockGetEvents.mockResolvedValue(
      page([
        {
          seq: 1,
          event: {
            type: "question",
            request_id: "r1",
            prompt: "old",
            options: [],
          },
        },
        { seq: 2, event: { type: "question_resolved", request_id: "r1" } },
      ]),
    );
    ensureAgentSessionFeed("m1", "s2");
    await flush();
    expect(getAgentSessionPendingQuestion("s2")).toBeNull();
  });

  it("resetAgentSessionFeedsForTests clears all sessions", () => {
    applyLiveAgentSessionEvent("m1", "s1", 1, userMessage("hi"));
    applyLiveAgentSessionEvent("m1", "s2", 1, {
      type: "question",
      request_id: "r1",
      prompt: "q",
      options: [],
    });

    resetAgentSessionFeedsForTests();

    expect(getAgentSessionFeedSnapshot("s1")).toEqual({
      blocks: [],
      lastSeq: 0,
      backfilled: false,
    });
    expect(getAgentSessionFeedSnapshot("s2").blocks).toHaveLength(0);
    expect(getAgentSessionPendingQuestion("s2")).toBeNull();
  });
});
