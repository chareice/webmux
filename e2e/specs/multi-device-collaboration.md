# Multi-Device Collaboration

## Scenario 1: Desktop-sized terminal stays readable on mobile viewing

1. **action:** In a desktop browser session, click the TabBar's "viewing" pill to take control, open a new terminal (TabBar ＋ button or `⌃B c`), right-click the pane and choose "Fit to window" from the context menu
   **eval:** The shared terminal is explicitly resized for the desktop viewport — the server's authoritative `cols`/`rows` match the desktop workspace size.

2. **action:** Open the same app on a mobile browser session (web viewport < 680px) without taking control. Tap the terminal card in the "Terminals" tab to open the fullscreen mobile terminal view.
   **eval:** Mobile remains in viewing mode (the mobile top bar shows a "control" pill). The terminal still reflects the desktop-sized authoritative dimensions, but the local mobile view scales down so the full width stays readable.

3. **action:** Inspect the mobile controls while still viewing
   **eval:** The terminal shows the "control" pill, does not expose `Fit to Window`, and does not allow keyboard input.

## Scenario 2: Explicit sizing round-trips cleanly between desktop and mobile

1. **action:** Start from a desktop-controlled terminal whose workspace was sized with "Fit to window"
   **eval:** The server has a stable desktop-sized `cols`/`rows`.

2. **action:** On mobile, tap the "control" pill, open the same terminal into the fullscreen mobile view
   **eval:** Control moves to mobile (the desktop TabBar grows a "viewing" pill), but the shared terminal size does not change just because control moved.

3. **action:** On mobile, tap `Fit to Window`
   **eval:** The shared terminal resizes to the mobile viewport, and the desktop session keeps rendering it as a narrow centered terminal instead of stretching it full width.

4. **action:** On desktop, reclaim control by clicking the TabBar's "viewing" pill, then right-click the pane and choose "Fit to window" again
   **eval:** The shared terminal resizes back to the desktop viewport, and the mobile session goes back to width-fitted local viewing.

## Scenario 3: Multiple shared terminals stay in sync across a handoff

1. **action:** In a desktop browser session, click the TabBar's "viewing" pill to take control and open two terminals (TabBar ＋ button or `⌃B c` twice).
   **eval:** Two live terminal panes exist in the desktop workspace for the same machine (as tabs and/or split panes).

2. **action:** Open the same account on mobile
   **eval:** Mobile sees both terminal cards listed under the "Terminals" tab in viewing mode.

3. **action:** On mobile, take control via the "control" pill, then open one of the terminals and close it via the mobile top bar's close button.
   **eval:** Both mobile and desktop update live to show exactly one remaining terminal, and both sessions agree on which terminal remains.
