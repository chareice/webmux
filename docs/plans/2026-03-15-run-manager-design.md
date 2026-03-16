# AI Coding Thread Manager Design

## Overview

Webmux thread management is now based on **structured timeline events**, not on
sanitized PTY output.

The product split is explicit:

1. `Thread Detail` is a readable task timeline.
2. `Terminal` is a separate full-fidelity shell.

We do not try to make a lossy terminal transcript behave like a terminal.

## Thread Data Model

```typescript
interface Run {
  id: string
  agentId: string
  tool: 'codex' | 'claude'
  repoPath: string
  branch: string
  prompt: string
  status: 'starting' | 'running' | 'success' | 'failed' | 'interrupted'
  createdAt: number
  updatedAt: number
  summary?: string
  hasDiff: boolean
  unread: boolean
}
```

## Timeline Event Model

```typescript
type RunTimelineEvent =
  | {
      type: 'message'
      role: 'assistant' | 'user' | 'system'
      text: string
    }
  | {
      type: 'command'
      status: 'started' | 'completed' | 'failed'
      command: string
      output: string
      exitCode: number | null
    }
  | {
      type: 'activity'
      status: 'info' | 'success' | 'warning' | 'error'
      label: string
      detail?: string
    }
```

## Agent Execution Model

Threads are executed as structured tool turns, not tmux-backed PTY sessions.

- Codex threads run through `@openai/codex-sdk`, with one Webmux thread bound
  to one Codex SDK thread ID and follow-up turns calling `resumeThread(threadId)`
- Claude runs through `claude -p --output-format stream-json`

Adapters convert tool-native JSON lines into structured timeline events.

## Protocol

### Server → Agent

```typescript
| { type: 'run-turn-start'; runId: string; turnId: string; tool: 'codex' | 'claude'; repoPath: string; prompt: string; toolThreadId?: string }
| { type: 'run-turn-interrupt'; runId: string; turnId: string }
| { type: 'run-turn-kill'; runId: string; turnId: string }
```

### Agent → Server

```typescript
| { type: 'run-status'; runId: string; turnId: string; status: RunStatus; summary?: string; hasDiff?: boolean; toolThreadId?: string }
| { type: 'run-item'; runId: string; turnId: string; item: RunTimelineEventPayload }
```

## API

```text
POST   /api/agents/:id/threads                   start thread
GET    /api/agents/:id/threads                   list threads for one agent
GET    /api/threads                              list threads for current user
GET    /api/agents/:id/threads/:threadId         thread detail with timeline items
POST   /api/agents/:id/threads/:threadId/turns   continue a thread with a new turn
POST   /api/agents/:id/threads/:threadId/read    mark thread as read
POST   /api/agents/:id/threads/:threadId/interrupt interrupt the active turn
DELETE /api/agents/:id/threads/:threadId         delete thread
WS     /ws/thread?threadId=xxx&token=xxx         real-time run-status and run-item events
```

Legacy interactive routes such as `/input`, `/approve`, and `/reject` are
removed.

## Mobile Product Model

- `ThreadsScreen` shows active and completed threads
- `ThreadDetailScreen` renders structured timeline cards
- `AgentsScreen` is the entry for machine browsing and terminal access
- `TerminalScreen` remains the fallback for full shell fidelity

## Non-Goals

- No ANSI/VT100 reconstruction in `Thread Detail`
- No attempt to mirror full-screen TUIs into the timeline
- No embedded approval/input controls in structured run cards

If a task requires true terminal interaction, users must switch to
`TerminalScreen`.
