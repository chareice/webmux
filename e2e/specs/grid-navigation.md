# Workspace Navigation: Tabs, panes, and URL sync

## Setup

- Destroy all existing terminals via the API
- Release any held control leases

## Steps

1. **action:** Open the app at `http://localhost:4317` on a desktop viewport (1440×960). Click the "viewing" pill in the sidebar's bottom control area to take control.
   **eval:** The pill is replaced by the view-only lock button (controlling shows no pill). The main area shows the empty state "No terminals yet" with a "Start terminal" button.

2. **action:** Click the "Start terminal" button (or the sidebar's ＋ button, or press `⌃B c`).
   **eval:** A terminal pane appears in the workspace and a section for its cwd group appears in the sidebar tree. The URL hash becomes `#/t/{terminal-id}` (auto-focusing the new terminal).

3. **action:** Press `Esc` (with focus outside the terminal).
   **eval:** The zoom hash is cleared; the workspace stays visible — it is the permanent desktop view, not an overlay.

4. **action:** Create a second terminal in a different cwd (e.g. via the API or by launching from another workpath).
   **eval:** A second section appears in the sidebar tree. Clicking a section switches the workspace to that group; the active section is highlighted with an accent left border.

5. **action:** Press `⌃B %` (Ctrl+B, then Shift+5).
   **eval:** The active pane splits to the right — the group now shows two panes side by side, and the section's rows list the pane terminals. `⌃B "` splits down.

6. **action:** Press `⌃B` then an arrow key.
   **eval:** Focus moves between panes in that direction. The focused pane has a subtle 1px accent border; unfocused panes have a plain line border. There are no per-pane headers.

7. **action:** Press `⌃B z`.
   **eval:** The focused pane zooms to fill the workspace. `⌃B z` again (or closing the pane) restores the split layout.

8. **action:** Right-click a pane.
   **eval:** A context menu opens with Split right / Split down / Zoom / Fit to window, a "Move pane to tab ▸" submenu (the old toolbar `<select>` replacement), and Close pane.

9. **action:** Choose "Close pane" from the context menu (or press `⌃B x`).
   **eval:** The pane is destroyed and the split layout collapses. Closing the last pane returns to the empty "No terminals yet" state.

10. **action:** Reload the page while the URL has `#/t/{id}`.
    **eval:** After reload, the app restores the focused terminal automatically. The back button then clears the hash and returns to the default terminal.
