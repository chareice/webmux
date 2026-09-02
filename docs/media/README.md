# Media

## Brand assets

These are generated, not hand-kept. `logo-source.png` is the master; the
vectors come from it via `scripts/logo-to-svg.sh`, which traces with potrace
and crops the viewBox to the ink.

| File | What it is |
|---|---|
| `logo-source.png` | the master bitmap — the only thing to replace when the mark changes |
| `logo.svg` | wordmark in brand blue `#1A5FE8`, for light backgrounds |
| `logo-black.svg` | wordmark in ink `#0C0C0C`, what the site's nav uses on its cream ground |
| `logo-dark.svg` | wordmark in `#FAFAF5`, for dark backgrounds |
| `favicon.svg` + `favicon-16/32.png` | the `o` alone, cream on `#0A0A0A` |
| `avatar.svg` + `avatar-400.png` | the same mark at avatar size |
| `og-1200x630.svg` + `.png` | share card: wordmark over the tagline |

To regenerate everything after a new `logo-source.png`:

```bash
brew install potrace librsvg
scripts/logo-to-svg.sh docs/media/logo-source.png docs/media/logo.svg '#1A5FE8' 0.71
```

The trailing `0.71` is potrace's black level, the luma where ink is split from
ground. Its 0.5 default sits below the midpoint between this blue and the cream
ground and erodes the glyphs by about 4% of their ink; 0.71 measured closest to
the source. Re-derive it if the brand colours change.

Then rasterise the icons and card with `rsvg-convert -w <n> -h <n>`, and copy
`logo.svg`, `logo-black.svg`, `logo-dark.svg`, `favicon*` and the card into `site/public/`.

# Screenshots and GIFs to record

Nothing here is committed yet. Each file below is referenced by the README, the
site, or both, and each will render as a broken image until it exists.

Shoot everything on a dark terminal. The product is dark-only, so a light
screenshot will look like a different app.

## Required

### `hero.gif`

Referenced by: `README.md` (top), `site/public/media/hero.gif` (hero section).
This is the one that has to work; everything else is optional.

The whole pitch in one loop: the same terminal, on two screens, at once.

- **Frame:** a desk screen and a phone in one shot. Real phone in hand is
  better than a simulated frame.
- **On the desk screen:** Claude Code mid-task in an offdesk terminal, output
  scrolling.
- **On the phone:** the same session, attached, showing the same output.
- **The beat that sells it:** type on the phone, and the desk screen updates.
  Then keep the desk screen visible while the phone keeps working — that is the
  control lease and it should read as obvious, not explained.
- **Length:** 6–10 seconds, looping cleanly. No captions, no cursor
  highlighting, no zoom effects.
- **Size:** under 4 MB. It loads on a phone, on mobile data, above the fold.

## Worth having

### `machines.png`

The machine list with **three** machines registered and online — a laptop, a
NAS, a VPS, named so the difference is obvious. This is the "one hub, many
machines" claim, and one machine in the shot proves nothing.

### `cli.png` or `cli.gif`

A terminal running the orchestration example from the README end to end:
`offdesk open` → `send` → `wait` → `read`. Let `wait` actually block for a
second or two; that pause is the point of the command.

### `tokens.png`

Settings → API Tokens, with several tokens that have distinct names
(`claude-nas`, `ci-runner`, `phone`) and visibly different "last used" values.
This is the security story: per-agent tokens, individually revocable.

### `phone-terminal.png`

Portrait phone screenshot, real device. A full-screen terminal with the key bar
at the bottom — the Ctrl/Esc/arrow row. Something recognisable on screen, `vim`
or `htop` rather than a bare prompt, to make "it is the real terminal" land.

## Before you commit anything

- No real hostnames, tokens, IP addresses, or client names on screen. Check the
  tmux status area and the browser URL bar.
- No `webmux` anywhere in frame — that is the whole point of the rename.
- Compress GIFs (`gifsicle -O3 --lossy=80`). A 20 MB hero GIF is worse than no
  hero GIF.
