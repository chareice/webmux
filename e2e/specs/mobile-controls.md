# Mobile Controls: Terminal UI on phone screen

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Browser viewport set to iPhone 14 (390×844)

## Steps

1. **action:** Set device to "iPhone 14" and open http://localhost:4317
   **eval:** The mobile workbench loads with a dark background. A top app bar shows a rounded "host chip" on the left containing a green online dot, the host name "e2e-machine", an OS label "linux", and a chevron. Next to it is an overflow (⋯) button. At the bottom is a 3-tab navigation: "Hosts", "Terminals" (selected, showing badge "0"), and "Stats". The main area shows a "Workpath" picker card labelled "All" and, below it, the empty state "No terminals here yet — Tap + to start one".

2. **action:** Tap the "Hosts" bottom tab
   **eval:** The Hosts page loads. It shows a "HOSTS" section with one row for "e2e-machine" (green dot, "linux" label, "0 term" meta), and a "WORKPATHS · e2e-machine" section below with an "All workpaths" row (highlighted) and an "All · 1" subsection containing a "~" row with path "/root".

3. **action:** Tap the "~" workpath row
   **eval:** The bottom tab switches back to "Terminals". The "Workpath" picker card at the top now reads "~" (with the path "/root" next to it). The main area still shows the "No terminals here yet" empty state. The overflow menu (tapped via the ⋯ button in the top bar) or the header still offers a "Control Here" action — use it in the next step.

4. **action:** Tap the overflow (⋯) button in the top bar and tap "Control Here" (if the app exposes control via that menu in mobile; otherwise tap the host chip and confirm the host is selected — in the fresh mobile layout, the "Stop Control" action appears in the overflow menu only while controlling). If no overflow menu control is present, take control via the `Stats` tab's "Request control" action row. Then return to the "Terminals" tab and tap the "+" floating action button (FAB) in the bottom-right.
   **eval:** A new terminal is created. Because creating a terminal auto-opens the fullscreen focus view, the app transitions directly into the mobile terminal focus screen (see step 5). The "Terminals" tab's badge becomes "1".

5. **action:** Observe the fullscreen focus screen that opened after step 4
   **eval:** The full viewport shows the live terminal. A top header has a back chevron on the left, then a tint dot, the terminal title (e.g. "Terminal abcd1234"), a subtitle line showing "/root · pid {n}", and an overflow (⋯) button on the right. Below the terminal body is a horizontal key-bar (44px) with keys "Esc", "Tab", "Ctrl", "Alt", "↑", "↓", "←", "→", "|", "/", "-", "~". If there are sibling terminals, a prev/next strip appears at the very bottom (disabled buttons when there are no siblings).

6. **action:** Tap the terminal body, type "echo hello" and press Enter on the soft keyboard
   **eval:** The terminal renders "# echo hello" followed by "hello" on the next line, followed by a fresh "#" prompt.

7. **action:** Tap the back chevron in the focus header
   **eval:** The focus view closes and returns to the "Terminals" tab. The terminal is still alive — it appears as a `MobileTermCard` in the list: tint dot, title, short id chip, cwd footer "/root", and `{cols}×{rows}` size indicator.

8. **action:** Tap the "Stats" bottom tab, then tap the "Release control" action row (danger-styled).
   **eval:** The mode flips to viewing. Returning to the "Terminals" tab, the FAB is gone (the + only appears while controlling). Tapping the terminal card still opens the fullscreen focus view, but the bottom key-bar buttons do nothing (no input is accepted) and there is no `Fit to Window` action.

9. **action:** Tap the "Stats" tab, tap "Request control" to regain control. Return to the "Terminals" tab and confirm the FAB is visible. Open a desktop browser session for the same account, click "Control Here" (this takes control away from mobile), then destroy the terminal from the desktop grid card's close (×) button.
   **eval:** On mobile, control is released back ("Control Here" reappears, FAB disappears). After the desktop closes the terminal, the mobile "Terminals" tab updates live to the empty state "No terminals here yet — Tap + to start one" and the tab badge clears.
