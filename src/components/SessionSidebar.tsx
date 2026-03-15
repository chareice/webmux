import { LoaderCircle, RefreshCcw, Trash2 } from 'lucide-react'

import type { SessionSummary } from '../../shared/contracts.ts'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  selectedSessionName: string | null
  draftName: string
  isCreating: boolean
  error: string | null
  onDraftNameChange: (value: string) => void
  onCreateSession: () => void
  onRefresh: () => void
  onSelectSession: (name: string) => void
  onKillSession: (name: string) => void
}

export function SessionSidebar(props: SessionSidebarProps) {
  const {
    sessions,
    selectedSessionName,
    draftName,
    isCreating,
    error,
    onDraftNameChange,
    onCreateSession,
    onRefresh,
    onSelectSession,
    onKillSession,
  } = props

  return (
    <section className="session-rail">
      <div className="brand-card">
        <p className="eyebrow">Pocket Terminal</p>
        <h1>Webmux</h1>
        <p className="brand-copy">
          A tmux-backed cockpit for hopping between long-running shells from your phone.
        </p>
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

        {sessions.length === 0 ? (
          <div className="empty-card">
            <p>No sessions yet.</p>
            <p>Create one and it will stay alive on the server after you disconnect.</p>
          </div>
        ) : (
          <div className="session-list">
            {sessions.map((session) => {
              const isSelected = selectedSessionName === session.name

              return (
                <article
                  aria-pressed={isSelected}
                  className={`session-card${isSelected ? ' active' : ''}`}
                  key={session.name}
                >
                  <button
                    className="session-open"
                    onClick={() => onSelectSession(session.name)}
                    type="button"
                  >
                    <div className="session-header">
                      <div>
                        <h3>{session.name}</h3>
                        <p>{session.path}</p>
                      </div>
                      <span className={`session-badge${session.attachedClients > 0 ? ' live' : ''}`}>
                        {session.attachedClients > 0 ? 'Live' : 'Idle'}
                      </span>
                    </div>
                    <div className="session-meta">
                      <span>{session.windows} windows</span>
                      <span>{session.attachedClients} attached</span>
                      <span>{formatTimestamp(session.lastActivityAt)}</span>
                    </div>
                    <pre className="session-preview">{session.preview.join('\n')}</pre>
                  </button>

                  <button
                    aria-label={`Kill ${session.name}`}
                    className="icon-button"
                    onClick={() => onKillSession(session.name)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}
