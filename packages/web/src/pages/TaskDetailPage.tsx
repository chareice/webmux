import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Send,
  StopCircle,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import {
  MAX_ATTACHMENTS,
  fileToBase64,
  formatDuration,
  repoName,
  timeAgo,
  toolIcon,
  toolLabel,
} from '../lib/utils.ts'
import type { DraftAttachment } from '../lib/utils.ts'
import type {
  Project,
  Task,
  TaskMessage,
  TaskStatus,
  TaskStep,
  RunEvent,
} from '@webmux/shared'

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

function taskStatusClass(status: TaskStatus): string {
  switch (status) {
    case 'pending': return 'muted'
    case 'dispatched': return 'warning'
    case 'running': return 'accent'
    case 'waiting': return 'warning'
    case 'completed': return 'success'
    case 'failed': return 'danger'
  }
}

function isTaskActive(status: TaskStatus): boolean {
  return status === 'dispatched' || status === 'running' || status === 'waiting'
}

/* ── Step Item (expandable) ─────────────────────── */

function StepItem({ step }: { step: TaskStep }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!step.detail

  return (
    <div className={`td-activity-item td-activity-${step.status} ${hasDetail ? 'td-activity-clickable' : ''}`}>
      <button
        className="td-activity-row"
        onClick={() => hasDetail && setExpanded(!expanded)}
        type="button"
        aria-expanded={hasDetail ? expanded : undefined}
        tabIndex={hasDetail ? 0 : -1}
      >
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
        {hasDetail && (
          <span className="td-activity-chevron">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>
      {expanded && step.detail && (
        <div className="td-activity-detail">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.detail}</ReactMarkdown>
        </div>
      )}
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

  items.sort((a, b) => a.timestamp - b.timestamp)

  const result: TimelineItem[] = []
  let currentStepGroup: TaskStep[] = []
  let groupTimestamp = 0

  for (const item of items) {
    if (item.type === 'step') {
      if (currentStepGroup.length === 0) groupTimestamp = item.timestamp
      currentStepGroup.push(item.data)
    } else {
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
  if (currentStepGroup.length > 0) {
    result.push({ type: 'step-group', data: currentStepGroup, timestamp: groupTimestamp })
  }

  return result
}

/* ── Task Detail Page ──────────────────────────── */

export function TaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [steps, setSteps] = useState<TaskStep[]>([])
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])

  const timelineRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset state when navigating between tasks
  useEffect(() => {
    setTask(null)
    setProject(null)
    setSteps([])
    setMessages([])
    setReplyText('')
    setAttachments(prev => {
      for (const a of prev) URL.revokeObjectURL(a.previewUrl)
      return []
    })
    setError(null)
    setIsLoading(true)
  }, [projectId, taskId])

  // Cleanup attachment ObjectURLs on unmount
  useEffect(() => {
    return () => {
      setAttachments(prev => {
        for (const a of prev) URL.revokeObjectURL(a.previewUrl)
        return []
      })
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!projectId || !taskId) return
    try {
      // Load project info
      const projRes = await fetchApi(`/api/projects/${projectId}`)
      if (!projRes.ok) throw new Error('Failed to load project')
      const projData = (await projRes.json()) as { project: Project; tasks: Task[] }
      setProject(projData.project)

      // Find the task
      const currentTask = projData.tasks.find(t => t.id === taskId)
      if (!currentTask) throw new Error('Task not found')
      setTask(currentTask)

      // Load steps and messages
      if (currentTask.status !== 'pending') {
        const [stepsRes, msgsRes] = await Promise.all([
          fetchApi(`/api/projects/${projectId}/tasks/${taskId}/steps`),
          fetchApi(`/api/projects/${projectId}/tasks/${taskId}/messages`),
        ])
        if (stepsRes.ok) {
          const stepsData = await stepsRes.json() as { steps: TaskStep[] }
          setSteps(stepsData.steps)
        }
        if (msgsRes.ok) {
          const msgsData = await msgsRes.json() as { messages: TaskMessage[] }
          setMessages(msgsData.messages)
        }
      } else {
        // Explicitly clear for pending tasks
        setSteps([])
        setMessages([])
      }

      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, taskId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // WebSocket for real-time updates
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
          if (data.type === 'task-status' && data.task.id === taskId) {
            setTask(data.task)
          }
          if (data.type === 'task-step' && data.taskId === taskId) {
            setSteps(prev => {
              const existing = prev.findIndex(s => s.id === data.step.id)
              if (existing >= 0) {
                const updated = [...prev]
                updated[existing] = data.step
                return updated
              }
              return [...prev, data.step]
            })
          }
          if (data.type === 'task-message' && data.taskId === taskId) {
            setMessages(prev => {
              if (prev.some(m => m.id === data.message.id)) return prev
              return [...prev, data.message]
            })
          }
        } catch {
          // ignore parse errors
        }
      },
    })

    return () => controller.dispose()
  }, [projectId, taskId, token])

  // Auto-scroll on new timeline items
  useEffect(() => {
    if (timelineRef.current) {
      setTimeout(() => {
        timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' })
      }, 50)
    }
  }, [steps.length, messages.length])

  // Auto-refresh for active tasks
  useEffect(() => {
    if (!task || !isTaskActive(task.status)) return
    const interval = setInterval(() => { void loadData() }, 5000)
    return () => clearInterval(interval)
  }, [task, loadData])

  // Guard against missing params (after all hooks)
  if (!projectId || !taskId) {
    return (
      <div className="task-detail-page">
        <div className="threads-empty">
          <h2>Invalid URL</h2>
          <p>Missing project or task ID.</p>
        </div>
      </div>
    )
  }

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const remaining = MAX_ATTACHMENTS - attachments.length
    const toAdd = Array.from(files).slice(0, remaining)
    const newAttachments: DraftAttachment[] = []
    for (const file of toAdd) {
      if (!file.type.startsWith('image/')) continue
      const base64 = await fileToBase64(file)
      newAttachments.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), base64 })
    }
    setAttachments(prev => [...prev, ...newAttachments])
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const removed = prev.find(a => a.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter(a => a.id !== id)
    })
  }

  const handleSendReply = async () => {
    if ((!replyText.trim() && attachments.length === 0) || !task) return
    setSendingReply(true)
    try {
      const uploadAttachments = attachments.map(a => ({
        id: a.id,
        name: a.file.name,
        mimeType: a.file.type,
        sizeBytes: a.file.size,
        base64: a.base64,
      }))
      const body: { content: string; attachments?: typeof uploadAttachments } = { content: replyText.trim() || '(image)' }
      if (uploadAttachments.length > 0) body.attachments = uploadAttachments

      const res = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to send message')
      }
      const data = await res.json() as { message: TaskMessage }
      setMessages(prev => [...prev, data.message])
      setReplyText('')
      for (const a of attachments) URL.revokeObjectURL(a.previewUrl)
      setAttachments([])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSendingReply(false)
    }
  }

  const handleRetry = async () => {
    if (!task) return
    try {
      setRetrying(true)
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}/retry`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to retry task')
      const data = (await res.json()) as { task: Task }
      setTask(data.task)
      setSteps([])
      setMessages([])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  const handleMarkComplete = async () => {
    if (!task) return
    try {
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}/complete`, {
        method: 'POST',
      })
      if (res.ok) {
        setTask(prev => prev ? { ...prev, status: 'completed' as TaskStatus } : prev)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDelete = async () => {
    if (!task) return
    const label = isTaskActive(task.status)
      ? 'This will stop the running task and remove it.'
      : 'This will remove the task.'
    if (!confirm(label)) return

    try {
      const res = await fetchApi(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete task')
      navigate(`/projects/${projectId}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const hasContent = replyText.trim().length > 0 || attachments.length > 0

  if (isLoading) {
    return (
      <div className="task-detail-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading task...</span>
        </div>
      </div>
    )
  }

  if (!task || !project) {
    return (
      <div className="task-detail-page">
        <div className="threads-empty">
          <h2>Task not found</h2>
          {error ? <p>{error}</p> : null}
        </div>
      </div>
    )
  }

  const sc = taskStatusClass(task.status)
  const active = isTaskActive(task.status)
  const timeline = buildUnifiedTimeline(messages, steps, task)

  return (
    <div className="task-detail-page">
      {/* Mobile header — single compact row */}
      <div className="task-detail-header task-detail-header--mobile">
        <button
          className="icon-button"
          onClick={() => navigate(`/projects/${projectId}`)}
          type="button"
          aria-label="Back to project"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="task-mobile-info">
          <span className="task-mobile-title">{task.title}</span>
        </span>
        <span className={`thread-status-badge ${sc}`}>
          <span className={`thread-status-dot ${sc}`} />
          {taskStatusLabel(task.status)}
        </span>
      </div>

      {/* Desktop two-column layout */}
      <div className="task-detail-body">
        {/* Left sidebar (desktop only) */}
        <aside className="task-sidebar">
          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Status</span>
            <span className={`thread-status-badge ${sc}`}>
              <span className={`thread-status-dot ${sc}`} />
              {taskStatusLabel(task.status)}
            </span>
          </div>

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Tool</span>
            <div className="thread-sidebar-row">
              <span className={`thread-tool-badge ${task.tool || project.defaultTool || 'claude'}`}>
                {toolIcon(task.tool || project.defaultTool || 'claude')}
              </span>
              <span className="thread-sidebar-value">
                {toolLabel(task.tool || project.defaultTool || 'claude')}
              </span>
            </div>
          </div>

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Project</span>
            <span className="thread-sidebar-value">{project.name}</span>
            <span className="thread-sidebar-detail">{repoName(project.repoPath)}</span>
          </div>

          {task.branchName && (
            <div className="thread-sidebar-section">
              <span className="thread-sidebar-label">Branch</span>
              <span className="thread-sidebar-value mono">{task.branchName}</span>
            </div>
          )}

          {task.priority !== 0 && (
            <div className="thread-sidebar-section">
              <span className="thread-sidebar-label">Priority</span>
              <span className="thread-sidebar-value">P{task.priority}</span>
            </div>
          )}

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Created</span>
            <span className="thread-sidebar-detail">{timeAgo(task.createdAt)}</span>
          </div>

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Updated</span>
            <span className="thread-sidebar-detail">{timeAgo(task.updatedAt)}</span>
          </div>

          {/* Prompt/description if different from title */}
          {task.prompt && task.prompt !== task.title && (
            <div className="thread-sidebar-section">
              <span className="thread-sidebar-label">Description</span>
              <p className="thread-sidebar-summary">{task.prompt}</p>
            </div>
          )}

          <div className="thread-sidebar-actions">
            {active && (
              <button
                className="secondary-button thread-interrupt-button"
                onClick={() => void handleMarkComplete()}
                type="button"
              >
                <StopCircle size={14} />
                Mark Complete
              </button>
            )}
            {task.status !== 'completed' && task.status !== 'pending' && !active && (
              <button
                className="secondary-button task-complete-button"
                onClick={() => void handleMarkComplete()}
                type="button"
              >
                <Check size={14} />
                Mark Complete
              </button>
            )}
            {task.status === 'failed' && (
              <button
                className="secondary-button"
                disabled={retrying}
                onClick={() => void handleRetry()}
                type="button"
              >
                <RotateCcw size={14} />
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
            <button
              className="secondary-button thread-delete-button"
              onClick={() => void handleDelete()}
              type="button"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="task-detail-main">
          {/* Timeline */}
          <div className="task-detail-timeline" ref={timelineRef}>
            {timeline.length === 0 && task.status === 'pending' && (
              <div className="thread-detail-empty">
                <p>Task is pending. Waiting for agent to pick it up...</p>
              </div>
            )}

            {timeline.length === 0 && active && (
              <div className="thread-detail-empty">
                <p>Task started. Waiting for timeline events...</p>
              </div>
            )}

            {timeline.map((item, i) => {
              if (item.type === 'message') {
                const msg = item.data as TaskMessage
                const isAgent = msg.role === 'agent'
                return (
                  <div key={msg.id} className={`chat-bubble ${isAgent ? 'assistant' : 'user'}`}>
                    <div className="chat-role">
                      {isAgent ? (
                        <span className="chat-role-icon"><Bot size={12} /></span>
                      ) : (
                        <span className="chat-role-icon"><User size={12} /></span>
                      )}
                      {isAgent ? 'Agent' : 'You'}
                    </div>
                    <div className="chat-content message-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    <div className="chat-meta">{timeAgo(msg.createdAt)}</div>
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
                  <div key={`summary-${i}`} className="task-summary-box">
                    <h3 className="task-summary-label">Summary</h3>
                    <div className="task-summary-text message-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                    </div>
                  </div>
                )
              }
              if (item.type === 'error') {
                return (
                  <div key={`error-${i}`} className="task-timeline-error">{item.text}</div>
                )
              }
              return null
            })}
          </div>

          {/* Footer */}
          <div className="task-detail-footer">
            {/* Mobile action buttons */}
            {active && (
              <button
                className="secondary-button thread-interrupt-button task-action-button--mobile"
                onClick={() => void handleMarkComplete()}
                type="button"
              >
                <StopCircle size={14} />
                Mark Complete
              </button>
            )}

            {/* Attachment thumbnails */}
            {attachments.length > 0 && (
              <div className="composer-attachments">
                {attachments.map(a => (
                  <div key={a.id} className="attachment-thumb attachment-thumb--small">
                    <img src={a.previewUrl} alt={a.file.name} className="attachment-thumb-img" />
                    <button
                      className="attachment-thumb-remove"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Remove attachment ${a.file.name}`}
                      type="button"
                    >
                      <X size={10} />
                    </button>
                    <span className="attachment-thumb-name">{a.file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="thread-composer">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="visually-hidden"
                onChange={(e) => {
                  void handleFilesSelected(e.target.files)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              />
              <button
                className="composer-icon-btn"
                disabled={attachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
                title={`Attach images (${attachments.length}/${MAX_ATTACHMENTS})`}
                type="button"
              >
                <ImagePlus size={18} />
              </button>
              <textarea
                className="thread-composer-input"
                placeholder={active ? 'Send a message to the agent...' : 'Message this task...'}
                rows={1}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSendReply()
                  }
                }}
                onPaste={(e) => {
                  const files = e.clipboardData?.files
                  if (files?.length) { e.preventDefault(); void handleFilesSelected(files) }
                }}
                disabled={sendingReply}
              />
              <button
                className="composer-send-btn"
                disabled={sendingReply || !hasContent}
                onClick={() => void handleSendReply()}
                type="button"
                title="Send message (⌘+Enter)"
              >
                {sendingReply ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              </button>
            </div>
            {error ? <p className="error-banner thread-error">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
