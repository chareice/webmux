// Per-session runtime store feeding the agent chat view.
//
// One module-level singleton holds a feed entry per agent session: the
// incremental `AgentTranscript`, a backfill guard, and a cached immutable
// snapshot for React (`useSyncExternalStore` relies on snapshot identity to
// skip re-renders, so the snapshot object is only regenerated when the
// transcript actually changes).
//
// Live events arrive via `applyLiveAgentSessionEvent` from the events-WS
// handling site; `ensureAgentSessionFeed` seeds history through the events
// REST endpoint. Until the backfill has landed, live events are BUFFERED
// (not applied): the transcript only dedups `seq <= lastSeq`, so applying a
// live event first would make the backfill silently drop all earlier history.
// After the backfill resolves, the buffer is flushed in arrival order and the
// transcript's dedup drops the overlap. A lightweight per-session
// pending-question map is maintained alongside the transcript so the
// inbox/sidebar can show unresolved questions before any backfill has run.
//
// The store core is DOM-free; only the hook at the bottom touches React.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AgentEvent } from "@offdesk/shared";

import { getAgentSessionEvents } from "./api";
import {
  createAgentTranscript,
  type AgentTranscript,
  type TranscriptBlock,
} from "./agentTranscript";

export interface AgentSessionFeedSnapshot {
  blocks: readonly TranscriptBlock[];
  lastSeq: number;
  backfilled: boolean;
}

export interface AgentSessionPendingQuestion {
  requestId: string;
  prompt: string;
}

interface SessionFeedEntry {
  machineId: string;
  transcript: AgentTranscript;
  backfilled: boolean;
  /** Shared in-flight backfill; concurrent `ensure` calls reuse it. */
  backfillPromise: Promise<void> | null;
  /** Live events received before the backfill landed, in arrival order. */
  pendingLive: { seq: number; event: AgentEvent }[];
  version: number;
  snapshot: AgentSessionFeedSnapshot;
  listeners: Set<() => void>;
}

// Bound on buffered pre-backfill live events for sessions that are never
// opened; the backfill window is 500, so this is already generous.
const PENDING_LIVE_CAP = 1000;

const EMPTY_SNAPSHOT: AgentSessionFeedSnapshot = Object.freeze({
  blocks: Object.freeze([]) as readonly TranscriptBlock[],
  lastSeq: 0,
  backfilled: false,
});

const sessions = new Map<string, SessionFeedEntry>();
const pendingQuestions = new Map<string, AgentSessionPendingQuestion>();

function getOrCreateEntry(machineId: string, sessionId: string): SessionFeedEntry {
  let entry = sessions.get(sessionId);
  if (!entry) {
    const transcript = createAgentTranscript();
    entry = {
      machineId,
      transcript,
      backfilled: false,
      backfillPromise: null,
      pendingLive: [],
      version: 0,
      snapshot: EMPTY_SNAPSHOT,
      listeners: new Set(),
    };
    sessions.set(sessionId, entry);
  }
  return entry;
}

function publish(entry: SessionFeedEntry): void {
  entry.version += 1;
  entry.snapshot = {
    // Copy: transcript.blocks() is the mutable internal array; React must see
    // a fresh immutable array per change.
    blocks: [...entry.transcript.blocks()],
    lastSeq: entry.transcript.lastSeq(),
    backfilled: entry.backfilled,
  };
  for (const listener of entry.listeners) listener();
}

function trackPendingQuestion(
  sessionId: string,
  event: AgentEvent,
): void {
  if (event.type === "question") {
    pendingQuestions.set(sessionId, {
      requestId: event.request_id,
      prompt: event.prompt,
    });
  } else if (event.type === "question_resolved") {
    pendingQuestions.delete(sessionId);
  }
}

