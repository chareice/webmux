# Core Control Flow: Two browser sessions stay in sync

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Use two isolated browser sessions so the app generates different `device_id` values
- Start with no terminals open

## Steps

1. **action:** In browser session A, open http://localhost:4317
   **eval:** Desktop layout loads with the sidebar already open. The page shows "Machines", the online machine "e2e-machine", the root directory entry "▸~/root✕", and the top-right button "Take Control". The empty state says "Select a directory to open a terminal".

2. **action:** In browser session A, click "Take Control", then click the root directory entry "▸~/root✕"
   **eval:** A terminal card appears in the canvas. The card title starts with "Terminal", and the card shows "Close terminal" and "Maximize" buttons. The top-right machine control button now says "Release Control".

3. **action:** In browser session B, open http://localhost:4317
   **eval:** The same terminal is already visible in session B, but it is in watch mode. The terminal card shows the button "Watch mode - cannot close", and the top-right machine control button says "Take Control".

4. **action:** In browser session B, click "Take Control"
   **eval:** Session B becomes the controller. The top-right machine control button changes to "Release", and the terminal card button changes from "Watch mode - cannot close" to "Close terminal".

5. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** Session A flips into watch mode for the same terminal. The top-right machine control button changes to "Take Control", and the terminal card button changes to "Watch mode - cannot close".

6. **action:** In browser session B, click "Close terminal"
   **eval:** The terminal disappears from session B. The empty state "Select a directory to open a terminal" is visible again, and the top-right machine control button still says "Release".

7. **action:** In browser session A, wait for the live update without reloading the page
   **eval:** The terminal also disappears from session A. The empty state "Select a directory to open a terminal" is visible, and the top-right machine control button still says "Take Control".

8. **action:** In browser session A, reload the page
   **eval:** After reload, session A still shows the empty state "Select a directory to open a terminal" and the top-right button "Take Control".

9. **action:** In browser session B, reload the page
   **eval:** After reload, session B also shows the empty state "Select a directory to open a terminal" and the top-right button "Take Control", because a full page reload is treated as leaving control.
