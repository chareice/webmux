# offdesk Design System

This documents the system the app actually ships. The site's palette,
indoors: warm chrome, dark terminal, terminal-first. Canonical tokens live in
`packages/app/global.css` (CSS custom properties, sRGB triplets; the hex
values are `site/src/styles/global.css`'s) and are consumed via Tailwind
(`tailwind.config.ts`), `packages/app/lib/colors.web.ts`, and the literal
copies in `packages/app/lib/theme.tsx` for React Native inline styles.

## Principles

1. **The terminal is the interface.** Chrome exists to be ignored: one tab bar
   on large screens, one strip + key bar on compact (phone / Fold cover). The
   Fold inner screen is large *and* touch — tab bar plus a portaled key bar,
   not the phone shell. See
   `docs/plans/2026-08-13-fold-touch-workspace.md` and
   `docs/superpowers/specs/2026-07-18-raw-terminal-ux-redesign-design.md`.
   Anything that competes with the terminal for attention is a bug.
2. **Dark is for the terminal, not the chrome.** The terminal body is the
   night-dark the site draws terminals in; everything around it is sand and
   cream, so the terminal reads as the object on the desk. (Until
   2026-09-04 the chrome was dark too; the desktop-hub plan,
   `docs/plans/2026-09-04-desktop-hub-role.md`, changed that.)
3. **One accent.** Coral `--color-accent` is the one thing to press; cream
   text sits on it (`--color-on-accent`). Semantic colors (ok/warn/err/info)
   are reserved for state — they never decorate.
4. **Real data or no data.** Meters and stats render only live values; no
   placeholder/mock series.

## Color tokens

| Token | sRGB | Role |
|---|---|---|
| `--color-bg-0` | `255 244 227` | canvas (sand) |
| `--color-bg-1` | `255 251 244` | elevated (bars, sheets) (cream) |
| `--color-bg-2` | `255 251 244` | surface (cards, menus) (cream) |
| `--color-bg-3` | `255 233 204` | surface hover / pressed (sand-2) |
| `--color-term-bg` | `30 27 46` | terminal body (`#1e1b2e`) |
| `--color-line` | `230 207 174` | solid border |
| `--color-line-soft` | `241 222 198` | subtle divider |
| `--color-fg-0..3` | `43 35 64` → `157 149 179` | text scale (ink → faint) |
| `--color-accent` | `255 107 87` | coral — the one thing to press |
| `--color-on-accent` | `255 251 244` | cream, on coral |
| `--color-ok` | `31 158 140` | success / online / running (lagoon, darkened to read on cream) |
| `--color-warn` | `210 154 18` | warning (sun, same) |
| `--color-err` | `232 84 63` | error / destructive (coral-2) |
| `--color-info` | `31 143 194` | focus ring, informational (sea, same) |
| `--color-violet` | `124 92 191` | auxiliary series |

Alpha composition uses `rgb(var(--x) / a)`. Focus-visible = 2px `info` ring;
text selection = accent at 20%. The xterm theme (`lib/colors.shared.ts`) is
the site's terminal: `#1e1b2e` body, `#f3eee6` text, coral cursor, sun
selection.

## Typography

- Display (titles, buttons, eyebrows): `Fredoka Variable` → ui-rounded →
  system. UI sans: `Nunito Variable` → ui-rounded → system. Both ship in
  `packages/app/public/fonts` so a hub with no internet has them; the site's
  vocabulary for them is `components/Warm.web.tsx` (pill buttons with a hard
  coral shadow, 28px cards, the coral "donut" step badge).
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
  with `term-bg` so it merges into the terminal (the one dark thing in the
  bar); inactive tabs transparent,
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

The dark-only, cool-neutral (hue 260°, amber accent) system shipped from the
design refresh until 2026-09-04, when the chrome took the site's palette;
git history has the old tokens. The earlier parchment/terracotta concept
was never implemented.
