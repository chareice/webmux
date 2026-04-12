# Multi-Device Collaboration

## Scenario 1: Desktop-sized terminal stays readable on mobile viewing

1. **action:** In a desktop browser session, take control, open the `~/root` bookmark, maximize the terminal, and tap `Use This Size`
   **eval:** The shared terminal is explicitly resized for the desktop viewport.

2. **action:** Open the same app on a mobile browser session without taking control and maximize the existing terminal
   **eval:** Mobile remains in viewing mode. The terminal still reflects the desktop-sized authoritative dimensions, but the local mobile view scales down so the full width stays readable.

3. **action:** Inspect the mobile controls while still viewing
   **eval:** The terminal shows `Control Here`, does not expose `Use This Size`, and does not allow command bar or keyboard input.

## Scenario 2: Explicit sizing round-trips cleanly between desktop and mobile

1. **action:** Start from a desktop-controlled terminal that has already been explicitly sized with `Use This Size`
   **eval:** The server has a stable desktop-sized `cols`/`rows`.

2. **action:** On mobile, take control of the same terminal and maximize it
   **eval:** Control moves to mobile, but the shared terminal size does not change just because control moved.

3. **action:** On mobile, tap `Use This Size`
   **eval:** The shared terminal resizes to the mobile viewport, and the desktop session keeps rendering it as a narrow centered terminal instead of stretching it full width.

4. **action:** On desktop, reclaim control and tap `Use This Size`
   **eval:** The shared terminal resizes back to the desktop viewport, and the mobile session goes back to width-fitted local viewing.

## Scenario 3: Multiple shared terminals stay in sync across a handoff

1. **action:** In a desktop browser session, take control and open the `~/root` bookmark twice
   **eval:** Two live terminal cards exist for the same machine.

2. **action:** Open the same account on mobile
   **eval:** Mobile sees the same two terminal cards in viewing mode.

3. **action:** On mobile, take control and close one of the two terminals
   **eval:** Both mobile and desktop update live to show exactly one remaining terminal, and both sessions agree on which terminal remains.