/** Wires a live browser event envelope into the store. */
export function applyLiveAgentSessionEvent(
  machineId: string,
  sessionId: string,
  seq: number,
  event: AgentEvent,
): void {
  const entry = getOrCreateEntry(machineId, sessionId);
  if (!entry.backfilled) {
    // Buffer until the backfill lands (see the module comment); the pending
    // question map is tracked immediately so the inbox stays live.
    entry.pendingLive.push({ seq, event });
    if (entry.pendingLive.length > PENDING_LIVE_CAP) entry.pendingLive.shift();
    trackPendingQuestion(sessionId, event);
    return;
  }
  const isNew = seq > entry.transcript.lastSeq();
  entry.transcript.apply(seq, event);
  if (!isNew) return;

  trackPendingQuestion(sessionId, event);
  publish(entry);
}

/**
 * Seeds a session's transcript from the event log. The first call triggers a
 * backfill; later calls are no-ops while backfilled or while a fetch is in
 * flight (they share that fetch). Failures leave `backfilled` false so a
 * later call retries.
 */
export function ensureAgentSessionFeed(
  machineId: string,
  sessionId: string,
): void {
  const entry = getOrCreateEntry(machineId, sessionId);
  // The entry may have been created from a live envelope before the session
  // was known locally (machineId ""); the caller with a session object wins.
  if (machineId) entry.machineId = machineId;
  if (entry.backfilled || entry.backfillPromise) return;

  entry.backfillPromise = (async () => {
    try {
      const page = await getAgentSessionEvents(machineId, sessionId, 0, 500);
      for (const { seq, event } of page.events) {
        entry.transcript.apply(seq, event);
      }
      // Flush live events buffered during the fetch; the transcript's
      // `seq <= lastSeq` dedup drops the overlap.
      const buffered = entry.pendingLive;
      entry.pendingLive = [];
      for (const { seq, event } of buffered) {
        entry.transcript.apply(seq, event);
      }
      entry.backfilled = true;
      // Reconcile the lightweight pending-question map from the now-complete
      // transcript (covers history replayed before any live event).
      const pending = entry.transcript.pendingQuestion();
      if (pending) {
        pendingQuestions.set(sessionId, {
          requestId: pending.requestId,
          prompt: pending.prompt,
        });
      } else {
        pendingQuestions.delete(sessionId);
      }
      publish(entry);
    } catch {
      // Leave backfilled=false so a later ensure retries.
    } finally {
      entry.backfillPromise = null;
    }
  })();
}

/** Drops all state for a destroyed session. */
export function removeAgentSessionFeed(sessionId: string): void {
  sessions.delete(sessionId);
  pendingQuestions.delete(sessionId);
}

/**
 * Latest unresolved question for a session, from live events alone before
 * backfill and reconciled from the transcript afterwards.
 */
export function getAgentSessionPendingQuestion(
  sessionId: string,
): AgentSessionPendingQuestion | null {
  return pendingQuestions.get(sessionId) ?? null;
}

/** Non-React snapshot accessor; returns a stable cached reference. */
export function getAgentSessionFeedSnapshot(
  sessionId: string,
): AgentSessionFeedSnapshot {
  return sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT;
}

/** Test-only reset of all feed state. */
export function resetAgentSessionFeedsForTests(): void {
  sessions.clear();
  pendingQuestions.clear();
}

/**
 * React hook subscribing to one session's transcript. Takes the full session
 * (id + machine_id, as on `AgentSessionInfo`) so it can trigger the backfill
 * itself.
 */
export function useAgentSessionFeed(
  session: { id: string; machine_id: string } | null,
): AgentSessionFeedSnapshot {
  const sessionId = session?.id ?? null;
  const machineId = session?.machine_id ?? null;

  useEffect(() => {
    if (sessionId && machineId) ensureAgentSessionFeed(machineId, sessionId);
  }, [machineId, sessionId]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionId || !machineId) return () => {};
      const entry = getOrCreateEntry(machineId, sessionId);
      entry.listeners.add(onStoreChange);
      return () => {
        entry.listeners.delete(onStoreChange);
      };
    },
    [machineId, sessionId],
  );

  const getSnapshot = useCallback(
    () => (sessionId ? getAgentSessionFeedSnapshot(sessionId) : EMPTY_SNAPSHOT),
    [sessionId],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
