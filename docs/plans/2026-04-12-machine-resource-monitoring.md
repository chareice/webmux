# Machine Resource Monitoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Machine agent periodically collects system metrics (CPU, memory, disk) and pushes them to the Hub, which broadcasts them to browsers. The frontend displays a VS Code-style bottom status bar showing machine stats and control mode.

**Architecture:** The machine agent uses the `sysinfo` crate to collect CPU/memory/disk stats every 5 seconds, then sends them to the Hub via the existing WebSocket channel as a new `MachineToHub::ResourceStats` message. The Hub stores the latest stats per machine in memory (no DB persistence) and broadcasts them to browsers via a new `BrowserEvent::MachineStats` event. The frontend renders a fixed bottom status bar (like VS Code) that consolidates: active machine selector, resource metrics, and control mode — replacing the floating `ModeIndicator`.

**Tech Stack:** Rust `sysinfo` crate, existing WebSocket infrastructure, React/TypeScript for the StatusBar component.

---

### Task 1: Add `sysinfo` dependency to workspace and machine crate

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/machine/Cargo.toml`

**Step 1: Add sysinfo to workspace dependencies**

In `Cargo.toml` (workspace root), add to `[workspace.dependencies]`:

```toml
sysinfo = "0.33"
```

**Step 2: Add sysinfo to machine crate**

In `crates/machine/Cargo.toml`, add to `[dependencies]`:

```toml
sysinfo = { workspace = true }
```

**Step 3: Verify it compiles**

Run: `cargo check -p tc-machine`
Expected: compiles without errors

**Step 4: Commit**

```bash
git add Cargo.toml crates/machine/Cargo.toml
git commit -m "feat(deps): add sysinfo crate for machine resource monitoring"
```

---

### Task 2: Add resource stats types to protocol

**Files:**
- Modify: `crates/protocol/src/lib.rs`

**Step 1: Add ResourceStats struct**

Add after the `DirEntry` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceStats {
    /// CPU usage percentage (0.0 - 100.0), averaged across all cores
    pub cpu_percent: f32,
    /// Total physical memory in bytes
    pub memory_total: u64,
    /// Used physical memory in bytes
    pub memory_used: u64,
    /// Disk info
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
}
```

**Step 2: Add MachineToHub::ResourceStats variant**

Add to `MachineToHub` enum:

```rust
#[serde(rename = "resource_stats")]
ResourceStats { stats: ResourceStats },
```

**Step 3: Add BrowserEvent::MachineStats variant**

Add to `BrowserEvent` enum:

```rust
#[serde(rename = "machine_stats")]
MachineStats {
    machine_id: String,
    stats: ResourceStats,
},
```

**Step 4: Verify it compiles**

Run: `cargo check -p tc-protocol`
Expected: compiles without errors

**Step 5: Commit**

```bash
git add crates/protocol/src/lib.rs
git commit -m "feat(protocol): add ResourceStats types and message variants"
```

---

### Task 3: Implement stats collector in machine agent

**Files:**
- Create: `crates/machine/src/stats.rs`
- Modify: `crates/machine/src/main.rs` (add `mod stats;`)

**Step 1: Create stats.rs**

```rust
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tc_protocol::{DiskInfo, ResourceStats};

pub struct StatsCollector {
    system: System,
    disks: Disks,
}

impl StatsCollector {
    pub fn new() -> Self {
        let system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        let disks = Disks::new_with_refreshed_list();
        Self { system, disks }
    }

    pub fn collect(&mut self) -> ResourceStats {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.disks.refresh(true);

        let cpu_percent = self.system.global_cpu_usage();
        let memory_total = self.system.total_memory();
        let memory_used = self.system.used_memory();

        let disks: Vec<DiskInfo> = self
            .disks
            .iter()
            .filter(|d| {
                let mp = d.mount_point().to_string_lossy();
                mp == "/"
                    || mp.starts_with("/home")
                    || mp.starts_with("/mnt")
                    || mp.starts_with("/Volumes")
                    || mp.starts_with("/data")
            })
            .map(|d| DiskInfo {
                mount_point: d.mount_point().to_string_lossy().to_string(),
                total_bytes: d.total_space(),
                used_bytes: d.total_space() - d.available_space(),
            })
            .collect();

        ResourceStats {
            cpu_percent,
            memory_total,
            memory_used,
            disks,
        }
    }
}
```

