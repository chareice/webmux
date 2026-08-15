# webmux Design System

This documents the system the app actually ships. Dark-only, cool-neutral,
terminal-first. Canonical tokens live in `packages/app/global.css` (CSS custom
properties, sRGB triplets derived from oklch at hue 260°) and are consumed via
Tailwind (`tailwind.config.ts`) and `packages/app/lib/colors.web.ts`.

## Principles

1. **The terminal is the interface.** Chrome exists to be ignored: one tab bar
   on large screens, one strip + key bar on compact (phone / Fold cover). The
   Fold inner screen is large *and* touch — tab bar plus a portaled key bar,
   not the phone shell. See
   `docs/plans/2026-08-13-fold-touch-workspace.md` and
   `docs/superpowers/specs/2026-07-18-raw-terminal-ux-redesign-design.md`.
   Anything that competes with the terminal for attention is a bug.
2. **Dark-only, deliberately.** The canvas approaches the terminal background;
   surfaces elevate by small lightness steps at a constant cool hue (260°).
3. **One warm accent.** Amber `--color-accent` marks focus, activity, and brand
   moments. Semantic colors (ok/warn/err/info) are reserved for state — they
   never decorate.
4. **Real data or no data.** Meters and stats render only live values; no
   placeholder/mock series.

## Color tokens

| Token | sRGB | Role |
|---|---|---|
| `--color-bg-0` | `11 12 15` | canvas |
| `--color-bg-1` | `17 19 22` | elevated (bars, sheets) |
| `--color-bg-2` | `23 26 29` | surface (cards, menus) |
| `--color-bg-3` | `31 34 38` | surface hover / pressed |
| `--color-term-bg` | `5 6 10` | terminal body (darkest) |
| `--color-line` | `39 41 45` | solid border |
| `--color-line-soft` | `27 29 32` | subtle divider |
| `--color-fg-0..3` | `247 248 251` → `91 94 98` | text scale (primary → faint) |
| `--color-accent` | `251 157 89` | warm amber — focus/brand |
| `--color-ok` | `99 209 143` | success / online / running |
| `--color-warn` | `234 191 58` | warning |
| `--color-err` | `250 104 99` | error / destructive |
| `--color-info` | `105 193 252` | focus ring, informational |
| `--color-violet` | `187 154 244` | auxiliary series |

Alpha composition uses `rgb(var(--x) / a)`. Focus-visible = 2px `info` ring;
text selection = accent at 20%.

## Typography

- UI sans: `Geist` → system stack. Features `ss01`, `cv11`.
- Mono (terminal + all metrics/ids): `Maple Mono NF CN` → `Noto Sans Mono CJK
  SC` → `JetBrains Mono` → platform mono. User-overridable in Settings.
- Sizes: UI 12–13.5px; terminal size user-set; uppercase micro-labels get
  slight letter-spacing.

## Chrome recipes

Display mode is two-axis, not a 768px window-width breakpoint. `isTouch`
comes from `(pointer: coarse)`; touch is always compact (every touch device
gets the single-column mobile layout — folding, rotation, or a soft keyboard
cannot flip chrome); non-touch keeps `innerWidth ≤ 768`. History and the
retired large-touch workspace: `docs/plans/2026-08-13-fold-touch-workspace.md`.

- **Desktop / Fold-inner tab bar** (34px mouse, ≥40px touch): active tab fills
  with `term-bg` so it merges into the terminal; inactive tabs transparent,
  hover `bg-2`. Right meta: online dot + host + RTT + cpu/mem micro-meters
  (30×4px bars, `bg-3` track, `fg-2` fill). Large+touch also pins one
  ExtendedKeyBar at the bottom of the main column (portaled from the focused
  pane).
- **Mobile strip (~44px)** chips: `bg-2` fill, `line` border, active `bg-3` +
  `fg-0`; group divider = 1px × 16px `line`. Key bar keys: 30px, `bg-3`,
  mono 11px; `^C` accent; latched `Ctrl` info-blue.
- **Overlays** (palette, cheat sheet, sheets): `bg-2`, `line` border, radius
  10–13px, shadow `0 14px 40px rgb(0 0 0 / 0.5)`.
- **Transient banners** (handoff, reconnect): tinted at 7–10% of their
  semantic color, never blocking, auto-dismiss.

## Motion

Fades/slides 150–350ms ease-out; status dots may pulse at 1.6s. Respect
`prefers-reduced-motion`. No decorative animation.

## History

The previous parchment/terracotta concept (Claude-inspired, light theme) was
never implemented and is retired; git history has the old file.
