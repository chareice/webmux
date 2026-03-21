import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Plus,
  FolderGit2,
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
  ImagePlus,
  ChevronDown,
  Pencil,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import type {
  Project,
  AgentInfo,
  Task,
  TaskMessage,
  TaskStatus,
  TaskStep,
  RunEvent,
  ProjectAction,
  RunTool,
} from '@webmux/shared'

/* ── Constants ─────────────────────────────────── */

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['dispatched', 'running', 'waiting']
const AUTO_REFRESH_INTERVAL = 5000
const MAX_ATTACHMENTS = 4

/* ── Types ─────────────────────────────────────── */

interface DraftAttachment {
  id: string
  file: File
  previewUrl: string
  base64: string
}

/* ── Helpers ───────────────────────────────────── */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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

function repoName(repoPath: string): string {
  const parts = repoPath.split('/')
  return parts[parts.length - 1] || repoPath
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

/* ── Task Detail Modal ──────────────────────────── */

function TaskDetailModal({
  task,
  steps,
  messages,
  project,
  onClose,
  onDelete,
  onRetry,
  onMarkComplete,
  retrying,
  replyText,
  setReplyText,
  sendingReply,
  onSendReply,
  attachments,
  onFilesSelected,
  onRemoveAttachment,
}: {
  task: Task
  steps: TaskStep[]
  messages: TaskMessage[]
  project: Project
  onClose: () => void
  onDelete: (taskId: string) => void
  onRetry: (taskId: string) => void
  onMarkComplete: (taskId: string) => void
  retrying: boolean
  replyText: string
  setReplyText: (v: string) => void
  sendingReply: boolean
  onSendReply: () => void
  attachments: DraftAttachment[]
  onFilesSelected: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
}) {
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const timeline = buildUnifiedTimeline(messages, steps, task)

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [timeline.length])

  return (
    <ModalOverlay onClose={onClose}>
      <div className="td-modal-header">
        <div className="td-modal-title-row">
          <StatusCircle status={task.status} size={22} />
          <h2 className="td-modal-title">{task.title}</h2>
        </div>
        <button className="td-modal-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      <div className="td-modal-meta-bar">
        <span className={`td-status-badge-sm td-status-${task.status}`}>
          {taskStatusLabel(task.status)}
        </span>
        {task.priority !== 0 && <span className="td-meta-pill">P{task.priority}</span>}
        {task.branchName && <span className="td-meta-pill">{task.branchName}</span>}
        <span className="td-meta-time">{timeAgo(task.createdAt)}</span>
      </div>

      <div className="td-timeline" ref={chatRef}>
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
      </div>

      <div className="td-modal-bottom">
        {attachments.length > 0 && (
          <div className="td-attachment-previews">
            {attachments.map((a) => (
              <div key={a.id} className="td-attachment-thumb">
                <img src={a.previewUrl} alt={a.file.name} />
                <button className="td-attachment-remove" onClick={() => onRemoveAttachment(a.id)} type="button">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="td-chat-input-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            onChange={(e) => { onFilesSelected(e.target.files); if (fileInputRef.current) fileInputRef.current.value = '' }}
          />
          <button
            className="td-chat-attach"
            disabled={attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
            title={`Attach images (${attachments.length}/${MAX_ATTACHMENTS})`}
            type="button"
          >
            <ImagePlus size={16} />
          </button>
          <input
            className="td-chat-input"
            placeholder="Type a message..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && (replyText.trim() || attachments.length > 0)) { e.preventDefault(); onSendReply() } }}
            onPaste={(e) => {
              const files = e.clipboardData?.files
              if (files?.length) { e.preventDefault(); onFilesSelected(files) }
            }}
            disabled={sendingReply}
          />
          <button
            className="td-chat-send"
            disabled={(!replyText.trim() && attachments.length === 0) || sendingReply}
            onClick={onSendReply}
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="td-modal-actions-row">
          {task.runId && (
            <Link
              className="td-btn td-btn-ghost td-btn-sm"
              to={`/agents/${project.agentId}/threads/${task.runId}`}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} /> View Run
            </Link>
          )}
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
  title,
  subtitle,
}: {
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
  title?: string
  subtitle?: string
}) {
  return (
    <ModalOverlay onClose={onClose} maxWidth={360}>
      <div className="td-confirm-body">
        <h2 className="td-confirm-title">{title ?? 'Delete task?'}</h2>
        <p className="td-confirm-subtitle">{subtitle ?? 'This action cannot be undone.'}</p>
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

/* ── Project Sidebar Item ──────────────────────── */

function ProjectSidebarItem({
  project,
  isActive,
  taskCounts,
  onClick,
}: {
  project: Project
  isActive: boolean
  taskCounts: { total: number; active: number }
  onClick: () => void
}) {
  return (
    <button
      className={`pj-sidebar-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <FolderGit2 size={14} className="pj-sidebar-item-icon" />
      <span className="pj-sidebar-item-name">{project.name}</span>
      {taskCounts.active > 0 && (
        <span className="pj-sidebar-item-badge active">{taskCounts.active}</span>
      )}
      {taskCounts.active === 0 && taskCounts.total > 0 && (
        <span className="pj-sidebar-item-badge">{taskCounts.total}</span>
      )}
    </button>
  )
}

/* ── New Action Modal ───────────────────────────── */

function NewActionModal({
  onClose,
  onCreateManual,
  onGenerate,
  isSubmitting,
  formError,
  defaultTool,
  generatingStatus,
}: {
  onClose: () => void
  onCreateManual: (name: string, prompt: string, description: string, tool: RunTool) => void
  onGenerate: (description: string) => void
  isSubmitting: boolean
  formError: string | null
  defaultTool: RunTool
  generatingStatus: 'idle' | 'generating' | 'done'
}) {
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [aiDescription, setAiDescription] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [description, setDescription] = useState('')
  const [tool, setTool] = useState<RunTool>(defaultTool)

  return (
    <ModalOverlay onClose={generatingStatus === 'generating' ? () => {} : onClose} maxWidth={520}>
      <div className="td-modal-header">
        <h2 className="td-modal-title">New Action</h2>
        {generatingStatus !== 'generating' && (
          <button className="td-modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="td-modal-body">
        {generatingStatus === 'generating' ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <LoaderCircle className="spin" size={28} style={{ marginBottom: '1rem' }} />
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
              AI is analyzing the project and generating action definition...
            </p>
            <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.5rem', opacity: 0.7 }}>
              This may take a minute
            </p>
          </div>
        ) : (
          <>
            <div className="td-action-mode-tabs">
              <button
                className={`td-action-mode-tab ${mode === 'ai' ? 'active' : ''}`}
                onClick={() => setMode('ai')}
                type="button"
              >
                AI Generate
              </button>
              <button
                className={`td-action-mode-tab ${mode === 'manual' ? 'active' : ''}`}
                onClick={() => setMode('manual')}
                type="button"
              >
                Manual
              </button>
            </div>

            {mode === 'ai' ? (
              <>
                <textarea
                  className="td-input td-input-desc"
                  placeholder="Describe the action you want (e.g., 'deploy to production', 'run database migration')"
                  rows={4}
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  autoFocus
                />
                {formError && <p className="td-form-error">{formError}</p>}
                <div className="td-modal-footer">
                  <button className="td-btn td-btn-ghost" onClick={onClose} type="button">
                    Cancel
                  </button>
                  <button
                    className="td-btn td-btn-primary"
                    disabled={isSubmitting || !aiDescription.trim()}
                    onClick={() => onGenerate(aiDescription.trim())}
                    type="button"
                  >
                    {isSubmitting ? <LoaderCircle className="spin" size={14} /> : null}
                    {isSubmitting ? 'Starting...' : 'Generate with AI'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  className="td-input td-input-title"
                  placeholder="Action name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <input
                  className="td-input"
                  placeholder="Description (optional)"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <textarea
                  className="td-input td-input-desc"
                  placeholder="Prompt (the instructions for this action)"
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
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
                    disabled={isSubmitting || !name.trim() || !prompt.trim()}
                    onClick={() => onCreateManual(name.trim(), prompt.trim(), description.trim(), tool)}
                    type="button"
                  >
                    {isSubmitting ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
                    {isSubmitting ? 'Creating...' : 'Create Action'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

/* ── Edit Action Modal ─────────────────────────── */

function EditActionModal({
  action,
  onClose,
  onSave,
  isSubmitting,
  formError,
}: {
  action: ProjectAction
  onClose: () => void
  onSave: (data: { name: string; description: string; prompt: string; tool: RunTool }) => void
  isSubmitting: boolean
  formError: string | null
}) {
  const [name, setName] = useState(action.name)
  const [description, setDescription] = useState(action.description)
  const [prompt, setPrompt] = useState(action.prompt)
  const [tool, setTool] = useState<RunTool>(action.tool)

  return (
    <ModalOverlay onClose={onClose} maxWidth={520}>
      <div className="td-modal-header">
        <h2 className="td-modal-title">{action.id ? 'Edit Action' : 'Confirm Action'}</h2>
        <button className="td-modal-close" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      <div className="td-modal-body">
        <input
          className="td-input td-input-title"
          placeholder="Action name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="td-input"
          placeholder="Description (optional)"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <textarea
          className="td-input td-input-desc"
          placeholder="Prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
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
            disabled={isSubmitting || !name.trim() || !prompt.trim()}
            onClick={() => onSave({ name: name.trim(), description: description.trim(), prompt: prompt.trim(), tool })}
            type="button"
          >
            {isSubmitting ? <LoaderCircle className="spin" size={14} /> : action.id ? <Check size={14} /> : <Plus size={14} />}
            {isSubmitting ? 'Saving...' : action.id ? 'Save' : 'Create Action'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/* ── Main Page Component ────────────────────────── */

export function ProjectsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  // Projects state
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  // Active project + tasks
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)

  // Task detail state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskSteps, setTaskSteps] = useState<Record<string, TaskStep[]>>({})
  const [taskMessages, setTaskMessages] = useState<Record<string, TaskMessage[]>>({})

  // Actions state
  const [actions, setActions] = useState<ProjectAction[]>([])
  const [showNewActionModal, setShowNewActionModal] = useState(false)
  const [editingAction, setEditingAction] = useState<ProjectAction | null>(null)
  const [deleteActionId, setDeleteActionId] = useState<string | null>(null)
  const [actionSubmitting, setActionSubmitting] = useState(false)
  const [actionFormError, setActionFormError] = useState<string | null>(null)
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null)
  const [executingActionId, setExecutingActionId] = useState<string | null>(null)
  const [generatingStatus, setGeneratingStatus] = useState<'idle' | 'generating' | 'done'>('idle')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteType, setDeleteType] = useState<'task' | 'project'>('task')

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])

  // Mobile sidebar toggle
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)

  // Task counts per project
  const [projectTaskCounts, setProjectTaskCounts] = useState<Record<string, { total: number; active: number }>>({})

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Load projects list ───────────────────────
  const loadProjects = useCallback(async () => {
    setIsLoadingProjects(true)
    try {
      const [projectsRes, agentsRes] = await Promise.all([
        fetchApi('/api/projects'),
        fetchApi('/api/agents'),
      ])
      if (!projectsRes.ok) throw new Error('Failed to load projects')
      if (!agentsRes.ok) throw new Error('Failed to load agents')
      const projectsData = (await projectsRes.json()) as { projects: Project[] }
      const agentsData = (await agentsRes.json()) as { agents: AgentInfo[] }
      setProjects(projectsData.projects)
      setAgents(new Map(agentsData.agents.map((a) => [a.id, a])))
      setProjectsError(null)
      return projectsData.projects
    } catch (err) {
      setProjectsError((err as Error).message)
      return []
    } finally {
      setIsLoadingProjects(false)
    }
  }, [])

  // ─── Load tasks for a project ─────────────────
  const loadTasks = useCallback(async (pid: string, showLoading = true) => {
    if (showLoading) setIsLoadingTasks(true)
    try {
      const res = await fetchApi(`/api/projects/${pid}`)
      if (!res.ok) throw new Error('Failed to load project')
      const data = (await res.json()) as { project: Project; tasks: Task[]; actions: ProjectAction[] }
      setActiveProject(data.project)
      setTasks(data.tasks)
      setActions(data.actions || [])
      setTasksError(null)

      // Update task counts for this project
      const active = data.tasks.filter(t => ACTIVE_TASK_STATUSES.includes(t.status)).length
      setProjectTaskCounts(prev => ({ ...prev, [pid]: { total: data.tasks.length, active } }))

      // Load steps and messages for non-pending tasks
      for (const task of data.tasks) {
        if (task.status !== 'pending') {
          const stepsRes = await fetchApi(`/api/projects/${pid}/tasks/${task.id}/steps`)
          if (stepsRes.ok) {
            const stepsData = await stepsRes.json() as { steps: TaskStep[] }
            setTaskSteps(prev => ({ ...prev, [task.id]: stepsData.steps }))
          }
          const msgsRes = await fetchApi(`/api/projects/${pid}/tasks/${task.id}/messages`)
          if (msgsRes.ok) {
            const msgsData = await msgsRes.json() as { messages: TaskMessage[] }
            setTaskMessages(prev => ({ ...prev, [task.id]: msgsData.messages }))
          }
        }
      }
    } catch (err) {
      setTasksError((err as Error).message)
    } finally {
      setIsLoadingTasks(false)
    }
  }, [])

  // ─── Initial load ─────────────────────────────
  useEffect(() => {
    void loadProjects().then((loadedProjects) => {
      if (loadedProjects.length === 0) return
      const targetId = projectId ?? loadedProjects[0]?.id
      if (targetId) {
        void loadTasks(targetId)
        if (!projectId) {
          navigate(`/projects/${targetId}`, { replace: true })
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handle URL projectId changes ─────────────
  useEffect(() => {
    if (!projectId || isLoadingProjects) return
    if (activeProject?.id !== projectId) {
      setTasks([])
      setActions([])
      setTaskSteps({})
      setTaskMessages({})
      setSelectedTask(null)
      setReplyText('')
      setDraftAttachments([])
      void loadTasks(projectId)
    }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-refresh for active tasks ────────────
  useEffect(() => {
    const hasActive = tasks.some((t) => ACTIVE_TASK_STATUSES.includes(t.status))
    if (hasActive && activeProject) {
      intervalRef.current = setInterval(() => {
        void loadTasks(activeProject.id, false)
      }, AUTO_REFRESH_INTERVAL)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [tasks, activeProject, loadTasks])

  // ─── WebSocket for real-time updates ──────────
  useEffect(() => {
    if (!activeProject || !token) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(
          `${wsProtocol}//${window.location.host}/ws/project?projectId=${encodeURIComponent(activeProject.id)}&token=${encodeURIComponent(token)}`,
        )
      },
      onMessage(event) {
        try {
          const data = JSON.parse(event.data) as RunEvent
          if (data.type === 'task-status') {
            setTasks((prev) => prev.map((t) => (t.id === data.task.id ? data.task : t)))
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
  }, [activeProject, token])

  // ─── Attachment handlers ──────────────────────
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const remaining = MAX_ATTACHMENTS - draftAttachments.length
    const toAdd = Array.from(files).slice(0, remaining)
    const newAttachments: DraftAttachment[] = []
    for (const file of toAdd) {
      if (!file.type.startsWith('image/')) continue
      const base64 = await fileToBase64(file)
      newAttachments.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), base64 })
    }
    setDraftAttachments((prev) => [...prev, ...newAttachments])
  }

  const removeAttachment = (id: string) => {
    setDraftAttachments((prev) => {
      const removed = prev.find((a) => a.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  // ─── Task CRUD handlers ───────────────────────
  const handleAddTask = async (title: string, description: string, priority: number, tool: 'claude' | 'codex') => {
    if (!activeProject) return
    setFormError(null)
    setIsSubmitting(true)
    try {
      const body: { title: string; prompt?: string; priority?: number; tool?: string } = { title, tool }
      if (description) body.prompt = description
      if (priority !== 0) body.priority = priority

      const res = await fetchApi(`/api/projects/${activeProject.id}/tasks`, {
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
    if (!activeProject) return
    try {
      setRetryingId(taskId)
      const res = await fetchApi(`/api/projects/${activeProject.id}/tasks/${taskId}/retry`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to retry task')
      const data = (await res.json()) as { task: Task }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)))
      setSelectedTask(data.task)
      setTaskSteps(prev => { const next = { ...prev }; delete next[taskId]; return next })
      setTaskMessages(prev => { const next = { ...prev }; delete next[taskId]; return next })
    } catch (err) {
      setTasksError((err as Error).message)
    } finally {
      setRetryingId(null)
    }
  }

  const handleMarkComplete = async (taskId: string) => {
    if (!activeProject) return
    try {
      const res = await fetchApi(`/api/projects/${activeProject.id}/tasks/${taskId}/complete`, {
        method: 'POST',
      })
      if (res.ok) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed' as TaskStatus } : t))
        setSelectedTask(prev => prev && prev.id === taskId ? { ...prev, status: 'completed' as TaskStatus } : prev)
      }
    } catch (err) {
      setTasksError((err as Error).message)
    }
  }

  const handleSendReply = async () => {
    if ((!replyText.trim() && draftAttachments.length === 0) || !selectedTask || !activeProject) return
    setSendingReply(true)
    try {
      const uploadAttachments = draftAttachments.map((a) => ({
        id: a.id,
        name: a.file.name,
        mimeType: a.file.type,
        sizeBytes: a.file.size,
        base64: a.base64,
      }))
      const body: { content: string; attachments?: typeof uploadAttachments } = { content: replyText.trim() || '(image)' }
      if (uploadAttachments.length > 0) body.attachments = uploadAttachments

      const res = await fetchApi(`/api/projects/${activeProject.id}/tasks/${selectedTask.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json() as { message: TaskMessage }
        setTaskMessages(prev => ({
          ...prev,
          [selectedTask.id]: [...(prev[selectedTask.id] || []), data.message]
        }))
        setReplyText('')
        for (const a of draftAttachments) URL.revokeObjectURL(a.previewUrl)
        setDraftAttachments([])
      }
    } finally {
      setSendingReply(false)
    }
  }

  const handleDeleteTask = (taskId: string) => {
    setDeleteType('task')
    setDeleteTargetId(taskId)
  }

  const handleDeleteProject = () => {
    if (!activeProject) return
    setDeleteType('project')
    setDeleteTargetId(activeProject.id)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return

    if (deleteType === 'project') {
      try {
        setDeletingId(deleteTargetId)
        const res = await fetchApi(`/api/projects/${deleteTargetId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to delete project')
        const remaining = projects.filter(p => p.id !== deleteTargetId)
        setProjects(remaining)
        setDeleteTargetId(null)
        if (remaining.length > 0) {
          navigate(`/projects/${remaining[0].id}`, { replace: true })
        } else {
          setActiveProject(null)
          setTasks([])
          navigate('/projects', { replace: true })
        }
      } catch (err) {
        setTasksError((err as Error).message)
      } finally {
        setDeletingId(null)
      }
      return
    }

    // Delete task
    try {
      setDeletingId(deleteTargetId)
      const res = await fetchApi(`/api/projects/${activeProject!.id}/tasks/${deleteTargetId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete task')
      setTasks((prev) => prev.filter((t) => t.id !== deleteTargetId))
      if (selectedTask?.id === deleteTargetId) setSelectedTask(null)
      setDeleteTargetId(null)
    } catch (err) {
      setTasksError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  // ─── Action handlers ─────────────────────────
  const handleExecuteAction = async (action: ProjectAction) => {
    if (executingActionId || !activeProject) return
    setExecutingActionId(action.id)
    try {
      const res = await fetchApi(`/api/projects/${activeProject.id}/actions/${action.id}/run`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to execute action')
      const data = await res.json() as { runId: string }
      navigate(`/agents/${activeProject.agentId}/threads/${data.runId}`)
    } catch (err) {
      setTasksError((err as Error).message)
    } finally {
      setExecutingActionId(null)
    }
  }

  const handleCreateActionManual = async (name: string, prompt: string, description: string, tool: RunTool) => {
    if (!activeProject) return
    setActionFormError(null)
    setActionSubmitting(true)
    try {
      const body: { name: string; prompt: string; description?: string; tool?: RunTool } = { name, prompt, tool }
      if (description) body.description = description

      const res = await fetchApi(`/api/projects/${activeProject.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to create action')
      }
      const data = (await res.json()) as { action: ProjectAction }
      setActions((prev) => [...prev, data.action])
      setShowNewActionModal(false)
    } catch (err) {
      setActionFormError((err as Error).message)
    } finally {
      setActionSubmitting(false)
    }
  }

  const handleGenerateAction = async (description: string) => {
    if (!activeProject) return
    setActionFormError(null)
    setActionSubmitting(true)
    try {
      const res = await fetchApi(`/api/projects/${activeProject.id}/actions/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to generate action')
      }
      const data = (await res.json()) as { runId: string }
      setActionSubmitting(false)
      setGeneratingStatus('generating')

      // Poll for run completion
      const pollInterval = 3000
      const maxPolls = 120 // 6 minutes max
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, pollInterval))
        const runRes = await fetchApi(`/api/agents/${activeProject.agentId}/threads/${data.runId}`)
        if (!runRes.ok) continue
        const runData = (await runRes.json()) as {
          run: { status: string }
          turns: Array<{ items: Array<{ type: string; role?: string; text?: string }> }>
        }
        const status = runData.run.status
        if (status === 'success' || status === 'failed') {
          if (status === 'failed') {
            throw new Error('AI generation failed')
          }
          // Extract JSON from assistant messages in the last turn
          const lastTurn = runData.turns[runData.turns.length - 1]
          if (lastTurn) {
            const assistantMessages = lastTurn.items
              .filter(item => item.type === 'message' && item.role === 'assistant' && item.text)
              .map(item => item.text!)

            let parsed: { name?: string; description?: string; prompt?: string } | null = null
            for (const text of assistantMessages) {
              try {
                // Try to extract JSON from the text (may be wrapped in markdown fences)
                const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || [null, text]
                const jsonStr = jsonMatch[1] ?? text
                const obj = JSON.parse(jsonStr.trim())
                if (obj.name && obj.prompt) {
                  parsed = obj
                  break
                }
              } catch {
                // Try finding JSON object in the text
                const braceMatch = text.match(/\{[\s\S]*"name"[\s\S]*"prompt"[\s\S]*\}/)
                if (braceMatch) {
                  try {
                    const obj = JSON.parse(braceMatch[0])
                    if (obj.name && obj.prompt) {
                      parsed = obj
                      break
                    }
                  } catch { /* skip */ }
                }
              }
            }

            if (parsed) {
              // Switch to edit mode with pre-filled data
              setGeneratingStatus('idle')
              setShowNewActionModal(false)
              setEditingAction({
                id: '',
                projectId: activeProject.id,
                name: parsed.name || '',
                description: parsed.description || '',
                prompt: parsed.prompt || '',
                tool: activeProject.defaultTool as RunTool,
                sortOrder: 0,
                createdAt: 0,
                updatedAt: 0,
              })
              return
            }
          }
          // If we couldn't parse JSON, show error
          throw new Error('Could not parse AI response. Try creating the action manually.')
        }
      }
      throw new Error('Generation timed out. Try creating the action manually.')
    } catch (err) {
      setActionFormError((err as Error).message)
      setGeneratingStatus('idle')
    } finally {
      setActionSubmitting(false)
    }
  }

  const handleUpdateAction = async (data: { name: string; description: string; prompt: string; tool: RunTool }) => {
    if (!editingAction || !activeProject) return
    setActionFormError(null)
    setActionSubmitting(true)
    try {
      if (!editingAction.id) {
        // This is a new action from AI generation — create instead of update
        const res = await fetchApi(`/api/projects/${activeProject.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          throw new Error((errData as any)?.error || 'Failed to create action')
        }
        const resData = (await res.json()) as { action: ProjectAction }
        setActions((prev) => [...prev, resData.action])
      } else {
        // Normal update
        const res = await fetchApi(`/api/projects/${activeProject.id}/actions/${editingAction.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          throw new Error((errData as any)?.error || 'Failed to update action')
        }
        setActions((prev) =>
          prev.map((a) => (a.id === editingAction.id ? { ...a, ...data } : a)),
        )
      }
      setEditingAction(null)
    } catch (err) {
      setActionFormError((err as Error).message)
    } finally {
      setActionSubmitting(false)
    }
  }

  const handleDeleteActionConfirm = async () => {
    if (!deleteActionId || !activeProject) return
    try {
      setDeletingActionId(deleteActionId)
      const res = await fetchApi(`/api/projects/${activeProject.id}/actions/${deleteActionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete action')
      setActions((prev) => prev.filter((a) => a.id !== deleteActionId))
      setDeleteActionId(null)
    } catch (err) {
      setTasksError((err as Error).message)
    } finally {
      setDeletingActionId(null)
    }
  }

  // ─── Project switching ────────────────────────
  const handleSelectProject = (pid: string) => {
    if (pid === activeProject?.id) return
    setShowMobileSidebar(false)
    navigate(`/projects/${pid}`)
  }

  // ─── Derived data ─────────────────────────────
  const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority)

  // ─── Loading state ────────────────────────────
  if (isLoadingProjects) {
    return (
      <div className="pj-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading projects...</span>
        </div>
      </div>
    )
  }

  // ─── Empty state ──────────────────────────────
  if (projects.length === 0 && !projectsError) {
    return (
      <div className="pj-page">
        <div className="pj-empty">
          <FolderGit2 size={40} className="pj-empty-icon" />
          <h2>No projects yet</h2>
          <p>Create a project to manage tasks and dispatch them to agents automatically.</p>
          <button
            className="primary-button"
            onClick={() => navigate('/projects/new')}
            type="button"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pj-page">
      {projectsError && <p className="error-banner">{projectsError}</p>}

      {/* Mobile project selector */}
      <div className="pj-mobile-header">
        <button
          className="pj-mobile-selector"
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          type="button"
        >
          <FolderGit2 size={14} />
          <span className="pj-mobile-selector-name">
            {activeProject?.name ?? 'Select Project'}
          </span>
          <ChevronDown size={14} className={`pj-mobile-chevron ${showMobileSidebar ? 'open' : ''}`} />
        </button>
        <div className="pj-mobile-actions">
          <button
            className="td-btn td-btn-primary td-btn-sm"
            onClick={() => { setFormError(null); setShowAddModal(true) }}
            disabled={!activeProject}
            type="button"
          >
            <Plus size={14} /> Add Task
          </button>
        </div>
      </div>

      {/* Mobile project dropdown */}
      {showMobileSidebar && (
        <div className="pj-mobile-dropdown">
          {projects.map((project) => (
            <button
              className={`pj-mobile-dropdown-item ${project.id === activeProject?.id ? 'active' : ''}`}
              key={project.id}
              onClick={() => handleSelectProject(project.id)}
              type="button"
            >
              <FolderGit2 size={14} />
              <span>{project.name}</span>
              {(projectTaskCounts[project.id]?.active ?? 0) > 0 && (
                <span className="pj-sidebar-item-badge active">
                  {projectTaskCounts[project.id]?.active}
                </span>
              )}
            </button>
          ))}
          <button
            className="pj-mobile-dropdown-item pj-mobile-dropdown-new"
            onClick={() => navigate('/projects/new')}
            type="button"
          >
            <Plus size={14} />
            <span>New Project</span>
          </button>
        </div>
      )}

      <div className="pj-split">
        {/* ── Sidebar ─────────────────────────── */}
        <aside className="pj-sidebar">
          <div className="pj-sidebar-header">
            <span className="pj-sidebar-title">Projects</span>
          </div>
          <div className="pj-sidebar-list">
            {projects.map((project) => (
              <ProjectSidebarItem
                key={project.id}
                project={project}
                isActive={project.id === activeProject?.id}
                taskCounts={projectTaskCounts[project.id] ?? { total: 0, active: 0 }}
                onClick={() => handleSelectProject(project.id)}
              />
            ))}
          </div>
          <button
            className="pj-sidebar-new"
            onClick={() => navigate('/projects/new')}
            type="button"
          >
            <Plus size={14} />
            New Project
          </button>
        </aside>

        {/* ── Main Content ────────────────────── */}
        <div className="pj-main">
          {activeProject ? (
            <>
              {/* Project header */}
              <div className="pj-main-header">
                <div className="pj-main-header-info">
                  <h1 className="pj-main-title">{activeProject.name}</h1>
                  <div className="pj-main-meta">
                    <span className="pj-main-meta-item" title={activeProject.repoPath}>
                      {repoName(activeProject.repoPath)}
                    </span>
                    <span className="pj-main-meta-sep">&middot;</span>
                    <span className="pj-main-meta-item">
                      {activeProject.defaultTool === 'codex' ? 'Codex' : 'Claude'}
                    </span>
                    {(() => {
                      const agent = agents.get(activeProject.agentId)
                      const isOnline = agent?.status === 'online'
                      return (
                        <>
                          <span className="pj-main-meta-sep">&middot;</span>
                          <span className={`pj-main-meta-agent ${isOnline ? 'online' : ''}`}>
                            <span className={`thread-status-dot ${isOnline ? 'success' : 'muted'}`} />
                            {agent?.name || activeProject.agentId}
                          </span>
                        </>
                      )
                    })()}
                  </div>
                </div>
                <div className="pj-main-header-actions">
                  <button
                    className="td-btn td-btn-primary td-btn-sm"
                    onClick={() => { setFormError(null); setShowAddModal(true) }}
                    type="button"
                  >
                    <Plus size={14} /> Add Task
                  </button>
                  <button
                    className="td-btn td-btn-ghost td-btn-sm pj-delete-btn"
                    onClick={handleDeleteProject}
                    title="Delete Project"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {tasksError && <p className="error-banner">{tasksError}</p>}

              {/* Actions */}
              {!isLoadingTasks && (
                <div className="td-actions-bar" style={{ padding: '0 1.25rem' }}>
                  <div className="td-actions-header">
                    <h3 className="td-actions-title">Actions</h3>
                    <button className="td-action-add-btn" onClick={() => { setActionFormError(null); setShowNewActionModal(true) }} type="button">
                      <Plus size={14} /> New Action
                    </button>
                  </div>
                  {actions.length > 0 && (
                    <div className="td-actions-grid">
                      {actions.map(action => (
                        <div key={action.id} className="td-action-card">
                          <div className="td-action-card-body">
                            <span className="td-action-card-name">{action.name}</span>
                            {action.description && <span className="td-action-card-desc">{action.description}</span>}
                          </div>
                          <div className="td-action-card-buttons">
                            <button className="td-btn td-btn-primary td-btn-sm" onClick={() => void handleExecuteAction(action)} disabled={executingActionId === action.id} type="button">
                              {executingActionId === action.id ? <LoaderCircle size={12} className="spin" /> : 'Run'}
                            </button>
                            <button className="td-action-icon" onClick={() => { setActionFormError(null); setEditingAction(action) }} type="button" title="Edit">
                              <Pencil size={14} />
                            </button>
                            <button className="td-action-icon td-action-danger" onClick={() => setDeleteActionId(action.id)} type="button" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Task list */}
              {isLoadingTasks ? (
                <div className="threads-loading">
                  <LoaderCircle className="spin" size={20} />
                  <span>Loading tasks...</span>
                </div>
              ) : (
                <div className="td-task-list">
                  {sortedTasks.length === 0 ? (
                    <div className="pj-tasks-empty">
                      <p>No tasks yet. Click &ldquo;Add Task&rdquo; to create one.</p>
                    </div>
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
                              to={`/agents/${activeProject.agentId}/threads/${task.runId}`}
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
                            onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id) }}
                            title="Delete"
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pj-tasks-empty">
              <p>Select a project from the sidebar.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ────────────────────────────── */}
      {selectedTask && activeProject && (
        <TaskDetailModal
          task={selectedTask}
          steps={taskSteps[selectedTask.id] || []}
          messages={taskMessages[selectedTask.id] || []}
          project={activeProject}
          onClose={() => { setSelectedTask(null); setReplyText('') }}
          onDelete={handleDeleteTask}
          onRetry={(id) => void handleRetry(id)}
          onMarkComplete={(id) => void handleMarkComplete(id)}
          retrying={retryingId === selectedTask.id}
          replyText={replyText}
          setReplyText={setReplyText}
          sendingReply={sendingReply}
          onSendReply={() => void handleSendReply()}
          attachments={draftAttachments}
          onFilesSelected={(files) => void handleFilesSelected(files)}
          onRemoveAttachment={removeAttachment}
        />
      )}

      {showAddModal && activeProject && (
        <AddTaskModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(t, d, p, tool) => void handleAddTask(t, d, p, tool)}
          defaultTool={(activeProject.defaultTool || 'claude') as 'claude' | 'codex'}
          isSubmitting={isSubmitting}
          formError={formError}
        />
      )}

      {deleteTargetId && (
        <ConfirmDeleteModal
          onClose={() => setDeleteTargetId(null)}
          onConfirm={() => void handleDeleteConfirm()}
          isDeleting={deletingId === deleteTargetId}
          title={deleteType === 'project' ? 'Delete project?' : 'Delete task?'}
          subtitle={
            deleteType === 'project'
              ? 'All tasks in this project will also be deleted. This cannot be undone.'
              : 'This action cannot be undone.'
          }
        />
      )}

      {showNewActionModal && activeProject && (
        <NewActionModal
          onClose={() => setShowNewActionModal(false)}
          onCreateManual={(name, prompt, desc, tool) => void handleCreateActionManual(name, prompt, desc, tool)}
          onGenerate={(desc) => void handleGenerateAction(desc)}
          isSubmitting={actionSubmitting}
          formError={actionFormError}
          defaultTool={(activeProject.defaultTool || 'claude') as 'claude' | 'codex'}
          generatingStatus={generatingStatus}
        />
      )}

      {editingAction && activeProject && (
        <EditActionModal
          action={editingAction}
          onClose={() => setEditingAction(null)}
          onSave={(data) => void handleUpdateAction(data)}
          isSubmitting={actionSubmitting}
          formError={actionFormError}
        />
      )}

      {deleteActionId && (
        <ConfirmDeleteModal
          onClose={() => setDeleteActionId(null)}
          onConfirm={() => void handleDeleteActionConfirm()}
          isDeleting={deletingActionId === deleteActionId}
          title="Delete action?"
          subtitle="This action cannot be undone."
        />
      )}
    </div>
  )
}
