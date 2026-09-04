# Phase 5 — The site and the README: Report

Date: 2026-09-04. Plan: `2026-09-04-desktop-hub-role.md`, phase 5.

## What changed

- **The site's hero** leads with the Mac app: step 1 is "On the Mac that
  stays on, install the app" with a Download for Mac button, a line saying
  it is signed and notarized for both chips, and the one-liner kept beneath
  it for a NAS or a server with no screen. Step 2 mentions the menu bar item
  as a place the code lives. The phone-app buttons under the steps go from
  coral to sky, so the page has one primary action.
- **`/mac`, `/windows`, `/linux`, `/desktop`** on offdesk.dev resolve to the
  newest published `desktop-v*` release at request time (`site/worker.js`),
  the way `/apk` already follows `app-v*`: drafts and prereleases never
  count. Tests cover the resolution and the redirect.
- **README → Install** leads with the Mac app and what it asks, keeps the
  script in full under "on a NAS, a VPS, or anything without a screen", and
  the Desktop bullet under "On your phone" names the three download paths
  and which platforms can be the hub.
- **docs/setup-lan.md** step 1 says the app does that step on a Mac.

## Verified

- `node --test site/worker.test.mjs`: 8 passed.
- `pnpm build` in `site/`: clean.
- The links go live only once the `desktop-v0.5.0` draft is published; the
  worker sends a visitor to the releases list until then.

## Not done here

- No screenshot of the app on the site yet; the hero still shows the phone.
- Windows and Linux are linked as clients; neither can be the hub (plan
  decision 5).
