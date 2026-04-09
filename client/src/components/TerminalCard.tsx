import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalInfo } from '../types'
import { terminalWsUrl } from '../api'
import '@xterm/xterm/css/xterm.css'

const TERM_COLS = 120
const TERM_ROWS = 36

interface TerminalCardProps {
  terminal: TerminalInfo
  maximized: boolean
  onMaximize: () => void
  onMinimize: () => void
  onDestroy: () => void
}

export function TerminalCard({ terminal, maximized, onMaximize, onMinimize, onDestroy }: TerminalCardProps) {
  // Two mount points: one for card view, one for maximized view
  const cardMountRef = useRef<HTMLDivElement>(null)
  const maxMountRef = useRef<HTMLDivElement>(null)
  // Persistent element that xterm renders into
  const termElRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Create terminal and WebSocket once on mount
  useEffect(() => {
    const termEl = document.createElement('div')
    termEl.style.width = '100%'
    termEl.style.height = '100%'
    termElRef.current = termEl

    const term = new Terminal({
      cols: TERM_COLS,
      rows: TERM_ROWS,
      fontSize: 14,
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
      cursorBlink: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termEl)

    termRef.current = term
    fitRef.current = fit

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
      ws.send(JSON.stringify({
        type: 'resize',
        cols: TERM_COLS,
        rows: TERM_ROWS,
      }))
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    return () => {
      ws.close()
      term.dispose()
    }
  }, [terminal.id])

  // Move the terminal element to the right container and handle sizing
  useEffect(() => {
    const termEl = termElRef.current
    const term = termRef.current
    const fit = fitRef.current
    const ws = wsRef.current
    if (!termEl || !term || !fit) return

    if (maximized) {
      const mount = maxMountRef.current
      if (!mount) return

      // Move terminal to maximized container
      mount.appendChild(termEl)
      termEl.style.transform = ''
      termEl.style.transformOrigin = ''
      termEl.style.pointerEvents = ''

      const doFit = () => {
        try {
          fit.fit()
          const dims = fit.proposeDimensions()
          if (dims && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: dims.cols,
              rows: dims.rows,
            }))
          }
        } catch { /* ignore */ }
        term.focus()
      }

      const timer = setTimeout(doFit, 50)

      const observer = new ResizeObserver(doFit)
      observer.observe(mount)

      return () => {
        clearTimeout(timer)
        observer.disconnect()
      }
    } else {
      const mount = cardMountRef.current
      if (!mount) return

      // DO NOT resize terminal or send resize to PTY.
      // Card view is just a CSS-scaled preview. PTY stays at maximized size.
      mount.appendChild(termEl)
      termEl.style.pointerEvents = 'none'

      // Calculate scale to fit the card wrapper
      const calcScale = () => {
        const wrapperW = mount.clientWidth
        const wrapperH = mount.clientHeight
        // Get actual terminal rendered size
        const termW = termEl.scrollWidth
        const termH = termEl.scrollHeight
        if (termW > 0 && termH > 0 && wrapperW > 0) {
          const s = Math.min(wrapperW / termW, wrapperH / termH, 1)
          termEl.style.transform = `scale(${s})`
          termEl.style.transformOrigin = 'top left'
        }
      }

      const timer = setTimeout(calcScale, 100)

      const observer = new ResizeObserver(calcScale)
      observer.observe(mount)

      return () => {
        clearTimeout(timer)
        observer.disconnect()
      }
    }
  }, [maximized])

  const handleTitleClick = useCallback(() => {
    if (!maximized) onMaximize()
  }, [maximized, onMaximize])

  return (
    <>
      {maximized && (
        <div
          onClick={onMinimize}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      <div
        style={maximized ? {
          position: 'fixed',
          top: '5vh',
          left: '5vw',
          width: '90vw',
          height: '90vh',
          zIndex: 100,
          background: 'var(--bg-card)',
          borderRadius: 8,
          border: '2px solid var(--border-active)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        } : {
          background: 'var(--bg-card)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'border-color 0.2s',
        }}
        onMouseEnter={e => { if (!maximized) e.currentTarget.style.borderColor = 'var(--border-active)' }}
        onMouseLeave={e => { if (!maximized) e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        {/* Title bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: maximized ? '8px 12px' : '4px 8px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.2)',
          cursor: maximized ? 'default' : 'pointer',
        }}
          onClick={handleTitleClick}
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
              fontSize: maximized ? 13 : 11,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {terminal.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {!maximized && (
              <button
                onClick={(e) => { e.stopPropagation(); onMaximize() }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '0 4px',
                }}
                title="Maximize"
              >
                ⤢
              </button>
            )}
            {maximized && (
              <button
                onClick={(e) => { e.stopPropagation(); onMinimize() }}
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
              onClick={(e) => { e.stopPropagation(); onDestroy() }}
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

        {/* Terminal content - two mount points, terminal moves between them */}
        {maximized ? (
          <div
            ref={maxMountRef}
            style={{
              flex: 1,
              padding: 4,
              overflow: 'hidden',
            }}
          />
        ) : (
          <div
            ref={cardMountRef}
            style={{
              flex: 1,
              minHeight: 160,
              overflow: 'hidden',
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={onMaximize}
          />
        )}

        {/* Footer */}
        <div style={{
          padding: maximized ? '4px 12px' : '2px 8px',
          borderTop: '1px solid var(--border)',
          fontSize: maximized ? 11 : 9,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {terminal.cwd}
        </div>
      </div>
    </>
  )
}
