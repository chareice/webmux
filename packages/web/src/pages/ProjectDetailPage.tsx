import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  LoaderCircle,
  RotateCcw,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import { timeAgo } from '../lib/utils.ts'
import type {
  Project,
  Task,
  TaskStatus,
  RunEvent,
} from '@webmux/shared'

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['dispatched', 'running', 'waiting']
const AUTO_REFRESH_INTERVAL = 5000

/* ── StatusCircle (lightweight, for task list only) ── */

function StatusCircle({ status, size = 18 }: { status: TaskStatus; size?: number }) {
  const r = size / 2 - 2
  const cx = size / 2
  const cy = size / 2

  switch (status) {
    case 'pending':
      return (
        <svg width={size} height={size} className="td-status-circle">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
      )
    case 'dispatched':
      return (
        <svg width={size} height={size} className="td-status-circle td-status-dispatched">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--warning)" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={r * 0.35} fill="var(--warning)" opacity="0.6" />
        </svg>
      )
    case 'running':
      return (
        <svg width={size} height={size} className="td-status-circle td-status-running">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent)" strokeWidth="2" className="td-status-glow" />
          <circle cx={cx} cy={cy} r={r * 0.35} fill="var(--accent)" />
        </svg>
      )
    case 'waiting':
      return (
        <svg width={size} height={size} className="td-status-circle td-status-waiting">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--warning)" strokeWidth="1.5" />
          <rect x={cx - r * 0.3} y={cy - r * 0.35} width={r * 0.2} height={r * 0.7} fill="var(--warning)" rx="1" />
          <rect x={cx + r * 0.1} y={cy - r * 0.35} width={r * 0.2} height={r * 0.7} fill="var(--warning)" rx="1" />
        </svg>
      )
    case 'completed':
      return (
        <svg width={size} height={size} className="td-status-circle">
          <circle cx={cx} cy={cy} r={r} fill="var(--success)" stroke="none" />
          <polyline
            points={`${cx - r * 0.35},${cy} ${cx - r * 0.05},${cy + r * 0.35} ${cx + r * 0.4},${cy - r * 0.3}`}
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'failed':
      return (
        <svg width={size} height={size} className="td-status-circle">
          <circle cx={cx} cy={cy} r={r} fill="var(--danger)" opacity="0.15" stroke="var(--danger)" strokeWidth="1.5" />
          <line x1={cx - r * 0.35} y1={cy - r * 0.35} x2={cx + r * 0.35} y2={cy + r * 0.35} stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={cx + r * 0.35} y1={cy - r * 0.35} x2={cx - r * 0.35} y2={cy + r * 0.35} stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
  }
}

/* ── Modal Overlay (for Add Task / Confirm Delete) ── */

