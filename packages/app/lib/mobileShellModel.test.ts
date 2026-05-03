import { describe, expect, it } from "vitest";
import type { MachineInfo, TerminalInfo } from "@webmux/shared";

import {
  getActiveMachine,
  getMachineTerminals,
  isMachineController,
  summarizeResourceStats,
} from "./mobileShellModel";

const machines: MachineInfo[] = [
  { id: "m1", name: "laptop", os: "linux", home_dir: "/home/chareice" },
  { id: "m2", name: "nas", os: "linux", home_dir: "/volume1/home" },
];

const terminals: TerminalInfo[] = [
  {
    id: "t1",
    machine_id: "m1",
    title: "shell",
    cwd: "/home/chareice",
    cols: 80,
    rows: 24,
    reachable: true,
  },
  {
    id: "t2",
    machine_id: "m2",
    title: "logs",
    cwd: "/volume1/home",
    cols: 100,
    rows: 30,
    reachable: true,
  },
];

describe("mobileShellModel", () => {
  it("falls back to the first machine when the selected machine is missing", () => {
    expect(getActiveMachine(machines, "missing")?.id).toBe("m1");
  });

  it("filters terminals to the active machine", () => {
    expect(getMachineTerminals(terminals, "m2").map((terminal) => terminal.id)).toEqual([
      "t2",
    ]);
  });

  it("detects whether this device controls a machine", () => {
    expect(isMachineController({ m1: "device-a" }, "m1", "device-a")).toBe(true);
    expect(isMachineController({ m1: "device-a" }, "m1", "device-b")).toBe(false);
  });

  it("summarizes missing and present resource stats for compact mobile display", () => {
    expect(summarizeResourceStats(undefined)).toEqual({
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      memoryLabel: "—",
    });

    expect(
      summarizeResourceStats({
        cpu_percent: 12.4,
        memory_total: 1024,
        memory_used: 512,
        disks: [
          { mount_point: "/", total_bytes: 100, used_bytes: 40 },
          { mount_point: "/data", total_bytes: 300, used_bytes: 210 },
        ],
      }),
    ).toEqual({
      cpuPercent: 12,
      memoryPercent: 50,
      diskPercent: 63,
      memoryLabel: "512B / 1.0K",
    });
  });
});
