# Raw Terminal UX Redesign — D1 Desktop + P1 Mobile

Decision record and implementation design for reorganizing webmux around the raw
remote-terminal experience. Supersedes the chrome/navigation decisions in
`2026-04-17-main-ui-redesign-design.md`, `2026-04-17-nav-redesign-with-tabs-design.md`,
and the dual layout-mode design in `2026-05-09-scrollable-tiling-design.md`.

Interactive prototype (5 variants, mock data): Claude artifact `55798845-1a15-41c2-8143-af4e8249962a`.
Chosen: **D1** (desktop, terminal-emulator style) and **P1** (mobile, strip + key bar).

## 1. Product decisions (fixed)

1. **Raw terminal first.** The product is a remote terminal for running Claude Code /
   Codex. Rendering fidelity, input, scroll, clipboard, and reconnect quality outrank
   any IA or visual work.
2. **No agent-semantic UI.** No y/n quick-reply buttons, permission cards, chat feeds,
   or session queues. Terminal-activity state (via output-silence heuristics) may
   return later as small status dots; nothing parses agent conversation semantics.
3. **Web-first.** The web app is the product. Tauri shells exist only to reclaim
   browser-denied capabilities (full key capture, tray, notifications, updater).
   No native rewrite.
4. **Simplest possible chrome and shortcuts.** One prefix key, everything else passes
   through. Mouse/touch is the second channel; there is no platform-specific
   convenience-shortcut layer.
5. **Phone/PC handoff is a core scenario.** Same session, same picture, on whichever
   device is picked up; input claims control.

## 2. Model: tab = group

- A **tab** is a group of panes on one machine (tmux *window* semantics). Splitting
  creates a pane inside the current tab. That is the entire grouping concept — the
  separate "workspace group management" surface goes away.
- Data: `group → ordered panes`. Desktop renders the group's split tree; mobile
  renders the same group as a **sequence** (one pane on screen at a time, ordered by
  DFS of the split tree).
- **Deletion:** the `tiling | scrollable` dual layout mode and the `aux_json` column
  (2026-05-09 design) are removed. Mobile never needs the desktop layout tree, only
  the pane order. Migration: existing `scrollable` groups flatten to their column
  order as a left-leaning split tree; `aux_json` is dropped.
- Workpaths/bookmarks remain launch-directory shortcuts only (unchanged API).

## 3. Desktop shape: D1 (terminal-emulator style)

Permanent chrome is a single 34 px tab bar. Everything else is terminal.

- **Tab bar left:** one tab per group — label = group name (defaults to cwd basename),
  small program annotation (`claude ▏codex` for a 2-pane tab), `＋` at the end.
- **Tab bar right:** host meta — status dot, host name, RTT latency, cpu/mem
  micro-meters. Real data from existing machine stats; the fake `mockSeries`
  sparklines are deleted.
- **Terminal area:** no per-pane headers. Focused pane indicated by a subtle border.
  Splits divided by 1 px lines.
- **Command palette** (`⌃B k`): new terminal, split, switch tab/host, reconnect,
  settings, sign out. Right-click context menu carries the same actions for mouse
  users.
- **Removed components:** `WorkbenchHeader` (incl. `HostSwitcher` dropdown as a
  header element — host switching moves to palette/tab-bar menu), the workspace
  toolbar icon row, the move-pane `<select>`, per-pane headers, the hidden
  `StatusBar` (its real data moves to the tab bar), `ExpandedTerminal.web.tsx`
  (already dead).

## 4. Mobile shape: P1 (strip + key bar)

Permanent chrome is exactly two elements; everything between them is terminal.

- **Top: session strip.** One chip per pane, horizontally scrollable. Chips of the
  same group sit adjacent, separated from other groups by a thin vertical divider.
  Strip right end (fixed, not scrolled): status dot, RTT, cpu/mem micro-meters.
  `＋` chip at the end for new terminal; long-press a chip for close/move/rename.
  Swiping the terminal horizontally moves through panes in strip order.
- **Bottom: two-row key bar** (redesigned for Claude Code frequency):
  - Fixed row: `ABC`(keyboard toggle) · attach · select-mode · — · `Esc` · `⇧Tab` ·
    `↑` · `↓` · `^C`
  - Scrollable row: `Ctrl`(latch) · `Tab` · `/` · `@` · `←` · `→` · `~` · `|` · `-` · `_`
  - **Ctrl is a latch modifier:** tap to arm (highlighted), next soft-keyboard letter
    sends `Ctrl+<letter>`, then disarms. Replaces the enumerated `C-d C-z C-l C-a C-e`
    keys. Long-press on arrow keys auto-repeats.
- **Removed:** the 3-tab bottom nav (Hosts / Terminals / Stats), the mobile app bar,
  the Stats page (its mislabeled "Terminals = disk count" bug disappears with it),
  card-list landing. The app opens directly into a terminal.

