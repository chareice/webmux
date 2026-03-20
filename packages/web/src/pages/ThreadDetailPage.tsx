import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  ListRestart,
  LoaderCircle,
  Paperclip,
  Pencil,
  Send,
  StopCircle,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import { MAX_ATTACHMENTS, fileToBase64, repoName, timeAgo, toolIcon, toolLabel } from '../lib/utils.ts'
import type { DraftAttachment } from '../lib/utils.ts'
import type {
  ContinueRunRequest,
  Run,
  RunDetailResponse,
  RunEvent,
  RunImageAttachmentUpload,
  RunStatus,
  RunTimelineEvent,
  RunTurn,
  RunTurnDetail,
  RunTurnOptions,
} from '@webmux/shared'

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

function isRunActive(status: RunStatus): boolean {
  return status === 'starting' || status === 'running'
}

function canContinue(turn: RunTurnDetail | undefined): boolean {
  if (!turn) return false
  return turn.status === 'success' || turn.status === 'failed' || turn.status === 'interrupted'
}

// --- Conversation segment grouping ---

type ConversationSegment =
  | { type: 'tools'; items: RunTimelineEvent[] }
  | { type: 'assistant'; text: string; id: number }
  | { type: 'system'; text: string; id: number }

function groupIntoSegments(items: RunTimelineEvent[]): ConversationSegment[] {
  const segments: ConversationSegment[] = []
  let pendingTools: RunTimelineEvent[] = []

  const flushTools = () => {
    if (pendingTools.length > 0) {
      segments.push({ type: 'tools', items: pendingTools })
      pendingTools = []
    }
  }

  for (const item of items) {
    if (item.type === 'message') {
      if (item.role === 'assistant') {
        flushTools()
        segments.push({ type: 'assistant', text: item.text, id: item.id })
      } else if (item.role === 'system') {
        flushTools()
        segments.push({ type: 'system', text: item.text, id: item.id })
      } else {
        // user messages inside a turn are unusual but treat like system
        flushTools()
        segments.push({ type: 'system', text: item.text, id: item.id })
      }
    } else {
      // activity or command -> accumulate into tools group
      pendingTools.push(item)
    }
  }

  flushTools()
  return segments
}

