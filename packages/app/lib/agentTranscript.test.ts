import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@offdesk/shared";

import { createAgentTranscript, type TranscriptBlock } from "./agentTranscript";

function kinds(blocks: readonly TranscriptBlock[]): string[] {
  return blocks.map((b) => b.kind);
}

describe("createAgentTranscript", () => {
  it("aggregates consecutive agent_message_chunk events into one assistant block", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "agent_message_chunk", text: "Hello" });
    t.apply(2, { type: "agent_message_chunk", text: ", world" });

    const blocks = t.blocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "assistant",
      id: "b0",
      text: "Hello, world",
      closed: false,
    });
  });

  it("starts a new assistant block for a chunk arriving after user_message", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "agent_message_chunk", text: "first" });
    t.apply(2, { type: "user_message", text: "question?" });
    t.apply(3, { type: "agent_message_chunk", text: "second" });

    const blocks = t.blocks();
    expect(kinds(blocks)).toEqual(["assistant", "user", "assistant"]);
    expect(blocks[0]).toMatchObject({ text: "first", closed: true });
    expect(blocks[2]).toMatchObject({ text: "second", closed: false });
    expect(blocks.map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
  });

  it("aggregates consecutive thought_chunk events into one thought block", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "thought_chunk", text: "thinking" });
    t.apply(2, { type: "thought_chunk", text: " harder" });

    const blocks = t.blocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "thought",
      id: "b0",
      text: "thinking harder",
      closed: false,
    });
  });

  it("closes the open block on turn_ended and on any non-chunk event", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "agent_message_chunk", text: "answer" });
    t.apply(2, { type: "turn_ended", stop_reason: "end_turn" });

    expect(t.blocks()[0]).toMatchObject({ kind: "assistant", closed: true });

    t.apply(3, { type: "thought_chunk", text: "hmm" });
    // A non-thought_chunk event closes the thought block too.
    t.apply(4, { type: "plan", entries_json: "[]" });
    expect(t.blocks()[2]).toMatchObject({ kind: "thought", closed: true });
  });

  it("creates a tool_call block and mutates it by tool_call_id on update", () => {
    const t = createAgentTranscript();
    t.apply(1, {
      type: "tool_call",
      tool_call_id: "tc1",
      title: "Read file",
      kind: "read",
      status: "pending",
    });
    t.apply(2, {
      type: "tool_call_update",
      tool_call_id: "tc1",
      status: "completed",
      content: "file body",
    });

    expect(t.blocks()).toEqual([
      {
        kind: "tool_call",
        id: "b0",
        toolCallId: "tc1",
        title: "Read file",
        toolKind: "read",
        status: "completed",
        content: "file body",
      },
    ]);
  });

  it("keeps prior status/content when an update omits them, and defaults toolKind to null", () => {
    const t = createAgentTranscript();
    t.apply(1, {
      type: "tool_call",
      tool_call_id: "tc1",
      title: "Run",
      status: "running",
    });
    t.apply(2, { type: "tool_call_update", tool_call_id: "tc1" });

    expect(t.blocks()[0]).toMatchObject({
      toolKind: null,
      status: "running",
      content: null,
    });
  });

  it("ignores a tool_call_update for an unknown id", () => {
    const t = createAgentTranscript();
    t.apply(1, {
      type: "tool_call_update",
      tool_call_id: "nope",
      status: "completed",
    });

    expect(t.blocks()).toEqual([]);
    expect(t.lastSeq()).toBe(1);
  });

  it("resolves a question block by request_id and reports it via pendingQuestion", () => {
    const options = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];
    const t = createAgentTranscript();
    t.apply(1, {
      type: "question",
      request_id: "r1",
      prompt: "Proceed?",
      options,
    });

    expect(t.blocks()[0]).toEqual({
      kind: "question",
      id: "b0",
      requestId: "r1",
      prompt: "Proceed?",
      options,
      resolved: false,
    });
    expect(t.pendingQuestion()).toEqual({
      requestId: "r1",
      prompt: "Proceed?",
      options,
    });

    t.apply(2, { type: "question_resolved", request_id: "r1" });
    expect(t.blocks()[0]).toMatchObject({ resolved: true });
    expect(t.pendingQuestion()).toBeNull();
  });

  it("ignores question_resolved for an unknown id and returns the latest unresolved question", () => {
    const t = createAgentTranscript();
    t.apply(1, {
      type: "question",
      request_id: "r1",
      prompt: "first?",
      options: [],
    });
    t.apply(2, { type: "question_resolved", request_id: "unknown" });
    t.apply(3, {
      type: "question",
      request_id: "r2",
      prompt: "second?",
      options: [],
    });

    expect(t.pendingQuestion()).toMatchObject({
      requestId: "r2",
      prompt: "second?",
    });

    t.apply(4, { type: "question_resolved", request_id: "r2" });
    expect(t.pendingQuestion()).toMatchObject({
      requestId: "r1",
      prompt: "first?",
    });
  });

  it("stays consistent when events are applied one at a time between blocks() reads", () => {
    const t = createAgentTranscript();
    const events: AgentEvent[] = [
      { type: "user_message", text: "hi" },
      { type: "agent_message_chunk", text: "a" },
      { type: "agent_message_chunk", text: "b" },
      {
        type: "tool_call",
        tool_call_id: "tc1",
        title: "Edit",
        status: "running",
      },
      { type: "tool_call_update", tool_call_id: "tc1", status: "done" },
      { type: "turn_ended", stop_reason: "end_turn" },
    ];
    const seen: string[][] = [];
    events.forEach((event, i) => {
      t.apply(i + 1, event);
      seen.push(kinds(t.blocks()));
    });

    expect(seen).toEqual([
      ["user"],
      ["user", "assistant"],
      ["user", "assistant"],
      ["user", "assistant", "tool_call"],
      ["user", "assistant", "tool_call"],
      ["user", "assistant", "tool_call", "turn_end"],
    ]);
    expect(t.blocks()[1]).toMatchObject({ text: "ab", closed: true });
    expect(t.blocks()[2]).toMatchObject({ status: "done" });
    expect(t.lastSeq()).toBe(6);
  });

  it("drops replayed seqs when live events overlap a backfill page", () => {
    const t = createAgentTranscript();
    const backfill: AgentEvent[] = [
      { type: "user_message", text: "hi" },
      { type: "agent_message_chunk", text: "hel" },
      { type: "agent_message_chunk", text: "lo" },
      { type: "turn_ended", stop_reason: "end_turn" },
      { type: "user_message", text: "again" },
      { type: "agent_message_chunk", text: "wo" },
    ];
    backfill.forEach((event, i) => t.apply(i + 1, event));

    // Live stream resumes at seq 5: 5 and 6 were already applied via backfill.
    t.apply(5, { type: "user_message", text: "again" });
    t.apply(6, { type: "agent_message_chunk", text: "DUPLICATE" });
    t.apply(7, { type: "agent_message_chunk", text: "rld" });

    const blocks = t.blocks();
    expect(kinds(blocks)).toEqual([
      "user",
      "assistant",
      "turn_end",
      "user",
      "assistant",
    ]);
    expect(blocks[1]).toMatchObject({ text: "hello" });
    expect(blocks[4]).toMatchObject({ text: "world" });
    expect(t.lastSeq()).toBe(7);
  });

  it("appends a turn_end divider block per turn_ended without collapsing", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "agent_message_chunk", text: "answer" });
    t.apply(2, { type: "turn_ended", stop_reason: "end_turn" });
    t.apply(3, { type: "turn_ended", stop_reason: "end_turn" });

    const blocks = t.blocks();
    expect(kinds(blocks)).toEqual(["assistant", "turn_end", "turn_end"]);
    expect(blocks[0]).toMatchObject({ closed: true });
    expect(blocks[1]).toMatchObject({ stopReason: "end_turn" });
    expect(blocks[2]).toMatchObject({ stopReason: "end_turn" });
  });

  it("creates an error block for error events", () => {
    const t = createAgentTranscript();
    t.apply(1, { type: "error", message: "connection lost" });

    expect(t.blocks()).toEqual([
      { kind: "error", id: "b0", message: "connection lost" },
    ]);
  });

  it("creates a plan block carrying entries_json verbatim", () => {
    const entries = JSON.stringify([{ content: "step", status: "pending" }]);
    const t = createAgentTranscript();
    t.apply(1, { type: "plan", entries_json: entries });

    expect(t.blocks()).toEqual([
      { kind: "plan", id: "b0", entriesJson: entries },
    ]);
  });
});