function ModalOverlay({
  children,
  onClose,
  maxWidth = 640,
}: {
  children: React.ReactNode
  onClose: () => void
  maxWidth?: number
}) {
  return (
    <div className="td-modal-overlay" onClick={onClose}>
      <div
        className="td-modal-content"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/* ── Add Task Modal ─────────────────────────────── */

function AddTaskModal({
  onClose,
  onSubmit,
  isSubmitting,
  formError,
  defaultTool,
}: {
  onClose: () => void
  onSubmit: (title: string, description: string, priority: number, tool: 'claude' | 'codex') => void
  isSubmitting: boolean
  formError: string | null
  defaultTool: 'claude' | 'codex'
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('0')
  const [showPriority, setShowPriority] = useState(false)
  const [tool, setTool] = useState<'claude' | 'codex'>(defaultTool)

  const handleSubmit = () => {
    if (!title.trim()) return
    const prio = parseInt(priority, 10)
    onSubmit(title.trim(), description.trim(), isNaN(prio) ? 0 : prio, tool)
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth={480}>
      <div className="td-modal-header">
        <h2 className="td-modal-title">Add Task</h2>
        <button className="td-modal-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      <div className="td-modal-body">
        <input
          className="td-input td-input-title"
          placeholder="Task title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) handleSubmit()
          }}
          autoFocus
        />

        <textarea
          className="td-input td-input-desc"
          placeholder="Description (optional)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button
          className="td-priority-toggle"
          onClick={() => setShowPriority(!showPriority)}
          type="button"
        >
          Priority {showPriority ? '−' : '+'}
        </button>

        {showPriority && (
          <input
            className="td-input td-input-priority"
            placeholder="0"
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        )}

        <div className="td-tool-selector">
          <button
            className={`td-tool-btn ${tool === 'claude' ? 'active' : ''}`}
            onClick={() => setTool('claude')}
            type="button"
          >
            Claude Code
          </button>
          <button
            className={`td-tool-btn ${tool === 'codex' ? 'active' : ''}`}
            onClick={() => setTool('codex')}
            type="button"
          >
            Codex
          </button>
        </div>

        {formError && <p className="td-form-error">{formError}</p>}

        <div className="td-modal-footer">
          <button className="td-btn td-btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="td-btn td-btn-primary"
            disabled={isSubmitting || !title.trim()}
            onClick={handleSubmit}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Plus size={14} />
            )}
            {isSubmitting ? 'Creating...' : 'Add Task'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/* ── Confirm Delete Modal ───────────────────────── */

function ConfirmDeleteModal({
  onClose,
  onConfirm,
  isDeleting,
}: {
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
}) {
  return (
    <ModalOverlay onClose={onClose} maxWidth={360}>
      <div className="td-confirm-body">
        <h2 className="td-confirm-title">Delete task?</h2>
        <p className="td-confirm-subtitle">This action cannot be undone.</p>
        <div className="td-modal-footer">
          <button className="td-btn td-btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="td-btn td-btn-danger"
            disabled={isDeleting}
            onClick={onConfirm}
            type="button"
          >
            <Trash2 size={14} />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/* ── Main Page Component ────────────────────────── */

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true)
    try {
      const res = await fetchApi(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('Failed to load project')
      const data = (await res.json()) as { project: Project; tasks: Task[] }
      setProject(data.project)
      setTasks(data.tasks)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  // Auto-refresh when there are active tasks (fallback for missed WS events)
  useEffect(() => {
    const hasActive = tasks.some((t) => ACTIVE_TASK_STATUSES.includes(t.status))
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
  }, [tasks, loadData])

  // WebSocket for real-time task status updates
  useEffect(() => {
    if (!projectId || !token) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(
          `${wsProtocol}//${window.location.host}/ws/project?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`,
        )
      },
      onMessage(event) {
        try {
          const data = JSON.parse(event.data) as RunEvent
          if (data.type === 'task-status') {
            setTasks((prev) => prev.map((t) => (t.id === data.task.id ? data.task : t)))
          }
        } catch {
          // ignore parse errors
        }
      },
    })

    return () => controller.dispose()
  }, [projectId, token])

  const handleAddTask = async (title: string, description: string, priority: number, tool: 'claude' | 'codex') => {
    setFormError(null)
    setIsSubmitting(true)
    try {
      const body: { title: string; prompt?: string; priority?: number; tool?: string } = { title, tool }
      if (description) body.prompt = description
      if (priority !== 0) body.priority = priority

      const res = await fetchApi(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to create task')
      }
      const data = (await res.json()) as { task: Task }
      setTasks((prev) => [...prev, data.task])
      setShowAddModal(false)
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRetry = async (taskId: string) => {
    try {
      setRetryingId(taskId)
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${taskId}/retry`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to retry task')
      const data = (await res.json()) as { task: Task }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRetryingId(null)
    }
  }

  const handleDeleteRequest = (taskId: string) => {
    setDeleteTargetId(taskId)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return
    try {
      setDeletingId(deleteTargetId)
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${deleteTargetId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete task')
      setTasks((prev) => prev.filter((t) => t.id !== deleteTargetId))
      setDeleteTargetId(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority)

  if (isLoading) {
    return (
      <div className="project-detail-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading project...</span>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="project-detail-page">
        <p className="error-banner">{error || 'Project not found'}</p>
        <button className="secondary-button" onClick={() => navigate('/projects')} type="button">
          <ArrowLeft size={14} />
          Back to Projects
        </button>
      </div>
    )
  }

  return (
    <div className="project-detail-page">
      <div className="new-thread-header">
        <button className="secondary-button" onClick={() => navigate('/projects')} type="button">
          <ArrowLeft size={14} />
          Back
        </button>
        <h1>{project.name}</h1>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="project-info-bar">
        <span className="project-info-item" title={project.repoPath}>
          {project.repoPath}
        </span>
        <span className="project-info-sep">&middot;</span>
        <span className="project-info-item">
          {project.defaultTool === 'codex' ? 'Codex' : 'Claude'}
        </span>
        {project.description ? (
          <>
            <span className="project-info-sep">&middot;</span>
            <span className="project-info-item project-info-desc">{project.description}</span>
          </>
        ) : null}
      </div>

      {/* Task list */}
      <div className="td-task-list">
        {sortedTasks.length === 0 ? (
          <p className="td-empty-hint">No tasks yet. Add one below.</p>
        ) : (
          sortedTasks.map((task) => (
            <div
              className={`td-task-row ${task.status === 'completed' ? 'td-task-completed' : ''}`}
              key={task.id}
              onClick={() => navigate(`/projects/${projectId}/tasks/${task.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/projects/${projectId}/tasks/${task.id}`) } }}
              role="link"
              tabIndex={0}
            >
              <StatusCircle status={task.status} />
              <div className="td-task-body">
                <span className="td-task-title">{task.title}</span>
                {task.status === 'completed' && task.summary && (
                  <span className="td-task-summary-preview">{task.summary}</span>
                )}
              </div>
              <span className="td-task-time">{timeAgo(task.updatedAt)}</span>
              <div className="td-task-actions">
                {task.runId && (
                  <Link
                    className="td-action-icon"
                    to={`/agents/${project.agentId}/threads/${task.runId}`}
                    onClick={(e) => e.stopPropagation()}
                    title="View Run"
                  >
                    <ExternalLink size={14} />
                  </Link>
                )}
                {task.status === 'failed' && (
                  <button
                    className="td-action-icon"
                    disabled={retryingId === task.id}
                    onClick={(e) => { e.stopPropagation(); void handleRetry(task.id) }}
                    title="Retry"
                    type="button"
                  >
                    {retryingId === task.id ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}
                  </button>
                )}
                <button
                  className="td-action-icon td-action-danger"
                  onClick={(e) => { e.stopPropagation(); handleDeleteRequest(task.id) }}
                  title="Delete"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Add Task button */}
        <button
          className="td-add-task-btn"
          onClick={() => { setFormError(null); setShowAddModal(true) }}
          type="button"
        >
          <Plus size={16} />
          Add Task
        </button>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddTaskModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(t, d, p, tool) => void handleAddTask(t, d, p, tool)}
          defaultTool={(project.defaultTool || 'claude') as 'claude' | 'codex'}
          isSubmitting={isSubmitting}
          formError={formError}
        />
      )}

      {deleteTargetId && (
        <ConfirmDeleteModal
          onClose={() => setDeleteTargetId(null)}
          onConfirm={() => void handleDeleteConfirm()}
          isDeleting={deletingId === deleteTargetId}
        />
      )}
    </div>
  )
}
