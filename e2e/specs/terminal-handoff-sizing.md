# Terminal Handoff Sizing

1. **action:** In a desktop browser session, open the app, click the sidebar's "viewing" pill to take control, and open a new terminal via the sidebar's ＋ button (new-session panel → terminal), `⌃B c`, or the empty-state "Start terminal" button.
   **eval:** One terminal pane appears in the workspace. The terminal exists on the server with its initial `cols` and `rows`.

2. **action:** Focus the terminal in the desktop workspace (click its pane)
   **eval:** The terminal renders at workspace size, but the authoritative terminal size on the server is unchanged until a fit is requested. Entering a larger viewport alone does not resize the shared PTY.

3. **action:** Open a mobile browser session (web viewport < 768px) for the same account and wait for the same terminal to appear in view-only mode
   **eval:** The same terminal is visible directly in the mobile shell (strip + terminal + key bar) without taking control — there is no card list. The mobile session still sees the same authoritative `cols` and `rows`, but the local view scales down so the full width fits on screen.

4. **action:** On mobile, take control via the host sheet ("Take control")
   **eval:** Control transfers to mobile (the desktop sidebar grows a "viewing" pill).

5. **action:** Nothing further — becoming the controller auto-fits the terminal to the mobile viewport (mobile has no manual Fit button anymore)
   **eval:** The shared terminal is resized to match the mobile viewport, and the authoritative `cols` and `rows` on the server change. On the desktop session, the workspace keeps the narrower terminal centered instead of stretching it across the full pane.