**Step 2: Add mod declaration**

In `crates/machine/src/main.rs`, add after `mod pty;`:

```rust
mod stats;
```

**Step 3: Verify it compiles**

Run: `cargo check -p tc-machine`
Expected: compiles without errors

**Step 4: Commit**

```bash
git add crates/machine/src/stats.rs crates/machine/src/main.rs
git commit -m "feat(machine): add StatsCollector for system resource metrics"
```

---

### Task 4: Send periodic stats from machine to hub

**Files:**
- Modify: `crates/machine/src/hub_conn.rs`

**Step 1: Add stats task in connect_once()**

After the existing terminals recovery block (line ~146) and before `// Task: forward send_tx messages...` (line ~148), spawn a stats collection task:

```rust
// Task: periodically send resource stats
let send_tx_stats = send_tx.clone();
let mut stats_task = tokio::spawn(async move {
    let mut collector = crate::stats::StatsCollector::new();
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    // Initial CPU reading needs a warmup tick
    interval.tick().await;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    loop {
        interval.tick().await;
        let stats = collector.collect();
        if send_tx_stats
            .send(MachineToHub::ResourceStats { stats })
            .is_err()
        {
            break;
        }
    }
});
```

**Step 2: Update tokio::select! to include stats_task**

Change the existing select/abort block at the end of `connect_once()`:

```rust
tokio::select! {
    _ = &mut send_task => {},
    _ = &mut recv_task => {},
    _ = &mut stats_task => {},
}

send_task.abort();
recv_task.abort();
stats_task.abort();
```

**Step 3: Verify it compiles**

Run: `cargo check -p tc-machine`
Expected: compiles without errors

**Step 4: Commit**

```bash
git add crates/machine/src/hub_conn.rs
git commit -m "feat(machine): send resource stats to hub every 5 seconds"
```

---

### Task 5: Handle resource stats in Hub and broadcast to browsers

**Files:**
- Modify: `crates/hub/src/machine_manager.rs`

**Step 1: Add stats storage to MachineConnection**

Add field to `MachineConnection` struct (after `output_buffers`):

```rust
/// Latest resource stats from this machine
pub latest_stats: Option<tc_protocol::ResourceStats>,
```

Initialize as `latest_stats: None` in the `MachineConnection` construction inside `register_machine()`.

**Step 2: Handle ResourceStats in handle_machine_message**

Add match arm before `MachineToHub::Pong`:

```rust
MachineToHub::ResourceStats { stats } => {
    {
        let mut machines = self.machines.lock().await;
        if let Some(conn) = machines.get_mut(machine_id) {
            conn.latest_stats = Some(stats.clone());
        }
    }
    let _ = self.event_tx.send(BrowserEvent::MachineStats {
        machine_id: machine_id.to_string(),
        stats,
    });
}
```

**Step 3: Add get_machine_stats method**

```rust
pub async fn get_machine_stats(&self, machine_id: &str) -> Option<tc_protocol::ResourceStats> {
    self.machines
        .lock()
        .await
        .get(machine_id)
        .and_then(|c| c.latest_stats.clone())
}
```

**Step 4: Verify it compiles**

Run: `cargo check -p tc-hub`
Expected: compiles without errors

**Step 5: Commit**

```bash
git add crates/hub/src/machine_manager.rs
git commit -m "feat(hub): handle resource stats and broadcast to browsers"
```

---

### Task 6: Add REST endpoint for machine stats

**Files:**
- Modify: `crates/hub/src/routes.rs`

**Step 1: Read current routes file to understand patterns**

**Step 2: Add GET /api/machines/{machine_id}/stats endpoint**

```rust
async fn get_machine_stats(
    Path(machine_id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.manager.get_machine_stats(&machine_id).await {
        Some(stats) => Json(stats).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
```

Register route: `.route("/api/machines/{machine_id}/stats", get(get_machine_stats))`

