import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import type { AgentInfo, Run, RunStatus } from "@webmux/shared";
import { listAllThreads, listAgents } from "./api";
import { deriveWorkpaths, type Workpath } from "./workpath";

const ACTIVE_STATUSES: RunStatus[] = ["starting", "running"];
const AUTO_REFRESH_INTERVAL = 5000;

interface WorkpathContextValue {
  workpaths: Workpath[];
  agents: Map<string, AgentInfo>;
  runs: Run[];
  isLoading: boolean;
  error: string | null;
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
  reload: () => Promise<void>;
  setRuns: React.Dispatch<React.SetStateAction<Run[]>>;
}

const WorkpathContext = createContext<WorkpathContextValue | null>(null);

export function WorkpathProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const [threadsData, agentsData] = await Promise.all([
        listAllThreads(),
        listAgents(),
      ]);
      setRuns(threadsData);
      setAgents(new Map(agentsData.agents.map((a) => [a.id, a])));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    const hasActive = runs.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (hasActive) {
      intervalRef.current = setInterval(() => {
        void loadData(false);
      }, AUTO_REFRESH_INTERVAL);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runs, loadData]);

  const workpaths = useMemo(() => deriveWorkpaths(runs, agents), [runs, agents]);

  useEffect(() => {
    if (!selectedPath && workpaths.length > 0) {
      setSelectedPath(workpaths[0].repoPath);
    }
  }, [workpaths, selectedPath]);

  const reload = useCallback(async () => {
    await loadData(false);
  }, [loadData]);

  const value = useMemo(
    () => ({
      workpaths,
      agents,
      runs,
      isLoading,
      error,
      selectedPath,
      setSelectedPath,
      reload,
      setRuns,
    }),
    [workpaths, agents, runs, isLoading, error, selectedPath, reload],
  );

  return (
    <WorkpathContext.Provider value={value}>
      {children}
    </WorkpathContext.Provider>
  );
}

export function useWorkpaths(): WorkpathContextValue {
  const ctx = useContext(WorkpathContext);
  if (!ctx)
    throw new Error("useWorkpaths must be used within WorkpathProvider");
  return ctx;
}
