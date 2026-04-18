# Terminal Handoff Sizing

1. **action:** In a desktop browser session, open the app, click "Control Here" in the header, select the "~" workpath in the Rail, and open a new terminal via the header's "New terminal" button or the empty-state "Start terminal" button. After the terminal appears, press `Esc` to dismiss the auto-opened ExpandedTerminal overlay.
   **eval:** One terminal card appears in the grid. The terminal exists on the server with its initial `cols` and `rows`.

2. **action:** Click the card to open the ExpandedTerminal overlay
   **eval:** The terminal opens at full overlay size, but the authoritative terminal size on the server is unchanged. Entering a larger viewport alone does not resize the shared PTY.

3. **action:** Open a mobile browser session (web viewport < 680px) for the same account and wait for the same terminal to appear in view-only mode
   **eval:** The same terminal is visible on mobile in the "Terminals" tab list without taking control. The mobile session still sees the same authoritative `cols` and `rows`, but the local view scales down so the full width fits on screen.

4. **action:** On mobile, tap "Control Here" (in the header or overflow menu) and tap the terminal card to open the fullscreen mobile terminal view
   **eval:** Control transfers to mobile, but the authoritative terminal size still does not change just because another device took over.

5. **action:** On mobile, tap `Fit to Window`
   **eval:** The shared terminal is explicitly resized to match the mobile viewport, and the authoritative `cols` and `rows` on the server change. On the desktop session, the local view inside the ExpandedTerminal overlay keeps the narrower terminal centered instead of stretching it across the full overlay.
