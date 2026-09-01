# Terminal-first UX reset — implementation report

Date: 2026-09-01

## Outcome

The browser product is terminal-only again. Desktop uses the compact top
TabBar and terminal workspace; mobile opens directly into the terminal shell
and creates terminals without an intermediate session-type picker.

This deliberately removes the unfinished product seam where terminals and
agent chats competed inside one session navigation model. The terminal remains
the primary object: hosts contain tabs, tabs contain up to four terminal panes,
and the command palette/prefix bindings operate on that hierarchy.

## Frontend changes

- Restored `TabBar.web.tsx` and `HostSwitcher.web.tsx` for desktop navigation,
  host status, control handoff, tab creation/reorder, settings, and sign-out.
- Restored the terminal-only `MobileWorkbench.web.tsx`: the title-bar plus
  action creates a terminal directly and the switcher contains terminal rows
  only.
- Removed the sidebar, agent chat, agent badge, new-session dialog/sheet, agent
  transcript/feed, remembered agent defaults, and their projection/state code.
- Removed browser-side agent-session REST helpers and bootstrap reducer state.
- Removed desktop/mobile agent-session E2E specs and returned the remaining
  specs to terminal-first selectors and behavior.

## Compatibility boundary

The ACP backend, database records, machine relay, shared wire contracts, and
server routes are intentionally retained. The browser no longer imports or
renders that capability, but upgrading does not require destructive data or
schema removal. A future agent feature can be reintroduced behind a terminal-
native command or preset after its product contract is clear.

## Preserved work

The reset is not a historical revert. It keeps changes that landed after the
old terminal shell, including terminal websocket compression, previous-tab
keepalive, mobile input/IME/touch-scroll fixes, and registered-host removal.
Host removal is available in both the desktop host switcher and mobile host
sheet with the existing confirmation flow.

## Validation

- `pnpm typecheck`
- `pnpm test` — 38 files, 292 tests passed
- `pnpm build`
- `pnpm e2e:test` — 82 tests passed in the Docker Hub/machine/browser stack
- `git diff --check`
