# Persistent Workspace Tabs Design

## Goal

Expanded terminal workspaces should use user-owned persistent tabs, similar to zellij tabs. A tab is a workspace group. Terminals in different working directories can belong to the same tab when the user chooses that grouping. Workpaths are launch shortcuts only: they pick the `cwd` for a new terminal so the user does not have to start and then run `cd`.

## Behavior

- A persisted tab belongs to one user and one machine.
- A terminal may reference one persisted tab through `workspace_group_id`.
- Workspace rendering groups terminals by `workspace_group_id` first.
- Terminals without `workspace_group_id` keep the current fallback behavior and are grouped by `cwd`.
- Creating a pane from an expanded workspace assigns the new terminal to the active persisted tab when one is active.
- Users can create a new tab from the expanded workspace. The current active pane moves into that tab.
- Users can move the active pane to another persisted tab.
- Persisted tabs remain visible when they temporarily have no panes.
- Workpath selection does not define workspace membership. Starting a terminal from a workpath may choose the launch directory, but the new terminal belongs to the current tab when launched from an expanded workspace.

## Data Model

- `workspace_groups`: persisted tab metadata (`id`, `user_id`, `machine_id`, `name`, `sort_order`, `created_at`).
- `terminal_sessions.workspace_group_id`: nullable tab assignment for active and recovered terminal sessions.
- `TerminalInfo.workspace_group_id`: nullable tab assignment sent to the browser.
- `BrowserStateSnapshot.workspace_groups`: the persisted tabs visible to the user.

## API

- `GET /api/machines/{machine_id}/workspace-groups`
- `POST /api/machines/{machine_id}/workspace-groups`
- `PUT /api/machines/{machine_id}/terminals/{terminal_id}/workspace-group`

## Testing

- Unit tests cover tab-first grouping and legacy cwd fallback.
- Unit tests cover bootstrap state carrying workspace groups and terminal updates.
- Rust tests cover database persistence and protocol compilation through `cargo test`.
