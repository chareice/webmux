# Performance & UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce web startup cost and multi-terminal browser load while making control, onboarding, and sidebar flows more explicit and less noisy.

**Architecture:** Keep the current Hub and protocol intact, but restructure the web shell so heavy terminal runtime loads only when needed, only a focused terminal stays live, and frequently changing state no longer forces large UI sections to rerender. Replace automatic side effects on first paint with user-driven actions and lightweight local fallbacks.

**Tech Stack:** React 19, Expo Web, React Native Web, TypeScript, xterm.js.

---

### Task 1: Lock behavior with failing tests

**Files:**
- Create: `packages/app/lib/terminalSessionPolicy.test.mjs`
- Create: `packages/app/lib/directoryAutocomplete.test.mjs`
- Create: `packages/app/lib/onboardingFlow.test.mjs`

- [ ] Write failing tests for the live-terminal selection policy, autocomplete caching/filtering, and explicit onboarding token generation.
- [ ] Run `node --test packages/app/lib/terminalSessionPolicy.test.mjs packages/app/lib/directoryAutocomplete.test.mjs packages/app/lib/onboardingFlow.test.mjs` and verify failure.

### Task 2: Add focused helpers for the new behavior

**Files:**
- Create: `packages/app/lib/terminalSessionPolicy.ts`
- Create: `packages/app/lib/directoryAutocomplete.ts`
- Create: `packages/app/lib/onboardingFlow.ts`

- [ ] Add small pure helpers that define which terminal stays live, how directory suggestions are cached/filtered, and when onboarding/add-machine panels should generate tokens.
- [ ] Re-run the new test files and keep them green while helpers stay framework-agnostic.

### Task 3: Shrink the web shell and terminal runtime

**Files:**
- Modify: `packages/app/app/index.tsx`
- Modify: `packages/app/components/TerminalCanvas.web.tsx`
- Modify: `packages/app/components/Canvas.web.tsx`
- Modify: `packages/app/components/TerminalCard.web.tsx`
- Create: `packages/app/components/TerminalPreview.web.tsx`

- [ ] Lazy-load the web canvas entry and defer heavy secondary panels/components.
- [ ] Keep only the maximized terminal live on web; render a lightweight preview card in grid mode.
- [ ] Memoize/render-isolate the web shell so stats/control updates do not repaint the terminal grid unnecessarily.

### Task 4: Remove over-eager first-paint side effects

**Files:**
- Modify: `packages/app/components/OnboardingView.web.tsx`
- Modify: `packages/app/components/Sidebar.tsx`
- Modify: `packages/app/components/StatusBar.tsx`
- Modify: `packages/app/components/TerminalCanvas.web.tsx`
- Modify: `packages/app/components/TerminalCanvas.android.tsx`

- [ ] Stop auto-claiming control on first machine; make control acquisition explicit.
- [ ] Stop auto-generating registration tokens on mount; generate on user action.
- [ ] Stop auto-writing a default bookmark to the backend; use a local fallback until the user acts.
- [ ] Cache and de-duplicate directory autocomplete lookups.
- [ ] Make control state clearer in the primary web layout so the bottom bar is no longer the only place users discover mode.

### Task 5: Verify the full slice

**Files:**
- Modify: `e2e/specs/core-control-flow.md` if the updated UX changes visible steps

- [ ] Run `node --test packages/app/lib/terminalSessionPolicy.test.mjs packages/app/lib/directoryAutocomplete.test.mjs packages/app/lib/onboardingFlow.test.mjs`.
- [ ] Run the existing app tests: `node --test packages/app/lib/bootstrapState.test.mjs packages/app/lib/orderedBinaryOutput.test.mjs packages/app/lib/terminalResize.test.mjs`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Serve the built web app locally and compare Lighthouse mobile/desktop results against the earlier baseline.
- [ ] Run the core control E2E/manual flow and confirm the new explicit control/onboarding behavior still works end-to-end.