**Step 3: Verify it compiles**

Run: `cargo check -p tc-hub`
Expected: compiles without errors

**Step 4: Commit**

```bash
git add crates/hub/src/routes.rs
git commit -m "feat(hub): add GET /api/machines/:id/stats REST endpoint"
```

---

### Task 7: Update TypeScript contracts

**Files:**
- Modify: `packages/shared/src/contracts.ts`

**Step 1: Add ResourceStats and DiskInfo types**

Add after `DirEntry` interface:

```typescript
export interface DiskInfo {
  mount_point: string
  total_bytes: number
  used_bytes: number
}

export interface ResourceStats {
  cpu_percent: number
  memory_total: number
  memory_used: number
  disks: DiskInfo[]
}
```

**Step 2: Add MachineToHub.ResourceStatsMessage variant**

Add to union type:
```typescript
| MachineToHub.ResourceStatsMessage
```

Add to namespace:
```typescript
export interface ResourceStatsMessage {
  type: 'resource_stats'
  stats: ResourceStats
}
```

**Step 3: Add BrowserEvent.MachineStats variant**

Add to union type:
```typescript
| BrowserEvent.MachineStats
```

Add to namespace:
```typescript
export interface MachineStats {
  type: 'machine_stats'
  machine_id: string
  stats: ResourceStats
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd packages/shared && pnpm tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add packages/shared/src/contracts.ts
git commit -m "feat(shared): add ResourceStats TypeScript types"
```

---

### Task 8: Add API client method for machine stats

**Files:**
- Modify: `packages/app/lib/api.ts`

**Step 1: Add getMachineStats function**

Add import for `ResourceStats` from `@webmux/shared`, then add:

```typescript
export const getMachineStats = (machineId: string) =>
  request<ResourceStats>("GET", `/api/machines/${machineId}/stats`);
```

**Step 2: Commit**

```bash
git add packages/app/lib/api.ts
git commit -m "feat(app): add getMachineStats API client method"
```

---

### Task 9: Create StatusBar component (VS Code-style bottom bar)

**Files:**
- Create: `packages/app/components/StatusBar.tsx`

This replaces the floating `ModeIndicator`. The status bar is a fixed bar at the bottom of the viewport, ~24px tall, dark background, with segments separated by subtle dividers. Layout (left to right):

**Left side:**
- Machine selector: if multiple machines online, show active machine name with a dropdown to switch. If one machine, just show its name with a green dot.
- Resource stats inline: `CPU 23%` | `MEM 4.2/8.0 GB` | `DISK 67%`

**Right side:**
- Control mode: green dot + "Control" or grey dot + "Watch" with a toggle button

**Step 1: Create StatusBar.tsx**

```tsx
import { useState } from "react";
import type { MachineInfo, ResourceStats } from "@webmux/shared";

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)}M`;
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function statColor(percent: number): string {
  if (percent < 60) return "rgb(0, 212, 170)";
  if (percent < 85) return "rgb(255, 193, 7)";
  return "rgb(255, 82, 82)";
}

interface StatusBarProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  onSelectMachine: (id: string) => void;
  machineStats: Record<string, ResourceStats>;
  isController: boolean;
  onRequestControl: () => void;
  onReleaseControl: () => void;
}

