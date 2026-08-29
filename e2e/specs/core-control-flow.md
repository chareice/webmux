# Core Control Flow: Two browser sessions stay in sync

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Use two isolated browser sessions so the app generates different `device_id` values
- Start with no terminals open

## Steps

1. **action:** In browser session A, open http://localhost:4317
   **eval:** The desktop workbench loads with the left sidebar (a hosts rail on top with online dots and cpu/mem/disk micro-meters per host, the session tree in the middle, and a "viewing" pill in the bottom control area — the pill only appears while the session is not the controller). The main area shows the empty state "No terminals yet" (no "Start terminal" button is shown because session A is not yet the controller).

2. **action:** In browser session A, click the "viewing" pill in the sidebar's bottom control area to take control, then click "Start terminal" in the empty state (or the sidebar's ＋ button (new-session dialog → terminal) / press `⌃B c`).
   **eval:** The "viewing" pill is replaced by the view-only lock button (controlling is the normal state). A terminal pane appears in the workspace, showing live terminal content.

3. **action:** In browser session B, open http://localhost:4317
   **eval:** Session B loads in view-only mode — the sidebar shows the "viewing" pill. The same terminal pane is already present in the workspace, but the "Close pane" item in the pane's right-click context menu is disabled.

4. **action:** In browser session B, click the "viewing" pill in the sidebar
   **eval:** Session B becomes the controller — its "viewing" pill disappears, and the "Close pane" context-menu item becomes enabled.

5. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** Session A flips into view-only mode — the "viewing" pill reappears in its sidebar, and its "Close pane" context-menu item is disabled again.

6. **action:** In browser session B, right-click the terminal pane and choose "Close pane" from the context menu
   **eval:** The terminal disappears from session B's workspace. The empty state "No terminals yet" is visible again. Session B remains the controller (its sidebar shows the view-only lock, not the pill).

7. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** The terminal also disappears from session A's workspace. The empty state "No terminals yet" is visible. Session A's sidebar remains in view-only mode ("viewing" pill).

8. **action:** In browser session A, reload the page
   **eval:** After reload, session A still shows the empty "No terminals yet" state with the "viewing" pill in the sidebar.

9. **action:** In browser session B, reload the page
   **eval:** After reload, session B also shows the empty "No terminals yet" state with the "viewing" pill in the sidebar — a full page reload is treated as leaving control.
