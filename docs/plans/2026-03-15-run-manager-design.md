# AI Coding Run Manager Design

## Overview

Webmux run management is now based on **structured timeline events**, not on
sanitized PTY output.

The product split is explicit:

1. `Run Detail` is a readable task timeline.
2. `Terminal` is a separate full-fidelity shell.

We do not try to make a lossy terminal transcript behave like a terminal.

## Run Data Model

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

Runs are executed as direct child processes, not tmux-backed PTY sessions.

- Codex runs through `codex exec --json`
- Claude runs through `claude -p --output-format stream-json`

Adapters convert tool-native JSON lines into structured timeline events.

## Protocol

### Server → Agent

```typescript
| { type: 'run-start'; runId: string; tool: 'codex' | 'claude'; repoPath: string; prompt: string }
| { type: 'run-interrupt'; runId: string }
| { type: 'run-kill'; runId: string }
```

### Agent → Server

```typescript
| { type: 'run-status'; runId: string; status: RunStatus; summary?: string; hasDiff?: boolean }
| { type: 'run-item'; runId: string; item: RunTimelineEventPayload }
```

## API

```text
POST   /api/agents/:id/runs                start run
GET    /api/agents/:id/runs                list runs for one agent
GET    /api/runs                           list runs for current user
GET    /api/agents/:id/runs/:runId         run detail with timeline items
POST   /api/agents/:id/runs/:runId/read    mark run as read
POST   /api/agents/:id/runs/:runId/interrupt interrupt a running task
DELETE /api/agents/:id/runs/:runId         delete run
WS     /ws/run?runId=xxx&token=xxx         real-time run-status and run-item events
```

Legacy interactive routes such as `/input`, `/approve`, and `/reject` are
removed.

## Mobile Product Model

- `RunsScreen` shows active and completed tasks
- `RunDetailScreen` renders structured timeline cards
- `AgentsScreen` is the entry for machine browsing and terminal access
- `TerminalScreen` remains the fallback for full shell fidelity

## Non-Goals

- No ANSI/VT100 reconstruction in `Run Detail`
- No attempt to mirror full-screen TUIs into the timeline
- No embedded approval/input controls in structured run cards

If a task requires true terminal interaction, users must switch to
`TerminalScreen`.
