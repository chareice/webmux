# Multi-Device Collaboration

## Scenario 1: Desktop-sized terminal stays readable on mobile viewing

1. **action:** In a desktop browser session, click the TabBar's "viewing" pill to take control, open a new terminal (TabBar ＋ button or `⌃B c`), right-click the pane and choose "Fit to window" from the context menu
   **eval:** The shared terminal is explicitly resized for the desktop viewport — the server's authoritative `cols`/`rows` match the desktop workspace size.

2. **action:** Open the same app on a mobile browser session (web viewport < 768px) without taking control. The mobile shell opens straight into the shared terminal — title bar on top, terminal in the middle, key bar at the bottom.
   **eval:** Mobile remains in viewing mode. The terminal still reflects the desktop-sized authoritative dimensions, but the local mobile view scales down so the full width stays readable.

3. **action:** Inspect the mobile controls while still viewing, then open the host sheet from the session switcher's host-name button
   **eval:** The key bar hides the keyboard (ABC) toggle and its keys send nothing; the host sheet offers "Take control".

## Scenario 2: Explicit sizing round-trips cleanly between desktop and mobile

1. **action:** Start from a desktop-controlled terminal whose workspace was sized with "Fit to window"
   **eval:** The server has a stable desktop-sized `cols`/`rows`.

2. **action:** On mobile, take control from the host sheet ("Take control")
   **eval:** Control moves to mobile (the desktop TabBar grows a "viewing" pill).

3. **action:** Nothing further — becoming the controller auto-fits the terminal to the mobile viewport (mobile has no manual Fit button anymore)
   **eval:** The shared terminal resizes to the mobile viewport, and the desktop session keeps rendering it as a narrow centered terminal instead of stretching it full width.

4. **action:** On desktop, reclaim control by clicking the TabBar's "viewing" pill, then right-click the pane and choose "Fit to window" again
   **eval:** The shared terminal resizes back to the desktop viewport, and the mobile session goes back to width-fitted local viewing.

## Scenario 3: Multiple shared terminals stay in sync across a handoff

1. **action:** In a desktop browser session, click the TabBar's "viewing" pill to take control and open two terminals (TabBar ＋ button or `⌃B c` twice).
   **eval:** Two live terminal panes exist in the desktop workspace for the same machine (as tabs and/or split panes).

2. **action:** Open the same account on mobile
   **eval:** Mobile sees the current session title and `{i}/{n}` position in the title bar, in viewing mode.

3. **action:** On mobile, take control via the host sheet, then close one of the terminals (switch to it, long-press the title bar → "Close terminal").
   **eval:** Both mobile and desktop update live to show exactly one remaining terminal, and both sessions agree on which terminal remains.
