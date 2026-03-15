# AI Coding Run Manager Design

## Overview

Webmux evolves from "remote tmux client" to "AI coding run manager". The core concept is **Run** — a managed AI coding task (Codex or Claude Code) with structured state, not just a raw terminal session.

## Two-layer interaction model

1. **Structured Control (primary)** — task cards with status, prompt input, approve/reject buttons
2. **Raw Terminal Fallback (secondary)** — full terminal only when needed

## Run Data Model

```typescript
interface Run {
  id: string
  agentId: string
  tool: 'codex' | 'claude'
  repoPath: string
  branch: string
  prompt: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  summary?: string
  hasDiff: boolean
  unread: boolean
  tmuxSession: string
}

type RunStatus =
  | 'starting'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'success'
  | 'failed'
  | 'interrupted'
```

## Agent Wrapper

Agent wraps codex/claude invocations, monitors pty output for status patterns:

| Tool | Pattern | Status |
|---|---|---|
| Claude Code | Idle prompt (`>` at start) | waiting_input |
| Claude Code | `Do you want to proceed?` / `Allow` / `Deny` | waiting_approval |
| Claude Code | Tool execution in progress | running |
| Codex | Idle prompt / `What would you like` | waiting_input |
| Codex | `Apply changes?` / `[y/N]` | waiting_approval |
| Codex | Generating/executing | running |
| Both | Process exit 0 | success |
| Both | Process exit != 0 | failed |
| Both | SIGINT received | interrupted |

## Protocol Extensions

### Server → Agent (new)

```typescript
| { type: 'run-start'; runId: string; tool: 'codex' | 'claude'; repoPath: string; prompt: string }
| { type: 'run-input'; runId: string; input: string }
| { type: 'run-interrupt'; runId: string }
| { type: 'run-approve'; runId: string }
| { type: 'run-reject'; runId: string }
```

### Agent → Server (new)

```typescript
| { type: 'run-event'; runId: string; status: RunStatus; summary?: string; hasDiff?: boolean }
| { type: 'run-output'; runId: string; data: string }
```

## API

```
POST   /api/agents/:id/runs                    — start run
GET    /api/agents/:id/runs                    — list runs
GET    /api/agents/:id/runs/:runId             — run detail
POST   /api/agents/:id/runs/:runId/input       — send prompt
POST   /api/agents/:id/runs/:runId/interrupt    — Ctrl+C
POST   /api/agents/:id/runs/:runId/approve     — approve changes
POST   /api/agents/:id/runs/:runId/reject      — reject changes
WS     /ws/run?runId=xxx&token=xxx             — real-time events + output
```

## React Native App

### Screens

1. **RunsScreen** — all runs, grouped by status, task cards
2. **NewRunScreen** — select machine, tool, repo, prompt
3. **RunDetailScreen** — output summary, prompt input, action buttons
4. **TerminalScreen** — WebView + xterm.js fallback

### Push Notifications

- waiting_input → "Claude Code is waiting for your input"
- waiting_approval → "Codex wants to apply changes"
- success → "Run completed"
- failed → "Run failed"

## Project Structure

```
packages/
├── shared/    — existing + Run types + run protocol messages
├── server/    — existing + runs API + run events WS + push
├── agent/     — existing + wrapper + pty status detection
├── web/       — existing (upgrade to run manager later)
└── mobile/    — React Native app (new)
```

## Implementation Phases

1. Agent wrapper (run-start, pty monitoring, status detection)
2. Server runs API + WebSocket
3. RN app (4 screens + push)
4. Web upgrade to run manager view
