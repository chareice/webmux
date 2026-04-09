import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalInfo } from '../types'
import { terminalWsUrl } from '../api'
import { TerminalToolbar } from './TerminalToolbar'
import '@xterm/xterm/css/xterm.css'

const TERM_COLS = 120
const TERM_ROWS = 36

interface TerminalCardProps {
  terminal: TerminalInfo
  maximized: boolean
  isMobile: boolean
  onMaximize: () => void
  onMinimize: () => void
  onDestroy: () => void
}

export function TerminalCard({ terminal, maximized, isMobile, onMaximize, onMinimize, onDestroy }: TerminalCardProps) {
  const cardMountRef = useRef<HTMLDivElement>(null)
  const maxMountRef = useRef<HTMLDivElement>(null)
  const termElRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  const [clientId, setClientId] = useState<string | null>(null)
  const [activeClient, setActiveClient] = useState<string | null>(null)

  const isController = clientId != null && clientId === activeClient

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
        switch (msg.type) {
          case 'output':
            term.write(msg.data)
            break
          case 'connected':
            setClientId(msg.client_id)
            setActiveClient(msg.active_client)
            break
          case 'control_changed':
            setActiveClient(msg.active_client)
            break
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

  // Move terminal element and handle sizing based on maximized state
  useEffect(() => {
    const termEl = termElRef.current
    const fit = fitRef.current
    const ws = wsRef.current
    if (!termEl || !fit) return

    if (maximized) {
      const mount = maxMountRef.current
      if (!mount) return

      mount.appendChild(termEl)
      termEl.style.transform = ''
      termEl.style.transformOrigin = ''
      termEl.style.pointerEvents = ''

      // Restore xterm scrollbar in maximized view
      const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport) viewport.style.overflow = ''

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
        termRef.current?.focus()
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

      mount.appendChild(termEl)
      termEl.style.pointerEvents = 'none'

      // Hide xterm scrollbar in card view
      const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport) viewport.style.overflow = 'hidden'

      const calcScale = () => {
        const wrapperW = mount.clientWidth
        const wrapperH = mount.clientHeight
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

  const handleTakeControl = useCallback(() => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'take_control' }))
    }
  }, [])

  const handleToolbarKey = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
    }
    termRef.current?.focus()
  }, [])

  const handleTitleClick = useCallback(() => {
    if (!maximized) onMaximize()
  }, [maximized, onMaximize])

  // Control indicator
  const controlBadge = activeClient == null ? null : isController ? (
    <span style={{
      fontSize: 9,
      color: 'var(--accent)',
      background: 'var(--accent-dim)',
      borderRadius: 3,
      padding: '1px 5px',
      marginLeft: 6,
      flexShrink: 0,
    }}>
      controlling
    </span>
  ) : (
    <span style={{
      fontSize: 9,
      color: 'var(--warning)',
      background: 'rgba(255, 217, 61, 0.15)',
      borderRadius: 3,
      padding: '1px 5px',
      marginLeft: 6,
      flexShrink: 0,
    }}>
      viewing
    </span>
  )

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
          top: isMobile ? 0 : '5vh',
          left: isMobile ? 0 : '5vw',
          width: isMobile ? '100vw' : '90vw',
          height: isMobile ? '100vh' : '90vh',
          zIndex: 100,
          background: 'var(--bg-card)',
          borderRadius: isMobile ? 0 : 8,
          border: isMobile ? 'none' : '2px solid var(--border-active)',
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
            minWidth: 0,
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
            {maximized && controlBadge}
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
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

        {/* Take control banner (shown when maximized and not controlling) */}
        {maximized && !isController && activeClient != null && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '8px 12px',
            background: 'rgba(255, 217, 61, 0.1)',
            borderBottom: '1px solid var(--border)',
            fontSize: 13,
            color: 'var(--warning)',
          }}>
            <span>Another device is controlling this terminal</span>
            <button
              onClick={handleTakeControl}
              style={{
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '4px 12px',
                fontWeight: 600,
              }}
            >
              Take Control
            </button>
          </div>
        )}

        {/* Terminal content */}
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
              aspectRatio: '5 / 3',
              overflow: 'hidden',
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={onMaximize}
          />
        )}

        {/* Mobile toolbar (shown when maximized and controlling) */}
        {maximized && isController && isMobile && (
          <TerminalToolbar onKey={handleToolbarKey} />
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
