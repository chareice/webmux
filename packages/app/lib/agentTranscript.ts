// Incremental builder for the agent-session chat transcript.
//
// Agent sessions stream normalized ACP events (`AgentEvent` from
// `@webmux/shared`), each tagged with a per-session monotonic `seq`. The same
// builder serves a backfill page (events replayed in seq order) and live
// continuation, so `apply` dedups: any event with `seq <= last applied seq` is
// dropped.
//
// Pure and DOM-free so the aggregation rules are unit-testable. Chunk appends
// are O(1)-ish: the currently open assistant/thought block is tracked by index
// instead of rescanning the block list.

import type { AgentEvent, AgentQuestionOption } from "@webmux/shared";

export type TranscriptBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; closed: boolean }
  | { kind: "thought"; id: string; text: string; closed: boolean }
  | {
      kind: "tool_call";
      id: string;
      toolCallId: string;
      title: string;
      toolKind: string | null;
      status: string;
      content: string | null;
    }
  | { kind: "plan"; id: string; entriesJson: string }
  | {
      kind: "question";
      id: string;
      requestId: string;
      prompt: string;
      options: AgentQuestionOption[];
      resolved: boolean;
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "turn_end"; id: string; stopReason: string };

export interface PendingQuestion {
  requestId: string;
  prompt: string;
  options: AgentQuestionOption[];
}

export interface AgentTranscript {
  /** Applies an event; events with `seq <= lastSeq()` are dropped. */
  apply(seq: number, event: AgentEvent): void;
  /** Current ordered blocks. Read-only view over the internal array. */
  blocks(): readonly TranscriptBlock[];
  lastSeq(): number;
  /** Latest unresolved question block, if any. */
  pendingQuestion(): PendingQuestion | null;
}

export function createAgentTranscript(): AgentTranscript {
  const blocks: TranscriptBlock[] = [];
  const toolCallBlockIndex = new Map<string, number>();
  const questionBlockIndex = new Map<string, number>();
  // Index of the open assistant/thought block, or null once closed.
  let openBlockIndex: number | null = null;
  let lastSeq = 0;
  let nextBlockId = 0;

  function pushBlock(block: TranscriptBlock): number {
    blocks.push(block);
    return blocks.length - 1;
  }

  function newBlockId(): string {
    const id = `b${nextBlockId}`;
    nextBlockId += 1;
    return id;
  }

  function closeOpenBlock(): void {
    if (openBlockIndex === null) return;
    const block = blocks[openBlockIndex];
    if (block.kind === "assistant" || block.kind === "thought") {
      block.closed = true;
    }
    openBlockIndex = null;
  }

  function applyChunk(kind: "assistant" | "thought", text: string): void {
    const open = openBlockIndex === null ? null : blocks[openBlockIndex];
    if (open && open.kind === kind) {
      open.text += text;
      return;
    }
    closeOpenBlock();
    openBlockIndex = pushBlock({
      kind,
      id: newBlockId(),
      text,
      closed: false,
    });
  }

  function applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case "user_message":
        closeOpenBlock();
        pushBlock({ kind: "user", id: newBlockId(), text: event.text });
        break;
      case "agent_message_chunk":
        applyChunk("assistant", event.text);
        break;
      case "thought_chunk":
        applyChunk("thought", event.text);
        break;
      case "tool_call": {
        closeOpenBlock();
        const index = pushBlock({
          kind: "tool_call",
          id: newBlockId(),
          toolCallId: event.tool_call_id,
          title: event.title,
          toolKind: event.kind ?? null,
          status: event.status,
          content: null,
        });
        toolCallBlockIndex.set(event.tool_call_id, index);
        break;
      }
      case "tool_call_update": {
        closeOpenBlock();
        const index = toolCallBlockIndex.get(event.tool_call_id);
        if (index === undefined) break;
        const block = blocks[index];
        if (block.kind !== "tool_call") break;
        if (event.status != null) block.status = event.status;
        if (event.content != null) block.content = event.content;
        break;
      }
      case "plan":
        closeOpenBlock();
        pushBlock({
          kind: "plan",
          id: newBlockId(),
          entriesJson: event.entries_json,
        });
        break;
      case "question": {
        closeOpenBlock();
        const index = pushBlock({
          kind: "question",
          id: newBlockId(),
          requestId: event.request_id,
          prompt: event.prompt,
          options: event.options,
          resolved: false,
        });
        questionBlockIndex.set(event.request_id, index);
        break;
      }
      case "question_resolved": {
        closeOpenBlock();
        const index = questionBlockIndex.get(event.request_id);
        if (index === undefined) break;
        const block = blocks[index];
        if (block.kind !== "question") break;
        block.resolved = true;
        break;
      }
      case "turn_ended":
        closeOpenBlock();
        pushBlock({
          kind: "turn_end",
          id: newBlockId(),
          stopReason: event.stop_reason,
        });
        break;
      case "error":
        closeOpenBlock();
        pushBlock({ kind: "error", id: newBlockId(), message: event.message });
        break;
    }
  }

  return {
    apply(seq, event) {
      if (seq <= lastSeq) return;
      lastSeq = seq;
      applyEvent(event);
    },
    blocks() {
      return blocks;
    },
    lastSeq() {
      return lastSeq;
    },
    pendingQuestion() {
      for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const block = blocks[i];
        if (block.kind === "question" && !block.resolved) {
          return {
            requestId: block.requestId,
            prompt: block.prompt,
            options: block.options,
          };
        }
      }
      return null;
    },
  };
}
