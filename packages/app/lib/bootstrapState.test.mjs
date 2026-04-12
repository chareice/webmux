import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  shouldResyncForEnvelope,
} from "./bootstrapState.ts";

test("bootstrap snapshot becomes the authoritative initial state", () => {
  const state = applyBootstrapSnapshot({
    snapshot_seq: 4,
    machines: [{ id: "machine-a", name: "A", os: "linux", home_dir: "/root" }],
    terminals: [{ id: "term-a", machine_id: "machine-a", title: "A", cwd: "/root", cols: 80, rows: 24 }],
    machine_stats: [{ machine_id: "machine-a", stats: { cpu_percent: 10, memory_total: 100, memory_used: 50, disks: [] } }],
    control_leases: [{ machine_id: "machine-a", controller_device_id: "device-a" }],
  });

  assert.equal(state.lastSeq, 4);
  assert.equal(state.machines.length, 1);
  assert.equal(state.terminals.length, 1);
  assert.equal(state.controlLeases["machine-a"], "device-a");
  assert.equal(state.machineStats["machine-a"].cpu_percent, 10);
});

test("older envelopes are ignored while newer ones mutate state", () => {
  const initial = applyBootstrapSnapshot({
    snapshot_seq: 4,
    machines: [{ id: "machine-a", name: "A", os: "linux", home_dir: "/root" }],
    terminals: [{ id: "term-a", machine_id: "machine-a", title: "A", cwd: "/root", cols: 80, rows: 24 }],
    machine_stats: [{ machine_id: "machine-a", stats: { cpu_percent: 10, memory_total: 100, memory_used: 50, disks: [] } }],
    control_leases: [{ machine_id: "machine-a", controller_device_id: "device-a" }],
  });

  const stale = applyBrowserEventEnvelope(initial, {
    seq: 3,
    event: { type: "machine_offline", machine_id: "machine-a" },
  });

  assert.equal(stale.machines.length, 1);
  assert.equal(stale.terminals.length, 1);
  assert.equal(stale.lastSeq, 4);

  const next = applyBrowserEventEnvelope(initial, {
    seq: 5,
    event: { type: "machine_offline", machine_id: "machine-a" },
  });

  assert.equal(next.machines.length, 0);
  assert.equal(next.terminals.length, 0);
  assert.equal(next.lastSeq, 5);
});

test("mode changes are applied per machine instead of globally", () => {
  const initial = applyBootstrapSnapshot({
    snapshot_seq: 7,
    machines: [
      { id: "machine-a", name: "A", os: "linux", home_dir: "/root" },
      { id: "machine-b", name: "B", os: "linux", home_dir: "/srv" },
    ],
    terminals: [],
    machine_stats: [],
    control_leases: [{ machine_id: "machine-a", controller_device_id: "device-a" }],
  });

  const next = applyBrowserEventEnvelope(initial, {
    seq: 8,
    event: {
      type: "mode_changed",
      machine_id: "machine-b",
      controller_device_id: "device-b",
    },
  });

  assert.equal(next.controlLeases["machine-a"], "device-a");
  assert.equal(next.controlLeases["machine-b"], "device-b");
});

test("sequence gaps trigger a bootstrap reset instead of applying partial state", () => {
  const initial = applyBootstrapSnapshot({
    snapshot_seq: 4,
    machines: [{ id: "machine-a", name: "A", os: "linux", home_dir: "/root" }],
    terminals: [],
    machine_stats: [],
    control_leases: [],
  });

  assert.equal(
    shouldResyncForEnvelope(initial, {
      seq: 6,
      event: { type: "machine_offline", machine_id: "machine-a" },
    }),
    true,
  );

  assert.equal(
    shouldResyncForEnvelope(initial, {
      seq: 5,
      event: { type: "machine_offline", machine_id: "machine-a" },
    }),
    false,
  );
});
