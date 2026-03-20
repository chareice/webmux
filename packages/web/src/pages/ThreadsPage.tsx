import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, FolderGit2, GitBranch, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { AgentInfo, Run, RunListResponse, RunStatus } from '@webmux/shared'

const ACTIVE_STATUSES: RunStatus[] = ['starting', 'running']
const AUTO_REFRESH_INTERVAL = 5000

interface ProjectGroup {
  repoPath: string
  repoName: string
  runs: Run[]
  hasActive: boolean
  latestUpdate: number
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function repoName(repoPath: string): string {
  const parts = repoPath.split('/')
  return parts[parts.length - 1] || repoPath
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'queued': return 'Queued'
    case 'starting': return 'Starting'
    case 'running': return 'Running'
    case 'success': return 'Success'
    case 'failed': return 'Failed'
    case 'interrupted': return 'Interrupted'
  }
}

function statusClass(status: RunStatus): string {
  switch (status) {
    case 'queued': return 'muted'
    case 'starting': return 'warning'
    case 'running': return 'accent'
    case 'success': return 'success'
    case 'failed': return 'danger'
    case 'interrupted': return 'muted'
  }
}

function toolIcon(tool: string): string {
  return tool === 'codex' ? 'CX' : 'CC'
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

function aiPreview(run: Run): string {
  if (run.summary) return truncate(run.summary, 120)
  if (run.status === 'running' || run.status === 'starting') return 'Running...'
  return 'No summary'
}

function groupByProject(runs: Run[]): ProjectGroup[] {
  const map = new Map<string, Run[]>()
  for (const run of runs) {
    const key = run.repoPath
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(run)
  }

  const groups: ProjectGroup[] = []
  for (const [path, groupRuns] of map) {
    groupRuns.sort((a, b) => b.updatedAt - a.updatedAt)
    groups.push({
      repoPath: path,
      repoName: repoName(path),
      runs: groupRuns,
      hasActive: groupRuns.some((r) => ACTIVE_STATUSES.includes(r.status)),
      latestUpdate: groupRuns[0].updatedAt,
    })
  }

  // Sort: groups with active runs first, then by most recent update
  groups.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1
    return b.latestUpdate - a.latestUpdate
  })

  return groups
}

