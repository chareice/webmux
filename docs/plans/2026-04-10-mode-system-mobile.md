# Control/Watch Mode System & Mobile Experience

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a device mode system (Control/Watch) so only one device at a time can directly interact with terminals, plus optimize the mobile terminal experience inspired by Termius.

**Architecture:** Global mode state tracked in Hub's MachineManager. REST API for mode control, events WS for broadcasting changes and device tracking. Frontend enforces mode via xterm.js `disableStdin` and conditional resize. Mobile gets Termius-inspired ExtendedKeyBar with explicit keyboard toggle.

**Tech Stack:** Rust (axum), React + TypeScript, xterm.js, WebSocket

---

## Task 1: Backend — Mode State, REST API & WebSocket Changes

**Files:**
- Modify: `crates/protocol/src/lib.rs`
- Modify: `crates/hub/src/machine_manager.rs`
- Modify: `crates/hub/src/ws.rs`
- Create: `crates/hub/src/routes/mode.rs`
- Modify: `crates/hub/src/routes/mod.rs`

### Step 1: Add protocol types

In `crates/protocol/src/lib.rs`, add `ModeChanged` variant to `BrowserEvent`:

```rust
// Add to BrowserEvent enum (after TerminalDestroyed variant):
#[serde(rename = "mode_changed")]
ModeChanged {
    controller_device_id: Option<String>,
},
```

### Step 2: Add mode state to MachineManager

In `crates/hub/src/machine_manager.rs`:

Add imports and struct:
```rust
use std::collections::HashSet;

struct ModeState {
    controller_device_id: Option<String>,
    connected_devices: HashSet<String>,
}
```

Add `mode` field to `MachineManager`:
```rust
pub struct MachineManager {
    machines: Arc<Mutex<HashMap<String, MachineConnection>>>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    event_tx: broadcast::Sender<BrowserEvent>,
    mode: Arc<Mutex<ModeState>>,
}
```

Initialize in `new()`:
```rust
mode: Arc::new(Mutex::new(ModeState {
    controller_device_id: None,
    connected_devices: HashSet::new(),
})),
```

Add mode methods:
```rust
pub fn register_device(&self, device_id: &str) {
    self.mode.lock().unwrap().connected_devices.insert(device_id.to_string());
}

pub fn unregister_device(&self, device_id: &str) {
    let mut mode = self.mode.lock().unwrap();
    mode.connected_devices.remove(device_id);
    if mode.controller_device_id.as_deref() == Some(device_id) {
        mode.controller_device_id = None;
        drop(mode);
        let _ = self.event_tx.send(BrowserEvent::ModeChanged {
            controller_device_id: None,
        });
    }
}

pub fn request_control(&self, device_id: &str) {
    self.mode.lock().unwrap().controller_device_id = Some(device_id.to_string());
    let _ = self.event_tx.send(BrowserEvent::ModeChanged {
        controller_device_id: Some(device_id.to_string()),
    });
}

pub fn release_control(&self, device_id: &str) {
    let mut mode = self.mode.lock().unwrap();
    if mode.controller_device_id.as_deref() == Some(device_id) {
        mode.controller_device_id = None;
        drop(mode);
        let _ = self.event_tx.send(BrowserEvent::ModeChanged {
            controller_device_id: None,
        });
    }
}

pub fn is_controller(&self, device_id: &str) -> bool {
    self.mode.lock().unwrap().controller_device_id.as_deref() == Some(device_id)
}

pub fn get_controller(&self) -> Option<String> {
    self.mode.lock().unwrap().controller_device_id.clone()
}
```

### Step 3: Create mode REST endpoints

