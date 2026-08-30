# Mobile Chat (agent sessions on the compact shell) — REPORT

Date: 2026-08-30. Branch: `feat-mobile-chat`. Spec: `2026-08-30-mobile-chat.md` (same directory), adapted mid-flight to the PR #300 world (`2026-08-30-session-create-ux-and-models-REPORT.md`).

## What was built

### 1. Agent sessions in the mobile session model

- `lib/mobileSessionSwitcher.ts`: `buildMobileSessionGroups` now returns `MobileSessionGroup[]` whose `rows` are a union — terminal panes (workspace order, as before) and agent rows. Agent placement mirrors the desktop sidebar tree exactly: persistent group by `workspace_group_id`, else cwd match, else a synthetic `cwd:<path>` section appended in first-seen order. Rows carry `unread` (seen map vs `last_event_seq`, cleared for the open session) and `selected`. `labelFromCwd` is now exported from `terminalWorkspaceLayout` and shared with `sidebarTree` (its private copy is gone).
- The switcher sheet, the title-bar position badge (`N/M`), the title-bar swipe and the edge swipe all walk this single strip order — terminals and agent sessions are one sequence. Agent rows: 2-letter badge, status dot (same `AgentStatusDot` semantics), title + cwd line, 44px target, unread = bold + white dot, no close ✕ (kill lives in the chat title bar). Long-press stays terminal-only and is suppressed while a chat is open.

### 2. Inbox surfacing

- `sidebarTree.askedSessions` (oldest-first, all machines) is passed into `MobileWorkbench`. When ≥1 session is `asked`: an amber dot on the title bar (`mobile-inbox-dot`) and a slim amber banner at the top of the switcher sheet (`mobile-inbox-banner`, "N waiting on you · oldest Xm" via the `formatAge` helper now shared in `lib/formatAge.ts`) — tapping jumps to the oldest asked session, switching host if needed. Inside a chat, a cross-session reminder chip (`mobile-cross-reminder`, "N more waiting · <title>") appears whenever a DIFFERENT session is asked; tapping jumps there.

### 3. Mobile chat page

- `AgentChatView` gained a `compact` prop (not a fork): the desktop header drops out (the mobile title bar carries badge + title + status pill + kill ✕ with a canvas-owned `ConfirmDialog`), the stream goes full-width, ask-card options become 52px touch targets, the composer is a 44px row with a 44px send/stop button and no keyboard-hint caption. Keyboard handling needs nothing new: the app root already sizes to `useVisualViewportHeight`, so the composer rides above the soft keyboard and the stream scrolls under it. The ExtendedKeyBar disappears because the chat replaces `TerminalWorkspace` entirely. Read-state (`seen`) plumbing is untouched — it keys off window focus, which behaves the same on mobile.
- Post-#300 adaptations: the header model picker was extracted into a shared `ModelPicker` (same `agent-chat-model-select`/`-label` testids) and rides above the composer on phones; starting-state honesty was extracted to `lib/agentStarting.ts` (`useStartingElapsedSec` + `COLD_START_HINT`) and the mobile title-bar pill now reads "正在启动 \<agent\>… Ns", with the cold-start hint appended to the composer's starting note. Resume lives above the composer on phones.

### 4. New-session sheet

- `components/newSessionState.ts` extracts `useNewSessionState` from `NewSessionDialog` (remembered defaults, model options from live sessions + persisted cache, recent cwds, bookmarks, machine/cwd/auto-run validation, submit persisting defaults). The desktop panel's UI and testids are unchanged.
- `components/NewSessionSheet.web.tsx`: the bottom-sheet variant per `MobileNew.dc.html`, mirroring the one-screen prefilled flow — agent chips (remembered kind preselected), 44px model dropdown (or the "模型在会话内可切换" hint), directory (recent cwds → bookmarks → free text), machine picker only when >1 machine is online (PROD tag → "auto-run off by default"), single-line auto-run toggle, full-width Create button + summary line.
- The mobile title-bar ＋ (`mobile-bar-new-session`) and the switcher's "New session" row open the sheet. The terminal chip preserves the old direct-create behavior exactly: the sheet is seeded with the group it was opened from, and terminal creation aims placement at that group (full tab overflows into a fresh one, per `planNewTerminalPlacement`). Agent kinds share the desktop `createAndSelectAgentSession` path (model + cross-host selection included).

### 5. Routing/handoff

- `#/a/<id>` deep-links and reloads open the chat on mobile (the existing hash sync is layout-agnostic; the chat renders through `chatContent`). Edge-swipe and title-bar swipe order includes agent sessions. `putFocus` remains terminals-only. Kill from the title bar confirms and returns to the terminal area.

