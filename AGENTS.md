# AGENTS.md

## E2E Browser Rule

- Default browser verification must run with `pnpm e2e:test` locally or `pnpm e2e:ci` in automation.
- Those commands run Playwright and Chromium inside the `runner` container. The browser process must not depend on a host-installed browser for normal verification.
- Do not use `playwright test` directly for routine checks.
- Host-browser runs are debug-only. If container startup itself is the thing under investigation, use `pnpm e2e:test:debug-host` and say explicitly that the run did not use the container browser.

## E2E Infrastructure

- Keep the browser runtime defined in `e2e/Dockerfile.runner`.
- Keep the default E2E path aligned across local use, CI, and documentation. If one of them changes, update all of them in the same change.
