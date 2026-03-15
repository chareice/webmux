import { Suspense, lazy, startTransition, useEffect, useState } from 'react'

import type {
  CreateSessionResponse,
  ListSessionsResponse,
  SessionSummary,
} from '../shared/contracts.ts'
import { SessionSidebar } from './components/SessionSidebar.tsx'
import './App.css'

const TerminalPanel = lazy(async () => {
  const module = await import('./components/TerminalPanel.tsx')
  return {
    default: module.TerminalPanel,
  }
})

function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('codex')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileTerminalOpen, setMobileTerminalOpen] = useState(false)

  const applySessions = (payload: ListSessionsResponse) => {
    setSessions(payload.sessions)

    startTransition(() => {
      setSelectedSessionName((current) => {
        if (current && payload.sessions.some((session) => session.name === current)) {
          return current
        }

        return payload.sessions[0]?.name ?? null
      })
    })
  }

  const refreshSessions = async () => {
    try {
      const response = await fetch('/api/sessions')

      if (!response.ok) {
        throw new Error('Failed to load sessions.')
      }

      const payload = (await response.json()) as ListSessionsResponse
      applySessions(payload)
    } catch (requestError) {
      setError((requestError as Error).message)
    }
  }

  useEffect(() => {
    let isDisposed = false

    const syncSessions = async () => {
      try {
        const response = await fetch('/api/sessions')

        if (!response.ok) {
          throw new Error('Failed to load sessions.')
        }

        const payload = (await response.json()) as ListSessionsResponse

        if (isDisposed) {
          return
        }

        applySessions(payload)
      } catch (requestError) {
        if (!isDisposed) {
          setError((requestError as Error).message)
        }
      }
    }

    void syncSessions()

    const interval = window.setInterval(() => {
      void syncSessions()
    }, 4000)

    return () => {
      isDisposed = true
      window.clearInterval(interval)
    }
  }, [])

  const selectedSession =
    sessions.find((session) => session.name === selectedSessionName) ?? null

  const createSession = async () => {
    const trimmedName = draftName.trim()

    if (!trimmedName) {
      setError('Session name cannot be empty.')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const payload = (await response.json()) as CreateSessionResponse
      setDraftName(trimmedName)
      await refreshSessions()

      startTransition(() => {
        setSelectedSessionName(payload.session.name)
      })
      setMobileTerminalOpen(true)
    } catch (requestError) {
      setError((requestError as Error).message)
    } finally {
      setIsCreating(false)
    }
  }

  const killSession = async (name: string) => {
    const confirmed = window.confirm(`Kill session "${name}"?`)

    if (!confirmed) {
      return
    }

    setError(null)

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`Failed to kill ${name}.`)
      }

      await refreshSessions()

      if (selectedSessionName === name) {
        startTransition(() => {
          setSelectedSessionName(null)
        })
      }
    } catch (requestError) {
      setError((requestError as Error).message)
    }
  }

  return (
    <div className={`app-shell ${mobileTerminalOpen ? 'mobile-terminal-open' : ''}`}>
      <SessionSidebar
        draftName={draftName}
        error={error}
        isCreating={isCreating}
        onCreateSession={() => {
          void createSession()
        }}
        onDraftNameChange={setDraftName}
        onKillSession={(name) => {
          void killSession(name)
        }}
        onRefresh={() => {
          void refreshSessions()
        }}
        onSelectSession={(name) => {
          startTransition(() => {
            setSelectedSessionName(name)
          })
          setMobileTerminalOpen(true)
        }}
        selectedSessionName={selectedSessionName}
        sessions={sessions}
      />
      <Suspense
        fallback={
          <section className="terminal-panel empty-state">
            <div className="empty-terminal-card">
              <p className="eyebrow">Loading terminal</p>
              <h2>Preparing xterm...</h2>
              <p>The session list is already live while the terminal bundle loads.</p>
            </div>
          </section>
        }
      >
        <TerminalPanel
          onBack={() => {
            setMobileTerminalOpen(false)
          }}
          session={selectedSession}
        />
      </Suspense>
    </div>
  )
}

export default App
