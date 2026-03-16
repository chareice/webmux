import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { AgentInfo, Run, RunListResponse, RunStatus } from '@webmux/shared'

const ACTIVE_STATUSES: RunStatus[] = ['starting', 'running']
const AUTO_REFRESH_INTERVAL = 5000

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
    case 'starting': return 'Starting'
    case 'running': return 'Running'
    case 'success': return 'Success'
    case 'failed': return 'Failed'
    case 'interrupted': return 'Interrupted'
  }
}

function statusClass(status: RunStatus): string {
  switch (status) {
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

export function ThreadsPage() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
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

  const activeRuns = runs.filter((r) => ACTIVE_STATUSES.includes(r.status))
  const completedRuns = runs.filter((r) => !ACTIVE_STATUSES.includes(r.status))

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

      {activeRuns.length > 0 ? (
        <div className="threads-section">
          <h2 className="threads-section-title">Active</h2>
          <div className="threads-list">
            {activeRuns.map((run) => (
              <ThreadCard
                key={run.id}
                run={run}
                agentName={agents.get(run.agentId)?.name || undefined}
                isDeleting={deletingId === run.id}
                onDelete={() => void handleDelete(run)}
                onClick={() => navigate(`/agents/${run.agentId}/threads/${run.id}`)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {completedRuns.length > 0 ? (
        <div className="threads-section">
          <h2 className="threads-section-title">Completed</h2>
          <div className="threads-list">
            {completedRuns.map((run) => (
              <ThreadCard
                key={run.id}
                run={run}
                agentName={agents.get(run.agentId)?.name || undefined}
                isDeleting={deletingId === run.id}
                onDelete={() => void handleDelete(run)}
                onClick={() => navigate(`/agents/${run.agentId}/threads/${run.id}`)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ThreadCard({
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
  return (
    <div className="thread-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="thread-card-header">
        <div className="thread-card-left">
          <span className={`thread-tool-badge ${run.tool}`}>{toolIcon(run.tool)}</span>
          <div className="thread-card-info">
            <span className="thread-repo-name">{repoName(run.repoPath)}</span>
            {run.branch ? <span className="thread-branch">{run.branch}</span> : null}
            {agentName ? <span className="thread-agent-name">{agentName}</span> : null}
          </div>
        </div>
        <span className={`thread-status-badge ${sc}`}>
          <span className={`thread-status-dot ${sc}`} />
          {statusLabel(run.status)}
        </span>
      </div>
      <p className="thread-prompt">{run.prompt}</p>
      <div className="thread-card-footer">
        <span className="thread-time">{timeAgo(run.updatedAt)}</span>
        <button
          className="icon-button kill-button"
          disabled={isDeleting}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="Remove thread"
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
