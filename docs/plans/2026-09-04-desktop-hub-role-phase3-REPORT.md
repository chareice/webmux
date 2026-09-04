# Phase 3 — The screens: Report

Date: 2026-09-04. Plan: `2026-09-04-desktop-hub-role.md`, phase 3. Same
branch and PR as phase 2 (`feat/desktop-hub-role`, #390).

## What was built

**The theme.** The app's tokens now carry the site's palette: sand canvas,
cream surfaces, ink text, coral accent with cream on it, lagoon / sun / sea
darkened enough to read on cream, and the site's `#1e1b2e` for the terminal.
One change in `global.css` and the literal copies in `lib/theme.tsx`
recoloured every screen; `lib/colors.shared.ts` gives xterm the same
terminal. Fredoka (display) and Nunito (body) ship as woff2 in
`packages/app/public/fonts` — a hub with no internet still has them — and
`components/Warm.web.tsx` carries the site's recipes as components: pill
buttons with the hard coral shadow, 28px cards, the coral "donut" badge, the
sticker shadow. The dozen hard-coded dark-palette hexes in components were
swept to tokens (`--color-on-accent` is new). `DESIGN.md` is rewritten to
match; its dark-only principle is now "dark is for the terminal".

**The desktop app's screens** (`components/DesktopSetup.web.tsx`, mounted by
`app/_layout.tsx` for the desktop shell only, via `lib/desktopHub.ts`):

- **First run** — the question and two cards. Stores the answer with
  `set_desktop_role`.
- **Setting it up** — runs `hub_install` on mount, three pending steps, the
  macOS incoming-connections note; on failure, the reason, Try again, and
  "Just connect to a hub instead".
- **Hub ready** — the code (QR of the short link, ink on cream), the
  address picker fed by `candidates` (picking calls `hub_link` with that
  base URL and redraws the code), iPhone / Android buttons, the copyable
  link with the token elided on screen, and **Open my terminal**, which
  signs this app in to its own hub with the owner's token
  (`loginWithToken`, new in `lib/auth.tsx`) — or the browser sign-in when
  the hub is an OAuth one and has no link.
- **Connect to a hub** — the desktop branch of `app/login.tsx`, restyled:
  paste the sign-in link (a `?token=` signs in directly; a `?code=` is
  redeemed first), or an address plus the browser sign-in; and a way back
  to "this is the machine that stays on".
- **Settings → This machine** — the role; for a hub, the three service
  dots, Show the phone code (the same panel, compact), and a two-step
  "Stop being the hub" that runs `hub_uninstall`.

**The menu bar** (`tray.rs`): Open offdesk, Show the phone code (opens
Settings), Add a machine (opens the add-host dialog), Copy hub address
(`read_link` on a thread, to the clipboard), Quit. The window hears the
tray through `offdesk://…` events in `TerminalCanvas`.

## Test output

- `pnpm typecheck`: clean.
- `pnpm test`: 40 files, 305 tests passed (7 new in `lib/desktopHub.test.ts`).
- `pnpm build`: clean; `dist/fonts/` carries both woff2 files.
- `cargo clippy --lib` and `cargo test --lib` in `packages/desktop/src-tauri`:
  clean, 13 passed.
- `pnpm e2e:test` (the Docker hub/node/browser stack, `E2E_HUB_HOST_PORT=14317`
  beside the live hub): **87 passed**, 0 failed, 3.6 min. The first run had
  one failure — `terminal-osc52-clipboard` installs a stub `__TAURI_INTERNALS__`
  mid-page, and the gate, reading "am I the desktop shell" on every render,
  swapped the tree for the first-run screen. The shell is now decided once
  at module load (Tauri's bridge is there before any script runs), and the
  suite is clean.

## Seen working

Through the dev server behind `proxy.mjs`, with a mocked Tauri bridge in
the browser so the desktop-only screens render there (the mock answers
`desktop_role`, `hub_status`, `hub_install`, `hub_link` with canned data;
nothing else is faked):

- First run → Set this machine up → Setting it up → Hub ready, with the
  QR, the picker showing `en0` first and `bridge100` second, the elided
  link, and the sticker card — matching `docs/design/desktop-hub`.
- First run → Just connecting → the restyled sign-in.
- Without the mock: the browser sign-in page, and the workspace signed in
  against the hub on the development Mac — the top TabBar in cream and
  sand with the active tab merging into the dark terminal, the host
  switcher popover, the "sized by another device" banner.

`pnpm tauri dev` builds and launches the real app with the new screens
(the tray menu registers without error); its window could not be
screenshotted from this session, which lacks screen-recording permission,
so the desktop-only screens were verified through the mocked bridge above.

## Fixed along the way

- `tauri.macos.conf.json` redefined the main window with only the title-bar
  style, and Tauri replaces the `windows` array wholesale when merging — so
  macOS builds lost the 1200×800 size and the "offdesk" title and opened
  as an 800×600 "Tauri App". The overlay now carries the whole window, with
  the title hidden behind the native traffic lights.
- The macOS icon was a full-bleed square; macOS draws app icons as-is, so
  it sat in the Dock as a cream tile. `packages/desktop/icon/icon-macos.svg`
  is the donut on a rounded square with the margins macOS expects, and
  `icon.icns` is regenerated from it (`rsvg-convert` + `tauri icon`).
  Windows and Android icons are unchanged.
- The setup screens scroll instead of clipping their top when the window
  is shorter than the content.

## Deviations from the plan

- **TabBar, not sidebar.** The wireframe's workspace drew the sidebar from
  the 2026-08-29 IA; the 2026-09-01 reset had removed it. The reset stands;
  the existing chrome was restyled. The plan is corrected.
- **Native tray menu without the machines list or Start at login.** The
  list needs a signed-in hub call the tray does not have; the services
  already start at login. Both are in the plan text now.
- **Two font files added** to `packages/app/public/fonts` (70 KB). Not a
  dependency; the site's fonts, self-hosted for offline hubs.

## Seen in passing, not fixed

- Redeeming a `?code=` link through the dev proxy (`localhost:4000`)
  succeeded server-side (`POST /api/auth/code` → 200) but the page landed
  on the sign-in screen: `router.replace` before the redemption remounts
  the provider, and the second restore runs before the token is stored.
  Not touched here — the same code path predates this branch and the
  phone's scan flow is documented as working against a served hub; worth
  a look with a hub-served page.
- `resolvedTheme` is now `"light"`; nothing reads it for behaviour.

## Not done here

- **The acceptance run on a clean Mac** — First run → Hub ready with a
  scannable code, `launchctl list | grep offdesk` showing both services,
  the phone signing in — needs a Mac that is not already a hub, and the
  phase 1 signing before Gatekeeper lets a fresh Mac open the app at all.
- Playwright screenshots beside the artboards were not committed: the
  only signed-in workspace available was the developer's live hub.
