import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Plus,
  LoaderCircle,
  RotateCcw,
  Trash2,
  ExternalLink,
  X,
  Check,
  CircleAlert,
  Send,
  Bot,
  User,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import type {
  Project,
  Task,
  TaskMessage,
  TaskStatus,
  TaskStep,
  RunEvent,
} from '@webmux/shared'

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['dispatched', 'running', 'waiting']
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
    case 'waiting': return 'Waiting'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}

/* ── Status Circle Component ────────────────────── */

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


/* ── Step Item (expandable) ─────────────────────── */

function StepItem({ step }: { step: TaskStep }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!step.detail

  return (
    <div className={`td-activity-item td-activity-${step.status} ${hasDetail ? 'td-activity-clickable' : ''}`}>
      <div className="td-activity-row" onClick={() => hasDetail && setExpanded(!expanded)}>
        <span className="td-activity-icon">
          {step.status === 'completed' ? (
            <Check size={12} />
          ) : step.status === 'running' ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <CircleAlert size={12} />
          )}
        </span>
        <span className="td-activity-label">{step.label}</span>
        {step.durationMs != null && (
          <span className="td-activity-duration">{formatDuration(step.durationMs)}</span>
        )}
      </div>
      {expanded && step.detail && (
        <div className="td-activity-detail">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.detail}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

/* ── Modal Overlay ──────────────────────────────── */

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

/* ── Unified Timeline Builder ─────────────────── */

type TimelineItem =
  | { type: 'message'; data: TaskMessage; timestamp: number }
  | { type: 'step-group'; data: TaskStep[]; timestamp: number }
  | { type: 'summary'; text: string; timestamp: number }
  | { type: 'error'; text: string; timestamp: number }

function buildUnifiedTimeline(
  messages: TaskMessage[],
  steps: TaskStep[],
  task: Task,
): TimelineItem[] {
  const items: Array<{ type: 'message' | 'step' | 'summary' | 'error'; data: any; timestamp: number }> = []

  for (const msg of messages) {
    items.push({ type: 'message', data: msg, timestamp: msg.createdAt })
  }
  for (const step of steps) {
    items.push({ type: 'step', data: step, timestamp: step.createdAt })
  }
  if (task.summary) {
    items.push({ type: 'summary', data: task.summary, timestamp: task.updatedAt })
  }
  if (task.errorMessage) {
    items.push({ type: 'error', data: task.errorMessage, timestamp: task.updatedAt })
  }

  // Sort by timestamp
  items.sort((a, b) => a.timestamp - b.timestamp)

  // Group consecutive steps together
  const result: TimelineItem[] = []
  let currentStepGroup: TaskStep[] = []
  let groupTimestamp = 0

  for (const item of items) {
    if (item.type === 'step') {
      if (currentStepGroup.length === 0) groupTimestamp = item.timestamp
      currentStepGroup.push(item.data)
    } else {
      // Flush step group
      if (currentStepGroup.length > 0) {
        result.push({ type: 'step-group', data: currentStepGroup, timestamp: groupTimestamp })
        currentStepGroup = []
      }
      if (item.type === 'message') {
        result.push({ type: 'message', data: item.data, timestamp: item.timestamp })
      } else if (item.type === 'summary') {
        result.push({ type: 'summary', text: item.data, timestamp: item.timestamp })
      } else if (item.type === 'error') {
        result.push({ type: 'error', text: item.data, timestamp: item.timestamp })
      }
    }
  }
  // Flush remaining steps
  if (currentStepGroup.length > 0) {
    result.push({ type: 'step-group', data: currentStepGroup, timestamp: groupTimestamp })
  }

  return result
}

/* ── Task Detail Modal ──────────────────────────── */

function TaskDetailModal({
  task,
  steps,
  messages,
  onClose,
  onDelete,
  onRetry,
  onMarkComplete,
  retrying,
  replyText,
  setReplyText,
  sendingReply,
  onSendReply,
}: {
  task: Task
  steps: TaskStep[]
  messages: TaskMessage[]
  onClose: () => void
  onDelete: (taskId: string) => void
  onRetry: (taskId: string) => void
  onMarkComplete: (taskId: string) => void
  retrying: boolean
  replyText: string
  setReplyText: (v: string) => void
  sendingReply: boolean
  onSendReply: () => void
}) {
  const chatRef = useRef<HTMLDivElement>(null)

  // Build unified timeline
  const timeline = buildUnifiedTimeline(messages, steps, task)

  // Auto-scroll on new items
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [timeline.length])

  return (
    <ModalOverlay onClose={onClose}>
      {/* Header: status + title + close */}
      <div className="td-modal-header">
        <div className="td-modal-title-row">
          <StatusCircle status={task.status} size={22} />
          <h2 className="td-modal-title">{task.title}</h2>
        </div>
        <button className="td-modal-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      {/* Compact metadata bar */}
      <div className="td-modal-meta-bar">
        <span className={`td-status-badge-sm td-status-${task.status}`}>
          {taskStatusLabel(task.status)}
        </span>
        {task.priority !== 0 && <span className="td-meta-pill">P{task.priority}</span>}
        {task.branchName && <span className="td-meta-pill">{task.branchName}</span>}
        <span className="td-meta-time">{timeAgo(task.createdAt)}</span>
      </div>

      {/* Unified timeline */}
      <div className="td-timeline" ref={chatRef}>
        {/* Show prompt/description at top if different from title */}
        {task.prompt && task.prompt !== task.title && (
          <div className="td-timeline-prompt">{task.prompt}</div>
        )}

        {timeline.length === 0 && task.status === 'pending' && (
          <div className="td-timeline-empty">Task is pending...</div>
        )}

        {timeline.map((item, i) => {
          if (item.type === 'message') {
            const msg = item.data as TaskMessage
            const isAgent = msg.role === 'agent'
            return (
              <div key={msg.id} className={`td-chat-bubble ${isAgent ? 'agent' : 'user'}`}>
                <div className="td-chat-bubble-header">
                  {isAgent ? <Bot size={14} /> : <User size={14} />}
                  <span className="td-chat-bubble-role">{isAgent ? 'Agent' : 'You'}</span>
                </div>
                <div className="td-chat-bubble-content td-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
                <div className="td-chat-bubble-meta">{timeAgo(msg.createdAt)}</div>
              </div>
            )
          }
          if (item.type === 'step-group') {
            const stepsInGroup = item.data as TaskStep[]
            return (
              <div key={`sg-${i}`} className="td-activity-group">
                {stepsInGroup.map(step => (
                  <StepItem key={step.id} step={step} />
                ))}
              </div>
            )
          }
          if (item.type === 'summary') {
            return (
              <div key={`summary-${i}`} className="td-summary-box">
                <h3 className="td-detail-label">Summary</h3>
                <p className="td-summary-text">{item.text}</p>
              </div>
            )
          }
          if (item.type === 'error') {
            return (
              <div key={`error-${i}`} className="td-timeline-error">{item.text}</div>
            )
          }
          return null
        })}

        {task.status === 'waiting' && (
          <div className="td-waiting-indicator">Waiting for your reply...</div>
        )}

        {(task.status === 'dispatched' || task.status === 'running') && (
          <div className="td-thinking-indicator">
            <LoaderCircle size={14} className="spin" />
            <span>Agent is working...</span>
          </div>
        )}
      </div>

      {/* Bottom: input + actions */}
      <div className="td-modal-bottom">
        <div className="td-chat-input-row">
          <input
            className="td-chat-input"
            placeholder="Type a message..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && replyText.trim()) { e.preventDefault(); onSendReply() } }}
            disabled={sendingReply}
          />
          <button
            className="td-chat-send"
            disabled={!replyText.trim() || sendingReply}
            onClick={onSendReply}
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="td-modal-actions-row">
          {task.status !== 'completed' && task.status !== 'pending' && (
            <button className="td-btn td-btn-success td-btn-sm" onClick={() => onMarkComplete(task.id)} type="button">
              <Check size={14} /> Complete
            </button>
          )}
          {task.status === 'failed' && (
            <button className="td-btn td-btn-secondary td-btn-sm" disabled={retrying} onClick={() => onRetry(task.id)} type="button">
              <RotateCcw size={14} /> Retry
            </button>
          )}
          <button className="td-btn td-btn-danger td-btn-sm" onClick={() => onDelete(task.id)} type="button">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/* ── Add Task Modal ─────────────────────────────── */

function AddTaskModal({
  onClose,
  onSubmit,
  isSubmitting,
  formError,
}: {
  onClose: () => void
  onSubmit: (title: string, description: string, priority: number) => void
  isSubmitting: boolean
  formError: string | null
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('0')
  const [showPriority, setShowPriority] = useState(false)

  const handleSubmit = () => {
    if (!title.trim()) return
    const prio = parseInt(priority, 10)
    onSubmit(title.trim(), description.trim(), isNaN(prio) ? 0 : prio)
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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [taskSteps, setTaskSteps] = useState<Record<string, TaskStep[]>>({})
  const [taskMessages, setTaskMessages] = useState<Record<string, TaskMessage[]>>({})
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

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

      // Load steps and messages for non-pending tasks
      for (const task of data.tasks) {
        if (task.status !== 'pending') {
          const stepsRes = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}/steps`)
          if (stepsRes.ok) {
            const stepsData = await stepsRes.json() as { steps: TaskStep[] }
            setTaskSteps(prev => ({ ...prev, [task.id]: stepsData.steps }))
          }
          const msgsRes = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}/messages`)
          if (msgsRes.ok) {
            const msgsData = await msgsRes.json() as { messages: TaskMessage[] }
            setTaskMessages(prev => ({ ...prev, [task.id]: msgsData.messages }))
          }
        }
      }
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
            // Update selected task if it's the one being viewed
            setSelectedTask((prev) => (prev && prev.id === data.task.id ? data.task : prev))
          }
          if (data.type === 'task-step') {
            setTaskSteps(prev => {
              const steps = prev[data.taskId] || []
              const existing = steps.findIndex(s => s.id === data.step.id)
              if (existing >= 0) {
                const updated = [...steps]
                updated[existing] = data.step
                return { ...prev, [data.taskId]: updated }
              }
              return { ...prev, [data.taskId]: [...steps, data.step] }
            })
          }
          if (data.type === 'task-message') {
            setTaskMessages(prev => {
              const msgs = prev[data.taskId] || []
              // Avoid duplicates
              if (msgs.some(m => m.id === data.message.id)) return prev
              return { ...prev, [data.taskId]: [...msgs, data.message] }
            })
          }
        } catch {
          // ignore parse errors
        }
      },
    })

    return () => controller.dispose()
  }, [projectId, token])

  const handleAddTask = async (title: string, description: string, priority: number) => {
    setFormError(null)
    setIsSubmitting(true)
    try {
      const body: { title: string; prompt?: string; priority?: number } = { title }
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
      setSelectedTask(data.task)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRetryingId(null)
    }
  }

  const handleMarkComplete = async (taskId: string) => {
    try {
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${taskId}/complete`, {
        method: 'POST',
      })
      if (res.ok) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed' as TaskStatus } : t))
        setSelectedTask(prev => prev && prev.id === taskId ? { ...prev, status: 'completed' as TaskStatus } : prev)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedTask) return
    setSendingReply(true)
    try {
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${selectedTask.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText.trim() }),
      })
      if (res.ok) {
        const data = await res.json() as { message: TaskMessage }
        setTaskMessages(prev => ({
          ...prev,
          [selectedTask.id]: [...(prev[selectedTask.id] || []), data.message]
        }))
        setReplyText('')
      }
    } finally {
      setSendingReply(false)
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
      // Close detail modal if the deleted task was open
      if (selectedTask?.id === deleteTargetId) setSelectedTask(null)
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
              onClick={() => setSelectedTask(task)}
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
                    onClick={(e) => { e.stopPropagation(); void handleRetry(task.id) }}
                    title="Retry"
                    type="button"
                  >
                    <RotateCcw size={14} />
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
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          steps={taskSteps[selectedTask.id] || []}
          messages={taskMessages[selectedTask.id] || []}
          onClose={() => { setSelectedTask(null); setReplyText('') }}
          onDelete={handleDeleteRequest}
          onRetry={(id) => void handleRetry(id)}
          onMarkComplete={(id) => void handleMarkComplete(id)}
          retrying={retryingId === selectedTask.id}
          replyText={replyText}
          setReplyText={setReplyText}
          sendingReply={sendingReply}
          onSendReply={() => void handleSendReply()}
        />
      )}

      {showAddModal && (
        <AddTaskModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(t, d, p) => void handleAddTask(t, d, p)}
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
