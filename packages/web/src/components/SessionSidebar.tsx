import { useCallback, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pin,
  PinOff,
  RefreshCcw,
  Search,
  Trash2,
} from 'lucide-react'

import type { SessionSummary } from '@webmux/shared'

/* ── Swipe-to-delete hook ─────────────────────────── */

const SWIPE_DELETE_WIDTH = 72 // px: snap threshold and revealed width

function useSwipeToDelete() {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)
  const [revealed, setRevealed] = useState(false)

  const reset = useCallback(() => {
    const el = innerRef.current
    if (el) {
      el.style.transition = 'transform 0.25s ease'
      el.style.transform = 'translateX(0)'
      el.style.willChange = ''
    }
    setRevealed(false)
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    currentX.current = 0
    swiping.current = false
    const el = innerRef.current
    if (el) {
      el.style.transition = 'none'
      el.style.willChange = 'transform'
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    const dx = touch.clientX - startX.current
    const dy = Math.abs(touch.clientY - startY.current)

    // If vertical scroll is dominant, bail out
    if (!swiping.current && dy > 10 && Math.abs(dx) < dy) return
    if (Math.abs(dx) > 10) swiping.current = true
    if (!swiping.current) return

    // Only allow swipe left (negative dx), clamp to delete width
    const offset = Math.max(-SWIPE_DELETE_WIDTH, Math.min(0, dx))
    currentX.current = offset
    const el = innerRef.current
    if (el) el.style.transform = `translateX(${offset}px)`
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!swiping.current) return
    const el = innerRef.current
    if (el) el.style.transition = 'transform 0.25s ease'

    if (currentX.current < -SWIPE_DELETE_WIDTH) {
      // Snap open
      if (el) el.style.transform = `translateX(-${SWIPE_DELETE_WIDTH}px)`
      setRevealed(true)
    } else {
      // Snap closed
      if (el) {
        el.style.transform = 'translateX(0)'
        el.style.willChange = ''
      }
      setRevealed(false)
    }
    swiping.current = false
  }, [])

  return { innerRef, revealed, reset, onTouchStart, onTouchMove, onTouchEnd }
}

interface SessionSidebarProps {
  sessions: SessionSummary[]
  selectedSessionName: string | null
  draftName: string
  isCreating: boolean
  error: string | null
  collapsed: boolean
  unreadSessions: Set<string>
  pinnedSessions: Set<string>
  agentName: string
  onBackToAgents: () => void
  onDraftNameChange: (value: string) => void
  onCreateSession: () => void
  onRefresh: () => void
  onSelectSession: (name: string) => void
  onKillSession: (name: string) => void
  onToggleCollapse: () => void
  onTogglePin: (name: string) => void
}

