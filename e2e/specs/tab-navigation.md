# Tab Navigation: Terminal tab-based view switching and URL sync

## Setup

- Destroy all existing terminals via the API
- Release any held control leases

## Steps

1. **action:** Open the app at `http://localhost:4317` on a desktop viewport (1440×960). Take control of the machine by clicking "Control Here".
   **eval:** The "Active Machine" section shows "Controlling" badge. The tab bar is not visible (no terminals exist). The canvas shows "Select a directory to open a terminal".

2. **action:** Expand the machine section in the sidebar and click the "~/root" bookmark to create the first terminal.
   **eval:** A tab bar appears at the top of the content area with two tabs: "All" (with a grid icon) and a terminal tab (e.g. "Terminal XXXXXXXX" with a blue dot). The terminal tab is active (highlighted with accent underline). The terminal is displayed full-size in the content area with a title bar showing the terminal name, "/root" cwd, a close button, "Use This Size", and a panel toggle button. The URL hash changes to `#/t/{terminal-id}`.

3. **action:** Click the "All" tab in the tab bar.
   **eval:** The view switches to the grid overview. The "Active Machine" section reappears with machine name, stats, and "Stop Control" button. The first terminal appears as a small card in the grid with a miniature terminal preview, title, close button, and "/root" footer. The "All" tab is now highlighted. The URL hash is cleared (no `#/t/` fragment).

4. **action:** Click the terminal card in the grid to switch to its tab.
   **eval:** The view switches back to the full-size terminal tab view. The terminal tab is active in the tab bar. The URL hash updates to `#/t/{terminal-id}`.

5. **action:** Click the "~/root" bookmark in the sidebar again to create a second terminal.
   **eval:** A third tab appears in the tab bar (now: "All", first terminal tab, second terminal tab). The new terminal's tab is automatically selected and active. The second terminal is displayed full-size. The URL hash updates to the new terminal's ID.

6. **action:** Click the first terminal's tab in the tab bar.
   **eval:** The view switches to the first terminal displayed full-size. The first terminal's tab is now active. The URL hash updates to the first terminal's ID.

7. **action:** Click the "All" tab to return to the grid.
   **eval:** Both terminals appear as cards in the grid. The tab bar shows all three tabs ("All" + two terminal tabs). The "All" tab is active.

8. **action:** Click the close button (×) on the second terminal's tab in the tab bar.
   **eval:** The second terminal is destroyed. Its tab disappears from the tab bar. Only "All" and the first terminal tab remain. The grid shows only one terminal card. The API confirms only one terminal exists.

9. **action:** Click the first terminal's tab, then use the browser back button.
   **eval:** After clicking the tab, the terminal is shown full-size with URL hash `#/t/{id}`. After pressing the browser back button, the view returns to the "All" grid view and the URL hash is cleared.

10. **action:** Click the first terminal's tab again, then reload the page.
    **eval:** After reload, the terminal tab view is restored based on the URL hash. The terminal is displayed full-size with the correct tab selected.

11. **action:** Close the last remaining terminal via the close button in the terminal's title bar (not the tab bar).
    **eval:** The terminal is destroyed. The tab bar disappears (no more terminal tabs to show). The canvas shows "Select a directory to open a terminal". The URL hash is cleared.
