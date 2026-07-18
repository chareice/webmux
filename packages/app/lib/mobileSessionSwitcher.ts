import type { TerminalInfo } from "@webmux/shared";

import {
  workspacePaneOrder,
  type WorkspaceGroup,
} from "./terminalWorkspaceLayout";

export interface MobileSessionPane {
  terminal: TerminalInfo;
  group: WorkspaceGroup;
  chipLabel: string;
}

export interface MobileSessionGroup {
  group: WorkspaceGroup;
  panes: MobileSessionPane[];
}

function terminalTitle(terminal: TerminalInfo): string {
  return terminal.title || terminal.id.slice(0, 8);
}

export function buildMobileSessionGroups(
  groups: WorkspaceGroup[],
  terminals: TerminalInfo[],
): MobileSessionGroup[] {
  const terminalsById = new Map(
    terminals.map((terminal) => [terminal.id, terminal]),
  );

  return groups.flatMap((group) => {
    const panes = workspacePaneOrder(group.root)
      .flatMap((terminalId) => {
        const terminal = terminalsById.get(terminalId);
        return terminal ? [terminal] : [];
      })
      .map((terminal, index) => {
        const title = terminalTitle(terminal);
        return {
          terminal,
          group,
          chipLabel: index === 0 ? `${group.label} · ${title}` : title,
        };
      });
    return panes.length > 0 ? [{ group, panes }] : [];
  });
}
