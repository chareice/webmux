import { Suspense, lazy, startTransition, useCallback, useEffect, useRef, useState } from 'react'

import type {
  CreateSessionResponse,
  ListSessionsResponse,
  SessionEvent,
  SessionSummary,
} from '../shared/contracts.ts'
import { SessionSidebar } from './components/SessionSidebar.tsx'
import { CommandPalette } from './components/CommandPalette.tsx'
import './App.css'

const TerminalPanel = lazy(async () => {
  const module = await import('./components/TerminalPanel.tsx')
  return {
    default: module.TerminalPanel,
  }
})

const PINNED_STORAGE_KEY = 'webmux:pinned'
const COLLAPSED_STORAGE_KEY = 'webmux:sidebar-collapsed'
const NOTIFICATIONS_STORAGE_KEY = 'webmux:notifications' as const

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function savePinned(pinned: Set<string>) {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...pinned]))
}

function loadCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
}

function loadNotificationsEnabled(): boolean {
  return localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === 'true'
}

function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('codex')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileTerminalOpen, setMobileTerminalOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed)
  const [pinnedSessions, setPinnedSessions] = useState(loadPinned)
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set())
  // Notifications enabled state is read directly from localStorage in applySessions

  const eventSocketRef = useRef<WebSocket | null>(null)
  const eventReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedSessionNameRef = useRef(selectedSessionName)
  selectedSessionNameRef.current = selectedSessionName

  const applySessions = useCallback((incoming: SessionSummary[]) => {
    setSessions((prev) => {
      // Detect new output activity
      const prevMap = new Map(prev.map((session) => [session.name, session]))

      setUnreadSessions((currentUnread) => {
        let changed = false
        const next = new Set(currentUnread)

        for (const session of incoming) {
          const old = prevMap.get(session.name)
          if (!old) continue

          const hasNewActivity = session.lastActivityAt > old.lastActivityAt
          const isSelected = selectedSessionNameRef.current === session.name

          if (hasNewActivity && !isSelected) {
            if (!next.has(session.name)) {
              next.add(session.name)
              changed = true

              // Send browser notification
              if (
                loadNotificationsEnabled() &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                new Notification(`webmux: ${session.name}`, {
                  body: `New activity in ${session.currentCommand || 'shell'}`,
                  tag: `webmux-${session.name}`,
                })
              }
            }
          }
        }

        return changed ? next : currentUnread
      })

      return incoming
    })

    startTransition(() => {
      setSelectedSessionName((current) => {
        if (current && incoming.some((session) => session.name === current)) {
          return current
        }
        return incoming[0]?.name ?? null
      })
    })
  }, [])

  // Events WebSocket connection
  const connectEventSocket = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws/events`)
    eventSocketRef.current = socket

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as SessionEvent
        if (message.type === 'sessions-sync') {
          applySessions(message.sessions)
        }
      } catch {
        // Ignore parse errors
      }
    }

    socket.onclose = () => {
      // Reconnect after a delay
      eventReconnectTimerRef.current = setTimeout(() => {
        connectEventSocket()
      }, 3000)
    }

    socket.onerror = () => {
      // onclose will fire after this
    }
  }, [applySessions])

  useEffect(() => {
    connectEventSocket()

    // Fallback: initial HTTP fetch in case WebSocket takes a moment
    void (async () => {
      try {
        const response = await fetch('/api/sessions')
        if (response.ok) {
          const payload = (await response.json()) as ListSessionsResponse
          applySessions(payload.sessions)
        }
      } catch {
        // Event socket will handle it
      }
    })()

    return () => {
      if (eventReconnectTimerRef.current) {
        clearTimeout(eventReconnectTimerRef.current)
      }
      eventSocketRef.current?.close()
      eventSocketRef.current = null
    }
  }, [connectEventSocket, applySessions])

  const refreshSessions = async () => {
    try {
      const response = await fetch('/api/sessions')

      if (!response.ok) {
        throw new Error('Failed to load sessions.')
      }

      const payload = (await response.json()) as ListSessionsResponse
      applySessions(payload.sessions)
    } catch (requestError) {
      setError((requestError as Error).message)
    }
  }

  const selectedSession =
    sessions.find((session) => session.name === selectedSessionName) ?? null

  const selectSession = useCallback((name: string) => {
    startTransition(() => {
      setSelectedSessionName(name)
    })
    setMobileTerminalOpen(true)
    setPaletteOpen(false)

    // Clear unread for this session
    setUnreadSessions((current) => {
      if (!current.has(name)) return current
      const next = new Set(current)
      next.delete(name)
      return next
    })
  }, [])

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

      selectSession(payload.session.name)
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

  const togglePin = useCallback((name: string) => {
    setPinnedSessions((current) => {
      const next = new Set(current)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      savePinned(next)
      return next
    })
  }, [])

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }, [])

  // Navigate to adjacent session
  const navigateSession = useCallback(
    (direction: 1 | -1) => {
      if (sessions.length === 0) return
      const currentIndex = sessions.findIndex((session) => session.name === selectedSessionName)
      const nextIndex = Math.max(0, Math.min(sessions.length - 1, currentIndex + direction))
      selectSession(sessions[nextIndex].name)
    },
    [sessions, selectedSessionName, selectSession],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+K: command palette
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
        return
      }

      // Ctrl+B: toggle sidebar
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault()
        toggleSidebarCollapse()
        return
      }

      // Ctrl+[ / Ctrl+]: navigate sessions
      if ((event.ctrlKey || event.metaKey) && event.key === '[') {
        event.preventDefault()
        navigateSession(-1)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault()
        navigateSession(1)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebarCollapse, navigateSession])

  return (
    <div className={`app-shell${mobileTerminalOpen ? ' mobile-terminal-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <SessionSidebar
        collapsed={sidebarCollapsed}
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
        onSelectSession={selectSession}
        onToggleCollapse={toggleSidebarCollapse}
        onTogglePin={togglePin}
        pinnedSessions={pinnedSessions}
        selectedSessionName={selectedSessionName}
        sessions={sessions}
        unreadSessions={unreadSessions}
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
          onNextSession={() => navigateSession(1)}
          onOpenPalette={() => setPaletteOpen((c) => !c)}
          onPrevSession={() => navigateSession(-1)}
          onToggleSidebar={toggleSidebarCollapse}
          session={selectedSession}
        />
      </Suspense>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onSelect={selectSession}
          sessions={sessions}
        />
      ) : null}
    </div>
  )
}

export default App
