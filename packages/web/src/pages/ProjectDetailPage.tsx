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
  Check,
  CircleAlert,
  Circle,
  ChevronRight,
  ChevronDown,
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
  RunTurnDetail,
  RunTimelineEvent,
  TodoEntry,
  TodoEntryStatus,
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
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth="1.5" />
        </svg>
      )
    case 'dispatched':
      return (
        <svg width={size} height={size} className="td-status-circle">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--warning)" strokeWidth="1.5" />
        </svg>
      )
    case 'running':
      return (
        <svg width={size} height={size} className="td-status-circle td-status-pulse">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent)" strokeWidth="2" />
        </svg>
      )
    case 'waiting':
      return (
        <svg width={size} height={size} className="td-status-circle">
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
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--danger)" strokeWidth="1.5" />
          <line x1={cx - r * 0.35} y1={cy - r * 0.35} x2={cx + r * 0.35} y2={cy + r * 0.35} stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={cx + r * 0.35} y1={cy - r * 0.35} x2={cx - r * 0.35} y2={cy + r * 0.35} stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
  }
}

/* ── Timeline Item Component ───────────────────── */

function TodoIcon({ status }: { status: TodoEntryStatus }) {
  switch (status) {
    case 'completed':
      return <Check size={14} className="td-timeline-todo-icon td-timeline-todo-icon-completed" />
    case 'in_progress':
      return <LoaderCircle size={14} className="td-timeline-todo-icon td-timeline-todo-icon-in_progress spin" />
    default:
      return <Circle size={14} className="td-timeline-todo-icon td-timeline-todo-icon-pending" />
  }
}