Create `crates/hub/src/routes/mode.rs`:
```rust
use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use crate::{auth::AuthUser, AppState};

#[derive(Serialize)]
struct ModeResponse {
    controller_device_id: Option<String>,
}

#[derive(Deserialize)]
struct ModeRequest {
    device_id: String,
}

async fn get_mode(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Json<ModeResponse> {
    Json(ModeResponse {
        controller_device_id: state.manager.get_controller(),
    })
}

async fn request_control(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Json<ModeResponse> {
    state.manager.request_control(&body.device_id);
    Json(ModeResponse {
        controller_device_id: Some(body.device_id),
    })
}

async fn release_control(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Json<ModeResponse> {
    state.manager.release_control(&body.device_id);
    Json(ModeResponse {
        controller_device_id: state.manager.get_controller(),
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/mode", get(get_mode))
        .route("/api/mode/control", post(request_control))
        .route("/api/mode/release", post(release_control))
}
```

Register in `crates/hub/src/routes/mod.rs` — add `pub mod mode;` and merge `mode::router()` into the main router.

### Step 4: Events WS — device tracking & auto-release

In `crates/hub/src/ws.rs`, modify `events_handler` to extract `device_id` from query params:

```rust
async fn events_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").map(|s| s.as_str());
    let device_id = params.get("device_id").cloned().unwrap_or_default();
    // ... auth check unchanged ...
    ws.on_upgrade(move |socket| handle_events(socket, state, device_id))
}
```

Modify `handle_events` to register/unregister device:
```rust
async fn handle_events(socket: WebSocket, state: AppState, device_id: String) {
    let (mut sender, _receiver) = socket.split();
    let mut rx = state.manager.subscribe_events();

    if !device_id.is_empty() {
        state.manager.register_device(&device_id);
    }

    loop {
        match rx.recv().await {
            Ok(event) => {
                let msg = serde_json::to_string(&event).unwrap();
                if sender.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
        }
    }

    // Cleanup on disconnect
    if !device_id.is_empty() {
        state.manager.unregister_device(&device_id);
    }
}
```

### Step 5: Terminal WS — device_id and input filtering

In `crates/hub/src/ws.rs`, add `CommandInput` to `ClientMessage`:
```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "input")]
    Input { data: String },
    #[serde(rename = "command_input")]
    CommandInput { data: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "image_paste")]
    ImagePaste { data: String, mime: String, filename: String },
}
```

Extract `device_id` in `terminal_ws_handler`:
```rust
async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    Path((machine_id, terminal_id)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").map(|s| s.as_str());
    let device_id = params.get("device_id").cloned().unwrap_or_default();
    // ... auth check unchanged ...
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, machine_id, terminal_id, state, device_id))
}
```

In `handle_terminal_ws` recv_task, add mode checks:
```rust
ClientMessage::Input { data } => {
    if device_id.is_empty() || manager.is_controller(&device_id) {
        let _ = manager.send_input(&mid, &tid, &data).await;
    }
}
ClientMessage::CommandInput { data } => {
    // CommandInput always goes through regardless of mode
    let _ = manager.send_input(&mid, &tid, &data).await;
}
ClientMessage::Resize { cols, rows } => {
    if device_id.is_empty() || manager.is_controller(&device_id) {
        let _ = manager.resize_terminal(&mid, &tid, cols, rows).await;
    }
}
// ImagePaste: always allow (explicit user action)
```

### Step 6: Verify backend compiles

```bash
cd /home/chareice/Projects/terminal-canvas/feature-mode-system
cargo build 2>&1
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat: add control/watch mode backend infrastructure

- Add ModeChanged browser event to protocol
- Add mode state tracking to MachineManager (device registry, controller)
- Add REST API: GET /api/mode, POST /api/mode/control, POST /api/mode/release
- Track device_id on events WS, auto-release control on disconnect
- Filter terminal input/resize by mode, add CommandInput bypass type"
```

---

## Task 2: Frontend — Device ID, Mode State & API

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/App.tsx`

### Step 1: Add types

In `client/src/types.ts`, add:
```typescript
export interface ModeState {
  controller_device_id: string | null
}
```

### Step 2: Add device ID utility and API functions

In `client/src/api.ts`, add device ID helper and mode API:

```typescript
export function getDeviceId(): string {
  let id = sessionStorage.getItem('tc-device-id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('tc-device-id', id)
  }
  return id
}

