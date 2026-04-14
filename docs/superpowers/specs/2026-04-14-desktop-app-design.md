# Webmux Desktop App Design

## Overview

Build a native desktop client for webmux using Tauri. The desktop app wraps the existing Expo Web frontend in a native window, adding system-level capabilities (global shortcuts, tray, notifications, auto-update). It is a pure client — it connects to a remote webmux-server, does not bundle one.

## Target Platforms

- macOS
- Windows
- Linux

## Architecture

```
webmux monorepo
├── packages/
│   ├── app/              # Existing Expo Web frontend (unchanged)
│   ├── shared/           # Shared code (unchanged)
│   └── desktop/          # New: Tauri desktop app
│       ├── src-tauri/    # Rust side (Tauri config, native features)
│       │   ├── src/
│       │   │   └── lib.rs
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       ├── src/          # Frontend entry (loads app's web build output)
│       └── package.json
```

### How It Works

- `packages/app` builds to static web assets as usual.
- `packages/desktop` Tauri app loads these static assets into a native window.
- The Tauri Rust side handles native features (tray, global shortcuts, etc.).
- The frontend calls native APIs via `@tauri-apps/api` with platform detection — enabled in Tauri, ignored in browser.

## Native Features

### Global Shortcut

- Plugin: `global-shortcut`
- Toggle show/hide the app window (similar to iTerm2 hotkey window)
- Default shortcut is configurable

### System Tray

- Built-in Tauri tray-icon (no plugin needed)
- Closing the window minimizes to tray instead of quitting
- Tray menu: Show/Hide window, Quit
- Tray icon reflects connection status (connected/disconnected)

### System Notification (Reserved)

- Plugin: `notification`
- Register plugin and expose JS API, but do not implement trigger logic yet
- Future: trigger on terminal output, connection state changes, etc.

### Auto Update

- Plugin: `updater`
- Update source: GitHub Releases
- Silent check on startup, prompt user when a new version is available

## Web Frontend Changes

### Platform Detection

Add a detection layer so the frontend can check if it's running inside Tauri:

```typescript
const isTauri = '__TAURI_INTERNALS__' in window;
```

When running in Tauri, enable native feature calls. When in browser, skip them.

### Client Download Entry

- Add a download entry in the Web UI (e.g., sidebar or login page)
- Detect user's OS and show the corresponding download link
- Download URLs point to GitHub Releases

## Build & Distribution

### Build Flow

1. Build `packages/app` web assets
2. Tauri packages the assets into a native app
3. Orchestrated via pnpm workspace scripts — single command build

### CI/CD (GitHub Actions)

- Use `tauri-apps/tauri-action` official GitHub Action
- Trigger on tag push
- Build for all three platforms:
  - macOS: `.dmg`
  - Windows: `.msi` / `.exe`
  - Linux: `.deb` / `.AppImage`
- Upload artifacts to GitHub Releases
- Auto-update endpoint points to GitHub Releases (native Tauri updater support)

### Code Signing

- Not implemented initially for macOS/Windows
- Users will see OS security prompts on first launch
- Can be added later when needed

## Risk: xterm.js on Linux WebView

Linux Tauri uses WebKitGTK. xterm.js WebGL rendering may have compatibility issues. Mitigation: fall back to Canvas renderer. Risk is low and testable early.