function TimelineItem({ item }: { item: RunTimelineEvent }) {
  const [expanded, setExpanded] = useState(false)

  switch (item.type) {
    case 'message': {
      const roleLabel = item.role === 'assistant' ? 'Assistant' : item.role === 'user' ? 'User' : 'System'
      return (
        <div className="td-timeline-item">
          <div className={`td-timeline-msg td-timeline-msg-${item.role}`}>
            <div className="td-timeline-msg-role">{roleLabel}</div>
            {item.text}
          </div>
        </div>
      )
    }

    case 'command': {
      const hasOutput = item.output && item.output.length > 0
      return (
        <div className="td-timeline-item">
          <div className="td-timeline-cmd">
            <div
              className="td-timeline-cmd-header"
              onClick={() => hasOutput && setExpanded(!expanded)}
            >
              {hasOutput && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              <span>{item.command}</span>
              <span className={`td-timeline-cmd-status td-timeline-cmd-status-${item.status}`}>
                {item.status}
              </span>
            </div>
            {expanded && hasOutput && (
              <div className="td-timeline-cmd-output">{item.output}</div>
            )}
          </div>
        </div>
      )
    }

    case 'activity': {
      return (
        <div className="td-timeline-item">
          <div className="td-timeline-activity">
            <span className={`td-timeline-activity-dot td-timeline-activity-dot-${item.status}`} />
            <span className="td-timeline-activity-label">{item.label}</span>
            {item.detail && <span className="td-timeline-activity-detail">{item.detail}</span>}
          </div>
        </div>
      )
    }

    case 'todo': {
      return (
        <div className="td-timeline-item">
          <div className="td-timeline-todo">
            {item.items.map((entry: TodoEntry, i: number) => (
              <div key={i} className="td-timeline-todo-item">
                <TodoIcon status={entry.status} />
                <span className={entry.status === 'completed' ? 'td-timeline-todo-text-completed' : ''}>
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }
  }
}

/* ── Run Timeline Component ────────────────────── */

function RunTimeline({ agentId, runId, token }: { agentId: string; runId: string; token: string }) {
  const [turns, setTurns] = useState<RunTurnDetail[]>([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Fetch run data on mount
  useEffect(() => {
    fetchApi(`/api/agents/${agentId}/threads/${runId}`)
      .then((res) => res.json())
      .then((data: { turns: RunTurnDetail[] }) => {
        setTurns(data.turns)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [agentId, runId])

  // WebSocket for real-time updates
  useEffect(() => {
    if (!token) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(
          `${wsProtocol}//${window.location.host}/ws/thread?threadId=${encodeURIComponent(runId)}&token=${encodeURIComponent(token)}`,
        )
      },
      onMessage(event) {
        try {
          const data = JSON.parse(event.data) as RunEvent
          if (data.type === 'run-item' && data.runId === runId) {
            setTurns((prev) => {
              const turnIdx = prev.findIndex((t) => t.id === data.turnId)
              if (turnIdx < 0) return prev
              const updated = [...prev]
              const turn = { ...updated[turnIdx] }
              const existingIdx = turn.items.findIndex((it) => it.id === data.item.id)
              if (existingIdx >= 0) {
                turn.items = [...turn.items]
                turn.items[existingIdx] = data.item
              } else {
                turn.items = [...turn.items, data.item]
              }
              updated[turnIdx] = turn
              return updated
            })
          }
          if (data.type === 'run-turn' && data.runId === runId) {
            setTurns((prev) => {
              const existing = prev.findIndex((t) => t.id === data.turn.id)
              if (existing >= 0) {
                const updated = [...prev]
                updated[existing] = { ...updated[existing], ...data.turn }
                return updated
              }
              return [...prev, { ...data.turn, items: [] }]
            })
          }
        } catch {
          // ignore parse errors
        }
      },
    })

    return () => controller.dispose()
  }, [runId, token])

  // Auto-scroll when new items arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  if (loading) {
    return (
      <div className="td-timeline-loading">
        <LoaderCircle className="spin" size={16} />
        <span>Loading run data...</span>
      </div>
    )
  }

  const allItems = turns.flatMap((turn) => turn.items)

  if (allItems.length === 0) {
    return <p className="td-muted-placeholder">No timeline events yet.</p>
  }

  return (
    <div className="td-run-timeline">
      {allItems.map((item) => (
        <TimelineItem key={item.id} item={item} />
      ))}
      <div ref={bottomRef} />
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

/* ── Chat View Component ───────────────────────── */

type ChatItem =
  | { type: 'message'; data: TaskMessage; timestamp: number }
  | { type: 'step'; data: TaskStep; timestamp: number }
  | { type: 'summary'; text: string; timestamp: number }
  | { type: 'error'; text: string; timestamp: number }

function buildChatTimeline(
  messages: TaskMessage[],
  steps: TaskStep[],
  task: Task,
): ChatItem[] {
  const items: ChatItem[] = []

  for (const msg of messages) {
    items.push({ type: 'message', data: msg, timestamp: msg.createdAt })
  }

  for (const step of steps) {
    items.push({ type: 'step', data: step, timestamp: step.createdAt })
  }

  if (task.summary) {
    items.push({ type: 'summary', text: task.summary, timestamp: task.updatedAt })
  }

  if (task.errorMessage) {
    items.push({ type: 'error', text: task.errorMessage, timestamp: task.updatedAt })
  }

  items.sort((a, b) => a.timestamp - b.timestamp)
  return items
}

function ChatView({
  task,
  messages,
  steps,
}: {
  task: Task
  messages: TaskMessage[]
  steps: TaskStep[]
}) {
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const timeline = buildChatTimeline(messages, steps, task)

  // Auto-scroll when new items arrive
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [timeline.length])

  // Group consecutive steps together
  const grouped: (ChatItem | { type: 'step-group'; items: ChatItem[] })[] = []
  for (const item of timeline) {
    if (item.type === 'step') {
      const last = grouped[grouped.length - 1]
      if (last && 'items' in last && last.type === 'step-group') {
        last.items.push(item)
      } else {
        grouped.push({ type: 'step-group', items: [item] })
      }
    } else {
      grouped.push(item)
    }
  }

  return (
    <div className="td-chat-wrapper">
      <div className="td-chat-container">
        {grouped.length === 0 && (
          <p className="td-muted-placeholder">No execution data yet.</p>
        )}
        {grouped.map((entry, i) => {
          if ('items' in entry && entry.type === 'step-group') {
            return (
              <div key={`sg-${i}`} className="td-chat-activity-group">
                {entry.items.map((stepItem) => {
                  const step = (stepItem as { type: 'step'; data: TaskStep }).data
                  return (
                    <div key={step.id} className="td-chat-activity-item">
                      <span className="td-step-icon">
                        {step.status === 'completed' ? (
                          <Check size={12} />
                        ) : step.status === 'running' ? (
                          <LoaderCircle size={12} className="spin" />
                        ) : (
                          <CircleAlert size={12} />
                        )}
                      </span>
                      <span className="td-chat-activity-label">{step.label}</span>
                      {step.durationMs != null && (
                        <span className="td-chat-activity-duration">{formatDuration(step.durationMs)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          }

          const item = entry as ChatItem
          switch (item.type) {
            case 'message': {
              const isAgent = item.data.role === 'agent'
              return (
                <div key={item.data.id} className={`td-chat-bubble ${isAgent ? 'agent' : 'user'}`}>
                  <div className="td-chat-bubble-header">
                    {isAgent ? <Bot size={14} /> : <User size={14} />}
                    <span className="td-chat-bubble-role">{isAgent ? 'Agent' : 'You'}</span>
                  </div>
                  <div className="td-chat-bubble-content">{item.data.content}</div>
                  <div className="td-chat-bubble-meta">{timeAgo(item.data.createdAt)}</div>
                </div>
              )
            }
            case 'summary':
              return (
                <div key={`summary-${i}`} className="td-summary-box">
                  <h3 className="td-detail-label">Summary</h3>
                  <p className="td-summary-text">{item.text}</p>
                </div>
              )
            case 'error':
              return (
                <div key={`error-${i}`} className="td-error-box">
                  <CircleAlert size={14} />
                  <span>{item.text}</span>
                </div>
              )
            default:
              return null
          }
        })}
        <div ref={chatBottomRef} />
      </div>
    </div>
  )
}

/* ── Task Detail Modal ──────────────────────────── */

function TaskDetailModal({
  task,
  steps,
  messages,
  project,
  token,
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
  project: Project
  token: string | null
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
  const hasExecution = steps.length > 0 || messages.length > 0 || task.summary || task.errorMessage || task.runId
  const [activeTab, setActiveTab] = useState<'details' | 'execution'>(
    hasExecution ? 'execution' : 'details',
  )

  return (
    <ModalOverlay onClose={onClose}>
      {/* Header */}
      <div className="td-modal-header">
        <div className="td-modal-title-row">
          <StatusCircle status={task.status} size={22} />
          <h2 className="td-modal-title">{task.title}</h2>
        </div>
        <button className="td-modal-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="td-modal-tabs">
        <button
          className={`td-modal-tab ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
          type="button"
        >
          Details
        </button>
        <button
          className={`td-modal-tab ${activeTab === 'execution' ? 'active' : ''}`}
          onClick={() => setActiveTab('execution')}
          type="button"
        >
          Execution
        </button>
      </div>

      {/* Tab content */}
      <div className="td-modal-body">
        {activeTab === 'details' && (
          <div className="td-tab-details">
            {/* Prompt / description */}
            <div className="td-detail-section">
              <h3 className="td-detail-label">Description</h3>
              {task.prompt && task.prompt !== task.title ? (
                <p className="td-detail-text">{task.prompt}</p>
              ) : (
                <p className="td-detail-text td-muted-placeholder">No description</p>
              )}
            </div>

            {/* Metadata */}
            <div className="td-detail-section">
              <h3 className="td-detail-label">Metadata</h3>
              <div className="td-metadata-grid">
                <span className="td-meta-key">Status</span>
                <span className={`td-status-badge td-status-${task.status}`}>
                  {taskStatusLabel(task.status)}
                </span>

                {task.priority !== 0 && (
                  <>
                    <span className="td-meta-key">Priority</span>
                    <span className="td-meta-value">{task.priority}</span>
                  </>
                )}

                {task.branchName && (
                  <>
                    <span className="td-meta-key">Branch</span>
                    <span className="td-meta-value td-branch-name">{task.branchName}</span>
                  </>
                )}

                <span className="td-meta-key">Created</span>
                <span className="td-meta-value">{timeAgo(task.createdAt)}</span>

                <span className="td-meta-key">Updated</span>
                <span className="td-meta-value">{timeAgo(task.updatedAt)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="td-detail-actions">
              {task.status !== 'completed' && task.status !== 'pending' && (
                <button
                  className="td-btn td-btn-success"
                  onClick={() => onMarkComplete(task.id)}
                  type="button"
                >
                  <Check size={14} />
                  Mark Complete
                </button>
              )}
              <button
                className="td-btn td-btn-danger"
                onClick={() => onDelete(task.id)}
                type="button"
              >
                <Trash2 size={14} />
                Delete
              </button>
              {task.status === 'failed' && (
                <button
                  className="td-btn td-btn-secondary"
                  disabled={retrying}
                  onClick={() => onRetry(task.id)}
                  type="button"
                >
                  <RotateCcw size={14} />
                  {retrying ? 'Retrying...' : 'Retry'}
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'execution' && (
          <div className="td-tab-execution">
            {messages.length > 0 || steps.length > 0 ? (
              <ChatView
                task={task}
                messages={messages}
                steps={steps}
              />
            ) : task.runId && token ? (
              <RunTimeline agentId={project.agentId} runId={task.runId} token={token} />
            ) : (
              <p className="td-muted-placeholder">No execution data yet.</p>
            )}

            {/* Input always visible at bottom of execution tab */}
            {task.status !== 'pending' && (
              <div className="td-chat-input-area">
                {task.status === 'waiting' && (
                  <div className="td-waiting-indicator">Agent is waiting for your reply...</div>
                )}
                <div className="td-chat-input-row">
                  <input
                    className="td-chat-input"
                    placeholder="Type a message..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && replyText.trim()) onSendReply() }}
                    disabled={sendingReply}
                  />
                  <button
                    className="td-btn td-btn-primary td-chat-send"
                    disabled={!replyText.trim() || sendingReply}
                    onClick={onSendReply}
                    type="button"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
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
          project={project}
          token={token}
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
