import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'

import type { SessionSummary, TerminalServerMessage } from '@webmux/shared'

type ModifierKey = 'ctrl' | 'alt'

interface ShortcutKey {
  label: string
  data: string
}

const MOBILE_SHORTCUTS: readonly ShortcutKey[] = [
  { label: 'Esc', data: '\u001b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\u0003' },
  { label: 'Ctrl+D', data: '\u0004' },
  { label: 'Ctrl+L', data: '\u000c' },
  { label: 'Ctrl+Z', data: '\u001a' },
  { label: '\u2191', data: '\u001b[A' },
  { label: '\u2193', data: '\u001b[B' },
  { label: '\u2190', data: '\u001b[D' },
  { label: '\u2192', data: '\u001b[C' },
  { label: 'Prefix', data: '\u0002' },
  { label: 'Detach', data: '\u0002d' },
] as const

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'disconnected' | 'error'

interface TerminalPanelProps {
  session: SessionSummary | null
  agentId: string
  token: string
  onBack: () => void
  onOpenPalette: () => void
  onNextSession: () => void
  onPrevSession: () => void
  onToggleSidebar: () => void
}

export function TerminalPanel({ session, agentId, token, onBack, onOpenPalette, onNextSession, onPrevSession, onToggleSidebar }: TerminalPanelProps) {
  if (!session) {
    return (
      <section className="terminal-panel empty-state">
        <div className="empty-terminal-card">
          <p className="eyebrow">No session selected</p>
          <h2>Pick a session to attach.</h2>
          <p>
            Sessions stay alive on the machine, so you can bounce between desktop and phone
            without losing context.
          </p>
        </div>
      </section>
    )
  }

  return (
    <ActiveTerminal
      agentId={agentId}
      key={session.name}
      onBack={onBack}
      onNextSession={onNextSession}
      onOpenPalette={onOpenPalette}
      onPrevSession={onPrevSession}
      onToggleSidebar={onToggleSidebar}
      session={session}
      token={token}
    />
  )
}

interface ActiveTerminalProps {
  session: SessionSummary
  agentId: string
  token: string
  onBack: () => void
  onOpenPalette: () => void
  onNextSession: () => void
  onPrevSession: () => void
  onToggleSidebar: () => void
}