export function ThreadsPage() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true)
    try {
      const [threadsRes, agentsRes] = await Promise.all([
        fetchApi('/api/threads'),
        fetchApi('/api/agents'),
      ])
      if (!threadsRes.ok) throw new Error('Failed to load threads')
      if (!agentsRes.ok) throw new Error('Failed to load agents')
      const threadsData = (await threadsRes.json()) as RunListResponse
      const agentsData = (await agentsRes.json()) as { agents: AgentInfo[] }
      setRuns(threadsData.runs)
      setAgents(new Map(agentsData.agents.map((a) => [a.id, a])))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  // Auto-refresh when there are active runs
  useEffect(() => {
    const hasActive = runs.some((r) => ACTIVE_STATUSES.includes(r.status))
    if (hasActive) {
      intervalRef.current = setInterval(() => {
        void loadData(false)
      }, AUTO_REFRESH_INTERVAL)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [runs, loadData])

  const handleDelete = async (run: Run) => {
    const label =
      run.status === 'starting' || run.status === 'running'
        ? 'This will stop the running task and remove it.'
        : 'This will remove the thread.'
    if (!confirm(label)) return

    try {
      setDeletingId(run.id)
      const res = await fetchApi(`/api/agents/${run.agentId}/threads/${run.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete thread')
      setRuns((prev) => prev.filter((r) => r.id !== run.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const projectGroups = useMemo(() => groupByProject(runs), [runs])

  const toggleProject = (repoPath: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(repoPath)) next.delete(repoPath)
      else next.add(repoPath)
      return next
    })
  }

  // Find online agents for the "New Thread" button
  const onlineAgents = [...agents.values()].filter((a) => a.status === 'online')

  if (isLoading) {
    return (
      <div className="threads-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading threads...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="threads-page">
      <div className="threads-header">
        <h1>Threads</h1>
        <div className="threads-header-actions">
          {onlineAgents.length === 1 ? (
            <button
              className="primary-button"
              onClick={() => navigate(`/agents/${onlineAgents[0].id}/threads/new`)}
              type="button"
            >
              <Plus size={16} />
              New Thread
            </button>
          ) : onlineAgents.length > 1 ? (
            <div className="threads-new-dropdown">
              <button className="primary-button" type="button">
                <Plus size={16} />
                New Thread
              </button>
              <div className="threads-new-dropdown-menu">
                {onlineAgents.map((agent) => (
                  <Link
                    key={agent.id}
                    className="threads-new-dropdown-item"
                    to={`/agents/${agent.id}/threads/new`}
                  >
                    {agent.name || agent.id}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {runs.length === 0 && !error ? (
        <div className="threads-empty">
          <h2>No threads yet</h2>
          <p>Create a thread to run Claude Code or Codex on a remote agent.</p>
        </div>
      ) : null}

      {projectGroups.map((group) => {
        const isCollapsed = collapsedProjects.has(group.repoPath)
        const activeCount = group.runs.filter((r) => ACTIVE_STATUSES.includes(r.status)).length
        return (
          <div className="threads-section" key={group.repoPath}>
            <button
              className={`threads-project-header ${isCollapsed ? 'collapsed' : ''}`}
              onClick={() => toggleProject(group.repoPath)}
              type="button"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FolderGit2 size={14} className="threads-project-icon" />
              <span className="threads-project-name">{group.repoName}</span>
              <span className="threads-project-path" title={group.repoPath}>{group.repoPath}</span>
              <span className="threads-project-count">{group.runs.length}</span>
              {activeCount > 0 ? (
                <span className="threads-project-active-badge">{activeCount} active</span>
              ) : null}
            </button>
            {!isCollapsed ? (
              <div className="threads-list">
                {group.runs.map((run) => (
                  <ThreadRow
                    key={run.id}
                    run={run}
                    agentName={agents.get(run.agentId)?.name || undefined}
                    isDeleting={deletingId === run.id}
                    onDelete={() => void handleDelete(run)}
                    onClick={() => navigate(`/agents/${run.agentId}/threads/${run.id}`)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ThreadRow({
  run,
  agentName,
  isDeleting,
  onDelete,
  onClick,
}: {
  run: Run
  agentName?: string
  isDeleting: boolean
  onDelete: () => void
  onClick: () => void
}) {
  const sc = statusClass(run.status)
  const isActive = run.status === 'running' || run.status === 'starting'
  return (
    <div
      className={`thread-row status-${sc}${run.unread ? ' unread' : ''}${isActive ? ' active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      {/* Line 1: meta info */}
      <div className="thread-row-meta">
        <span className={`thread-tool-badge ${run.tool}`}>{toolIcon(run.tool)}</span>
        {run.branch ? (
          <span className="thread-branch">
            <GitBranch size={11} />
            {run.branch}
          </span>
        ) : null}
        {agentName ? (
          <>
            <span className="thread-meta-sep">·</span>
            <span className="thread-agent-name">{agentName}</span>
          </>
        ) : null}
        <span className="thread-row-right">
          {run.hasDiff ? <span className="thread-diff-badge" title="Has code changes">Δ</span> : null}
          <span className={`thread-status-badge ${sc}`}>
            <span className={`thread-status-dot ${sc}`} />
            {statusLabel(run.status)}
          </span>
          <span className="thread-row-time">{timeAgo(run.updatedAt)}</span>
          <button
            className="thread-row-delete icon-button kill-button"
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="Remove thread"
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {/* Line 2: prompt → summary */}
      <div className="thread-row-content">
        <span className="thread-prompt-text">{truncate(run.prompt, 80)}</span>
        {run.summary || isActive ? (
          <>
            <span className="thread-arrow">→</span>
            <span className="thread-summary-text">{aiPreview(run)}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
