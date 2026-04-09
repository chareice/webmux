import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalInfo } from '../types'
import { terminalWsUrl } from '../api'
import '@xterm/xterm/css/xterm.css'

interface TerminalCardProps {
  terminal: TerminalInfo
  expanded?: boolean
  onExpand?: () => void
  onClose?: () => void
  onDestroy?: () => void
}

export function TerminalCard({ terminal, expanded = false, onExpand, onClose, onDestroy }: TerminalCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: expanded ? 14 : 9,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#112a45',
        foreground: '#e0e8f0',
        cursor: '#00d4aa',
        selectionBackground: 'rgba(0, 212, 170, 0.3)',
        black: '#0a1929',
        red: '#ff6b6b',
        green: '#00d4aa',
        yellow: '#ffd93d',
        blue: '#4dabf7',
        magenta: '#cc5de8',
        cyan: '#22b8cf',
        white: '#e0e8f0',
      },
      cursorBlink: expanded,
      disableStdin: !expanded,
      scrollback: expanded ? 5000 : 100,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)

    // Delay fit to allow DOM to settle
    requestAnimationFrame(() => {
      try { fit.fit() } catch { /* ignore */ }
    })

    termRef.current = term
    fitRef.current = fit

    // WebSocket connection
    const ws = new WebSocket(terminalWsUrl(terminal.id))
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output') {
          term.write(msg.data)
        }
      } catch { /* ignore */ }
    }

    ws.onopen = () => {
      // Send resize on connect
      const dims = fit.proposeDimensions()
      if (dims) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: dims.cols,
          rows: dims.rows,
        }))
      }
    }

    if (expanded) {
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })
    }

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        const dims = fit.proposeDimensions()
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: dims.cols,
            rows: dims.rows,
          }))
        }
      } catch { /* ignore */ }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      ws.close()
      term.dispose()
    }
  }, [terminal.id, expanded])

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 8,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: expanded ? '100%' : undefined,
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => { if (!expanded) e.currentTarget.style.borderColor = 'var(--border-active)' }}
      onMouseLeave={e => { if (!expanded) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: expanded ? '8px 12px' : '4px 8px',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(0,0,0,0.2)',
        cursor: expanded ? 'default' : 'pointer',
      }}
        onClick={() => !expanded && onExpand?.()}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflow: 'hidden',
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent)',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: expanded ? 13 : 11,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {terminal.title}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {!expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onExpand?.() }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '0 4px',
              }}
              title="Expand"
            >
              ⤢
            </button>
          )}
          {expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose?.() }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 14,
                padding: '0 4px',
              }}
              title="Minimize"
            >
              ⤡
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDestroy?.() }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--danger)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 4px',
              opacity: 0.6,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
            title="Close terminal"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: 4,
          minHeight: expanded ? 0 : 140,
          overflow: 'hidden',
        }}
        onClick={() => !expanded && onExpand?.()}
      />

      {/* Footer - path */}
      <div style={{
        padding: expanded ? '4px 12px' : '2px 8px',
        borderTop: '1px solid var(--border)',
        fontSize: expanded ? 11 : 9,
        color: 'var(--text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {terminal.cwd}
      </div>
    </div>
  )
}
