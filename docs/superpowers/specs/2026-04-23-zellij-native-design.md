# Webmux Native Zellij Design

## Goal

Introduce a first-class `Native Zellij` path into `webmux` without disturbing the current Legacy terminal flow.

The first release is explicitly a trial path:

- Keep the current Legacy terminal stack unchanged.
- Remove `Zellij Native` from the `+ New Terminal` path.
- Add a dedicated sidebar entry named `Native Zellij`.
- Clicking that entry opens a `webmux`-hosted native page in the current tab.
- `webmux` automatically reuses a long-lived managed Zellij session for the current user on the current machine.

This design is optimized for trying Zellij safely first, not for replacing the old stack in one step.

## Product Decisions

### User Entry Point

The only primary entry for this feature is a dedicated sidebar item:

- Label: `Native Zellij`
- Placement: machine-scoped navigation area in the workbench sidebar
- Visibility: shown when a machine is selected
- Status badge: `Beta`

`+ New Terminal` remains Legacy-only in this phase. The user should not perceive Zellij as "another terminal card mode". It is a separate terminal path.

### Navigation Model

Clicking `Native Zellij` navigates to a dedicated route owned by `webmux`:

`/machines/:machineId/native-zellij`

This route stays in the current tab and provides:

- a back button to return to the normal workbench
- machine name
- `Native Zellij` / `Beta` identity
- minimal connection or readiness status
- the native Zellij UI as the main content area

This should feel like entering a different terminal environment inside `webmux`, not being thrown to a raw external URL.

### Session Model

The managed session policy for phase one is fixed:

- one long-lived managed Zellij session per user per machine
- the session is reused on every visit
- entering `Native Zellij` restores the last state instead of creating a clean session each time

The user does not choose from a session list and does not manually create sessions in the first release.

### Failure Model

If the machine is not ready for Zellij, the sidebar entry is still shown.

Opening `Native Zellij` should lead to a guided state, not a missing-feature dead end:

- machine does not have Zellij installed
- native web server is unavailable
- managed session bootstrap failed

In all of these cases, the page should stay inside `webmux` and show a clear recovery path.

## Non-Goals

The first release does not include:

- replacing Legacy terminals
- mixing Zellij into existing terminal cards
- a Zellij session list or session picker
- shared Zellij sessions across users
- a generic terminal-engine abstraction across all terminal features
- deep visual merging of Zellij UI into current xterm card components

## High-Level Architecture

The recommended shape is:

1. `webmux` app owns navigation and page shell.
2. `webmux` hub owns auth, authorization, and machine-scoped routing.
3. `webmux-node` owns machine-local Zellij orchestration.
4. Zellij itself owns the native terminal UI.

This keeps each layer focused:

- app: where the user goes
- hub: whether the user is allowed and how the browser reaches the machine safely
- node: whether Zellij exists, whether the managed session exists, and whether the local native web server is ready
- Zellij: actual native terminal experience

## Detailed Flow

### Happy Path

When the user clicks `Native Zellij`:

1. The app navigates to `/machines/:machineId/native-zellij`.
2. The page requests a bootstrap endpoint from the hub.
3. The hub verifies that the user can access the machine.
4. The hub asks the node to ensure Native Zellij is ready for this user on this machine.
5. The node:
   - checks whether Zellij is installed
   - ensures the local Zellij native web server is available
   - ensures the managed session for this user exists
   - returns readiness metadata to the hub
6. The hub returns a same-origin proxy target to the app.
7. The app renders the native page shell and loads the proxied Zellij UI in the main content area.

### Missing Zellij

If Zellij is not installed:

1. The node reports a structured capability failure.
2. The hub returns a typed "not ready" response.
3. The app renders an install/enable screen inside the native route.

That screen should include:

- a short explanation of what is missing
- the current machine name
- install or enable instructions
- a retry button
- a back-to-workbench button

### Transient Failure

If bootstrap fails after the machine is otherwise valid:

- keep the user on the native route
- show a recoverable error state
- offer retry
- do not silently fall back to Legacy

Silent fallback would make trial behavior ambiguous and hard to validate.

## Route and Page Structure

### New App Route

Add a dedicated route for the native page instead of reusing terminal overlays.

The page should be visually minimal:

- compact top bar
- no terminal grid
- no Legacy terminal cards
- main pane reserved for Zellij native content

