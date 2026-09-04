# The desktop app is the installer — Implementation Plan

Date: 2026-09-04. Decided with Ryan the same day, after the hub / node /
client wording landed in #388. Design (authoritative):
`docs/design/desktop-hub/*.dc.html` with `canvas.json`; the same canvas is
live at https://claude.ai/code/artifact/8d96adca-7d1b-497b-a76d-331dda921298.

## Goal

Someone who never opens a terminal downloads the Mac app, opens it, answers
one question, scans one code with their phone, and is looking at a terminal
on the Mac from the phone. The shell one-liner stays for NAS, VPS, Docker and
"add a second machine"; it stops being the front door.

## Settled decisions (do not relitigate in the PRs)

1. **The desktop app plays two roles, the user picks on first run.** "The one
   that stays on" makes this machine the hub. "Just connecting" makes it a
   client, which is everything the app is today. The choice is stored next
   to the hub URL the mobile app already keeps (`mobile_hub.rs`, `hub.json`)
   and can be changed in Settings.
2. **The hub role keeps the service model.** The app does not run the hub in
   its own process. On first run it does what `offdesk.dev/install` does:
   runs the bundled `offdesk-hub service install`, which installs the launchd
   hub and node services, registers this machine, and prints the link. Quit
   the app and the phone still works. `offdesk-hub link`, `offdesk` and
   every doc stay true. The app is the panel over those services, plus the
   menu bar item.
3. **tmux ships inside the app.** The node refuses to start without tmux
   (`crates/machine/src/main.rs`, `check_tmux_available`), and today the
   installer fails and tells the user to `brew install tmux`. That is the
   first wall for the person this is for. Bundle a tmux binary as a sidecar
   and put the sidecar directory first on the services' `PATH`. A system
   tmux, when present, keeps its own server: the two do not need to agree.
4. **Signed and notarized before anything else ships.** An unsigned app is
   "damaged" on macOS and gets a firewall prompt on every launch when the
   hub listens. That is a worse first minute than `curl | sh`. Phase 1 is CI.
5. **Windows is a client only.** No tmux on Windows, and the install script
   never covered it. The first-run question is not asked there; the app
   opens on Connect to a hub. Say so on the site.
6. **The chrome goes warm, the terminal stays dark.** The app adopts the
   site's palette and type (sand, cream, coral, sun; Fredoka, Nunito, Geist
   Mono) — see `site/src/styles/global.css`. `DESIGN.md`'s dark-only
   principle is revised: dark is for the terminal, not the chrome. The
   phone and desktop are one web app (`packages/app`), so this is one
   change.
7. **No component library.** The wireframes need buttons, cards, inputs,
   lists, a toggle, a QR code. NativeWind 4 is already in the app and the
   site is Tailwind; port the site's `@theme` tokens into
   `packages/app/tailwind.config.ts` as the app theme and build the eight
   primitives by hand, matching the site's `.btn-coral`, `.btn-sky`,
   `.card`, `.step`, `.term` recipes. A library would fight the sticker
   aesthetic and bring a second token system. Revisit only if the primitive
   count passes twenty.

## Phases

Each phase is its own PR with its own report under `docs/plans/`.

### Phase 1 — Developer ID signing and notarization (CI only)

