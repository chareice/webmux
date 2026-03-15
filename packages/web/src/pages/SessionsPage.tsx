import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type {
  CreateSessionResponse,
  SessionEvent,
  SessionSummary,
} from '@webmux/shared'

import { fetchApi, useAuth } from '../auth.tsx'
import { SessionSidebar } from '../components/SessionSidebar.tsx'
import { CommandPalette } from '../components/CommandPalette.tsx'

const TerminalPanel = lazy(async () => {
  const module = await import('../components/TerminalPanel.tsx')
  return { default: module.TerminalPanel }
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

export function SessionsPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()

  const [agentName, setAgentName] = useState('')
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

  const eventSocketRef = useRef<WebSocket | null>(null)
  const eventReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedSessionNameRef = useRef(selectedSessionName)
  selectedSessionNameRef.current = selectedSessionName

  // Fetch agent info
  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchApi('/api/agents')
        if (res.ok) {
          const data = (await res.json()) as { agents: Array<{ id: string; name: string }> }
          const agent = data.agents.find((a) => a.id === agentId)
          if (agent && !cancelled) {
            setAgentName(agent.name)
          }
        }
      } catch {
        // Ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  const applySessions = useCallback((incoming: SessionSummary[]) => {
    setSessions((prev) => {
      const prevMap = new Map(prev.map((s) => [s.name, s]))

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
        if (current && incoming.some((s) => s.name === current)) return current
        return incoming[0]?.name ?? null
      })
    })
  }, [])

  // Events WebSocket connection
  const connectEventSocket = useCallback(() => {
    if (!token || !agentId) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${wsProtocol}//${window.location.host}/ws/events?token=${encodeURIComponent(token)}`,
    )
    eventSocketRef.current = socket

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as SessionEvent
        if (message.type === 'sessions-sync' && message.agentId === agentId) {
          applySessions(message.sessions)
        }
      } catch {
        // Ignore parse errors
      }
    }

    socket.onclose = () => {
      eventReconnectTimerRef.current = setTimeout(() => {
        connectEventSocket()
      }, 3000)
    }

    socket.onerror = () => {
      // onclose will fire after this
    }
  }, [applySessions, token, agentId])

  useEffect(() => {
    connectEventSocket()

    // Fallback: initial HTTP fetch
    if (agentId) {
      void (async () => {
        try {
          const res = await fetchApi(`/api/agents/${agentId}/sessions`)
          if (res.ok) {
            const payload = (await res.json()) as { sessions: SessionSummary[] }
            applySessions(payload.sessions)
          }
        } catch {
          // Event socket will handle it
        }
      })()
    }

    return () => {
      if (eventReconnectTimerRef.current) {
        clearTimeout(eventReconnectTimerRef.current)
      }
      eventSocketRef.current?.close()
      eventSocketRef.current = null
    }
  }, [connectEventSocket, applySessions, agentId])

  const refreshSessions = async () => {
    if (!agentId) return
    try {
      const res = await fetchApi(`/api/agents/${agentId}/sessions`)
      if (!res.ok) throw new Error('Failed to load sessions.')
      const payload = (await res.json()) as { sessions: SessionSummary[] }
      applySessions(payload.sessions)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const selectedSession =
    sessions.find((s) => s.name === selectedSessionName) ?? null

  const selectSession = useCallback((name: string) => {
    startTransition(() => {
      setSelectedSessionName(name)
    })
    setMobileTerminalOpen(true)
    setPaletteOpen(false)

    setUnreadSessions((current) => {
      if (!current.has(name)) return current
      const next = new Set(current)
      next.delete(name)
      return next
    })
  }, [])

  const createSession = async () => {
    const trimmedName = draftName.trim()
    if (!trimmedName || !agentId) {
      setError('Session name cannot be empty.')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetchApi(`/api/agents/${agentId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      if (!res.ok) throw new Error(await res.text())
      const payload = (await res.json()) as CreateSessionResponse
      setDraftName(trimmedName)
      await refreshSessions()
      selectSession(payload.session.name)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsCreating(false)
    }
  }

  const killSession = async (name: string) => {
    const confirmed = window.confirm(`Kill session "${name}"?`)
    if (!confirmed || !agentId) return

    setError(null)

    try {
      const res = await fetchApi(
        `/api/agents/${agentId}/sessions/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`Failed to kill ${name}.`)
      await refreshSessions()
      if (selectedSessionName === name) {
        startTransition(() => {
          setSelectedSessionName(null)
        })
      }
    } catch (err) {
      setError((err as Error).message)
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

  const navigateSession = useCallback(
    (direction: 1 | -1) => {
      if (sessions.length === 0) return
      const currentIndex = sessions.findIndex((s) => s.name === selectedSessionName)
      const nextIndex = Math.max(0, Math.min(sessions.length - 1, currentIndex + direction))
      selectSession(sessions[nextIndex].name)
    },
    [sessions, selectedSessionName, selectSession],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setPaletteOpen((c) => !c)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault()
        toggleSidebarCollapse()
        return
      }
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
    <div
      className={`app-shell${mobileTerminalOpen ? ' mobile-terminal-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
    >
      <SessionSidebar
        agentName={agentName}
        collapsed={sidebarCollapsed}
        draftName={draftName}
        error={error}
        isCreating={isCreating}
        onBackToAgents={() => navigate('/')}
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
          agentId={agentId ?? ''}
          onBack={() => {
            setMobileTerminalOpen(false)
          }}
          onNextSession={() => navigateSession(1)}
          onOpenPalette={() => setPaletteOpen((c) => !c)}
          onPrevSession={() => navigateSession(-1)}
          onToggleSidebar={toggleSidebarCollapse}
          session={selectedSession}
          token={token ?? ''}
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
