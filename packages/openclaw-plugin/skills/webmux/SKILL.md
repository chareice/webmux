---
name: webmux
description: Run AI coding tasks on remote machines via Webmux
openclaw:
  always: false
  triggerWhen:
    - user mentions running code on a remote machine or server
    - user asks to delegate a coding task
    - user mentions "webmux", "remote agent", or "remote coding"
---

# Webmux Remote Coding

You have access to remote coding agents via Webmux. These agents are machines
with Claude or Codex installed, ready to execute coding tasks.

## Available Tools

| Tool | Purpose |
|------|---------|
| `webmux_list_agents` | See which remote machines are online |
| `webmux_run` | Start a coding task on a remote machine |
| `webmux_get_result` | Check task status and read results |
| `webmux_continue` | Send follow-up instructions to a running session |
| `webmux_interrupt` | Stop a running task |
| `webmux_list_threads` | List all coding sessions |
| `webmux_list_projects` | List projects |
| `webmux_create_task` | Queue a task in a project |
| `webmux_list_tasks` | List tasks in a project |

## Workflow

1. **Always start with `webmux_list_agents`** to check which machines are online.
   Never guess an agent ID.

2. **Ask the user for `repoPath`** if not obvious from context.
   This is the absolute path to the repository on the remote machine.

3. **Use `webmux_run`** to start a task. It returns immediately with a thread ID.

4. **Poll with `webmux_get_result`** to check progress.
   - If status is `running` or `queued` or `starting`: wait a few seconds, then check again.
   - If status is `success`: summarize the result for the user.
   - If status is `failed`: report the error and ask if user wants to retry.

5. **Use `webmux_continue`** to send follow-up instructions to the same session.

## Defaults

- Default tool: `claude` (use `codex` only if user asks)
- Don't set model unless user specifies one
- Summarize results in natural language; include code snippets only if relevant

## For Project-Based Workflows

If the user wants to queue multiple tasks or manage ongoing work:
1. `webmux_list_projects` to find or confirm the project
2. `webmux_create_task` to queue tasks
3. Tasks are picked up and executed automatically by the assigned agent

## Error Handling

- If an agent is offline, tell the user and suggest trying another agent
- If the API returns an error, report it clearly without raw JSON
- If a task takes too long (>5 minutes), inform the user it's still running
  and offer to check back later