export function StatusBar({
  machines,
  activeMachineId,
  onSelectMachine,
  machineStats,
  isController,
  onRequestControl,
  onReleaseControl,
}: StatusBarProps) {
  const [showMachineMenu, setShowMachineMenu] = useState(false);

  const activeMachine = machines.find((m) => m.id === activeMachineId) || machines[0];
  const stats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const memPercent = stats && stats.memory_total > 0
    ? (stats.memory_used / stats.memory_total) * 100
    : 0;
  const rootDisk = stats?.disks.find((d) => d.mount_point === "/");
  const diskPercent = rootDisk && rootDisk.total_bytes > 0
    ? (rootDisk.used_bytes / rootDisk.total_bytes) * 100
    : 0;

  return (
    <div
      style={{
        height: 24,
        minHeight: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "rgb(0, 122, 204)",  // VS Code blue
        borderTop: "1px solid rgba(255,255,255,0.1)",
        fontSize: 12,
        color: "#fff",
        userSelect: "none",
        position: "relative",
        zIndex: 100,
        paddingLeft: 8,
        paddingRight: 8,
        gap: 0,
        flexShrink: 0,
      }}
    >
      {/* Left section */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {/* Machine selector */}
        {activeMachine && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => machines.length > 1 && setShowMachineMenu((p) => !p)}
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                cursor: machines.length > 1 ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0 8px",
                height: 24,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: "rgb(0, 212, 170)",
                  flexShrink: 0,
                }}
              />
              <span>{activeMachine.name}</span>
              {machines.length > 1 && <span style={{ fontSize: 8 }}>{"\u25BC"}</span>}
            </button>

            {/* Machine dropdown */}
            {showMachineMenu && machines.length > 1 && (
              <div
                style={{
                  position: "absolute",
                  bottom: 24,
                  left: 0,
                  backgroundColor: "rgb(30, 30, 30)",
                  border: "1px solid rgb(69, 69, 69)",
                  borderRadius: 4,
                  minWidth: 160,
                  zIndex: 200,
                  overflow: "hidden",
                }}
              >
                {machines.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectMachine(m.id);
                      setShowMachineMenu(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      padding: "6px 10px",
                      background:
                        m.id === activeMachine.id
                          ? "rgba(0, 122, 204, 0.4)"
                          : "none",
                      border: "none",
                      color: "#fff",
                      fontSize: 12,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "rgb(0, 212, 170)",
                      }}
                    />
                    {m.name}
                    <span style={{ marginLeft: "auto", color: "rgb(150,150,150)", fontSize: 10 }}>
                      {m.os}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Separator */}
        {stats && <Separator />}

        {/* Resource stats */}
        {stats && (
          <>
            <StatusItem
              label="CPU"
              value={`${stats.cpu_percent.toFixed(0)}%`}
              color={statColor(stats.cpu_percent)}
            />
            <StatusItem
              label="MEM"
              value={`${formatBytes(stats.memory_used)}/${formatBytes(stats.memory_total)}`}
              color={statColor(memPercent)}
            />
            {rootDisk && (
              <StatusItem
                label="DISK"
                value={`${diskPercent.toFixed(0)}%`}
                color={statColor(diskPercent)}
              />
            )}
          </>
        )}
      </div>

      {/* Right section */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <button
          onClick={isController ? onReleaseControl : onRequestControl}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px",
            height: 24,
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: isController
                ? "rgb(0, 212, 170)"
                : "rgb(150, 150, 150)",
              flexShrink: 0,
            }}
          />
          <span>{isController ? "Control" : "Watch"}</span>
        </button>
      </div>
    </div>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 14,
        backgroundColor: "rgba(255,255,255,0.3)",
        marginLeft: 4,
        marginRight: 4,
      }}
    />
  );
}

function StatusItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 6px",
        height: 24,
        fontSize: 12,
        color: "#fff",
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/app/components/StatusBar.tsx
git commit -m "feat(app): add VS Code-style StatusBar component"
```

---

### Task 10: Integrate StatusBar into TerminalCanvas and remove floating ModeIndicator

**Files:**
- Modify: `packages/app/components/TerminalCanvas.web.tsx`
- Modify: `packages/app/components/Canvas.web.tsx` (adjust padding-bottom for status bar)

**Step 1: Add state for machineStats and activeMachineId in TerminalCanvas**

```typescript
import type { ResourceStats } from "@webmux/shared";
import { StatusBar } from "./StatusBar";

// Add state
const [machineStats, setMachineStats] = useState<Record<string, ResourceStats>>({});
const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
```

**Step 2: Handle machine_stats event in WebSocket onmessage**

Add case in the events switch:

```typescript
case "machine_stats":
  setMachineStats((prev) => ({
    ...prev,
    [msg.machine_id]: msg.stats,
  }));
  break;