## Checks (real output, this machine, this branch)

- `pnpm typecheck` (`tsc -b`) — clean.
- `pnpm test` (vitest) — **41 files, 345 tests passed**. New coverage: 6 agent-placement/ordering/unread cases in `mobileSessionSwitcher.test.ts`. The inbox oldest-asked ordering is covered by the existing `sidebarTree.test.ts` case ("collects askedSessions oldest first across all machines") — mobile consumes `askedSessions[0]` directly, so no forked logic to re-test.
- `pnpm build` — exported `dist` successfully.
- The containerized e2e suite (`pnpm e2e:test`) was **not run** (spec: the human runs it) — selectors were written by reading `e2e/tests/helpers.ts`, the existing mobile specs, and `agent-sessions.spec.ts`; see risks below.

## Commits

- `bbaeb4d` wip snapshot (pre-rebase): session model + MobileWorkbench agent rows/inbox/title bar + `formatAge`/`labelFromCwd` sharing. Kept its snapshot name — it sits before the `origin/main` merge and rewording would mean rebasing a merge.
- `f5f29e4` merge `origin/main` (PRs #297/#299/#300) — auto-resolved; both intents verified by reading the result.
- `e0fe250` compact chat view — model picker, starting honesty, touch targets.
- `21d2784` mobile new-session sheet mirroring the one-screen create flow.
- `7f22968` wire agent sessions into the compact shell (TerminalCanvas).
- `4be88f7` e2e: mobile agent sessions spec + sheet-driven ＋ updates.

## Deviations from the spec

1. **Kill affordance**: the spec offered "ConfirmDialog behind the title-bar sheet or an explicit control" — I took the explicit control: a ✕ in the mobile title bar while a chat is open, confirming through a canvas-owned `ConfirmDialog` with the desktop copy. The compact `AgentChatView` renders no kill button of its own.
2. **Cold-start hint placement on mobile**: the desktop shows "冷启动约 1 分钟" next to the header pill; the cramped mobile title bar only gets the "正在启动 \<agent\>… Ns" pill, and the hint moves into the composer's starting note.
3. **Model picker placement on mobile**: above the composer (left-aligned), not in the title bar — the title bar already carries badge + title + status + kill + ＋.
4. **Cross-session reminder visibility**: shown whenever another session is currently `asked` (state-based), not only at the moment it "becomes" asked — simpler and consistent with the unread/inbox model.
5. **Terminal long-press sheet is suppressed while a chat is open** (it targeted the background terminal, which read as a bug).
6. **＋ testid renamed** `mobile-bar-new-terminal` → `mobile-bar-new-session`, and the switcher row `mobile-session-switcher-new-terminal` → `mobile-session-switcher-new-session`; `mobile-controls.spec.ts` updated accordingly (its two direct-create tests now drive the sheet via `mobileCreateTerminalViaSheet` — the "create in active group" and "overflow into new tab" expectations are unchanged).

## E2E risk notes (written by reading, NOT executed)

- `e2e/tests/mobile-agent-sessions.spec.ts` (5 tests): switcher row → chat page + streamed echo; ask-card option tap; asked-elsewhere dot/reminder/banner jump; ＋ sheet creates an agent session; kill via title bar. Specific risks:
  - Control-lease timing: after `mobileTakeControl`, specs wait on `mobile-bar-new-session` becoming enabled (the shell's control signal) and on `mobile-new-session-submit` being enabled before submitting. If the host-sheet toggle flow changes, these waits are the canary.
  - The "asked elsewhere" test parks session A on a permission request, then opens session B's chat via the switcher; the reminder chip and banner assert on "1 more waiting" / "1 waiting on you". If the fake agent's ask timing changes, the `agent-ask-card` visibility wait is the synchronization point.
  - The sheet test asserts the machine picker is hidden with a single online machine (mirrors the desktop panel rule) and that remembered defaults prefill — Playwright's fresh context per test keeps this deterministic.
- `mobile-controls.spec.ts`: the two tests that clicked the old ＋ now go through the sheet (terminal chip + submit). The sheet seeds cwd from `readLastCwd` → falls back to the group's cwd on a fresh context, so the `/root` + `workspace_group_id` expectations hold. If `localStorage` ever carries over between tests, the remembered agent kind (not "terminal") would preselect an agent chip — the helper clicks the terminal chip explicitly, so only the cwd seed is sensitive.
- Touch/swipe behaviors (title-bar swipe, edge swipe) now walk a strip that can include agent rows; no spec covers swiping onto an agent session — candidate for a follow-up if the human wants it.
