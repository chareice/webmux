import type { MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";

export interface MobileResourceSummary {
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  memoryLabel: string;
}

export function getActiveMachine(
  machines: MachineInfo[],
  selectedMachineId: string | null,
): MachineInfo | null {
  if (machines.length === 0) return null;
  return (
    machines.find((machine) => machine.id === selectedMachineId) ?? machines[0]
  );
}

export function getMachineTerminals(
  terminals: TerminalInfo[],
  machineId: string | null,
): TerminalInfo[] {
  if (!machineId) return [];
  return terminals.filter((terminal) => terminal.machine_id === machineId);
}

export function isMachineController(
  controlLeases: Record<string, string>,
  machineId: string | null,
  deviceId: string | null,
): boolean {
  return Boolean(machineId && deviceId && controlLeases[machineId] === deviceId);
}

export function summarizeResourceStats(
  stats: ResourceStats | undefined,
): MobileResourceSummary {
  if (!stats) {
    return {
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      memoryLabel: "—",
    };
  }

  const memoryPercent =
    stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : null;

  let usedDisk = 0;
  let totalDisk = 0;
  for (const disk of stats.disks) {
    usedDisk += disk.used_bytes;
    totalDisk += disk.total_bytes;
  }

  return {
    cpuPercent: Math.round(stats.cpu_percent),
    memoryPercent,
    diskPercent: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : null,
    memoryLabel: `${formatBytes(stats.memory_used)} / ${formatBytes(
      stats.memory_total,
    )}`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}