```

**Step 3: Auto-select first machine as active**

When machines list changes, if no active machine is set, select the first:

```typescript
useEffect(() => {
  if (!activeMachineId && machines.length > 0) {
    setActiveMachineId(machines[0].id);
  }
}, [machines, activeMachineId]);
```

**Step 4: Replace floating ModeIndicator with StatusBar**

Remove the floating `ModeIndicator` div (the `<div style={{ position: 'fixed', top: 12, right: 12, ... }}>` block).

Remove the `ModeIndicator` import.

Add `<StatusBar>` at the bottom of the main flex container, after the Canvas/OnboardingView. The overall layout becomes:

```tsx
<div style={{ display: "flex", flexDirection: "column", height: "100dvh", ... }}>
  <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
    {/* Sidebar */}
    {/* Canvas / OnboardingView */}
  </div>
  <StatusBar
    machines={machines}
    activeMachineId={activeMachineId}
    onSelectMachine={setActiveMachineId}
    machineStats={machineStats}
    isController={isController}
    onRequestControl={handleRequestControl}
    onReleaseControl={handleReleaseControl}
  />
</div>
```

**Step 5: Adjust Canvas padding**

No special padding needed — the StatusBar lives outside the canvas flex area, not overlapping.

**Step 6: Clean up machineStats on machine offline**

In the `machine_offline` event handler, also remove stats:

```typescript
case "machine_offline":
  setMachines((prev) => prev.filter((m) => m.id !== msg.machine_id));
  setTerminals((prev) => prev.filter((t) => t.machine_id !== msg.machine_id));
  setMachineStats((prev) => {
    const next = { ...prev };
    delete next[msg.machine_id];
    return next;
  });
  break;
```

**Step 7: Verify frontend builds**

Run: `cd packages/app && pnpm tsc --noEmit` (or `pnpm build`)
Expected: no errors

**Step 8: Commit**

```bash
git add packages/app/components/TerminalCanvas.web.tsx packages/app/components/Canvas.web.tsx
git commit -m "feat(app): integrate StatusBar, remove floating ModeIndicator"
```

---

### Task 11: End-to-end verification

**Step 1: Start the hub**

Run: `WEBMUX_DEV_MODE=true cargo run -p tc-hub`
Expected: Hub starts on :4317

**Step 2: Start a machine agent**

Run: `cargo run -p tc-machine -- start --id test-dev`
Expected: Machine connects, starts sending resource stats every 5 seconds

**Step 3: Check hub logs**

Expected: Hub receives `resource_stats` messages and broadcasts `machine_stats` events

**Step 4: Start frontend dev server**

Run: `cd packages/app && pnpm dev`

**Step 5: Open browser and verify**

- Bottom status bar appears, fixed at the bottom, 24px tall, VS Code blue
- Left side shows: machine name with green dot, then CPU/MEM/DISK stats
- Right side shows: Control/Watch mode toggle
- Stats update every ~5 seconds
- Stat values change color: green (<60%), yellow (<85%), red (>=85%)
- If multiple machines connected, clicking machine name opens a dropdown to switch
- When machine goes offline, stats clear
- Old floating ModeIndicator is gone
- Terminal grid still fills the space above the status bar correctly
- On mobile: status bar still visible (may need responsive tweaks in a future iteration)

**Step 6: Final commit**

If any fixes were needed during verification, commit them.

---

## Summary

| Task | What | Where |
|------|------|-------|
| 1 | Add `sysinfo` dependency | `Cargo.toml`, `crates/machine/Cargo.toml` |
| 2 | Protocol types | `crates/protocol/src/lib.rs` |
| 3 | Stats collector module | `crates/machine/src/stats.rs` |
| 4 | Periodic stats sending | `crates/machine/src/hub_conn.rs` |
| 5 | Hub handles & broadcasts | `crates/hub/src/machine_manager.rs` |
| 6 | REST endpoint | `crates/hub/src/routes.rs` |
| 7 | TypeScript types | `packages/shared/src/contracts.ts` |
| 8 | API client | `packages/app/lib/api.ts` |
| 9 | StatusBar component | `packages/app/components/StatusBar.tsx` |
| 10 | Integration + remove ModeIndicator | `TerminalCanvas.web.tsx` |
| 11 | End-to-end verification | Full stack test |
