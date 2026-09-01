import type { AgentSessionInfo, TerminalInfo } from "@offdesk/shared";

import {
  labelFromCwd,
  workspacePaneOrder,
  type WorkspaceGroup,
} from "./terminalWorkspaceLayout";

// A row in the mobile session model: a terminal pane or an agent session.
// Agent rows sit next to terminals in the switcher sheet, the title-bar
// position badge, and the strip order the title-bar/edge swipes walk.
export type MobileSessionRow =
  | {
      kind: "terminal";
      terminal: TerminalInfo;
      group: WorkspaceGroup;
    }
  | {
      kind: "agent";
      session: AgentSessionInfo;
      group: WorkspaceGroup;
      // New events since the user last saw the session; only meaningful
      // while the session isn't the open one (same rule as the sidebar tree).
      unread: boolean;
      // The agent session currently open in the chat page.
      selected: boolean;
    };

export interface MobileSessionGroup {
  group: WorkspaceGroup;
  rows: MobileSessionRow[];
}

export function buildMobileSessionGroups(
  groups: WorkspaceGroup[],
  terminals: TerminalInfo[],
  agentSessions: AgentSessionInfo[] = [],
  agentSessionSeen: Record<string, number> = {},
  selectedAgentSessionId: string | null = null,
): MobileSessionGroup[] {
  const terminalsById = new Map(
    terminals.map((terminal) => [terminal.id, terminal]),
  );

  const result: MobileSessionGroup[] = [];
  const groupsById = new Map<string, MobileSessionGroup>();
  for (const group of groups) {
    const rows: MobileSessionRow[] = workspacePaneOrder(group.root).flatMap(
      (terminalId) => {
        const terminal = terminalsById.get(terminalId);
        return terminal ? [{ kind: "terminal" as const, terminal, group }] : [];
      },
    );
    const entry: MobileSessionGroup = { group, rows };
    result.push(entry);
    groupsById.set(group.id, entry);
  }

  // Agent sessions land in their persistent group's section, else in the
  // section whose cwd matches, else a synthetic cwd-fallback section appended
  // after the real groups in first-seen order — the same placement rules the
  // desktop sidebar tree uses, so mobile and desktop group sessions
  // identically. Rows append after the section's terminal rows.
  const syntheticByCwd = new Map<string, MobileSessionGroup>();
  for (const session of agentSessions) {
    let entry =
      (session.workspace_group_id
        ? groupsById.get(session.workspace_group_id)
        : undefined) ??
      result.find((candidate) => candidate.group.cwd === session.cwd) ??
      syntheticByCwd.get(session.cwd);
    if (!entry) {
      const group: WorkspaceGroup = {
        id: `cwd:${session.cwd}`,
        label: labelFromCwd(session.cwd),
        cwd: session.cwd,
        workspaceGroupId: null,
        persistent: false,
        root: null,
        paneCount: 0,
      };
      entry = { group, rows: [] };
      result.push(entry);
      syntheticByCwd.set(session.cwd, entry);
    }
    const selected = session.id === selectedAgentSessionId;
    entry.rows.push({
      kind: "agent",
      session,
      group: entry.group,
      unread:
        !selected &&
        (agentSessionSeen[session.id] ?? 0) < session.last_event_seq,
      selected,
    });
  }

  return result.filter((entry) => entry.rows.length > 0);
}
