# Terminal Handoff Sizing

1. **action:** In a desktop browser session, open the app, take control of the online machine, and open the `~/root` bookmark
   **eval:** One terminal card appears in the grid. The terminal exists on the server with its initial `cols` and `rows`.

2. **action:** Maximize the terminal in the desktop session
   **eval:** The terminal opens full screen, but the authoritative terminal size on the server is unchanged. Entering a larger viewport alone does not resize the shared PTY.

3. **action:** Open a mobile browser session for the same account and wait for the same terminal to appear in view-only mode
   **eval:** The same terminal is visible on mobile without taking control. The mobile session still sees the same authoritative `cols` and `rows`, but the local view scales down so the full width fits on screen.

4. **action:** On mobile, take control and maximize the terminal
   **eval:** Control transfers to mobile, but the authoritative terminal size still does not change just because another device took over.

5. **action:** On mobile, tap `Use This Size`
   **eval:** The shared terminal is explicitly resized to match the mobile viewport, and the authoritative `cols` and `rows` on the server change. On the desktop session, the local view keeps the narrower terminal centered instead of stretching it across the full screen.
