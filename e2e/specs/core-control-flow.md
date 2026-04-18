# Core Control Flow: Two browser sessions stay in sync

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Use two isolated browser sessions so the app generates different `device_id` values
- Start with no terminals open

## Steps

1. **action:** In browser session A, open http://localhost:4317
   **eval:** The desktop workbench loads with the Rail open on the left (host "e2e-machine" shown at the top with an online status dot, a "Filter workpaths…" input, an "All" row selected, and a "Workpaths" section listing "~" with path "/root"). The header shows breadcrumb "e2e-machine / All", a "Viewing" pill, CPU/MEM/TERM stat chips, and a "Control Here" button top-right. The main area shows the empty state "No terminals yet" (no "Start terminal" button is shown because session A is not yet the controller).

2. **action:** In browser session A, click "Control Here" in the header. Then click the "~" row in the Rail, then click "Start terminal" (or the "New terminal" button in the header).
   **eval:** The "Viewing" pill becomes "Controlling" and the top-right button changes to "Stop Control". A terminal card appears in the grid with a tint dot, the generated title starting with "Terminal", a short id chip, an "ctrl" badge, and a "/root" footer. The card body shows live terminal content.

3. **action:** In browser session B, open http://localhost:4317
   **eval:** Session B loads in view-only mode — the header shows a "Viewing" pill and a "Control Here" button. The same terminal card is already present in the grid but its header does NOT show the "ctrl" badge. Its close (×) button is disabled (tooltip reads "View only — cannot close").

4. **action:** In browser session B, click "Control Here" in the header
   **eval:** Session B becomes the controller — the pill flips to "Controlling" and the button to "Stop Control". The card now shows the "ctrl" badge and its close button becomes active.

5. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** Session A flips into view-only mode — the pill returns to "Viewing" and the button to "Control Here". The card's "ctrl" badge disappears and its close button is disabled again.

6. **action:** In browser session B, click the close (×) button in the terminal card's header
   **eval:** The terminal disappears from session B's grid. The empty state "No terminals yet" is visible again. The header still shows "Controlling" and "Stop Control".

7. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** The terminal also disappears from session A's grid. The empty state "No terminals yet" is visible. The header remains in view-only mode ("Viewing" pill, "Control Here" button).

8. **action:** In browser session A, reload the page
   **eval:** After reload, session A still shows the empty "No terminals yet" grid, with "Viewing" pill and "Control Here" button top-right.

9. **action:** In browser session B, reload the page
   **eval:** After reload, session B also shows the empty "No terminals yet" grid with "Viewing" pill and "Control Here" button — a full page reload is treated as leaving control.