export function SessionSidebar(props: SessionSidebarProps) {
  const {
    sessions,
    selectedSessionName,
    draftName,
    isCreating,
    error,
    collapsed,
    unreadSessions,
    pinnedSessions,
    agentName,
    onBackToAgents,
    onDraftNameChange,
    onCreateSession,
    onRefresh,
    onSelectSession,
    onKillSession,
    onToggleCollapse,
    onTogglePin,
  } = props

  const [searchQuery, setSearchQuery] = useState('')

  // Dashboard stats
  const activeSessions = sessions.filter((session) => session.attachedClients > 0)
  const idleSessions = sessions.filter((session) => session.attachedClients === 0)
  const unreadCount = unreadSessions.size

  // Filter and sort: pinned first, then by activity
  const filtered = sessions.filter((session) =>
    session.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const pinned = filtered.filter((session) => pinnedSessions.has(session.name))
  const unpinned = filtered.filter((session) => !pinnedSessions.has(session.name))
  const sortedSessions = [...pinned, ...unpinned]

  if (collapsed) {
    return (
      <section className="session-rail collapsed">
        <button
          className="collapse-toggle"
          onClick={onToggleCollapse}
          type="button"
          title="Expand sidebar"
        >
          <ChevronRight size={18} />
        </button>
        <div className="collapsed-sessions">
          {sessions.map((session) => {
            const isSelected = selectedSessionName === session.name
            const hasUnread = unreadSessions.has(session.name)

            return (
              <button
                className={`collapsed-session-dot${isSelected ? ' active' : ''}`}
                key={session.name}
                onClick={() => onSelectSession(session.name)}
                title={session.name}
                type="button"
              >
                <span className="collapsed-initial">
                  {session.name.charAt(0).toUpperCase()}
                </span>
                {hasUnread ? <span className="unread-dot" /> : null}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <section className="session-rail">
      <div className="brand-card">
        <div className="brand-header">
          <div className="brand-agent-info">
            <button
              className="secondary-button back-to-agents"
              onClick={onBackToAgents}
              type="button"
            >
              <ArrowLeft size={14} />
              Agents
            </button>
            <h1>{agentName || 'Webmux'}</h1>
          </div>
          <button
            className="collapse-toggle desktop-only"
            onClick={onToggleCollapse}
            type="button"
            title="Collapse sidebar"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        {/* Dashboard overview */}
        <div className="dashboard-bar">
          <span className="dashboard-stat">
            <span className="stat-dot live" />
            {activeSessions.length} active
          </span>
          <span className="dashboard-stat">
            <span className="stat-dot idle" />
            {idleSessions.length} idle
          </span>
          {unreadCount > 0 ? (
            <span className="dashboard-stat unread">
              <span className="stat-dot unread" />
              {unreadCount} unread
            </span>
          ) : null}
        </div>

        <button className="secondary-button ghost-button" onClick={onRefresh} type="button">
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      <form
        className="create-card"
        onSubmit={(event) => {
          event.preventDefault()
          onCreateSession()
        }}
      >
        <label className="field-label" htmlFor="session-name">
          New session
        </label>
        <div className="input-row">
          <input
            id="session-name"
            autoComplete="off"
            className="session-input"
            disabled={isCreating}
            maxLength={32}
            onChange={(event) => onDraftNameChange(event.target.value)}
            placeholder="ops, codex, inbox"
            value={draftName}
          />
          <button className="primary-button" disabled={isCreating} type="submit">
            {isCreating ? <LoaderCircle className="spin" size={16} /> : 'Create'}
          </button>
        </div>
        <p className="field-hint">Letters, numbers, dot, dash, underscore. Keep it short.</p>
        {error ? <p className="error-banner">{error}</p> : null}
      </form>

      <div className="session-list-card">
        <div className="section-heading">
          <h2>Sessions</h2>
          <span>{sessions.length}</span>
        </div>

        {/* Search filter */}
        {sessions.length > 5 ? (
          <div className="session-search">
            <Search size={15} />
            <input
              className="session-search-input"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter sessions..."
              type="text"
              value={searchQuery}
            />
          </div>
        ) : null}

        {sortedSessions.length === 0 && sessions.length > 0 ? (
          <div className="empty-card">
            <p>No sessions match "{searchQuery}".</p>
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="empty-card">
            <p>No sessions yet.</p>
            <p>Create one and it will stay alive on the server after you disconnect.</p>
          </div>
        ) : (
          <div className="session-list">
            {sortedSessions.map((session) => (
              <SwipeableSessionCard
                key={session.name}
                session={session}
                isSelected={selectedSessionName === session.name}
                hasUnread={unreadSessions.has(session.name)}
                isPinned={pinnedSessions.has(session.name)}
                onSelect={onSelectSession}
                onKill={onKillSession}
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Swipeable session card ────────────────────────── */

interface SwipeableSessionCardProps {
  session: SessionSummary
  isSelected: boolean
  hasUnread: boolean
  isPinned: boolean
  onSelect: (name: string) => void
  onKill: (name: string) => void
  onTogglePin: (name: string) => void
}

function SwipeableSessionCard({
  session,
  isSelected,
  hasUnread,
  isPinned,
  onSelect,
  onKill,
  onTogglePin,
}: SwipeableSessionCardProps) {
  const swipe = useSwipeToDelete()

  return (
    <article
      aria-pressed={isSelected}
      className={`session-card${isSelected ? ' active' : ''}${hasUnread ? ' has-unread' : ''}`}
    >
      {/* Delete zone revealed behind the card */}
      <button
        className="swipe-delete-zone"
        onClick={() => {
          swipe.reset()
          onKill(session.name)
        }}
        style={{ width: SWIPE_DELETE_WIDTH }}
        type="button"
        aria-label={`Kill ${session.name}`}
      >
        <Trash2 size={18} />
      </button>

      {/* Swipeable inner content */}
      <div
        className="session-card-inner"
        ref={swipe.innerRef}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
      >
        <button
          className="session-open"
          onClick={() => {
            if (swipe.revealed) {
              swipe.reset()
              return
            }
            onSelect(session.name)
          }}
          type="button"
          title={session.path}
        >
          <div className="session-header">
            <div className="session-name-row">
              {hasUnread ? <span className="unread-dot" /> : null}
              <h3>{session.name}</h3>
              {isPinned ? <Pin size={13} className="pin-icon" /> : null}
            </div>
            <span className={`session-badge${session.attachedClients > 0 ? ' live' : ''}`}>
              {session.attachedClients > 0
                ? session.attachedClients === 1
                  ? 'Live'
                  : `${session.attachedClients} clients`
                : 'Idle'}
            </span>
          </div>
          <div className="session-meta">
            <span className="session-cmd">{session.currentCommand || 'shell'}</span>
            <span>{compactPath(session.path)}</span>
            <span>{formatTimestamp(session.lastActivityAt)}</span>
          </div>
          <pre className="session-preview">{session.preview.join('\n')}</pre>
        </button>

        <div className="session-actions">
          <button
            aria-label={isPinned ? `Unpin ${session.name}` : `Pin ${session.name}`}
            className="icon-button pin-button"
            onClick={() => onTogglePin(session.name)}
            type="button"
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            aria-label={`Kill ${session.name}`}
            className="icon-button kill-button"
            onClick={() => onKill(session.name)}
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatTimestamp(timestamp: number): string {
  return timestampFormatter.format(new Date(timestamp * 1000))
}

function compactPath(path: string): string {
  const segments = path.split('/').filter(Boolean)

  if (segments.length <= 3) {
    return path
  }

  return `.../${segments.slice(-3).join('/')}`
}
