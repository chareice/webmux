# Phase 4 — The phone: Report

Date: 2026-09-04. Plan: `2026-09-04-desktop-hub-role.md`, phase 4. Design:
`docs/design/desktop-hub/Phone*.dc.html`.

## What was built

The phone is the same web app the hub serves, so the theme from phase 3
already reached it the moment the hub served the new bundle. This phase is
the four phone artboards on top of that, in `MobileWorkbench.web.tsx` and
the phone branch of `app/login.tsx`.

- **Welcome** (`PhoneWelcome`) — landed with phase 3's sign-in restyle:
  the wordmark, "Your terminal stays home.", Scan the code as the one
  coral button, the address field under a "No code handy?" rule.
- **Can't reach the hub** (`PhoneBlocked`) — new. Shown instead of the
  address form when the app could not reach its stored hub on launch, or
  when a connect attempt fails. When `mobile_hub.rs` reports the refused
  Local Network permission (iOS answers it with "no route to host"), the
  page says the hub is there and this phone is not allowed to see it yet,
  names the two switches — Local Network, and Wireless Data on phones sold
  in China — and offers Open Settings, Try again, and Use another address.
  Any other failure says nothing answered at that address, with the hub's
  own reason and the same two ways on.
- **Machines and sessions** (`PhoneList`) — the switcher sheet. A chip per
  machine across the top (the active one carries the meters and opens the
  machine sheet; the others switch to that machine; offline ones dashed),
  New terminal as a coral pill beside Tabs, sections per tab with the pane
  count, 52px card rows with the terminal's name in display type and its
  directory in mono, the active row filled.
- **Terminal** (`PhoneTerminal`) — the title bar: 52px, the terminal's name
  in display type over "tab · machine" in mono, a pill that says Keyboard,
  Watching or View only from the control lease, the round New terminal
  button, the position badge, the machine dot. The key bar was already the
  palette's (coral `^C`); sizes stay as `DESIGN.md` has them.
- The sheets take the site's shapes: 28px top radius, ink scrim, display
  titles, 52px menu rows. The machine sheet's title is Machines.

Every test id the mobile specs read is unchanged: `mobile-title-bar`,
`-label`, `mobile-bar-new-terminal`, `mobile-session-switcher`,
`mobile-session-header` and its `-dot/-rtt/-cpu/-mem/-disk`,
`mobile-host-button`, `mobile-session-row-*`, `mobile-session-close-*`,
`mobile-session-switcher-new-terminal`, `mobile-workspace-manager-button`,
`mobile-control-toggle`, `mobile-host-remove-*`. One is new:
`mobile-title-bar-control` (the pill).

## Test output

- `pnpm typecheck`: clean.
- `pnpm test`: 40 files, 305 tests passed.
- E2E_RESULT

## Seen working

Through the dev proxy at a 375×812 viewport, signed in to the hub on the
development Mac: the title bar with the terminal's name, "tab 2 ·
MacBook-Pro-3.local", the Keyboard pill and the badge; the switcher sheet
with the machine chip (name, 1ms, cpu/mem/disk), the two pills, and the
sections "zourenyuan · 2 panes" and "tab 2 · 1 pane" with their rows.

The Can't reach the hub page only exists in the phone app (it needs the
app's `mobile_hub.rs` errors), so it was not exercised here; its two
branches are driven by the message text `mobile_hub.rs` already produces,
which the previous screen also matched on.

## Not done here

- **On-device pass.** The Local Network denial path, and the whole app on
  an iPhone, need a device: the next TestFlight build from `ios-v*`.
- **The key bar at 44px.** The wireframe drew 44px keys; `DESIGN.md` keeps
  30px on the compact shell and the specs measure them. Left as is.
