// Sidebar tree projection for the desktop IA: browserState (machines,
// terminals, workspace groups/layouts, agent sessions) → an ordered,
// render-ready model of machine blocks, their workspace-group sections, and
// the pane/agent rows inside each section. Pure and DOM-free so vitest can
// cover the ordering rules: sections keep their per-machine sort_order, the
// tree never re-sorts by status, and ⌃B 1..9 indices are assigned across
// machines top-to-bottom over the sections left visible by the host filter.

import type {
  AgentKind,
  AgentSessionInfo,
  AgentSessionStatus,
  MachineInfo,
  TerminalInfo,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
} from "@offdesk/shared";
import { displayTerminalTitle } from "./displayTerminalTitle";
import {
  createTerminalWorkspace,
  groupPaneTerminalIds,
  labelFromCwd,
  type WorkspaceGroup,
} from "./terminalWorkspaceLayout";

// ⌃B 1..9 — only the first nine visible sections get a shortcut index.
export const SIDEBAR_SHORTCUT_COUNT = 9;

export type SidebarRow =
  | {
      kind: "terminal";
      terminalId: string;
      title: string;
      reachable: boolean;
      // The workspace's focused pane (active machine's active terminal only).
      focused: boolean;
    }
  | {
      kind: "agent";
      agentSessionId: string;
      title: string;
      agentKind: AgentKind;
      status: AgentSessionStatus;
      // New events since the user last saw the session; only meaningful
      // while the session isn't the open one.
      unread: boolean;
      // The agent session currently open on the right.
      selected: boolean;
    };

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
  // Terminal rows first, then agent rows; the tree never re-sorts by status.
  rows: SidebarRow[];
  // Source group, kept so the sidebar can hand it to rename/delete/reorder
  // handlers without a second lookup. Synthetic agent-only sections carry a
  // fabricated cwd-fallback group (persistent: false, no workspace row).
  group: WorkspaceGroup;
}

export interface SidebarMachine {
  machineId: string;
  name: string;
  online: boolean;
  dimmed: boolean;
  sections: SidebarSection[];
}

// An agent session blocked on a user answer — drives the inbox banner
// ("N waiting on you · oldest Xm"). Collected across ALL machines: the host
// filter must not hide a blocked session.
export interface SidebarAskedSession {
  sessionId: string;
  machineId: string;
  title: string;
  agentKind: AgentKind;
  createdAtMs: number;
}

export interface SidebarTree {
  machines: SidebarMachine[];
  // Visible (non-dimmed) sections in tree order — the ⌃B N target list and
  // the command palette's tab rows.
  visibleSections: SidebarSection[];
  // Sessions with status "asked", oldest first by created_at_ms.
  askedSessions: SidebarAskedSession[];
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
  agentSessions?: AgentSessionInfo[];
  // session id → last_seen_seq for the current user.
  agentSessionSeen?: Record<string, number>;
  selectedAgentSessionId?: string | null;
}

export function buildSidebarTree(input: SidebarTreeInput): SidebarTree {
  const terminalsById = new Map(
    input.terminals.map((terminal) => [terminal.id, terminal]),
  );
  const agentSessions = input.agentSessions ?? [];
  const agentSessionSeen = input.agentSessionSeen ?? {};
  const selectedAgentSessionId = input.selectedAgentSessionId ?? null;

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
      rows: groupPaneTerminalIds(group).flatMap((terminalId): SidebarRow[] => {
        const terminal = terminalsById.get(terminalId);
        if (!terminal) return [];
        return [
          {
            kind: "terminal",
            terminalId,
            title: displayTerminalTitle(terminal),
            reachable: terminal.reachable,
            focused: isActiveMachine && terminalId === input.activeTerminalId,
          },
        ];
      }),
      group,
    }));

    // Agent sessions land in their persistent group's section, else in the
    // section whose cwd matches, else a synthetic cwd-fallback section
    // appended after the real groups in first-seen order (same key/label
    // scheme as terminal fallback sections, so an agent-only section renders
    // identically). Rows append after the section's terminal rows.
    const sectionsById = new Map(
      sections.map((section) => [section.groupId, section]),
    );
    const syntheticByCwd = new Map<string, SidebarSection>();
    for (const session of agentSessions) {
      if (session.machine_id !== machine.id) continue;
      let section =
        (session.workspace_group_id
          ? sectionsById.get(session.workspace_group_id)
          : undefined) ??
        sections.find((candidate) => candidate.cwd === session.cwd) ??
        syntheticByCwd.get(session.cwd);
      if (!section) {
        const group: WorkspaceGroup = {
          id: `cwd:${session.cwd}`,
          label: labelFromCwd(session.cwd),
          cwd: session.cwd,
          workspaceGroupId: null,
          persistent: false,
          root: null,
          paneCount: 0,
        };
        section = {
          machineId: machine.id,
          groupId: group.id,
          label: group.label,
          cwd: group.cwd,
          persistent: false,
          paneCount: 0,
          active: isActiveMachine && group.id === input.activeGroupId,
          dimmed,
          shortcutIndex: null,
          rows: [],
          group,
        };
        sections.push(section);
        syntheticByCwd.set(session.cwd, section);
      }
      const selected = session.id === selectedAgentSessionId;
      section.rows.push({
        kind: "agent",
        agentSessionId: session.id,
        title: session.title,
        agentKind: session.agent_kind,
        status: session.status,
        unread:
          !selected &&
          (agentSessionSeen[session.id] ?? 0) < session.last_event_seq,
        selected,
      });
    }

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

  const askedSessions: SidebarAskedSession[] = agentSessions
    .filter((session) => session.status === "asked")
    .sort((a, b) => a.created_at_ms - b.created_at_ms)
    .map((session) => ({
      sessionId: session.id,
      machineId: session.machine_id,
      title: session.title,
      agentKind: session.agent_kind,
      createdAtMs: session.created_at_ms,
    }));

  return { machines: machineModels, visibleSections, askedSessions };
}