## 5. Input: per-keystroke direct to PTY (hard rule)

- Every key — soft keyboard, hardware keyboard, key bar — sends immediately to the
  PTY. IME composition sends on commit. **No buffered input field with a send button,
  ever** (the removed `CommandBar` pattern must not return). This is what makes
  Claude Code's `/` command menu, `@` file completion, arrow-key menus, and `⇧Tab`
  mode toggle work identically to desktop.
- Verification item: confirm the Android WebView IME path is genuinely per-keystroke
  (xterm.js hidden-textarea composition on some Android IMEs can behave
  sentence-buffered). If it buffers, that is a P0 bug in the raw-experience backlog.

## 6. Shortcuts: single prefix `⌃B`, everything else passes through

- The app steals exactly one key from the terminal: `Ctrl+B`. `⌃B ⌃B` sends a literal
  `Ctrl+B`. All other keys — including every bare `Ctrl+<letter>` — pass through.
- Identical on macOS, Linux, browser tab, and Tauri shells. Never depends on
  browser-reserved combos (`Ctrl/⌘+W/T/N`, `Ctrl+Tab`).
- Prefix table (rebindable second keys, one action registry):

  | Key | Action |
  |---|---|
  | `c` | new terminal (current tab's cwd) |
  | `1–9` | switch to tab N |
  | `n` / `p` | next / previous tab |
  | `w` | session switcher |
  | `%` / `"` | split right / split down |
  | arrows | focus pane in direction |
  | `z` | zoom/restore pane |
  | `x` | close pane (confirm if process running) |
  | `[` | copy mode |
  | `s` | switch host |
  | `k` | command palette |
  | `d` | detach (leave session running) |
  | `?` | cheat-sheet overlay |

- Copy/paste is **not invented**: macOS `⌘C/⌘V`; Linux `Ctrl+Shift+C/V` (terminal
  convention, interceptable in browsers); mobile select-mode/long-press.
- **Deletion:** both existing shortcut systems (`lib/shortcuts.ts` Cmd/Ctrl app
  shortcuts and `lib/workspaceShortcuts.ts` Mod bindings) are replaced by the single
  action table. Settings keeps rebinding UI, now for prefix second-keys.

## 7. Handoff and control

- Hub stores **last-focused pane per user**. Any device that opens the app lands
  there (per machine falls back to most recent). A transient banner ("接力自
  MacBook · 同一会话同一画面") confirms, then fades.
- **Input claims control** (last-writer-wins). Other devices become viewers with a
  passive indicator; picking one up and typing claims control back. The explicit
  Take/Stop Control flow demotes to an optional read-only lock for spectating.
- Reconnect gets a minimal visible state: a slim "reconnecting…" line when the WS
  drops (silent reconnect today), gone on recovery.

## 8. Host status

- Always visible, compact, real: status dot + RTT + cpu% + mem, in the D1 tab-bar
  right / P1 strip right. Sourced from existing machine stats reporting; RTT measured
  on the events WS. `mockSeries()` fake sparklines are deleted.

## 9. Cleanup rolled into this redesign

- Delete legacy dead packages (`packages/web`, `packages/server`, `packages/agent`
  stale `dist/`), `ExpandedTerminal.web.tsx`, stale comments referencing it.
- Rename login branding "Terminal Canvas" → webmux.
- Add sign-out (palette + settings).
- Rewrite `DESIGN.md` to document the actual dark token system; the parchment
  moodboard is obsolete.

## 10. Phasing

1. **Input & shortcut engine** — passthrough principle, prefix engine, action
   registry, cheat sheet; remove old shortcut systems. (Pure logic, unit-testable.)
2. **Desktop D1 shell** — replace WorkbenchHeader/toolbar with tab bar + palette;
   delete pane headers; host meta with real stats.
3. **Mobile P1 shell** — strip + key bar redesign (Ctrl latch, ⇧Tab//@ keys);
   remove bottom nav/Stats; direct-input verification on Android IME.
4. **Model simplification** — tab=group migration, drop layout modes/aux_json,
   mobile pane ordering.
5. **Handoff** — last-focused persistence, input-claims control, reconnect banner.

Each phase ships behind the existing e2e suite; phases 2–3 add Playwright specs for
the new chrome. Terminal rendering fidelity work (the fix-regression backlog) runs
independently of this redesign and is not gated by it.

## 11. Risks

- **Android IME buffering** may violate the direct-input rule → verify first in
  phase 3; fall back to xterm.js composition-handling fixes, not a buffered UI.
- **`⌃B` collides with tmux-inside-webmux** users: `⌃B ⌃B` covers it; prefix is
  rebindable (`⌃A`, `⌃Space`).
- **Control model change** (input claims vs explicit lease) alters multi-device
  semantics; acceptable for the single-user product, keep the read-only lock as the
  escape hatch.
- **Group migration** must be lossless for existing tiling layouts; scrollable
  groups flatten deterministically (documented above).
