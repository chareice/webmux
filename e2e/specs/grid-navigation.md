# Grid Navigation: Terminal grid, expand overlay, and URL sync

## Setup

- Destroy all existing terminals via the API
- Release any held control leases

## Steps

1. **action:** Open the app at `http://localhost:4317` on a desktop viewport (1440×960). Click "Control Here" in the header.
   **eval:** The header shows "Controlling" + "Stop Control". The Rail shows "All" selected and a "Workpaths · 1" section with a "~" row (path "/root"). The main area shows the empty state "No terminals yet" with a "Start terminal" button.

2. **action:** Click the "~" row in the Rail, then click the "Start terminal" button (or the header's "New terminal").
   **eval:** A terminal card appears in the workbench grid. The card header shows a tint dot, the generated title "Terminal …", a short id chip (first 8 chars of the terminal id), an "ctrl" badge, and action icons (expand, more, close). The card body shows a live terminal preview. The card footer shows the cwd "/root". The URL hash becomes `#/t/{terminal-id}` (auto-opening into the expanded view — see the next step).

3. **action:** Observe the current state after step 2 — because creating a terminal auto-navigates to `#/t/{id}`, the ExpandedTerminal overlay is on screen. Click the close button (×) in the expanded overlay's header (or press `Esc`).
   **eval:** The overlay closes and the URL hash is cleared. The terminal card is visible in the grid again. The Rail's "~" row shows a count badge "1".

4. **action:** Click anywhere on the terminal card.
   **eval:** The ExpandedTerminal overlay opens. It has a dimmed/blurred backdrop and a large modal with: traffic-light dots (red/yellow/green), a tint dot, the terminal title, the short id, the cwd, an "ctrl" badge, and three icon buttons top-right (re-fit, fit, close). The body shows the terminal at full size. A footer shows "id {short} · {cols}×{rows} · reachable" and an "Esc collapse" hint. The URL hash updates to `#/t/{terminal-id}`.

5. **action:** Click the "~" row in the Rail again to create a second terminal. (Use "New terminal" in the header while the "~" workpath is selected.)
   **eval:** A second terminal card exists in the grid. Because the scope is "~" (1 bookmark), the grid filters to only the terminals whose cwd matches "/root" — both terminals appear. After the second terminal is created, the URL hash updates to `#/t/{new-terminal-id}` and the expanded overlay shows the second terminal.

6. **action:** In the expanded overlay, look at the thumbnail strip at the bottom. Click the first terminal's thumbnail.
   **eval:** The overlay switches to the first terminal — the header chrome updates (different short id, different title) and the body shows the first terminal's content. The thumbnail strip highlights the active thumbnail with an accent outline. The URL hash updates to the first terminal's id.

7. **action:** Press `Esc` to close the overlay.
   **eval:** The overlay closes and the URL hash is cleared. Both terminal cards remain in the grid.

8. **action:** Click the "All" row in the Rail.
   **eval:** The Rail selection moves to "All". The grid still shows both terminals (the "All" scope includes every terminal for this host). The URL hash remains cleared.

9. **action:** Click the expand icon button on the second terminal's card.
   **eval:** The ExpandedTerminal overlay opens for that terminal. The URL hash updates to its id.

10. **action:** Click the overlay's backdrop (outside the modal body).
    **eval:** The overlay closes, the URL hash is cleared, and both cards are back in the grid.

11. **action:** Click the close (×) button in the first terminal card's header.
    **eval:** The first terminal is destroyed. Only one card remains in the grid. The API confirms only one terminal exists on the server.

12. **action:** Click the remaining card to expand it, then reload the page.
    **eval:** Before reload, the URL has `#/t/{id}`. After reload, the app restores the expanded view automatically (same terminal is shown full-size in the overlay). The back button then dismisses the overlay and returns to the grid with the URL hash cleared.
