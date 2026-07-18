# Terminal Handoff Sizing

1. **action:** In a desktop browser session, open the app, click the TabBar's "viewing" pill to take control, and open a new terminal via the TabBar's ＋ button, `⌃B c`, or the empty-state "Start terminal" button.
   **eval:** One terminal pane appears in the workspace. The terminal exists on the server with its initial `cols` and `rows`.

2. **action:** Focus the terminal in the desktop workspace (click its pane)
   **eval:** The terminal renders at workspace size, but the authoritative terminal size on the server is unchanged until a fit is requested. Entering a larger viewport alone does not resize the shared PTY.

3. **action:** Open a mobile browser session (web viewport < 680px) for the same account and wait for the same terminal to appear in view-only mode
   **eval:** The same terminal is visible on mobile in the "Terminals" tab list without taking control. The mobile session still sees the same authoritative `cols` and `rows`, but the local view scales down so the full width fits on screen.

4. **action:** On mobile, take control via the "control" pill and tap the terminal card to open the fullscreen mobile terminal view
   **eval:** Control transfers to mobile (the desktop TabBar grows a "viewing" pill), but the authoritative terminal size still does not change just because another device took over.

5. **action:** On mobile, tap `Fit to Window`
   **eval:** The shared terminal is explicitly resized to match the mobile viewport, and the authoritative `cols` and `rows` on the server change. On the desktop session, the workspace keeps the narrower terminal centered instead of stretching it across the full pane.
