import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Send,
  StopCircle,
} from 'lucide-react'
import { fetchApi, useAuth } from '../auth.tsx'
import { createReconnectableSocket } from '../lib/reconnectable-socket.ts'
import type {
  ContinueRunRequest,
  Run,
  RunDetailResponse,
  RunEvent,
  RunStatus,
  RunTimelineEvent,
  RunTimelineEventPayload,
  RunTurn,
  RunTurnDetail,
} from '@webmux/shared'

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

function isRunActive(status: RunStatus): boolean {
  return status === 'starting' || status === 'running'
}

function canContinue(turn: RunTurnDetail | undefined): boolean {
  if (!turn) return false
  return turn.status === 'success' || turn.status === 'failed' || turn.status === 'interrupted'
}

function toolIcon(tool: string): string {
  return tool === 'codex' ? 'CX' : 'CC'
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ThreadDetailPage() {
  const { agentId, threadId } = useParams<{ agentId: string; threadId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [run, setRun] = useState<Run | null>(null)
  const [turns, setTurns] = useState<RunTurnDetail[]>([])
  const [followUp, setFollowUp] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isContinuing, setIsContinuing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)

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

  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : undefined
  const active = latestTurn ? isRunActive(latestTurn.status) : run ? isRunActive(run.status) : false

  const handleInterrupt = async () => {
    try {
      await fetchApi(`/api/agents/${agentId}/threads/${threadId}/interrupt`, { method: 'POST' })
    } catch {
      // Ignore transient failures
    }
  }

  const handleContinue = async () => {
    if (!followUp.trim()) {
      setError('Please enter a follow-up message')
      return
    }

    setIsContinuing(true)
    try {
      const body: ContinueRunRequest = { prompt: followUp.trim() }
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

  return (
    <div className="thread-detail-page">
      {/* Header */}
      <div className="thread-detail-header">
        <div className="thread-detail-header-left">
          <button
            className="secondary-button"
            onClick={() => navigate('/threads')}
            type="button"
          >
            <ArrowLeft size={14} />
            <span className="button-label">Back</span>
          </button>
          <span className={`thread-tool-badge ${run.tool}`}>{toolIcon(run.tool)}</span>
          <div className="thread-detail-title">
            <span className="thread-detail-repo">{run.repoPath}</span>
            {run.branch ? <span className="thread-detail-branch">{run.branch}</span> : null}
          </div>
        </div>
        <span className={`thread-status-badge ${statusClass(run.status)}`}>
          <span className={`thread-status-dot ${statusClass(run.status)}`} />
          {statusLabel(run.status)}
        </span>
      </div>

      {/* Summary */}
      {run.summary ? (
        <div className="thread-detail-summary">
          <span className="thread-detail-summary-label">Latest Summary</span>
          <p className="thread-detail-summary-text">{run.summary}</p>
        </div>
      ) : null}

      {/* Timeline */}
      <div className="thread-detail-timeline" ref={timelineRef}>
        {turns.length === 0 ? (
          <div className="thread-detail-empty">
            <p>{active ? 'Thread started. Waiting for timeline events...' : 'No timeline recorded.'}</p>
          </div>
        ) : (
          turns.map((turn) => <TurnSection key={turn.id} turn={turn} />)
        )}
      </div>

      {/* Footer */}
      <div className="thread-detail-footer">
        {active ? (
          <>
            <button
              className="secondary-button thread-interrupt-button"
              onClick={() => void handleInterrupt()}
              type="button"
            >
              <StopCircle size={14} />
              Interrupt
            </button>
            <span className="thread-footer-hint">
              Follow-up input becomes available after the current turn finishes.
            </span>
          </>
        ) : canContinue(latestTurn) ? (
          <>
            <div className="thread-composer">
              <textarea
                className="thread-composer-input"
                placeholder="Message this thread..."
                rows={2}
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
                className="primary-button thread-send-button"
                disabled={isContinuing || !followUp.trim()}
                onClick={() => void handleContinue()}
                type="button"
              >
                {isContinuing ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              </button>
            </div>
            {error ? <p className="error-banner thread-error">{error}</p> : null}
          </>
        ) : (
          <span className="thread-footer-hint">Thread ended.</span>
        )}
      </div>
    </div>
  )
}

function TurnSection({ turn }: { turn: RunTurnDetail }) {
  return (
    <div className="turn-section">
      <div className="turn-header">
        <span className="turn-title">Turn {turn.index}</span>
        <span className={`turn-status ${statusClass(turn.status)}`}>
          {statusLabel(turn.status)}
        </span>
      </div>

      {/* User prompt */}
      <div className="timeline-card message-card user">
        <span className="timeline-eyebrow">User</span>
        <p className="timeline-text">{turn.prompt}</p>
      </div>

      {turn.items.length === 0 ? (
        <div className="turn-empty">
          <span>Waiting for events...</span>
        </div>
      ) : (
        turn.items.map((item) => <TimelineItem key={item.id} item={item} />)
      )}
    </div>
  )
}

function TimelineItem({ item }: { item: RunTimelineEvent }) {
  if (item.type === 'message') {
    const roleLabel = item.role === 'assistant' ? 'Assistant' : item.role === 'user' ? 'User' : 'System'
    return (
      <div className={`timeline-card message-card ${item.role}`}>
        <span className="timeline-eyebrow">{roleLabel}</span>
        <pre className="timeline-text message-text">{item.text}</pre>
      </div>
    )
  }

  if (item.type === 'command') {
    return <CommandItem item={item} />
  }

  // activity
  const dotClass =
    item.status === 'success' ? 'success'
    : item.status === 'warning' ? 'warning'
    : item.status === 'error' ? 'danger'
    : 'accent'

  return (
    <div className="timeline-activity">
      <span className={`timeline-activity-dot ${dotClass}`} />
      <div className="timeline-activity-text">
        <span className="timeline-activity-label">{item.label}</span>
        {item.detail ? <span className="timeline-activity-detail">{item.detail}</span> : null}
      </div>
    </div>
  )
}

function CommandItem({
  item,
}: {
  item: Extract<RunTimelineEvent, { type: 'command' }>
}) {
  const [expanded, setExpanded] = useState(false)
  const isCollapsible = item.output.length > 200 || item.output.split('\n').length > 4
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
