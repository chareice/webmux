// Sidebar tree projection for the desktop IA: browserState (machines,
// terminals, workspace groups/layouts) → an ordered, render-ready model of
// machine blocks, their workspace-group sections, and the pane rows inside
// each section. Pure and DOM-free so vitest can cover the ordering rules:
// sections keep their per-machine sort_order, the tree never re-sorts by
// status, and ⌃B 1..9 indices are assigned across machines top-to-bottom
// over the sections left visible by the host filter.

import type {
  MachineInfo,
  TerminalInfo,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
} from "@webmux/shared";
import { displayTerminalTitle } from "./displayTerminalTitle";
import {
  createTerminalWorkspace,
  groupPaneTerminalIds,
  type WorkspaceGroup,
} from "./terminalWorkspaceLayout";

// ⌃B 1..9 — only the first nine visible sections get a shortcut index.
export const SIDEBAR_SHORTCUT_COUNT = 9;

export interface SidebarRow {
  terminalId: string;
  title: string;
  reachable: boolean;
  // The workspace's focused pane (active machine's active terminal only).
  focused: boolean;
}

export interface SidebarSection {
  machineId: string;
  groupId: string;
  label: string;
  cwd: string;
  persistent: boolean;
  paneCount: number;
  // Section of the workspace currently shown on the right.
  active: boolean;
  // Dimmed by the host filter (another machine is filtered in).
  dimmed: boolean;
  // 1-based ⌃B N index across all visible sections; null when beyond 9 or
  // dimmed out by the host filter.
  shortcutIndex: number | null;
  rows: SidebarRow[];
  // Source group, kept so the sidebar can hand it to rename/delete/reorder
  // handlers without a second lookup.
  group: WorkspaceGroup;
}

export interface SidebarMachine {
  machineId: string;
  name: string;
  online: boolean;
  dimmed: boolean;
  sections: SidebarSection[];
}

export interface SidebarTree {
  machines: SidebarMachine[];
  // Visible (non-dimmed) sections in tree order — the ⌃B N target list and
  // the command palette's tab rows.
  visibleSections: SidebarSection[];
}

export interface SidebarTreeInput {
  machines: MachineInfo[];
  terminals: TerminalInfo[];
  workspaceGroups: WorkspaceGroupInfo[];
  workspaceLayouts: WorkspaceLayoutInfo[];
  // A machine is online when it has stats or any reachable terminal (same
  // rule HostSwitcher used).
  machineOnline?: Record<string, boolean>;
  hostFilterId: string | null;
  activeMachineId: string | null;
  activeGroupId: string | null;
  activeTerminalId: string | null;
}

export function buildSidebarTree(input: SidebarTreeInput): SidebarTree {
  const terminalsById = new Map(
    input.terminals.map((terminal) => [terminal.id, terminal]),
  );

  const machineModels: SidebarMachine[] = input.machines.map((machine) => {
    const dimmed =
      input.hostFilterId !== null && machine.id !== input.hostFilterId;
    const machineTerminals = input.terminals.filter(
      (terminal) => terminal.machine_id === machine.id,
    );
    const machineGroups = input.workspaceGroups.filter(
      (group) => group.machine_id === machine.id,
    );
    const machineLayouts = input.workspaceLayouts.filter(
      (layout) => layout.machine_id === machine.id,
    );
    const groups = createTerminalWorkspace(
      machineTerminals,
      null,
      machineGroups,
      machineLayouts,
    ).groups;
    const online =
      input.machineOnline?.[machine.id] ??
      machineTerminals.some((terminal) => terminal.reachable);
    const isActiveMachine = machine.id === input.activeMachineId;

    const sections: SidebarSection[] = groups.map((group) => ({
      machineId: machine.id,
      groupId: group.id,
      label: group.label,
      cwd: group.cwd,
      persistent: group.persistent,
      paneCount: group.paneCount,
      active: isActiveMachine && group.id === input.activeGroupId,
      dimmed,
      shortcutIndex: null,
      rows: groupPaneTerminalIds(group).flatMap((terminalId) => {
        const terminal = terminalsById.get(terminalId);
        if (!terminal) return [];
        return [
          {
            terminalId,
            title: displayTerminalTitle(terminal),
            reachable: terminal.reachable,
            focused: isActiveMachine && terminalId === input.activeTerminalId,
          },
        ];
      }),
      group,
    }));

    return {
      machineId: machine.id,
      name: machine.name,
      online,
      dimmed,
      sections,
    };
  });

  const visibleSections = machineModels.flatMap((machine) =>
    machine.dimmed ? [] : machine.sections,
  );
  visibleSections.forEach((section, index) => {
    if (index < SIDEBAR_SHORTCUT_COUNT) section.shortcutIndex = index + 1;
  });

  return { machines: machineModels, visibleSections };
}
