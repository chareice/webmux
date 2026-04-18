# Multi-Device Collaboration

## Scenario 1: Desktop-sized terminal stays readable on mobile viewing

1. **action:** In a desktop browser session, click "Control Here", select the "~" workpath in the Rail, open a new terminal, click the card to open the ExpandedTerminal overlay, and tap `Fit to Window`
   **eval:** The shared terminal is explicitly resized for the desktop viewport — the server's authoritative `cols`/`rows` match the desktop overlay size.

2. **action:** Open the same app on a mobile browser session (web viewport < 680px) without taking control. Tap the terminal card in the "Terminals" tab to open the fullscreen mobile terminal view.
   **eval:** Mobile remains in viewing mode (header shows "Control Here"). The terminal still reflects the desktop-sized authoritative dimensions, but the local mobile view scales down so the full width stays readable.

3. **action:** Inspect the mobile controls while still viewing
   **eval:** The terminal shows `Control Here`, does not expose `Fit to Window`, and does not allow keyboard input.

## Scenario 2: Explicit sizing round-trips cleanly between desktop and mobile

1. **action:** Start from a desktop-controlled terminal whose overlay was sized with `Fit to Window`
   **eval:** The server has a stable desktop-sized `cols`/`rows`.

2. **action:** On mobile, tap `Control Here`, open the same terminal into the fullscreen mobile view
   **eval:** Control moves to mobile, but the shared terminal size does not change just because control moved.

3. **action:** On mobile, tap `Fit to Window`
   **eval:** The shared terminal resizes to the mobile viewport, and the desktop session keeps rendering it as a narrow centered terminal instead of stretching it full width.

4. **action:** On desktop, reclaim control by clicking "Control Here" in the header, open the terminal's overlay, and tap `Fit to Window`
   **eval:** The shared terminal resizes back to the desktop viewport, and the mobile session goes back to width-fitted local viewing.

## Scenario 3: Multiple shared terminals stay in sync across a handoff

1. **action:** In a desktop browser session, click "Control Here", select the "~" workpath in the Rail, and open two terminals (click "New terminal" in the header twice; close the expand overlay between them so both remain in the grid).
   **eval:** Two live terminal cards exist in the desktop grid for the same machine.

2. **action:** Open the same account on mobile
   **eval:** Mobile sees both terminal cards listed under the "Terminals" tab in viewing mode.

3. **action:** On mobile, tap "Control Here" in the overflow menu (⋯) or header, then open one of the terminals and close it via the terminal's header close button inside the overflow menu / ExpandedTerminal `×` button.
   **eval:** Both mobile and desktop update live to show exactly one remaining terminal, and both sessions agree on which terminal remains.