export function ThreadDetailPage() {
  const { agentId, threadId } = useParams<{ agentId: string; threadId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [run, setRun] = useState<Run | null>(null)
  const [turns, setTurns] = useState<RunTurnDetail[]>([])
  const [followUp, setFollowUp] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [turnOptions, setTurnOptions] = useState<RunTurnOptions>({})
  const [showOptions, setShowOptions] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isContinuing, setIsContinuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawerItems, setDrawerItems] = useState<RunTimelineEvent[] | null>(null)
  const drawerItemsRef = useRef<RunTimelineEvent[] | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Open tool drawer: push a history entry so mobile back gesture works
  const openToolDrawer = useCallback((items: RunTimelineEvent[]) => {
    setDrawerItems(items)
    drawerItemsRef.current = items
    window.history.pushState({ toolDrawer: true }, '')
  }, [])

  // Close tool drawer: go back in history if we pushed an entry
  const closeToolDrawer = useCallback(() => {
    setDrawerItems(null)
    drawerItemsRef.current = null
    // Pop the history entry we pushed
    window.history.back()
  }, [])

  // Listen for popstate (browser back button / swipe gesture)
  useEffect(() => {
    const handler = (_e: PopStateEvent) => {
      // If drawer is open and user navigated back, close it
      if (drawerItemsRef.current) {
        setDrawerItems(null)
        drawerItemsRef.current = null
      }
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])


  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetchApi(`/api/agents/${agentId}/threads/${threadId}`)
      if (!res.ok) throw new Error('Failed to load thread')
      const data = (await res.json()) as RunDetailResponse
      setRun(data.run)
      setTurns(data.turns)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [agentId, threadId])

  useEffect(() => {
    setRun(null)
    setTurns([])
    setError(null)
    setFollowUp('')
    setAttachments([])
    setIsLoading(true)
    void fetchDetail()
  }, [fetchDetail])

  // WebSocket for real-time updates
  useEffect(() => {
    if (!token || !threadId) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const controller = createReconnectableSocket({
      connect() {
        return new WebSocket(
          `${wsProtocol}//${window.location.host}/ws/thread?threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(token)}`,
        )
      },
      onMessage(event) {
        const data = JSON.parse(event.data) as RunEvent
        if (data.type === 'run-status') {
          setRun(data.run)
        } else if (data.type === 'run-turn') {
          setTurns((prev) => upsertTurn(prev, data.turn))
        } else if (data.type === 'run-item') {
          setTurns((prev) => {
            const next = appendItem(prev, data.turnId, data.item)
            if (next === prev) {
              // Turn not found, refetch
              void fetchDetail()
            }
            return next
          })
        }
      },
      onError() {
        void fetchDetail()
      },
    })

    return () => controller.dispose()
  }, [token, threadId, fetchDetail])

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (timelineRef.current) {
      setTimeout(() => {
        timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' })
      }, 50)
    }
  }, [turns])

  const queuedTurns = turns.filter((t) => t.status === 'queued')
  const nonQueuedTurns = turns.filter((t) => t.status !== 'queued')
  const latestTurn = nonQueuedTurns.length > 0 ? nonQueuedTurns[nonQueuedTurns.length - 1] : undefined
  const active = latestTurn ? isRunActive(latestTurn.status) : run ? isRunActive(run.status) : false
  const interruptedWithQueue = latestTurn?.status === 'interrupted' && queuedTurns.length > 0

  const [editingTurnId, setEditingTurnId] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')

  const handleDeleteQueuedTurn = async (turnId: string) => {
    try {
      await fetchApi(`/api/agents/${agentId}/threads/${threadId}/turns/${turnId}`, { method: 'DELETE' })
    } catch {
      // Ignore
    }
  }

  const handleUpdateQueuedTurn = async (turnId: string, prompt: string) => {
    try {
      await fetchApi(`/api/agents/${agentId}/threads/${threadId}/turns/${turnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      setEditingTurnId(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleResumeQueue = async () => {
    try {
      const res = await fetchApi(`/api/agents/${agentId}/threads/${threadId}/resume-queue`, { method: 'POST' })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to resume queue')
      }
      const data = (await res.json()) as RunDetailResponse
      setRun(data.run)
      setTurns(data.turns)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDiscardQueue = async () => {
    try {
      await fetchApi(`/api/agents/${agentId}/threads/${threadId}/discard-queue`, { method: 'POST' })
    } catch {
      // Ignore
    }
  }

  const handleInterrupt = async () => {
    try {
      await fetchApi(`/api/agents/${agentId}/threads/${threadId}/interrupt`, { method: 'POST' })
    } catch {
      // Ignore transient failures
    }
  }

  const handleDelete = async () => {
    const label =
      run && isRunActive(run.status)
        ? 'This will stop the running task and remove it.'
        : 'This will remove the thread.'
    if (!confirm(label)) return

    try {
      const res = await fetchApi(`/api/agents/${agentId}/threads/${threadId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete thread')
      navigate('/threads', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const remaining = MAX_ATTACHMENTS - attachments.length
    const toAdd = Array.from(files).slice(0, remaining)

    const newAttachments: DraftAttachment[] = []
    for (const file of toAdd) {
      const base64 = await fileToBase64(file)
      newAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        base64,
      })
    }

    setAttachments((prev) => [...prev, ...newAttachments])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  const hasContent = followUp.trim().length > 0 || attachments.length > 0

  const handleContinue = async () => {
    if (!hasContent) {
      setError('Please enter a follow-up message or attach images')
      return
    }

    setIsContinuing(true)
    try {
      const uploadAttachments: RunImageAttachmentUpload[] = attachments.map((a) => ({
        id: a.id,
        name: a.file.name,
        mimeType: a.file.type,
        sizeBytes: a.file.size,
        base64: a.base64,
      }))

      const opts = Object.keys(turnOptions).length > 0 ? turnOptions : undefined
      const body: ContinueRunRequest = {
        prompt: followUp.trim(),
        ...(uploadAttachments.length > 0 ? { attachments: uploadAttachments } : {}),
        options: opts,
      }
      const res = await fetchApi(`/api/agents/${agentId}/threads/${threadId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to continue thread')
      }
      const data = (await res.json()) as RunDetailResponse
      setRun(data.run)
      setTurns(data.turns)
      setFollowUp('')
      // Clean up object URLs
      for (const a of attachments) URL.revokeObjectURL(a.previewUrl)
      setAttachments([])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsContinuing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="thread-detail-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading thread...</span>
        </div>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="thread-detail-page">
        <div className="threads-empty">
          <h2>Thread not found</h2>
          {error ? <p>{error}</p> : null}
        </div>
      </div>
    )
  }

  const sc = statusClass(run.status)

  // Tool detail full-page view
  if (drawerItems) {
    return (
      <div className="thread-detail-page">
        <ToolDrawer items={drawerItems} onClose={closeToolDrawer} />
      </div>
    )
  }

  return (
    <div className="thread-detail-page">
      {/* Mobile header — single compact row */}
      <div className="thread-detail-header thread-detail-header--mobile">
        <button
          className="icon-button"
          onClick={() => navigate('/threads')}
          type="button"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="thread-mobile-info">
          <span className="thread-mobile-repo">{repoName(run.repoPath)}</span>
          <span className="thread-mobile-sep">·</span>
          <span className="thread-mobile-tool">{toolLabel(run.tool)}</span>
        </span>
        <span className={`thread-status-badge ${sc}`}>
          <span className={`thread-status-dot ${sc}`} />
          {statusLabel(run.status)}
        </span>
      </div>

      {/* Desktop two-column layout */}
      <div className="thread-detail-body">
        {/* Left sidebar (desktop only) */}
        <aside className="thread-sidebar">
          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Tool</span>
            <div className="thread-sidebar-row">
              <span className={`thread-tool-badge ${run.tool}`}>{toolIcon(run.tool)}</span>
              <span className="thread-sidebar-value">{toolLabel(run.tool)}</span>
            </div>
          </div>

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Repository</span>
            <span className="thread-sidebar-value thread-sidebar-repo" title={run.repoPath}>
              {repoName(run.repoPath)}
            </span>
            <span className="thread-sidebar-detail">{run.repoPath}</span>
          </div>

          {run.branch ? (
            <div className="thread-sidebar-section">
              <span className="thread-sidebar-label">Branch</span>
              <span className="thread-sidebar-value mono">{run.branch}</span>
            </div>
          ) : null}

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Status</span>
            <span className={`thread-status-badge ${sc}`}>
              <span className={`thread-status-dot ${sc}`} />
              {statusLabel(run.status)}
            </span>
          </div>

          <div className="thread-sidebar-section">
            <span className="thread-sidebar-label">Updated</span>
            <span className="thread-sidebar-detail">{timeAgo(run.updatedAt)}</span>
          </div>

          <div className="thread-sidebar-actions">
            {active ? (
              <button
                className="secondary-button thread-interrupt-button"
                onClick={() => void handleInterrupt()}
                type="button"
              >
                <StopCircle size={14} />
                Interrupt
              </button>
            ) : null}
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
        <div className="thread-detail-main">
          {/* Timeline */}
          <div className="thread-detail-timeline" ref={timelineRef}>
            {nonQueuedTurns.length === 0 && queuedTurns.length === 0 ? (
              <div className="thread-detail-empty">
                <p>{active ? 'Thread started. Waiting for timeline events...' : 'No timeline recorded.'}</p>
              </div>
            ) : (
              nonQueuedTurns.map((turn, i) => (
                <TurnMessages
                  key={turn.id}
                  turn={turn}
                  showDivider={i > 0}
                  onOpenTools={openToolDrawer}
                />
              ))
            )}

            {/* Queued messages */}
            {queuedTurns.length > 0 ? (
              <div className="queued-turns">
                <div className="queued-turns-header">
                  <span className="queued-turns-label">Queued ({queuedTurns.length})</span>
                </div>
                {queuedTurns.map((turn) => (
                  <div className="queued-turn-card" key={turn.id}>
                    {editingTurnId === turn.id ? (
                      <div className="queued-turn-edit">
                        <textarea
                          className="thread-composer-input"
                          rows={2}
                          value={editingPrompt}
                          onChange={(e) => setEditingPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault()
                              void handleUpdateQueuedTurn(turn.id, editingPrompt)
                            }
                            if (e.key === 'Escape') setEditingTurnId(null)
                          }}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <div className="queued-turn-edit-actions">
                          <button
                            className="secondary-button"
                            onClick={() => setEditingTurnId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className="primary-button"
                            disabled={!editingPrompt.trim()}
                            onClick={() => void handleUpdateQueuedTurn(turn.id, editingPrompt)}
                            type="button"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <pre className="queued-turn-prompt">{turn.prompt}</pre>
                        <div className="queued-turn-actions">
                          <button
                            className="icon-button"
                            onClick={() => { setEditingTurnId(turn.id); setEditingPrompt(turn.prompt) }}
                            title="Edit"
                            type="button"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button kill-button"
                            onClick={() => void handleDeleteQueuedTurn(turn.id)}
                            title="Remove"
                            type="button"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="thread-detail-footer">
            {/* Interrupt + resume/discard controls */}
            {active ? (
              <button
                className="secondary-button thread-interrupt-button thread-interrupt-button--mobile"
                onClick={() => void handleInterrupt()}
                type="button"
              >
                <StopCircle size={14} />
                Interrupt
              </button>
            ) : null}

            {interruptedWithQueue ? (
              <div className="queue-decision">
                <span className="queue-decision-label">
                  {queuedTurns.length} queued message{queuedTurns.length > 1 ? 's' : ''}
                </span>
                <button
                  className="primary-button"
                  onClick={() => void handleResumeQueue()}
                  type="button"
                >
                  <ListRestart size={14} />
                  Resume queue
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void handleDiscardQueue()}
                  type="button"
                >
                  <Trash2 size={14} />
                  Discard all
                </button>
              </div>
            ) : null}

            {/* Composer — always visible when thread can accept messages */}
            {active || canContinue(latestTurn) ? (
              <>
                {/* Attachment thumbnails */}
                {attachments.length > 0 ? (
                  <div className="composer-attachments">
                    {attachments.map((a) => (
                      <div key={a.id} className="attachment-thumb attachment-thumb--small">
                        <img src={a.previewUrl} alt={a.file.name} className="attachment-thumb-img" />
                        <button
                          className="attachment-thumb-remove"
                          onClick={() => removeAttachment(a.id)}
                          title="Remove"
                          type="button"
                        >
                          <X size={10} />
                        </button>
                        <span className="attachment-thumb-name">{a.file.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {!active ? (
                  <TurnOptionsPanel
                    tool={run?.tool ?? 'claude'}
                    options={turnOptions}
                    onChange={setTurnOptions}
                    expanded={showOptions}
                    onToggle={() => setShowOptions(v => !v)}
                  />
                ) : null}
                <div className="thread-composer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="visually-hidden"
                    onChange={(e) => void handleFilesSelected(e.target.files)}
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
                    placeholder={active ? 'Queue a follow-up message...' : 'Message this thread...'}
                    rows={1}
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        void handleContinue()
                      }
                    }}
                  />
                  <button
                    className="composer-send-btn"
                    disabled={isContinuing || !hasContent}
                    onClick={() => void handleContinue()}
                    type="button"
                    title={active ? 'Queue message' : 'Send message'}
                  >
                    {isContinuing ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                  </button>
                </div>
                {error ? <p className="error-banner thread-error">{error}</p> : null}
              </>
            ) : (
              <span className="thread-footer-hint">Thread ended.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'max'] as const
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

function TurnOptionsPanel({ tool, options, onChange, expanded, onToggle }: {
  tool: 'codex' | 'claude'
  options: RunTurnOptions
  onChange: (opts: RunTurnOptions) => void
  expanded: boolean
  onToggle: () => void
}) {
  const efforts = tool === 'claude' ? CLAUDE_EFFORTS : CODEX_EFFORTS
  const activeEffort = tool === 'claude' ? options.claudeEffort : options.codexEffort
  const hasActive = !!options.model || !!activeEffort || !!options.clearSession

  return (
    <div className="turn-options-bar">
      <button className="turn-options-toggle" onClick={onToggle} type="button">
        <span className={hasActive ? 'turn-options-label active' : 'turn-options-label'}>
          {expanded ? '▾' : '▸'} Options{hasActive ? ' ●' : ''}
        </span>
      </button>
      {expanded ? (
        <div className="turn-options-panel">
          <div className="turn-option-row">
            <label className="turn-option-label">Model</label>
            <input
              className="turn-option-input"
              type="text"
              placeholder={tool === 'claude' ? 'e.g. claude-sonnet-4-6' : 'e.g. o4-mini'}
              value={options.model ?? ''}
              onChange={(e) => onChange({ ...options, model: e.target.value || undefined })}
            />
          </div>
          <div className="turn-option-row">
            <label className="turn-option-label">Effort</label>
            <div className="turn-option-chips">
              {efforts.map((level) => {
                const isActive = activeEffort === level
                return (
                  <button
                    key={level}
                    type="button"
                    className={isActive ? 'turn-option-chip active' : 'turn-option-chip'}
                    onClick={() => {
                      if (tool === 'claude') {
                        onChange({ ...options, claudeEffort: isActive ? undefined : level as RunTurnOptions['claudeEffort'] })
                      } else {
                        onChange({ ...options, codexEffort: isActive ? undefined : level as RunTurnOptions['codexEffort'] })
                      }
                    }}
                  >
                    {level}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="turn-option-row">
            <label className="turn-option-label">
              <input
                type="checkbox"
                checked={!!options.clearSession}
                onChange={(e) => onChange({ ...options, clearSession: e.target.checked || undefined })}
              />
              {' '}Clear session
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TurnMessages({ turn, showDivider, onOpenTools }: {
  turn: RunTurnDetail
  showDivider: boolean
  onOpenTools: (items: RunTimelineEvent[]) => void
}) {
  const hasAttachments = turn.attachments && turn.attachments.length > 0
  const segments = groupIntoSegments(turn.items)

  return (
    <>
      {showDivider ? <div className="chat-divider" /> : null}

      {/* User prompt */}
      <div className="chat-bubble user">
        <div className="chat-role">You</div>
        <div className="chat-content">{turn.prompt}</div>
        {hasAttachments ? (
          <div className="turn-attachments-indicator">
            <Paperclip size={12} />
            <span>{turn.attachments.length} image{turn.attachments.length > 1 ? 's' : ''} attached</span>
          </div>
        ) : null}
      </div>

      {turn.items.length === 0 ? (
        <div className="turn-empty">
          <span>Waiting for events...</span>
        </div>
      ) : (
        segments.map((seg, idx) => {
          if (seg.type === 'assistant') {
            return (
              <div key={`assistant-${seg.id}`} className="chat-bubble assistant">
                <div className="chat-role">Assistant</div>
                <div className="chat-content message-text">
                  <Markdown remarkPlugins={[remarkGfm]}>{seg.text}</Markdown>
                </div>
              </div>
            )
          }

          if (seg.type === 'system') {
            return (
              <div key={`system-${seg.id}`} className="chat-system">
                {seg.text}
              </div>
            )
          }

          return <ToolsGroup key={`tools-${idx}`} items={seg.items} onOpen={onOpenTools} />
        })
      )}
    </>
  )
}

function ToolsGroup({ items, onOpen }: { items: RunTimelineEvent[]; onOpen: (items: RunTimelineEvent[]) => void }) {
  // Always show todos inline, separate from the collapsible tools group
  const todoItems = items.filter((i) => i.type === 'todo')
  const rest = items.filter((i) => i.type !== 'todo')

  return (
    <>
      {todoItems.map((item) => (
        <TodoCard key={item.id} item={item as Extract<RunTimelineEvent, { type: 'todo' }>} />
      ))}
      {rest.length > 0 && <ToolsGroupInner items={rest} onOpen={onOpen} />}
    </>
  )
}

function ToolsGroupInner({ items, onOpen }: { items: RunTimelineEvent[]; onOpen: (items: RunTimelineEvent[]) => void }) {
  // Single activity with short/no detail → show inline as system text
  if (items.length === 1 && items[0].type === 'activity') {
    const a = items[0]
    const detail = a.detail && a.detail.length <= 80 ? `: ${a.detail}` : ''
    return <div className="chat-system">{a.label}{detail}</div>
  }

  // Only trivial activities (no commands, all short) → show inline
  const hasCommands = items.some((i) => i.type === 'command')
  if (!hasCommands && items.length <= 3 && items.every((i) => i.type === 'activity' && (!i.detail || i.detail.length <= 80))) {
    return (
      <div className="chat-system">
        {items.map((i) => i.type === 'activity' ? i.label : '').filter(Boolean).join(' → ')}
      </div>
    )
  }

  const commands = items.filter((i) => i.type === 'command').length
  const activities = items.filter((i) => i.type === 'activity').length
  const parts: string[] = []
  if (commands > 0) parts.push(`${commands} command${commands > 1 ? 's' : ''}`)
  if (activities > 0) parts.push(`${activities} activit${activities > 1 ? 'ies' : 'y'}`)
  const summary = parts.join(', ')

  return (
    <button
      className="chat-tools-inline"
      onClick={() => onOpen(items)}
      type="button"
    >
      <Wrench size={12} />
      <span>{summary}</span>
      <ChevronRight size={12} />
    </button>
  )
}

function ToolDrawer({ items, onClose }: { items: RunTimelineEvent[]; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="tool-drawer-page">
      <div className="tool-drawer-page-header">
        <button className="secondary-button" onClick={onClose} type="button">
          <ArrowLeft size={16} />
          Back
        </button>
        <h3>Tool Details</h3>
      </div>
      <div className="tool-drawer-page-body">
        {items.map((item) => {
          if (item.type === 'command') {
            return <CommandItem key={item.id} item={item} />
          }
          if (item.type === 'activity') {
            return <ActivityItem key={item.id} item={item} />
          }
          if (item.type === 'todo') {
            return <TodoCard key={item.id} item={item} />
          }
          return null
        })}
      </div>
    </div>
  )
}

function ActivityItem({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: 'activity' }>
}) {
  // Only show Expand when content exceeds the CSS -webkit-line-clamp (3 lines)
  const hasLongDetail = !!item.detail && item.detail.split('\n').length > 3
  const [expanded, setExpanded] = useState(false)

  const dotClass =
    item.status === 'success' ? 'success'
    : item.status === 'warning' ? 'warning'
    : item.status === 'error' ? 'danger'
    : 'accent'

  return (
    <div className="timeline-activity">
      <span className={`timeline-activity-dot ${dotClass}`} />
      <div className="timeline-activity-text">
        <div className="timeline-activity-header">
          <span className="timeline-activity-label">{item.label}</span>
          {hasLongDetail ? (
            <button
              className="activity-toggle"
              onClick={() => setExpanded(!expanded)}
              type="button"
            >
              {expanded ? 'Collapse' : 'Expand'}
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : null}
        </div>
        {item.detail ? (
          <pre className={`timeline-activity-detail ${hasLongDetail && !expanded ? 'clamped' : ''}`}>
            {item.detail}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

function TodoCard({ item }: { item: Extract<RunTimelineEvent, { type: 'todo' }> }) {
  const completedCount = item.items.filter((e) => e.status === 'completed').length
  const totalCount = item.items.length

  return (
    <div className="timeline-card todo-card">
      <div className="todo-header">
        <span className="timeline-eyebrow accent">Todo List</span>
        <span className="todo-progress">{completedCount}/{totalCount}</span>
      </div>
      <ul className="todo-list">
        {item.items.map((entry, i) => (
          <li key={i} className={`todo-entry todo-entry--${entry.status}`}>
            <span className="todo-icon">
              {entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '◉' : '○'}
            </span>
            <span className="todo-text">{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CommandItem({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: 'command' }>
}) {
  const [expanded, setExpanded] = useState(false)
  // Only show Expand when content exceeds the CSS -webkit-line-clamp (4 lines)
  const isCollapsible = item.output.split('\n').length > 4
  const cmdClass =
    item.status === 'failed' ? 'danger'
    : item.status === 'completed' ? 'success'
    : 'accent'

  return (
    <div className="timeline-card command-card">
      <div className="command-header">
        <span className={`timeline-eyebrow ${cmdClass}`}>
          {item.status === 'started' ? 'Command running' : 'Command'}
        </span>
        {item.exitCode !== null ? (
          <span className="command-exit">exit {item.exitCode}</span>
        ) : null}
      </div>
      <code className="command-text">{item.command}</code>
      {item.output ? (
        <div className="command-output">
          <div className="command-output-header">
            <span className="command-output-label">Output</span>
            {isCollapsible ? (
              <button
                className="command-output-toggle"
                onClick={() => setExpanded(!expanded)}
                type="button"
              >
                {expanded ? 'Collapse' : 'Expand'}
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : null}
          </div>
          <pre className={`command-output-text ${!expanded && isCollapsible ? 'clamped' : ''}`}>
            {item.output.trimEnd()}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

// Helper: upsert a turn in the turns array
function upsertTurn(prev: RunTurnDetail[], turn: RunTurn): RunTurnDetail[] {
  const idx = prev.findIndex((t) => t.id === turn.id)
  if (idx >= 0) {
    const next = [...prev]
    next[idx] = { ...next[idx], ...turn, items: next[idx].items }
    return next
  }
  return [...prev, { ...turn, items: [] }]
}

// Helper: append a timeline item to the correct turn
function appendItem(
  prev: RunTurnDetail[],
  turnId: string,
  item: RunTimelineEvent,
): RunTurnDetail[] {
  const idx = prev.findIndex((t) => t.id === turnId)
  if (idx < 0) return prev // signal caller to refetch

  const turn = prev[idx]
  // Avoid duplicates
  if (turn.items.some((i) => i.id === item.id)) return prev

  const next = [...prev]
  next[idx] = { ...turn, items: [...turn.items, item] }
  return next
}
