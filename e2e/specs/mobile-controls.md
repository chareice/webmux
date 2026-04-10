# Mobile Controls: Terminal UI on phone screen

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Browser viewport set to iPhone 14 (390×844)

## Steps

1. **action:** Set device to "iPhone 14" and open http://localhost:4317
   **eval:** Dark background with hamburger menu (☰) at top-left, "Control" indicator with green dot and "Release" button at top-right, onboarding text "Tap ≡ to open a terminal" centered

2. **action:** Tap the hamburger button (☰)
   **eval:** Sidebar opens as overlay on the left (~260px wide) with dark backdrop on right. Sidebar shows "MACHINES" heading, "e2e-machine" with green online dot and "linux" label, directory "~ /root" with expand arrow, and "+ Add directory" button

3. **action:** Tap the "~ /root" directory entry in the sidebar
   **eval:** Sidebar closes automatically. A terminal card appears in single-column layout with: title bar showing "Terminal [id]" with green dot, maximize button (⤢), and close button (✕). Terminal area shows `#` shell prompt. Footer shows "/root" path

4. **action:** Tap the terminal card to maximize it
   **eval:** Terminal goes fullscreen (no border radius). Title bar shows terminal name, minimize button (⤡), close button (✕). Bottom shows ExtendedKeyBar toolbar (44px) with: keyboard toggle icon, "Esc", "Tab", "|", "~" keys, then arrow keys "↑", "↓", "←", "→" (scrollable to reveal more). Below toolbar: "/root" path. ">_" command bar button visible at far right of toolbar

5. **action:** Tap the terminal input area, type "echo hello" and press Enter
   **eval:** Terminal displays "# echo hello" followed by "hello" output on next line, then a new `#` prompt with cursor

6. **action:** Tap the ">_" button in the ExtendedKeyBar
   **eval:** Command bar panel opens at bottom with: "CONTROL" heading, "Command..." text input, "Paste image or drag file" label with "IMG" and "Send" buttons, shortcut list including Ctrl+C (Interrupt), Ctrl+D (EOF), Ctrl+Z (Suspend), Ctrl+L (Clear), Ctrl+R (Search history), Ctrl+A (Line start), Ctrl+E (Line end), Tab (Autocomplete)

7. **action:** Tap the ">_" button again to close the command bar
   **eval:** Command bar panel closes, only the ExtendedKeyBar toolbar remains at bottom

8. **action:** Tap the "Release" button in the mode indicator
   **eval:** Mode switches to "Watch Mode" — terminal title bar shows "Watch Mode" badge, mode indicator changes to gray dot with "Watch" text and "Take Control" button. "Show keyboard" button disappears from toolbar. Terminal content remains visible but input is disabled

9. **action:** Tap the "Take Control" button
   **eval:** Mode switches back to "Control" — green dot with "Control" text and "Release" button. "Show keyboard" button reappears in toolbar. Terminal input is re-enabled

10. **action:** Tap the minimize button (⤡) in the maximized terminal title bar
    **eval:** Terminal should return to card view (non-fullscreen), showing the terminal card in single-column grid layout with maximize button (⤢) available again

11. **action:** Tap the close button (✕) on the terminal card
    **eval:** Terminal is destroyed and removed from the grid. Page returns to empty state with onboarding text "Tap ≡ to open a terminal"
