# API Tokens management UI (minimal)

**Status:** implementation spec (2026-08-03)
**Goal:** the simplest possible UI for managing API tokens (`wmx_…`) so users can create tokens for the `webmux` CLI without touching the browser console.

## Verified backend facts (already deployed, no hub changes)

- `GET /api/auth/api-tokens` → `[{id, name, created_at, last_used_at, expires_at}]` (ms timestamps; `last_used_at`/`expires_at` may be null)
- `POST /api/auth/api-tokens` body `{name: string}` → `{id, name, token, created_at}` — **the raw `wmx_…` token is returned only here, only once** (server stores a hash)
- `DELETE /api/auth/api-tokens/{id}` → 204
- All behind the existing Bearer auth; `packages/app/lib/api.ts` `request<T>()` handles auth headers.

## Deliverable (exactly two files touched + optional tests)

### 1. `packages/app/lib/api.ts`

Add types + three functions following the existing one-liner export pattern (`export const listMachines = …` style):

```ts
export interface ApiToken { id: string; name: string; created_at: number; last_used_at: number | null; expires_at: number | null }
export interface CreatedApiToken { id: string; name: string; token: string; created_at: number }
export const listApiTokens = () => request<ApiToken[]>("GET", "/api/auth/api-tokens");
export const createApiToken = (name: string) => request<CreatedApiToken>("POST", "/api/auth/api-tokens", { name });
export const deleteApiToken = (id: string) => request<void>("DELETE", `/api/auth/api-tokens/${id}`);
```

### 2. `packages/app/components/SettingsPage.tsx`

Add ONE new section "API Tokens" at the BOTTOM of the settings page (after the last existing section), reusing the file's existing `SectionTitle` / `SettingRow` primitives and the existing theme (`useColors`) and button/input styles already present in this file. Do NOT create new component files, do NOT restyle existing sections, do NOT add routes or palette entries.

Behavior:

- Load tokens via `listApiTokens()` when the settings page mounts (alongside the existing quick-commands load); show "Loading…" / error text states minimally.
- List rows: token name, `created <YYYY-MM-DD>`, `last used <YYYY-MM-DD|`—`>`, and a Delete button.
- Delete = **two-tap inline confirm** (first tap turns the button into "Confirm?", second tap deletes; resets after 3s or on blur). No modal, no `window.confirm`, no new dialog component.
- Create: one text input (placeholder "Token name (e.g. cli)") + "Create" button. Disabled + no-op for empty/whitespace names.
- On create success: show the returned token in a read-only, full-width, mono-font text box with a "Copy" button (`navigator.clipboard.writeText` with a fallback: select the text via a hidden textarea + `document.execCommand('copy')` — this must work in Tauri WebViews too), plus one line: "Copy it now — it won't be shown again." Show a "Done" button that clears the box. Until dismissed, the token stays visible. Add the new token to the list immediately (without its raw value).
- All errors surface as a short red text line inside the section (no window.alert).

Keep it visually consistent with the existing sections; ~150-200 lines added at most. No new dependencies.

## Explicit non-goals

- No rename, no expiry editing, no scopes, no search/sort/pagination, no mobile-specific layout (SettingsPage already renders on small screens; just don't break it), no CLI/docs changes, no backend changes, no new routes/palette entries.

## Verification commands

- `pnpm --filter app exec tsc --noEmit` (or the repo's typecheck script if one exists — check package.json first)
- `pnpm vitest run` if existing tests touch api.ts (make sure nothing breaks)
- Do NOT run repo-wide formatters; do not touch files outside the two listed (+ a small new test file only if the repo already has a test pattern for lib/api.ts — `lib/api.test.ts` exists, extend it only if trivial).

Do not commit.
