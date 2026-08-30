# Mobile Chat (agent sessions on the compact shell) — Implementation Spec

Date: 2026-08-30. Branch: `feat-mobile-chat` (base = main, which already contains the sidebar IA, the ACP backend, and the desktop chat view — PRs #292/#293/#294). Scope: **frontend only**, compact/mobile (`isCompact`) surfaces in `packages/app`. Desktop behavior must not change; `crates/*` untouched.

## What exists (read first)

- Desktop chat is DONE: `components/AgentChatView.web.tsx`, `components/NewSessionDialog.web.tsx`, `lib/agentTranscript.ts`, `lib/agentSessionFeed.ts`, `lib/api.ts` agent helpers, `lib/bootstrapState.ts` agent state, `lib/sidebarTree.ts` agent rows/unread/inbox — plus `docs/plans/2026-08-29-chat-view.md` + `-REPORT.md`. **Reuse the data layer wholesale; do not fork it.**
- Mobile shell: `components/MobileWorkbench.web.tsx` (title bar, session strip model, switcher bottom sheet with per-row close, edge swipe, ExtendedKeyBar) driven from `TerminalCanvas.web.tsx`'s compact branch. Terminals only today — agent sessions are invisible on mobile.
- Design (authoritative): `docs/design/next-ia/MobileList.dc.html` (list page: hosts cards strip, inbox banner, 44px tree rows with agent badges/status/unread), `MobileChat.dc.html` (chat page: title bar, cross-session amber reminder, 52px option chips, 44px input row), `MobileNew.dc.html` (new-session drawer: agent chips, Auto-run, machine rows with PROD tag, cwd). Settled rules unchanged: amber = asked only and only on agent sessions; unread = bold+dot, cleared by viewing, cross-device synced; phone is ALWAYS single pane; no Chat|Terminal mode switch anywhere (not built yet); no approval UI (ask-cards only).

## What to build

1. **Agent sessions in the mobile session model.** The switcher bottom sheet (and the strip/title-bar swipe order) includes agent sessions alongside terminals, grouped the same way the desktop sidebar groups them (`sidebarTree.ts` already computes sections with agent rows — reuse it or its helpers rather than re-deriving). Agent rows: 2-letter agent badge, status dot (same semantics/colors as desktop), unread bold+dot, title + cwd line, 44px targets. Agent rows get NO close ✕ in the sheet (kill lives in the chat header, matching desktop); terminal rows keep theirs.
2. **Inbox surfacing.** When ≥1 session is `asked`: a slim amber banner at the top of the switcher sheet ("N waiting on you · oldest Xm", tap → jump to the oldest asked session) and an amber dot on the title bar so it's visible without opening the sheet. While inside a chat, a cross-session reminder chip appears when a DIFFERENT session becomes asked (per MobileChat.dc.html); tapping jumps there.
3. **Mobile chat page.** Selecting an agent session shows the chat full-screen where the terminal normally renders. Adapt `AgentChatView` with a compact variant (prop, not a fork): 44px composer row, 52px option chips, title bar integration (the existing mobile title bar shows the agent badge + title + status pill; kill via ConfirmDialog behind the title-bar sheet or an explicit control — pick what the design shows), keyboard handling via the existing `useVisualViewportHeight` pattern (composer must stay above the soft keyboard; the stream scrolls under it), no ExtendedKeyBar while in chat. Read-state (`seen`) plumbing already lives in the view — verify it fires on mobile focus semantics too.
4. **New-session drawer.** The mobile title-bar ＋ currently creates a terminal in the current group. Change it to open a bottom-sheet variant of the new-session flow per MobileNew.dc.html: agent chips (claude/codex/grok/kimi/terminal), machine rows (PROD tag → "auto-run off by default"), cwd (bookmarks + free text), Auto-run toggle. Terminal chip must preserve today's behavior exactly (current group's cwd, overflow-into-new-tab rule). Reuse `NewSessionDialog`'s logic (extract shared pieces) rather than duplicating validation.
5. **Routing/handoff.** `#/a/<id>` opens the chat on mobile too (deep link + reload). Edge-swipe order includes agent sessions in strip order. `putFocus` remains terminals-only (unchanged).

## Constraints

- Desktop rendering paths must be untouched — every change is behind `isCompact` or inside mobile-only components. No new dependencies. Existing per-keystroke terminal input rules unaffected (chat composer is a normal textarea; IME must work — do NOT intercept composition events).
- Styles: tokens from `lib/colors`, match the .dc.html references (they use the repo's real palette).
- Keep the diff surgical: expect edits in `MobileWorkbench.web.tsx`, `TerminalCanvas.web.tsx` (compact branch), `AgentChatView.web.tsx` (compact variant), a `NewSessionSheet` (or reused dialog), plus small lib additions with tests.

## Acceptance

- `pnpm typecheck`, `pnpm test`, `pnpm build` clean; vitest for any new pure logic (mobile session ordering with agents, inbox oldest-asked pick).
- Browser tests: extend the suite with `mobile-agent-sessions.spec.ts` (mobile viewport, same fake-agent infra that `agent-sessions.spec.ts` uses): (a) session created via API appears in the switcher sheet with badge+status and opens the chat page; (b) send → streamed echo renders; (c) ask-card option tap resolves (auto_run=false path); (d) asked elsewhere → title-bar amber dot + banner jump works; (e) existing mobile specs keep passing conceptually. You cannot run the containerized suite here — the human runs it; get selectors right by reading `e2e/tests/helpers.ts` and the existing mobile specs.
- Commit in logical chunks. Finish with `docs/plans/2026-08-30-mobile-chat-REPORT.md`: what was built, real test output, deviations, risks for the human's containerized run.
