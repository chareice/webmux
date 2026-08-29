# Session creation UX overhaul + model selection — Implementation Spec

Date: 2026-08-30. Branch: `feat-session-create-ux` (base = main incl. #297). Scope: full-stack — `crates/protocol` + `crates/machine` + `crates/hub` (model plumbing) and `packages/app`/`packages/shared` desktop UI. Mobile (`MobileWorkbench`) untouched — a parallel effort owns it; keep `NewSessionDialog` exports it could reuse coherent.

## Why (user feedback, verbatim intent)

- "claude 不能配置模型的吗,其他的能选模型的吗" — no model choice anywhere today.
- "创建会话的逻辑也很烂,我根本看不懂现在的交互,非常不好用" — the 3-step dialog (agent + auto-run / machine / directory + summary) demands four decisions for every session.

## Part 1 — Model & mode plumbing (backend)

ACP facts (verified live on this machine):
- claude-code-acp's `session/new` **result** carries `models: {availableModels: [{modelId, name, description}], currentModelId}` and `modes: {availableModes: [{id, name, description}], currentModeId}`.
- Model switching in ACP is the unstable `session/set_model` request `{sessionId, modelId}`; modes via `session/set_mode` `{sessionId, modeId}`. The Zed adapters support set_model. **Probe kimi (`kimi acp`) and grok (`grok agent stdio`) yourself** (handshake + session/new against a scratch cwd; kimi surfaces a `configOptions` shape instead — map whatever it exposes for model choice, or record "not supported" in the report; grok likewise). Normalize: whatever an agent doesn't expose, the UI simply doesn't render.

Build:
1. `protocol`: `AgentModelInfo {model_id, name, description: Option}` ; on `AgentSessionInfo` + `AgentSessionUpdate` add `available_models: Vec<AgentModelInfo>` (empty = unsupported) and `current_model_id: Option<String>`. New `HubToMachine::AgentSessionSetModel {session_id, model_id}`. All additive/serde-tolerant.
2. `machine` (`acp.rs`): parse models (and stash modes for later — do NOT build mode UI) from session/new & session/load results; include in the ready `AgentSessionUpdate`. Handle SetModel → `session/set_model`; success → `AgentSessionUpdate{current_model_id}`; JSON-RPC error → `Error` event (don't fail the session). Adapters that never reported models reject SetModel locally with an `Error` event.
3. `hub`: persist the two new columns (JSON for the list), relay, include in bootstrap; `POST /api/machines/:m/agent-sessions/:id/model {model_id}` (lease-gated like prompt).
4. **Create-time model**: `POST agent-sessions` accepts optional `model_id`; hub stores it as *requested*; machine applies it by sending `session/set_model` immediately after ready, before flushing queued prompts. (ACP's session/new itself has no model param.)
5. Tests: extend the fake ACP agent to advertise two models and accept set_model; machine tests for ready-carries-models, create-time model applied before queued prompt, set_model success/error; hub route test.

## Part 2 — Create flow redesign (desktop)

Design intent: **"开会话"应该像 Claude Desktop 一样是一次点击,不是一张四决策表单。** Defaults do the work; the panel only exists for overrides.

1. **Remembered defaults.** Persist per-user last-used `{agent_kind, model_id, auto_run}` and per-project last cwd (localStorage is fine; key by machine). First ever use falls back to kimi/default.
2. **Project-level ＋ (primary path).** Each sidebar section header gets a hover ＋ with a two-item menu: "New agent chat" (creates instantly in that project's cwd with remembered agent+model — zero dialog) and "New terminal" (existing behavior). One click + one choice, everything else inherited.
3. **Global ＋ (the panel, rebuilt).** Replace the 3-step form with ONE compact panel, everything visible, prefilled from remembered defaults so plain Enter creates immediately:
   - Row 1: agent chips (claude/codex/grok/kimi/terminal) — remembered one preselected.
   - Row 2 (agent sessions only): **model dropdown** — populated from that agent's last-seen `available_models` (cache the list per agent kind client-side from any live/past session; empty → hidden with a "模型在会话内可切换" hint). Terminal chip hides rows 2/4.
   - Row 3: directory — **recent cwds first** (from existing sessions/terminals), then bookmarks, then free text; machine picker only renders when >1 machine is online (single machine = implicit).
   - Row 4: auto-run toggle, collapsed into a single line with the PROD note when relevant.
   - Footer: Create button; no summary block; not-controller hint stays.
4. **Starting-state honesty.** In the chat view while `starting`: replace the bare pill with "正在启动 <agent>…" plus a hint for npx-wrapped agents ("claude 冷启动约 1 分钟"), and keep the composer enabled with its existing "starting" note (backend queues). Show elapsed seconds.
5. **Chat-header model picker.** Current model shown as a small dropdown in the AgentChatView header (next to the auto-run label); switching calls the new route; while a turn is `working` the picker is disabled. Sessions with empty `available_models` show a static model label if `current_model_id` exists, else nothing.

## Constraints

- Keep every existing testid that e2e relies on where semantics survive; update specs where the flow legitimately changed (the dialog rebuild WILL break `agent-sessions.spec.ts` + `mobile-agent-sessions`… mobile specs do not exist yet — only desktop `agent-sessions.spec.ts` and `workspace-*` flows matter). You cannot run the containerized suite; update by reading, the human runs it.
- `pnpm typecheck/test/build` + `cargo test --workspace` + clippy clean. Fake-agent machine tests must cover the model plumbing.
- Commit in logical chunks; REPORT at `docs/plans/2026-08-30-session-create-ux-and-models-REPORT.md` with: kimi/grok model-capability probe results (real transcripts), what was built, real test output, deviations, e2e risk notes.