export async function getMode(): Promise<{ controller_device_id: string | null }> {
  const res = await fetch('/api/mode', fetchOpts())
  if (!res.ok) throw new Error('Failed to get mode')
  return res.json()
}

export async function requestControl(deviceId: string): Promise<void> {
  await fetch('/api/mode/control', {
    ...fetchOpts(),
    method: 'POST',
    headers: { ...fetchOpts().headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
}

export async function releaseControl(deviceId: string): Promise<void> {
  await fetch('/api/mode/release', {
    ...fetchOpts(),
    method: 'POST',
    headers: { ...fetchOpts().headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
}
```

Update `eventsWsUrl()` to include device_id:
```typescript
export function eventsWsUrl(deviceId: string): string {
  // Add device_id param alongside existing token param
  const base = wsBase()
  const token = getToken()
  return `${base}/ws/events?token=${token}&device_id=${deviceId}`
}
```

Update `terminalWsUrl()` to include device_id:
```typescript
export function terminalWsUrl(machineId: string, terminalId: string, deviceId: string): string {
  const base = wsBase()
  const token = getToken()
  return `${base}/ws/terminal/${machineId}/${terminalId}?token=${token}&device_id=${deviceId}`
}
```

Note: Check the existing `eventsWsUrl` and `terminalWsUrl` implementations — they may already construct URLs with token params. Adapt the device_id addition to match the existing URL construction pattern.

### Step 3: Add mode state to App.tsx

In `client/src/App.tsx`:

```typescript
import { getDeviceId, getMode, requestControl, releaseControl } from './api'

// Inside App component:
const deviceId = useMemo(() => getDeviceId(), [])
const [controllerDeviceId, setControllerDeviceId] = useState<string | null>(null)
const isController = controllerDeviceId === deviceId

// Fetch initial mode state (add to the existing useEffect that fetches machines/terminals):
getMode().then(m => setControllerDeviceId(m.controller_device_id)).catch(() => {})

// Handle ModeChanged in events WS message handler (add to existing event switch):
// case 'mode_changed':
//   setControllerDeviceId(event.controller_device_id)

// Update eventsWsUrl call to pass deviceId

// Mode control handlers:
const handleRequestControl = useCallback(() => {
  requestControl(deviceId)
}, [deviceId])

const handleReleaseControl = useCallback(() => {
  releaseControl(deviceId)
}, [deviceId])
```

Pass `isController`, `deviceId`, `handleRequestControl`, `handleReleaseControl` to child components.

### Step 4: Verify frontend compiles

```bash
cd /home/chareice/Projects/terminal-canvas/feature-mode-system/client
pnpm build 2>&1
```

### Step 5: Commit

```bash
git add -A
git commit -m "feat: add frontend device ID, mode state, and mode API"
```

---

## Task 3: Frontend — Mode UI & Terminal Integration

**Files:**
- Create: `client/src/components/ModeIndicator.tsx`
- Modify: `client/src/components/TerminalCard.tsx`
- Modify: `client/src/components/Canvas.tsx`
- Modify: `client/src/App.tsx`

### Step 1: Create ModeIndicator component

Create `client/src/components/ModeIndicator.tsx`:

```tsx
import { useCallback } from 'react'

interface ModeIndicatorProps {
  isController: boolean
  onRequestControl: () => void
  onReleaseControl: () => void
}

export function ModeIndicator({ isController, onRequestControl, onReleaseControl }: ModeIndicatorProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: isController ? 'var(--accent-dim)' : 'rgba(255,255,255,0.05)',
      borderRadius: 6,
      fontSize: 12,
      userSelect: 'none',
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: isController ? 'var(--accent)' : 'var(--text-muted)',
      }} />
      <span style={{ color: isController ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {isController ? 'Control' : 'Watch'}
      </span>
      <button
        onClick={isController ? onReleaseControl : onRequestControl}
        style={{
          background: 'none',
          border: '1px solid ' + (isController ? 'var(--text-muted)' : 'var(--accent)'),
          borderRadius: 4,
          color: isController ? 'var(--text-secondary)' : 'var(--accent)',
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: 11,
        }}
      >
        {isController ? 'Release' : 'Take Control'}
      </button>
    </div>
  )
}
```

### Step 2: Place ModeIndicator in App layout

Add `ModeIndicator` to the top-right area or alongside the mobile hamburger button. Position it fixed on mobile, or inside the canvas header area.

In `client/src/App.tsx`, render `ModeIndicator` in a fixed position:
```tsx
{/* Mode indicator — fixed top-right */}
<div style={{
  position: 'fixed',
  top: 8,
  right: 12,
  zIndex: 200,
}}>
  <ModeIndicator
    isController={isController}
    onRequestControl={handleRequestControl}
    onReleaseControl={handleReleaseControl}
  />
</div>
```

### Step 3: TerminalCard — mode integration

In `client/src/components/TerminalCard.tsx`:

Add props: `isController: boolean`, `deviceId: string`

**a) WebSocket URL — pass deviceId:**
```typescript
const ws = new WebSocket(terminalWsUrl(terminal.machine_id, terminal.id, deviceId))
```

**b) Initial resize — only send if controller:**
```typescript
ws.onopen = () => {
  if (isController) {
    ws.send(JSON.stringify({ type: 'resize', cols: TERM_COLS, rows: TERM_ROWS }))
  }
}
```

**c) Keyboard input — respect mode:**
```typescript
term.onData((data) => {
  if (ws.readyState === WebSocket.OPEN && isController) {
    ws.send(JSON.stringify({ type: 'input', data }))
  }
})
```

**d) CommandBar — use command_input type:**
Change the `handleToolbarKey` and CommandBar's `onSend` to use `command_input`:
```typescript
const handleToolbarKey = useCallback((data: string) => {
  const ws = wsRef.current
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command_input', data }))
  }
  if (isController) termRef.current?.focus()
}, [isController])
```

**e) Maximized resize — only in control mode:**
In the maximized `useEffect`, wrap resize send:
```typescript
if (dims && ws?.readyState === WebSocket.OPEN && isController) {
  ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
}
```

**f) Watch mode visual indicator:**
When not controller and maximized, show a subtle "Watch Mode" badge:
```tsx
{maximized && !isController && (
  <div style={{
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'rgba(0,0,0,0.6)',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 11,
    color: 'var(--text-muted)',
    zIndex: 10,
    pointerEvents: 'none',
  }}>
    Watch Mode
  </div>
)}
```

**Important note on reactivity:** The `isController` value changes dynamically. The `useEffect` that creates the terminal and WS runs once on mount (dependency: `[terminal.id, terminal.machine_id]`). The `onData` handler and other callbacks capture `isController` at creation time via closure. To handle mode changes after mount, use a ref:

```typescript
const isControllerRef = useRef(isController)
useEffect(() => { isControllerRef.current = isController }, [isController])
```

Then use `isControllerRef.current` in callbacks instead of `isController`.

### Step 4: Pass mode props through Canvas to TerminalCard

In `Canvas.tsx`, add `isController` and `deviceId` props, pass them down to each `TerminalCard`.

In `App.tsx`, pass `isController` and `deviceId` to `Canvas`.

### Step 5: Sidebar — restrict terminal creation in Watch mode

In `App.tsx`, pass `isController` to Sidebar or conditionally disable `handleCreateTerminal`:
```typescript
const handleCreateTerminal = useCallback(async (machineId: string, cwd: string) => {
  if (!isController) return
  // ... existing logic
}, [isController])
```

Also disable the destroy button in Watch mode (pass `isController` to TerminalCard, disable close button).

### Step 6: Verify and commit

```bash
cd /home/chareice/Projects/terminal-canvas/feature-mode-system/client
pnpm build 2>&1
```

```bash
git add -A
git commit -m "feat: add mode UI indicator and terminal mode integration

- ModeIndicator component with take/release control buttons
- TerminalCard respects mode: disable input, skip resize in watch mode
- CommandBar uses command_input type (bypasses mode restriction)
- Disable terminal creation/destruction in watch mode"
```

---

## Task 4: Mobile — ExtendedKeyBar (Termius-style)

**Files:**
- Create: `client/src/components/ExtendedKeyBar.tsx`
- Modify: `client/src/components/TerminalCard.tsx` (replace TerminalToolbar reference)

### Step 1: Create ExtendedKeyBar component

Create `client/src/components/ExtendedKeyBar.tsx`:

Design: A bottom toolbar with three zones:
- Left: Keyboard toggle button
- Center: Horizontally scrollable key groups (4 keys per group)
- Right: CommandBar toggle button

```tsx
import { useState, useCallback } from 'react'

interface ExtendedKeyBarProps {
  onKey: (data: string) => void
  onToggleKeyboard: () => void
  onToggleCommandBar: () => void
  keyboardVisible: boolean
  commandBarVisible: boolean
  isController: boolean
}

const KEY_GROUPS = [
  // Group 1: Modifiers
  [
    { label: 'Esc', data: '\x1b' },
    { label: 'Tab', data: '\t' },
    { label: '|', data: '|' },
    { label: '~', data: '~' },
  ],
  // Group 2: Navigation
  [
    { label: '\u2191', data: '\x1b[A' },
    { label: '\u2193', data: '\x1b[B' },
    { label: '\u2190', data: '\x1b[C' },  // Note: check actual codes
    { label: '\u2192', data: '\x1b[D' },
  ],
  // Group 3: Ctrl combos
  [
    { label: 'C-c', data: '\x03' },
    { label: 'C-d', data: '\x04' },
    { label: 'C-z', data: '\x1a' },
    { label: 'C-l', data: '\x0c' },
  ],
  // Group 4: More Ctrl
  [
    { label: 'C-a', data: '\x01' },
    { label: 'C-e', data: '\x05' },
    { label: 'C-r', data: '\x12' },
    { label: 'C-w', data: '\x17' },
  ],
  // Group 5: Special chars
  [
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: '_', data: '_' },
    { label: '.', data: '.' },
  ],
]

export function ExtendedKeyBar({
  onKey, onToggleKeyboard, onToggleCommandBar,
  keyboardVisible, commandBarVisible, isController,
}: ExtendedKeyBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      height: 44,
      flexShrink: 0,
      touchAction: 'none',
    }}>
      {/* Left: Keyboard toggle (only in control mode) */}
      {isController && (
        <button
          onClick={onToggleKeyboard}
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: keyboardVisible ? 'var(--accent-dim)' : 'transparent',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: keyboardVisible ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 18,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title={keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
        >
          {/* Keyboard icon using text */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6" y2="8" strokeLinecap="round" />
            <line x1="10" y1="8" x2="10" y2="8" strokeLinecap="round" />
            <line x1="14" y1="8" x2="14" y2="8" strokeLinecap="round" />
            <line x1="18" y1="8" x2="18" y2="8" strokeLinecap="round" />
            <line x1="6" y1="12" x2="6" y2="12" strokeLinecap="round" />
            <line x1="10" y1="12" x2="10" y2="12" strokeLinecap="round" />
            <line x1="14" y1="12" x2="14" y2="12" strokeLinecap="round" />
            <line x1="18" y1="12" x2="18" y2="12" strokeLinecap="round" />
            <line x1="8" y1="16" x2="16" y2="16" />
          </svg>
        </button>
      )}

      {/* Center: Scrollable key groups */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        gap: 2,
        padding: '0 4px',
      }}>
        {KEY_GROUPS.map((group, gi) => (
          <div key={gi} style={{
            display: 'flex',
            gap: 2,
            padding: '0 2px',
            borderRight: gi < KEY_GROUPS.length - 1 ? '1px solid var(--border)' : 'none',
            paddingRight: gi < KEY_GROUPS.length - 1 ? 6 : 2,
            marginRight: gi < KEY_GROUPS.length - 1 ? 2 : 0,
          }}>
            {group.map(key => (
              <button
                key={key.label}
                onClick={() => onKey(key.data)}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  padding: '4px 10px',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  minWidth: 36,
                  height: 32,
                }}
              >
                {key.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Right: CommandBar toggle */}
      <button
        onClick={onToggleCommandBar}
        style={{
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: commandBarVisible ? 'var(--accent-dim)' : 'transparent',
          border: 'none',
          borderLeft: '1px solid var(--border)',
          color: commandBarVisible ? 'var(--accent)' : 'var(--text-secondary)',
          fontSize: 16,
          cursor: 'pointer',
          flexShrink: 0,
        }}
        title={commandBarVisible ? 'Hide command bar' : 'Show command bar'}
      >
        {/* Terminal/command icon */}
        &gt;_
      </button>
    </div>
  )
}
```

### Step 2: Integrate into TerminalCard

In `TerminalCard.tsx`, replace the mobile TerminalToolbar usage:

Replace:
```tsx
{maximized && isMobile && (
  <TerminalToolbar onKey={handleToolbarKey} />
)}
```

With:
```tsx
{maximized && isMobile && (
  <ExtendedKeyBar
    onKey={handleToolbarKey}
    onToggleKeyboard={handleToggleKeyboard}
    onToggleCommandBar={handleToggleCommandBar}
    keyboardVisible={keyboardVisible}
    commandBarVisible={commandBarVisible}
    isController={isController}
  />
)}
```

Add state and handlers for keyboard/commandbar visibility (see Task 5 for keyboard management details):

```typescript
const [keyboardVisible, setKeyboardVisible] = useState(false)
const [commandBarVisible, setCommandBarVisible] = useState(false)

const handleToggleKeyboard = useCallback(() => {
  setKeyboardVisible(prev => !prev)
}, [])

const handleToggleCommandBar = useCallback(() => {
  setCommandBarVisible(prev => !prev)
}, [])
```

### Step 3: Verify and commit

```bash
cd /home/chareice/Projects/terminal-canvas/feature-mode-system/client
pnpm build 2>&1
```

```bash
git add -A
git commit -m "feat: add Termius-inspired ExtendedKeyBar for mobile

- Scrollable key groups (Esc/Tab, arrows, Ctrl combos, special chars)
- Keyboard toggle button (control mode only)
- CommandBar toggle button
- Replace TerminalToolbar with ExtendedKeyBar on mobile"
```

---

## Task 5: Mobile — Keyboard Management & CommandBar Bottom Sheet

**Files:**
- Modify: `client/src/components/TerminalCard.tsx`
- Modify: `client/src/components/CommandBar.tsx`

### Step 1: Prevent auto-focus on mobile

In `TerminalCard.tsx`, the terminal gets auto-focused on maximize. Remove this for mobile:

In the maximized `useEffect`, change `termRef.current?.focus()` call:
```typescript
const doFit = () => {
  try {
    fit.fit()
    const dims = fit.proposeDimensions()
    if (dims && ws?.readyState === WebSocket.OPEN && isControllerRef.current) {
      ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
    }
  } catch { /* ignore */ }
  // Only auto-focus on desktop in control mode
  if (!isMobile && isControllerRef.current) {
    termRef.current?.focus()
  }
}
```

### Step 2: Keyboard show/hide via focus management

The virtual keyboard on mobile appears when a text input or the xterm textarea gets focus. To control keyboard visibility:

```typescript
// Show keyboard: focus the xterm textarea
const showKeyboard = useCallback(() => {
  if (!isMobile || !isControllerRef.current) return
  const textarea = termElRef.current?.querySelector('textarea')
  if (textarea) {
    textarea.readOnly = false
    textarea.focus()
  }
  setKeyboardVisible(true)
}, [isMobile])

// Hide keyboard: blur the xterm textarea
const hideKeyboard = useCallback(() => {
  const textarea = termElRef.current?.querySelector('textarea')
  if (textarea) textarea.blur()
  setKeyboardVisible(false)
}, [])

const handleToggleKeyboard = useCallback(() => {
  if (keyboardVisible) {
    hideKeyboard()
  } else {
    showKeyboard()
  }
}, [keyboardVisible, showKeyboard, hideKeyboard])
```

On mobile in Watch mode, make the xterm textarea read-only to prevent accidental keyboard popup:
```typescript
useEffect(() => {
  if (!isMobile) return
  const textarea = termElRef.current?.querySelector('textarea')
  if (textarea) {
    textarea.readOnly = !isController
  }
}, [isMobile, isController])
```

### Step 3: Handle visual viewport resize (keyboard appearance)

When the virtual keyboard appears, the visual viewport shrinks. Use the VisualViewport API to detect this and refit the terminal:

```typescript
useEffect(() => {
  if (!isMobile || !maximized) return

  const handleViewportResize = () => {
    const fit = fitRef.current
    if (!fit) return
    // Small delay for viewport to settle
    setTimeout(() => {
      try {
        fit.fit()
      } catch { /* ignore */ }
    }, 100)
  }

  window.visualViewport?.addEventListener('resize', handleViewportResize)
  return () => {
    window.visualViewport?.removeEventListener('resize', handleViewportResize)
  }
}, [isMobile, maximized])
```

### Step 4: CommandBar as bottom sheet on mobile

Modify `TerminalCard.tsx` to render CommandBar as a slide-up panel on mobile when `commandBarVisible` is true:

```tsx
{/* Mobile CommandBar bottom sheet */}
{maximized && isMobile && commandBarVisible && (
  <div style={{
    position: 'absolute',
    bottom: 44, // above the ExtendedKeyBar
    left: 0,
    right: 0,
    maxHeight: '50vh',
    background: 'var(--bg-secondary)',
    borderTop: '2px solid var(--border-active)',
    borderRadius: '12px 12px 0 0',
    overflow: 'hidden',
    zIndex: 10,
    animation: 'slideUp 0.2s ease-out',
  }}>
    <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
  </div>
)}
```

The existing desktop CommandBar rendering stays unchanged:
```tsx
{maximized && !isMobile && (
  <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
)}
```

Add the slide-up animation in `index.css`:
```css
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
```

### Step 5: Adjust CommandBar layout for mobile

In `CommandBar.tsx`, make the component work well in both orientations. The existing 200px fixed width is for desktop sidebar mode. For mobile, it should be full-width:

Wrap the outer div style conditionally — or better, remove the fixed width and let the parent control sizing. The parent container already constrains it. Change the root div:

```tsx
<div style={{
  // Remove: width: 200, minWidth: 200,
  // The parent controls width (200px on desktop, full-width on mobile)
  borderLeft: '1px solid var(--border)', // only visible on desktop
  background: 'rgba(0,0,0,0.2)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  width: '100%',
  maxHeight: '100%',
}}>
```

Then in TerminalCard desktop usage, wrap it with a fixed-width container:
```tsx
{maximized && !isMobile && (
  <div style={{ width: 200, minWidth: 200, borderLeft: '1px solid var(--border)' }}>
    <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
  </div>
)}
```

### Step 6: Verify and commit

```bash
cd /home/chareice/Projects/terminal-canvas/feature-mode-system/client
pnpm build 2>&1
```

```bash
git add -A
git commit -m "feat: mobile keyboard management and CommandBar bottom sheet

- Explicit keyboard toggle via xterm textarea focus/blur
- Prevent auto-focus on mobile (no unwanted keyboard popup)
- VisualViewport resize listener for terminal refit on keyboard show/hide
- CommandBar renders as slide-up bottom sheet on mobile
- Watch mode: textarea read-only to prevent keyboard popup"
```

---

## Task 6: Integration, Edge Cases & Polish

**Files:**
- Various files from Tasks 1-5

### Step 1: Auto-request control on first visit

If no device currently holds control and the user opens the page, automatically request control:

In `App.tsx`, after fetching initial mode:
```typescript
getMode().then(m => {
  setControllerDeviceId(m.controller_device_id)
  // Auto-take control if no one has it
  if (!m.controller_device_id) {
    requestControl(deviceId)
  }
})
```

### Step 2: Handle mode change during active terminal session

When a device loses control while a terminal is maximized and keyboard is open (mobile):
- Hide keyboard
- Show a brief toast/notification: "Control transferred to another device"

Add a `useEffect` that watches `isController` changes:
```typescript
const prevControllerRef = useRef(isController)
useEffect(() => {
  if (prevControllerRef.current && !isController) {
    // Lost control — hide keyboard on mobile
    hideKeyboard?.()
    // Could show a brief notification
  }
  prevControllerRef.current = isController
}, [isController])
```

### Step 3: Handle concurrent terminal creation/destruction

Ensure the events WS properly handles:
- `terminal_created` events in Watch mode (terminal appears but is read-only)
- `terminal_destroyed` events — remove terminal regardless of mode
- `machine_offline` — cleanup regardless of mode

These should already work since events WS is separate from mode. Verify.

### Step 4: Mobile layout fixes

Ensure the maximized terminal layout works correctly with the new components:

```
Mobile maximized layout (Control mode, keyboard hidden):
┌──────────────────────┐
│ Title bar            │
├──────────────────────┤
│                      │
│   Terminal (full)    │
│                      │
├──────────────────────┤
│ [kbd] [keys...] [>_] │  ← ExtendedKeyBar
├──────────────────────┤
│ Footer (cwd)         │
└──────────────────────┘

Mobile maximized layout (Control mode, keyboard shown):
┌──────────────────────┐
│ Title bar            │
├──────────────────────┤
│   Terminal (shrunk)  │
├──────────────────────┤
│ [kbd] [keys...] [>_] │  ← ExtendedKeyBar
├──────────────────────┤
│                      │
│   System Keyboard    │
│                      │
└──────────────────────┘

Mobile maximized layout (Watch mode):
┌──────────────────────┐
│ Title bar            │
├──────────────────────┤
│                      │
│   Terminal (full)    │
│   "Watch Mode" badge │
│                      │
├──────────────────────┤
│ [keys...       ] [>_]│  ← ExtendedKeyBar (no kbd button)
├──────────────────────┤
│ Footer (cwd)         │
└──────────────────────┘
```

### Step 5: Full build verification

```bash
# Backend
cd /home/chareice/Projects/terminal-canvas/feature-mode-system
cargo build 2>&1

# Frontend
cd client
pnpm build 2>&1
```

### Step 6: Manual testing checklist

- [ ] Open in desktop browser, verify Control mode by default
- [ ] Open in second browser tab, verify Watch mode (or Take Control)
- [ ] In Watch mode: keyboard input blocked, CommandBar works
- [ ] Take control from second tab, first tab switches to Watch
- [ ] Close controller tab, mode auto-released
- [ ] Mobile: maximize terminal, keyboard NOT shown
- [ ] Mobile: tap keyboard button, keyboard appears
- [ ] Mobile: tap keyboard button again, keyboard hides
- [ ] Mobile: tap CommandBar button, bottom sheet slides up
- [ ] Mobile: ExtendedKeyBar keys send correct data
- [ ] Mobile Watch mode: no keyboard button, CommandBar still works

### Step 7: Final commit

```bash
git add -A
git commit -m "feat: integration polish and edge case handling

- Auto-request control on first visit if no controller
- Handle mode change during active session (hide keyboard, notify)
- Mobile layout verification and fixes"
```

---

## Dependency Graph

```
Task 1 (Backend) ──────────────────────────┐
                                           │
Task 2 (Frontend Mode State) ◄─────────────┤
    │                                      │
    ├──► Task 3 (Mode UI + Terminal) ◄─────┘
    │         │
    │         ├──► Task 6 (Integration)
    │         │         ▲
    │         │         │
Task 4 (ExtendedKeyBar) ┤
    │                    │
    └──► Task 5 (Keyboard + CommandBar Sheet)
```

**Parallelizable:**
- Batch 1: Task 1
- Batch 2: Task 2 + Task 4 (independent)
- Batch 3: Task 3 + Task 5 (depend on batch 2)
- Batch 4: Task 6 (integration)