### Sidebar Integration

The existing machine-scoped sidebar is the right place to add the entry because it frames Zellij as a machine capability, not a one-off action.

The item should support three states:

- available: normal click target
- unavailable but discoverable: still clickable, opens guidance state
- loading: shown while the target page is bootstrapping

## Native Content Embedding Strategy

The first release should not try to rebuild the native Zellij UI in React.

Instead, `webmux` should host a dedicated native page route and load the Zellij native web experience through a `webmux`-controlled same-origin proxy surface.

The simplest maintainable shape is:

- `webmux` page shell for header, status, and navigation
- proxied native Zellij content in the main pane

This preserves:

- current-tab navigation
- clear return path
- centralized auth and authorization
- future rollout control

And it avoids:

- coupling current xterm-specific code to Zellij internals
- reimplementing native Zellij browser behavior

## Node Responsibilities

`webmux-node` needs a new Native Zellij responsibility set distinct from the current tmux-backed PTY manager.

Required responsibilities:

- detect whether `zellij` is installed
- determine whether the native web capability is available in the installed version
- ensure a machine-local native web server is available
- ensure the per-user managed session exists
- reuse the existing managed session on repeated visits
- expose enough structured metadata for the hub to proxy browser traffic safely

This should be implemented as a dedicated module, not folded into the current tmux manager.

## Managed Session Naming

The naming policy must be deterministic and machine-local.

Required properties:

- unique per user on the same machine
- stable across visits
- safe for command-line and Zellij naming constraints
- not based on a display name that may change

Fixed policy:

- derive from authenticated `user_id`
- compute lowercase SHA-256
- take the first 12 hex characters
- prefix with `webmux-user-`

Example:

- `user_id = 12345`
- `session_name = webmux-user-5994471abb01`

The contract is fixed: same user + same machine always resolves to the same managed session name.

## Hub Responsibilities

The hub should remain the only public browser-facing control plane.

New hub responsibilities:

- authorize access to the native route per machine
- request native bootstrap from the node
- translate node capability failures into typed app responses
- expose same-origin proxy endpoints for the native Zellij content

The hub must not require the browser to connect directly to a machine-local Zellij URL.

## Security Constraints

The browser should never be told to open a raw machine-local Zellij address directly.

Security requirements:

- machine-local Zellij native web should bind locally, not publicly
- browser access must stay gated by existing `webmux` auth
- machine authorization must remain user-scoped
- proxying must preserve user-to-machine access checks

This keeps rollout and later migration under `webmux` control instead of spreading trust to ad hoc machine URLs.

## Data and Capability Model

The app needs to know whether a machine can use Native Zellij.

Phase one should expose a simple capability model from the backend:

- unsupported: machine definitely cannot launch Native Zellij
- available: machine can launch or resume Native Zellij
- unknown/loading: capability not resolved yet

This capability should drive:

- sidebar affordance
- native page state
- guidance copy

The feature does not need a broad capabilities framework in the first release; a focused Zellij-native capability is enough.

## UX States

The native route needs explicit states:

- bootstrapping
- ready
- missing installation
- temporarily unavailable
- unauthorized or machine unavailable

Each state should render as a purposeful page, not a blank container.

## Testing Expectations

Implementation should extend both automated tests and lightweight manual verification.

Tests expected from this design:

- app navigation tests for sidebar entry visibility and route behavior
- hub authorization tests for native route access
- node unit tests for managed-session naming and capability detection
- node tests for "ensure session exists" behavior
- proxy-path tests covering authenticated access and machine ownership

Manual verification expected:

- open a machine with Zellij available and confirm repeated visits reuse the same session
- open a machine without Zellij and confirm the guidance page appears
- return from native page back to workbench without losing basic navigation state

## Documentation Impact

Implementation should update:

- machine setup or install docs for Zellij prerequisites
- user-facing usage docs for `Native Zellij`
- any onboarding copy that currently implies Legacy terminals are the only path

## Migration Value

This design gives `webmux` a practical migration path:

- Legacy remains stable and untouched.
- Native Zellij gets a clean trial surface.
- The user learns one clear entry point.
- If the trial succeeds, the native route can gradually become the preferred terminal path.

That lets the team evaluate Zellij on real usage without first paying the cost of a full terminal-stack rewrite.
