import type { Run, AgentInfo, RunStatus } from "@webmux/shared";
import { repoName } from "@webmux/shared";

const ACTIVE_STATUSES: RunStatus[] = ["starting", "running"];

export interface Workpath {
  /** Full path — also serves as unique key */
  repoPath: string;
  /** Short directory name */
  dirName: string;
  /** Agent/node ID */
  agentId: string;
  /** Node display name */
  nodeName: string | undefined;
  /** Threads under this workpath, sorted by updatedAt desc */
  runs: Run[];
  /** Whether any thread is currently active */
  hasActive: boolean;
  /** Count of active threads */
  activeCount: number;
  /** Count of unread threads */
  unreadCount: number;
  /** Most recent updatedAt */
  latestUpdate: number;
}

export function deriveWorkpaths(
  runs: Run[],
  agents: Map<string, AgentInfo>,
): Workpath[] {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const key = run.repoPath;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(run);
  }

  const workpaths: Workpath[] = [];
  for (const [path, groupRuns] of map) {
    groupRuns.sort((a, b) => b.updatedAt - a.updatedAt);
    const activeRuns = groupRuns.filter((r) =>
      ACTIVE_STATUSES.includes(r.status),
    );
    const agentId = groupRuns[0].agentId;
    workpaths.push({
      repoPath: path,
      dirName: repoName(path),
      agentId,
      nodeName: agents.get(agentId)?.name,
      runs: groupRuns,
      hasActive: activeRuns.length > 0,
      activeCount: activeRuns.length,
      unreadCount: groupRuns.filter((r) => r.unread).length,
      latestUpdate: groupRuns[0].updatedAt,
    });
  }

  workpaths.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1;
    return b.latestUpdate - a.latestUpdate;
  });

  return workpaths;
}
