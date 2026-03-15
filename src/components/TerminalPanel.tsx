import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Keyboard, Link2Off, LoaderCircle, Wifi, WifiOff } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'

import type { SessionSummary, TerminalServerMessage } from '../../shared/contracts.ts'

const QUICK_KEYS = [
  { label: 'Esc', data: '\u001b' },
  { label: 'Prefix', data: '\u0002' },
  { label: 'Ctrl+C', data: '\u0003' },
  { label: 'Ctrl+L', data: '\u000c' },
  { label: 'Tab', data: '\t' },
  { label: 'Detach', data: '\u0002d' },
  { label: '↑', data: '\u001b[A' },
  { label: '↓', data: '\u001b[B' },
  { label: '←', data: '\u001b[D' },
  { label: '→', data: '\u001b[C' },
] as const

type ConnectionState = 'idle' | 'connecting' | 'live' | 'disconnected' | 'error'

interface TerminalPanelProps {
  session: SessionSummary | null
  onBack: () => void
}

export function TerminalPanel({ session, onBack }: TerminalPanelProps) {
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

  return <ActiveTerminal key={session.name} onBack={onBack} session={session} />
}

function ActiveTerminal({ session, onBack }: { session: SessionSummary; onBack: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<string | null>(null)

  const sendRaw = (data: string) => {
    const socket = socketRef.current

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    socket.send(
      JSON.stringify({
        type: 'input',
        data,
      }),
    )
  }

  const pushResize = () => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const socket = socketRef.current

    if (!terminal || !fitAddon || !socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    fitAddon.fit()
    socket.send(
      JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows,
      }),
    )
  }

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"Iosevka Term", "JetBrains Mono", "SF Mono", monospace',
      fontSize: 15,
      lineHeight: 1.15,
      scrollback: 1500,
      theme: {
        background: '#071419',
        foreground: '#f5ebd3',
        cursor: '#f7b34d',
        selectionBackground: 'rgba(247, 179, 77, 0.28)',
        black: '#0b2128',
        red: '#f16d63',
        green: '#76cb75',
        yellow: '#f1c86a',
        blue: '#74b8ff',
        magenta: '#d6a0f7',
        cyan: '#58dccb',
        white: '#e8dbc2',
        brightBlack: '#506a71',
        brightWhite: '#fff7e8',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${wsProtocol}//${window.location.host}/ws/terminal?session=${encodeURIComponent(session.name)}`,
    )
    socketRef.current = socket

    const disposeInput = terminal.onData((data) => {
      sendRaw(data)
    })

    socket.onopen = () => {
      setConnectionState('live')
      pushResize()
      terminal.focus()
    }

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as TerminalServerMessage

      if (message.type === 'data') {
        terminal.write(message.data)
        return
      }

      if (message.type === 'ready') {
        terminal.write(`\u001b]0;${message.sessionName}\u0007`)
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
      setConnectionState((current) => (current === 'error' ? current : 'disconnected'))
    }

    socket.onerror = () => {
      setConnectionState('error')
      setError('WebSocket transport failed.')
    }

    const resizeObserver = new ResizeObserver(() => {
      pushResize()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      disposeInput.dispose()
      socket.close()
      socketRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [session])

  return (
    <section className="terminal-panel">
      <header className="terminal-header">
        <div className="terminal-title-row">
          <button className="secondary-button mobile-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
            Sessions
          </button>
          <div>
            <p className="eyebrow">Attached session</p>
            <h2>{session.name}</h2>
          </div>
        </div>
        <div className="terminal-status-row">
          <span className={`status-pill ${connectionState}`}>
            {connectionState === 'live' ? <Wifi size={15} /> : <WifiOff size={15} />}
            {statusLabel(connectionState)}
          </span>
          <button
            className="secondary-button"
            onClick={() => terminalRef.current?.focus()}
            type="button"
          >
            <Keyboard size={16} />
            Focus keyboard
          </button>
        </div>
      </header>

      <div className="terminal-frame">
        <div className="terminal-canvas" ref={containerRef} />
        {connectionState === 'connecting' ? (
          <div className="terminal-overlay">
            <LoaderCircle className="spin" size={18} />
            <span>Attaching to tmux...</span>
          </div>
        ) : null}
      </div>

      <div className="terminal-toolbar">
        <div className="toolbar-group">
          {QUICK_KEYS.map((shortcut) => (
            <button
              className="shortcut-button"
              key={shortcut.label}
              onClick={() => {
                sendRaw(shortcut.data)
                terminalRef.current?.focus()
              }}
              type="button"
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <div className="toolbar-group meta">
          <span>
            <Link2Off size={14} />
            Browser disconnect only detaches your client.
          </span>
        </div>
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
    case 'disconnected':
      return 'Detached'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
}