- `.github/workflows/desktop.yml`: on the macOS job, import a **Developer
  ID Application** certificate (a different certificate from the iOS
  distribution one in `mobile-ios.yml`) and notarize with the App Store
  Connect API key the iOS workflow already has. Tauri reads
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`; the updater key
  stays as is.
- Ryan supplies the certificate and adds the secrets; the workflow change
  can be reviewed before they exist.
- Acceptance: a fresh Mac opens the `.dmg` from `desktop-v*` with no
  Gatekeeper dialog, `spctl -a -vv` says Notarized Developer ID, and the
  incoming-connection prompt appears once, naming offdesk.

### Phase 2 — Sidecars and the hub role

- `packages/desktop/src-tauri/tauri.conf.json` `bundle.externalBin`:
  `offdesk-hub`, `offdesk-node`, `tmux`, each with the target-triple
  suffix Tauri expects. The desktop job builds the two crates from the
  same checkout (`build.yml` already does per-target release builds; reuse
  its steps, or download the matching `v*` assets and lipo them) and
  builds tmux static against libevent and ncurses for both architectures.
  Linux gets the same sidecars minus tmux (apt has it; keep the existing
  error text). Windows gets none.
- Rust side (`lib.rs`, new `role.rs`): commands `role_get`, `role_set`,
  `hub_install(base_url)` which runs the sidecar
  `offdesk-hub service install` with `OFFDESK_BASE_URL` set from the
  address the user picked and `PATH` led by the sidecar dir; `hub_status`,
  `hub_link` (parses the sidecar's `offdesk-hub link` output into
  `{url, token_url, qr}`), `interfaces` (LAN addresses to choose from,
  the `reachable_base_url` logic in `crates/hub/src/first_run.rs` is the
  reference), `machines` (from the hub's API once the app is signed in).
- The services' launchd plists must carry `PATH` with the sidecar
  directory first; `offdesk-hub service install` gains a `--path-prepend`
  flag (or reads `OFFDESK_PATH_PREPEND`) so the CLI path is unchanged.
- Acceptance: on a Mac with no tmux and no offdesk, choosing "The one that
  stays on" ends on Hub ready with a scannable code; `launchctl list |
  grep offdesk` shows both services; quitting the app changes nothing on
  the phone; `offdesk-hub link` in Terminal prints the same link.

### Phase 3 — The screens

In `packages/app`, behind `isTauriDesktop`:

- First run (`Main.dc.html`), Hub ready (`HubReady.dc.html`), Connect to a
  hub (`ClientConnect.dc.html`, a restyle of `app/login.tsx` — the paste-
  the-link path is already there). Hub ready is reachable later from
  Settings and from the menu bar.
- Menu bar (`HubPanel.dc.html`): start as a native tray menu in `tray.rs`
  with the same items — address (copies), machines, Show the phone code,
  Add a machine, Open offdesk, Start at login, Quit. A custom popover
  window is a follow-up, not part of this phase.
- Workspace (`Workspace.dc.html`): the sidebar from
  `2026-08-29-sidebar-ia.md` restyled to the warm chrome; no IA change.
- Theme: the token port from decision 7, applied to the existing screens
  in the same PR so the app is not two-toned.
- Acceptance: the Playwright suite's desktop specs pass against the new
  chrome (testids unchanged); a screenshot of each of the four screens
  beside its artboard in the report.

### Phase 4 — The phone

- Welcome (`PhoneWelcome.dc.html`): restyle of the existing setup screen;
  same three paths (scan, type an address, paste the link).
- Can't reach the hub (`PhoneBlocked.dc.html`): shown when
  `mobile_hub.rs`'s 5-second connect times out on a local address, in
  place of today's silent return to the setup screen. Open Settings deep-
  links to the app's own settings page on iOS.
- Machines and sessions, Terminal: restyles of `MobileWorkbench`; the key
  bar and the strip keep their sizes from `DESIGN.md`.
- Acceptance: mobile e2e specs pass; the Local Network denial path is
  exercised by hand on a device and screenshotted in the report.

### Phase 5 — Site and README

- `site/`: the hero's step 1 becomes "Download for Mac", the one-liner
  moves to "On a NAS or a server". Windows is listed as a client.
- README: same reorder; the Install section keeps the script in full.
- The "get the app" buttons on Hub ready point at the App Store once the
  public link exists; until then, TestFlight and `/apk`.

## Out of scope, deliberately

- A universal link that opens the App Store when the app is missing
  (scan one code, install, scan again is acceptable for v1).
- Running the hub inside the app process.
- A hub role on Windows or Linux desktop.
- Moving the desktop crate into the Cargo workspace.

## Constraints

- `crates/*` changes are limited to the `PATH` flag in phase 2; the
  protocol is untouched.
- No new dependencies in `packages/app` beyond a QR renderer (the hub
  already renders one server-side; prefer reusing its output).
- The desktop crate stays outside the workspace (`docs/facts.md`).
