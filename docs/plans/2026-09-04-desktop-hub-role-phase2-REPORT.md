# Phase 2 — Sidecars and the hub role: Report

Date: 2026-09-04. Plan: `2026-09-04-desktop-hub-role.md`, phase 2. Branch
`feat/desktop-hub-role`.

## What was built

**The hub tells programs what it would tell a person.** `offdesk-hub link
--json` (`crates/hub/src/main.rs`, `run_link_json`) prints one JSON object:
the address a phone would type, the sign-in link (null on an OAuth hub), the
short link the QR code carries, and `candidates` — every address a phone
might reach this machine at, best first. The ordering is
`first_run::order_candidates`, a pure function over the interface list and
what `reachable_base_url` would pick: LAN addresses on physical interfaces
first, then tunnels and tailnets, never loopback, link-local or the fake-IP
range. The address picker on Hub ready reads this list.

**The desktop app can take the role** (`packages/desktop/src-tauri/src/role.rs`,
desktop only). Six commands, registered in `lib.rs` and allowed in the
desktop capability:

| Command | Does |
|---|---|
| `desktop_role` / `set_desktop_role` | The first-run answer, `hub` or `client`, in `desktop.json` next to the app's config |
| `hub_status` | Whether this platform can be a hub, whether the binaries are bundled, whether the hub and node services are installed, whether something answers on 4317 |
| `hub_install(base_url?)` | Runs the bundled `offdesk-hub service install`, with `OFFDESK_BASE_URL` set to the address the person picked, then returns what `link --json` says |
| `hub_link(base_url?)` | `link --json`, for showing the code again |
| `hub_uninstall` | Both services removed; the database and tmux sessions stay |

The binaries are found beside the app's executable first (where Tauri puts
sidecars), then on `PATH` and in `~/.local/bin`, so development without
sidecars works against a script install. When they came from beside the
app, `PATH` is led with that directory for the install; `service install`
bakes the installing process's `PATH` into the launchd plist / systemd unit
and runs the node's install with the same environment, so both services
find the bundled tmux with no change to `crates/*`. The plan had a
`--path-prepend` flag; it was not needed and the plan is corrected.

**The sidecars.** Two overlay configs, `tauri.sidecars.macos.conf.json`
(hub, node, tmux) and `tauri.sidecars.linux.conf.json` (hub, node), merged
by the release build's `--config`, so a plain `tauri dev`, the iOS and
Android builds, and the Windows job need none of them. Two scripts:

- `scripts/desktop-sidecars.sh [--universal]` builds `offdesk-node` and
  `offdesk-hub --features embed-ui` for this host or, on macOS, both
  architectures lipo'd, into `src-tauri/binaries/` (gitignored).
- `scripts/build-tmux-sidecar.sh <out>` builds tmux 3.5a against a static
  libevent 2.1.12 and a static utf8proc 2.9.0 (all three fetched by pinned
  SHA-256), linked otherwise only to the SDK's ncurses and libSystem. It
  refuses to emit a binary that links outside `/usr/lib`. utf8proc is what
  makes CJK and emoji the right width; macOS's own wcwidth is years behind.

`.github/workflows/desktop.yml` runs both before `tauri-action` on macOS
(universal) and Linux, and passes the overlay in `args`.

## Test output

`cargo test -p offdesk-hub --bin offdesk-hub first_run`:

```
test first_run::tests::the_picker_leads_with_the_chosen_address_and_hides_what_nobody_reaches ... ok
test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 109 filtered out
```

`cargo test --lib` in `packages/desktop/src-tauri`:

```
test role::tests::no_json_is_an_error_with_a_reason ... ok
test role::tests::the_link_is_read_off_the_json_line ... ok
test role::tests::an_oauth_hub_has_no_link_and_that_is_not_an_error ... ok
test role::tests::the_service_files_are_where_each_platform_keeps_them ... ok
test role::tests::the_sidecar_directory_leads_the_path ... ok
test result: ok. 13 passed; 0 failed
```

`offdesk-hub link --json` against the hub already running on the
development Mac (token redacted):

```
{"url":"http://192.168.1.223:4317","link":"http://192.168.1.223:4317/?token=…","short":"http://192.168.1.223:4317/?code=…","candidates":[{"interface":"en0","address":"192.168.1.223"},{"interface":"bridge100","address":"192.168.64.1"}]}
```

en0 first, the VM bridge second — the order the picker wants.

The tmux sidecar, built on the development Mac for both architectures:

```
$ otool -L tmux-universal-apple-darwin
(architecture x86_64): /usr/lib/libncurses.5.4.dylib, /usr/lib/libSystem.B.dylib, /usr/lib/libresolv.9.dylib
(architecture arm64):  the same three
$ env -i PATH=/usr/bin:/bin tmux-universal-apple-darwin -L probe new-session -d 'sleep 3' && … list-sessions
probe: 1 windows
$ arch -x86_64 tmux-x86_64-apple-darwin -V
tmux 3.5a
```

`scripts/desktop-sidecars.sh` on the development Mac: `offdesk-hub-aarch64-apple-darwin` (15 MB, UI baked in) and `offdesk-node-aarch64-apple-darwin` (7 MB).

`pnpm tauri build --config src-tauri/tauri.sidecars.macos.conf.json --bundles app`
on the development Mac (aarch64, not universal): the app built and the
bundle carries all three sidecars, each runnable from inside it:

```
offdesk.app/Contents/MacOS/offdesk-desktop   17 MB
offdesk.app/Contents/MacOS/offdesk-hub       15 MB   link --json → en0, bridge100, link present
offdesk.app/Contents/MacOS/offdesk-node       7 MB   "offdesk node daemon"
offdesk.app/Contents/MacOS/tmux               1.4 MB "tmux 3.5a"
```

The command then stopped at the updater artifact, wanting
`TAURI_SIGNING_PRIVATE_KEY`, which only CI has; the bundle was complete
before that step.

## Not done here, on purpose

- **Not exercised: `hub_install` end to end.** The development Mac already
  runs a hub and a node as services, and reinstalling them under a test is
  not something to do to the person's machine. The command is the sidecar
  invocation plus `link --json`, both of which were run by hand; the first
  real run is the phase 3 acceptance on a clean Mac.
- **No UI.** Phase 3 wires the six commands to the first-run and Hub ready
  screens.
- **The CI job has not run.** It runs on the next `desktop-v*` tag or a
  `workflow_dispatch`. The two risks: the macOS runner cross-building the
  x86_64 libevent/utf8proc/tmux (works on the arm64 development Mac with
  the same commands), and the universal-suffixed sidecar names Tauri
  expects for `--target universal-apple-darwin` (the script emits
  `-universal-apple-darwin` and both per-arch names).

## Risks

- A signed app moved after install leaves the plists pointing at the old
  path. Tauri's updater replaces the bundle in place, so updates are fine;
  dragging the app elsewhere is a Settings → reinstall in phase 3.
- `tmux` from the app and a Homebrew `tmux` are different builds; each
  keeps its own server socket by version, so they do not collide, but a
  person who `tmux attach`es with the Homebrew one will not see the app's
  sessions unless versions match. Documented for phase 5.