function ActiveTerminal({ session, agentId, token, onBack, onOpenPalette, onNextSession, onPrevSession, onToggleSidebar }: ActiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  // Refs for callbacks so the terminal key handler can access them without recreating
  const onOpenPaletteRef = useRef(onOpenPalette)
  const onNextSessionRef = useRef(onNextSession)
  const onPrevSessionRef = useRef(onPrevSession)
  const onToggleSidebarRef = useRef(onToggleSidebar)

  useEffect(() => { onOpenPaletteRef.current = onOpenPalette }, [onOpenPalette])
  useEffect(() => { onNextSessionRef.current = onNextSession }, [onNextSession])
  useEffect(() => { onPrevSessionRef.current = onPrevSession }, [onPrevSession])
  useEffect(() => { onToggleSidebarRef.current = onToggleSidebar }, [onToggleSidebar])

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeModifiers, setActiveModifiers] = useState<Set<ModifierKey>>(new Set())
  const [connectionFlash, setConnectionFlash] = useState<'connect' | 'disconnect' | null>(null)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const sendRaw = useCallback((data: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'input', data }))
  }, [])

  const sendWithModifiers = useCallback(
    (data: string) => {
      let modified = data

      if (activeModifiers.has('ctrl') && data.length === 1) {
        const code = data.toLowerCase().charCodeAt(0)
        if (code >= 97 && code <= 122) {
          modified = String.fromCharCode(code - 96)
        }
      }

      if (activeModifiers.has('alt') && data.length === 1) {
        modified = `\u001b${modified}`
      }

      sendRaw(modified)

      if (activeModifiers.size > 0) {
        setActiveModifiers(new Set())
      }
    },
    [activeModifiers, sendRaw],
  )

  const focusTerminal = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const textarea = el.querySelector('textarea')
    textarea?.focus()
  }, [])

  // Single self-contained effect for terminal + WebSocket lifecycle
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttemptCount = 0

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"Iosevka Term", "JetBrains Mono", "SF Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#0f0f14',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: 'rgba(122, 162, 247, 0.25)',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightWhite: '#c0caf5',
      },
    })

    // Intercept Ctrl+K, Ctrl+B, Ctrl+[, Ctrl+] before xterm processes them
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.type === 'keydown') {
        if (event.key === 'k') {
          event.preventDefault()
          event.stopPropagation()
          onOpenPaletteRef.current()
          return false
        }
        if (event.key === 'b') {
          event.preventDefault()
          event.stopPropagation()
          onToggleSidebarRef.current()
          return false
        }
        if (event.key === '[') {
          event.preventDefault()
          event.stopPropagation()
          onPrevSessionRef.current()
          return false
        }
        if (event.key === ']') {
          event.preventDefault()
          event.stopPropagation()
          onNextSessionRef.current()
          return false
        }
      }
      return true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(container)

    const pushResize = () => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      fitAddon.fit()
      socket.send(JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows,
      }))
    }

    // Handle mobile IME composition correctly.
    // Mobile keyboards fire onData with the FULL composed string on each update,
    // not just the new character. We track what was already sent to only send the delta.
    let composing = false
    let lastCompositionText = ''

    const textarea = container.querySelector('textarea')
    if (textarea) {
      textarea.addEventListener('compositionstart', () => {
        composing = true
        lastCompositionText = ''
      })
      textarea.addEventListener('compositionend', () => {
        composing = false
        lastCompositionText = ''
      })
    }

    const disposeInput = terminal.onData((data) => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return

      if (composing) {
        // During composition, onData sends the full composed text each time.
        // Only send the new part (delta).
        const delta = data.startsWith(lastCompositionText)
          ? data.slice(lastCompositionText.length)
          : data
        lastCompositionText = data
        if (delta) {
          socket.send(JSON.stringify({ type: 'input', data: delta }))
        }
      } else {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const connect = () => {
      if (disposed) return

      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.close()
        socketRef.current = null
      }

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const params = new URLSearchParams({
        agent: agentId,
        session: session.name,
        cols: String(terminal.cols),
        rows: String(terminal.rows),
        token,
      })
      const socket = new WebSocket(
        `${wsProtocol}//${window.location.host}/ws/terminal?${params.toString()}`,
      )
      socketRef.current = socket

      socket.onopen = () => {
        if (disposed) { socket.close(); return }
        reconnectAttemptCount = 0
        setConnectionState('live')
        setReconnectAttempt(0)
        setError(null)
        setConnectionFlash('connect')
        setTimeout(() => setConnectionFlash(null), 600)
        pushResize()
        terminal.focus()
      }

      socket.onmessage = (event) => {
        if (disposed) return
        const message = JSON.parse(event.data) as TerminalServerMessage

        if (message.type === 'data') {
          terminal.write(message.data)
          return
        }

        if (message.type === 'ready') {
          return
        }

        if (message.type === 'exit') {
          setConnectionState('disconnected')
          terminal.writeln(`\r\n[session exited with code ${message.exitCode}]`)
          return
        }

        setConnectionState('error')
        setError(message.message)
        terminal.writeln(`\r\n[error] ${message.message}`)
      }

      socket.onclose = () => {
        if (disposed) return
        setConnectionFlash('disconnect')
        setTimeout(() => setConnectionFlash(null), 600)

        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptCount), RECONNECT_MAX_MS)
        reconnectAttemptCount += 1
        setConnectionState('reconnecting')
        setReconnectAttempt(reconnectAttemptCount)
        reconnectTimer = setTimeout(connect, delay)
      }

      socket.onerror = () => {}
    }

    connect()

    const resizeObserver = new ResizeObserver(() => {
      pushResize()
    })
    resizeObserver.observe(container)

    const handleOnline = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      reconnectAttemptCount = 0
      connect()
    }
    window.addEventListener('online', handleOnline)

    return () => {
      disposed = true
      window.removeEventListener('online', handleOnline)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      resizeObserver.disconnect()
      disposeInput.dispose()
      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.close()
        socketRef.current = null
      }
      terminal.dispose()
    }
  }, [session.name, agentId, token])

  // Refit on fullscreen toggle
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 50)
    return () => clearTimeout(timer)
  }, [isFullscreen])

  const toggleModifier = (mod: ModifierKey) => {
    setActiveModifiers((current) => {
      const next = new Set(current)
      if (next.has(mod)) {
        next.delete(mod)
      } else {
        next.add(mod)
      }
      return next
    })
  }

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    if (touch.clientX < 30) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    }
  }

  const handleTouchEnd = (event: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = Math.abs(touch.clientY - touchStartRef.current.y)
    if (dx > 80 && dy < 60) onBack()
    touchStartRef.current = null
  }

  const frameClassName = [
    'terminal-frame',
    connectionFlash === 'connect' ? 'flash-connect' : '',
    connectionFlash === 'disconnect' ? 'flash-disconnect' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      className={`terminal-panel${isFullscreen ? ' fullscreen' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Compact header bar */}
      <header className="terminal-header">
        <div className="terminal-title-row">
          <button className="secondary-button mobile-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
          </button>
          <h2>{session.name}</h2>
          <span className={`status-pill ${connectionState}`}>
            {connectionState === 'live' ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="status-label">{statusLabel(connectionState)}</span>
          </span>
        </div>
        <div className="terminal-status-row">
          <button
            className="secondary-button"
            onClick={() => setIsFullscreen((current) => !current)}
            type="button"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </header>

      {/* Terminal */}
      <div className={frameClassName} onClick={focusTerminal} role="presentation">
        <div className="terminal-canvas" ref={containerRef} />
        {connectionState === 'connecting' ? (
          <div className="terminal-overlay">
            <LoaderCircle className="spin" size={18} />
            <span>Attaching...</span>
          </div>
        ) : null}
        {connectionState === 'reconnecting' ? (
          <div className="terminal-overlay reconnecting">
            <LoaderCircle className="spin" size={18} />
            <span>Reconnecting... ({reconnectAttempt})</span>
          </div>
        ) : null}
      </div>

      {/* Mobile-only toolbar */}
      <div className="terminal-toolbar">
        <div className="toolbar-group modifier-group" role="toolbar" aria-label="Modifier keys">
          <button
            className={`shortcut-button modifier-button${activeModifiers.has('ctrl') ? ' active' : ''}`}
            onClick={() => toggleModifier('ctrl')}
            type="button"
          >
            Ctrl
          </button>
          <button
            className={`shortcut-button modifier-button${activeModifiers.has('alt') ? ' active' : ''}`}
            onClick={() => toggleModifier('alt')}
            type="button"
          >
            Alt
          </button>
          <span className="toolbar-separator" />
          {MOBILE_SHORTCUTS.map((shortcut) => (
            <button
              className="shortcut-button"
              key={shortcut.label}
              onClick={() => {
                sendWithModifiers(shortcut.data)
                focusTerminal()
              }}
              type="button"
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        {activeModifiers.size > 0 ? (
          <div className="toolbar-group" role="toolbar" aria-label="Letter keys">
            {'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => (
              <button
                className="shortcut-button letter-button"
                key={letter}
                onClick={() => {
                  sendWithModifiers(letter)
                  focusTerminal()
                }}
                type="button"
              >
                {letter}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="error-banner">{error}</p> : null}
    </section>
  )
}

function statusLabel(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'Attaching'
    case 'live':
      return 'Live'
    case 'reconnecting':
      return 'Reconnecting'
    case 'disconnected':
      return 'Detached'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
}
