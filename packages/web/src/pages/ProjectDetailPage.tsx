import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft, Plus, LoaderCircle, RotateCcw, Trash2, ExternalLink } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { Project, Task, TaskStatus } from '@webmux/shared'

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['dispatched', 'running']
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

function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending': return 'Pending'
    case 'dispatched': return 'Dispatched'
    case 'running': return 'Running'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
  }
}

function taskStatusClass(status: TaskStatus): string {
  switch (status) {
    case 'pending': return 'muted'
    case 'dispatched': return 'warning'
    case 'running': return 'accent'
    case 'completed': return 'success'
    case 'failed': return 'danger'
  }
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add task form
  const [newTitle, setNewTitle] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newPriority, setNewPriority] = useState('0')
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

  // Auto-refresh when there are active tasks
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

  const handleAddTask = async () => {
    setFormError(null)
    if (!newTitle.trim()) { setFormError('Title is required'); return }
    if (!newPrompt.trim()) { setFormError('Prompt is required'); return }

    setIsSubmitting(true)
    try {
      const body: { title: string; prompt: string; priority?: number } = {
        title: newTitle.trim(),
        prompt: newPrompt.trim(),
      }
      const prio = parseInt(newPriority, 10)
      if (!isNaN(prio) && prio !== 0) body.priority = prio

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
      setNewTitle('')
      setNewPrompt('')
      setNewPriority('0')
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

  const handleDelete = async (taskId: string) => {
    if (!confirm('Delete this task?')) return
    try {
      setDeletingId(taskId)
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete task')
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
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
      <div className="project-tasks-section">
        <h2 className="project-tasks-heading">
          Tasks
          <span className="project-tasks-count">{tasks.length}</span>
        </h2>

        {sortedTasks.length === 0 ? (
          <p className="form-hint">No tasks yet. Add one below.</p>
        ) : (
          <div className="project-tasks-list">
            {sortedTasks.map((task) => {
              const sc = taskStatusClass(task.status)
              return (
                <div className="project-task-row" key={task.id}>
                  <div className="project-task-main">
                    <span className={`thread-status-badge ${sc}`}>
                      <span className={`thread-status-dot ${sc}`} />
                      {taskStatusLabel(task.status)}
                    </span>
                    <span className="project-task-title">{task.title}</span>
                    {task.priority !== 0 ? (
                      <span className="project-task-priority">P{task.priority}</span>
                    ) : null}
                  </div>
                  <div className="project-task-details">
                    <span className="project-task-prompt">{task.prompt}</span>
                  </div>
                  <div className="project-task-meta">
                    {task.branchName ? (
                      <span className="project-task-branch">{task.branchName}</span>
                    ) : null}
                    {task.errorMessage ? (
                      <span className="project-task-error">{task.errorMessage}</span>
                    ) : null}
                    <span className="project-task-time">{timeAgo(task.updatedAt)}</span>
                  </div>
                  <div className="project-task-actions">
                    {task.runId && project ? (
                      <Link
                        className="secondary-button"
                        to={`/agents/${project.agentId}/threads/${task.runId}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />
                        View Run
                      </Link>
                    ) : null}
                    {task.status === 'failed' ? (
                      <button
                        className="secondary-button"
                        disabled={retryingId === task.id}
                        onClick={() => void handleRetry(task.id)}
                        type="button"
                      >
                        <RotateCcw size={12} />
                        {retryingId === task.id ? 'Retrying...' : 'Retry'}
                      </button>
                    ) : null}
                    {task.status === 'pending' ? (
                      <button
                        className="icon-button kill-button"
                        disabled={deletingId === task.id}
                        onClick={() => void handleDelete(task.id)}
                        title="Delete task"
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Task form */}
      <div className="project-add-task">
        <h2 className="project-tasks-heading">Add Task</h2>
        <div className="project-add-task-form">
          <div className="form-section">
            <label className="form-label">Title</label>
            <input
              className="session-input"
              placeholder="Task title"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="form-section">
            <label className="form-label">Prompt</label>
            <textarea
              className="prompt-textarea"
              placeholder="What should the AI do for this task?"
              rows={4}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
            />
          </div>
          <div className="form-section">
            <label className="form-label">Priority (higher = first)</label>
            <input
              className="session-input project-priority-input"
              placeholder="0"
              type="number"
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
            />
          </div>
          {formError ? <p className="error-banner">{formError}</p> : null}
          <button
            className="primary-button new-thread-submit"
            disabled={isSubmitting || !newTitle.trim() || !newPrompt.trim()}
            onClick={() => void handleAddTask()}
            type="button"
          >
            {isSubmitting ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            {isSubmitting ? 'Creating...' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
