# tmux Scroll & Clipboard Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let tmux own scrolling and clipboard so the xterm.js scrollbar no longer misleads users, and copy/paste works end-to-end from tmux through to the browser clipboard.

**Architecture:** Enable tmux mouse mode and OSC 52 clipboard passthrough. Add `@xterm/addon-clipboard` to xterm.js so OSC 52 sequences from tmux reach `navigator.clipboard`. Add a Ctrl+C/Cmd+C handler that copies xterm.js selection instead of sending SIGINT. Hide the now-useless xterm.js scrollbar via CSS.

**Tech Stack:** Rust (tmux config in pty.rs), TypeScript/React (xterm.js addons), CSS

---

### Task 1: Add tmux mouse + clipboard config

**Files:**
- Modify: `crates/machine/src/pty.rs:497-516` (`ensure_tmux_config`)

**Step 1: Write the Rust unit test**

Add a `#[cfg(test)]` module at the bottom of `pty.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmux_config_contains_mouse_and_clipboard() {
        // ensure_tmux_config writes to a file; read it back
        ensure_tmux_config();
        let path = tmux_config_path();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("set -g mouse on"), "missing mouse on");
        assert!(content.contains("set -s set-clipboard on"), "missing set-clipboard");
        assert!(content.contains("set -g history-limit 10000"), "missing history-limit");
    }
}
```

**Step 2: Run test — expect FAIL**

Run: `cargo test -p tc-machine`
Expected: FAIL — config doesn't contain those lines yet.

**Step 3: Add config lines to `ensure_tmux_config`**

In the config string, add after `unbind C-b`:
```
set -g mouse on
set -s set-clipboard on
set -g history-limit 10000
```

**Step 4: Run test — expect PASS**

Run: `cargo test -p tc-machine`
Expected: PASS

**Step 5: Commit**

```
feat: enable tmux mouse mode and OSC 52 clipboard
```

---

### Task 2: Add @xterm/addon-clipboard and Ctrl+C copy handler

**Files:**
- Modify: `packages/app/package.json` (add dependency)
- Modify: `packages/app/components/TerminalView.web.tsx` (load addon, add key handler)

**Step 1: Install addon**

Run: `cd packages/app && pnpm add @xterm/addon-clipboard`

**Step 2: Load ClipboardAddon in TerminalView.web.tsx**

After `import { FitAddon } ...`, add:
```typescript
import { ClipboardAddon } from "@xterm/addon-clipboard";
```

After `term.loadAddon(fit);` (line 98), add:
```typescript
term.loadAddon(new ClipboardAddon());
```

**Step 3: Add Ctrl+C/Cmd+C copy handler**

After the `term.onData(...)` block (after line 134), add:
```typescript
term.attachCustomKeyEventHandler((event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "c" && event.type === "keydown") {
    if (term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
  }
  return true;
});
```

**Step 4: Verify build**

Run: `cd packages/app && pnpm build`
Expected: Build succeeds with no TS errors.

**Step 5: Commit**

```
feat: add clipboard addon and Ctrl+C copy handler
```

---

### Task 3: Hide xterm.js scrollbar via CSS

**Files:**
- Modify: `packages/app/global.css`

**Step 1: Add CSS rule**

After the `::-webkit-scrollbar-thumb` block, add:
```css
/* tmux owns scrolling; hide the xterm.js viewport scrollbar */
.xterm-viewport::-webkit-scrollbar {
  display: none;
}
.xterm-viewport {
  scrollbar-width: none;
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 3: Commit**

```
fix: hide xterm.js scrollbar (tmux handles scrolling)
```
