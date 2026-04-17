# Mobile Controls: Terminal UI on phone screen

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Browser viewport set to iPhone 14 (390×844)

## Steps

1. **action:** Set device to "iPhone 14" and open http://localhost:4317
   **eval:** Dark background with hamburger menu (☰) at top-left, onboarding text "Tap ≡ to open a terminal" centered, and a top-right control button labelled "Control Here"

2. **action:** Tap the hamburger button (☰)
   **eval:** Sidebar opens as overlay on the left (~260px wide) with dark backdrop on right. Sidebar shows "MACHINES" heading, "e2e-machine" with green online dot and "linux" label, directory "~ /root" with expand arrow, and "+ Add directory" button

3. **action:** Tap the "~ /root" directory entry in the sidebar
   **eval:** Sidebar closes automatically. A terminal card appears in single-column layout with: title bar showing "Terminal [id]" with green dot, maximize button (⤢), and close button (✕). Terminal area shows `#` shell prompt. Footer shows "/root" path

4. **action:** Tap the terminal card to maximize it
   **eval:** Terminal goes fullscreen (no border radius). Title bar shows terminal name, minimize button (⤡), close button (✕), and a "Use This Size" action while controlling. Bottom shows ExtendedKeyBar toolbar (44px) with: keyboard toggle icon, "Esc", "Tab", "|", "~" keys, then arrow keys "↑", "↓", "←", "→" (scrollable to reveal more). Below toolbar: "/root" path

5. **action:** Tap the terminal input area, type "echo hello" and press Enter
   **eval:** Terminal displays "# echo hello" followed by "hello" output on next line, then a new `#` prompt with cursor

6. **action:** Tap the "Stop Control" button in the mode indicator
   **eval:** Mode switches to viewing. The toggle changes to "Control Here", the keyboard button disappears from the toolbar, and terminal content remains visible but input is disabled

7. **action:** Tap the "Control Here" button
   **eval:** Mode switches back to controlling. The toggle changes to "Stop Control", the keyboard button reappears in the toolbar, and terminal input is re-enabled

8. **action:** Tap the minimize button (⤡) in the maximized terminal title bar
   **eval:** Terminal should return to card view (non-fullscreen), showing the terminal card in single-column grid layout with maximize button (⤢) available again

9. **action:** Tap the close button (✕) on the terminal card
   **eval:** Terminal is destroyed and removed from the grid. Page returns to empty state with onboarding text "Tap ≡ to open a terminal"
