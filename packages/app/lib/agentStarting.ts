// Starting-state honesty, shared by the desktop chat header and the mobile
// title bar: while a session is `starting` the status pill names the agent
// and ticks elapsed seconds ("正在启动 <agent>… Ns") instead of a bare
// "starting…", and the npx-wrapped adapters get a cold-start hint — their
// boot is slow enough (~1 min measured for claude) that a static pill reads
// as broken.

import { useEffect, useRef, useState } from "react";
import type { AgentKind } from "@offdesk/shared";

export const COLD_START_HINT: Partial<Record<AgentKind, string>> = {
  claude: "claude 冷启动约 1 分钟",
  codex: "codex 冷启动约 1 分钟",
};

/** Elapsed whole seconds since `starting` became true (0 otherwise), ticking
 *  once per second while it holds. */
export function useStartingElapsedSec(starting: boolean): number {
  const startingSinceRef = useRef<number | null>(null);
  if (starting && startingSinceRef.current === null) {
    startingSinceRef.current = Date.now();
  } else if (!starting) {
    startingSinceRef.current = null;
  }
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!starting) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [starting]);
  return starting && startingSinceRef.current !== null
    ? Math.max(0, Math.floor((nowMs - startingSinceRef.current) / 1000))
    : 0;
}
