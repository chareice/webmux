# Mobile Controls: Terminal UI on phone screen

## Setup

- E2E environment running (`docker compose -f e2e/docker-compose.yml up -d`)
- Node "e2e-machine" connected to hub
- Browser viewport set to iPhone 14 (390×844)

## Steps

1. **action:** Set device to "iPhone 14" and open http://localhost:4317
   **eval:** The mobile shell loads with a dark background and exactly two
   permanent chrome elements. Top: a 40px title bar with the current
   `{group} · {title}`, a visible 34px "＋" button, the current `{i}/{n}`
   position badge, and one host-health dot. Bottom: the two-row extended key
   bar — pinned row with
   keyboard toggle (ABC), attach, select-mode, then Esc, ⇧Tab, ↑, ↓ and an
   accent-colored ^C; scrollable row with Ctrl (latch), Tab, /, @, ←, →, ~,
   |, -, _. With no terminals the middle shows a centered "No terminals
   yet" empty state.

2. **action:** Tap the title bar, tap the host-name area in the switcher header, then tap "Take control" in the bottom sheet
   **eval:** The switcher header shows dot, host name, RTT, cpu%, and mem%.
   The host sheet opens listing hosts (dot, name, OS, term count)
   with "Add host", "Take control", "Reconnect session" and "Settings"
   rows. After taking control the sheet closes and the empty state now
   shows an accent "Start terminal" button.

3. **action:** Tap "Start terminal"
   **eval:** A new terminal is created and the shell opens straight into it:
   the live terminal fills the middle, the title bar shows
   `"{group} · shell"` and `1/1`, and the key bar shows the
   keyboard-toggle (ABC) button.

4. **action:** Tap ABC, type "echo hello" and press Enter on the soft keyboard
   **eval:** The terminal renders "# echo hello" followed by "hello" on the
   next line, followed by a fresh "#" prompt. Every keystroke sends
   immediately (no input field, no send button).

5. **action:** Tap "Ctrl" in the scrollable key row, then type "c" on the soft keyboard
   **eval:** Ctrl highlights (info-blue). The "c" arrives as ^C (the shell
   shows a fresh prompt instead of echoing "c"), and Ctrl disarms —
   typing "c" again echoes normally.

6. **action:** Create a second terminal via the title bar's "＋" button, then
   tap the title bar
   **eval:** The new terminal is created in the current group's cwd and becomes
   active immediately. The bar's `{i}/{n}` badge reflects the new position.
   Tapping the bar opens a grouped session
   sheet with one global "New terminal" row, group headers with pane counts,
   full terminal titles and cwd values, and a highlighted active row. Tapping
   another session switches to it and closes the sheet. Long-pressing the bar
   still opens the sheet with "Close terminal" and "New terminal here".

7. **action:** Swipe horizontally across the title bar, then swipe horizontally
   from the left screen edge (within ~24px of the edge)
   **eval:** Both gestures switch sessions in the same no-wrap group order.
   Middle-screen gestures in the terminal remain untouched, so terminal scroll
   and mouse-tracking apps keep working.

8. **action:** Open the host sheet and tap "View only"
   **eval:** The mode flips to viewing: the ABC keyboard toggle disappears
   from the key bar, the title-bar "＋" becomes disabled, and key-bar keys no
   longer send input. The terminal stays fully visible and live. Tapping
   "Unlock view only" returns to normal viewing without implicitly claiming
   control; "Take control" remains a separate action.

9. **action:** Take control again via the host sheet, then open a desktop browser session for the same account, click "Control Here" (this takes control away from mobile), then destroy the terminal from the desktop pane's close action
   **eval:** On mobile, control is released (host sheet shows "Take
   control" again, title-bar ＋ disabled). After the desktop closes the
   terminal, the mobile shell updates live and the
   empty state "No terminals yet" returns.

10. **action:** While controlling a terminal at 390×844, open the soft
    keyboard so the visual viewport shrinks, then close it
    **eval:** After the viewport settles, the terminal row count decreases so
    the cursor row, title bar, and key bar remain visible above the
    keyboard. Closing the keyboard grows the terminal row count again. A
    view-only client does not resize the shared PTY and instead scrolls the
    terminal to the bottom after a viewport shrink.

11. **action:** Take control, focus a real terminal, type
    `printf '\033]2;my-task\007'`, and press Enter
    **eval:** The emitted OSC 2 sequence flows through tmux, machine, hub, and
    browser events; the title bar updates live to show `my-task`.
