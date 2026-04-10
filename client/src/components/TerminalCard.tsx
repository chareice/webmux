import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalInfo } from '../types'
import { terminalWsUrl } from '../api'
import { ExtendedKeyBar } from './ExtendedKeyBar'
import { CommandBar } from './CommandBar'
import '@xterm/xterm/css/xterm.css'

const TERM_COLS = 120
const TERM_ROWS = 36

interface TerminalCardProps {
  terminal: TerminalInfo
  maximized: boolean
  isMobile: boolean
  isController: boolean
  deviceId: string
  onMaximize: () => void
  onMinimize: () => void
  onDestroy: () => void
}

export function TerminalCard({ terminal, maximized, isMobile, isController, deviceId, onMaximize, onMinimize, onDestroy }: TerminalCardProps) {
  const cardMountRef = useRef<HTMLDivElement>(null)
  const maxMountRef = useRef<HTMLDivElement>(null)
  const termElRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const isControllerRef = useRef(isController)

  useEffect(() => { isControllerRef.current = isController }, [isController])

  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [commandBarVisible, setCommandBarVisible] = useState(false)

  const handleToggleKeyboard = useCallback(() => {
    setKeyboardVisible(prev => {
      const next = !prev
      const textarea = termElRef.current?.querySelector('textarea')
      if (textarea) {
        if (next) {
          textarea.readOnly = false
          textarea.focus()
        } else {
          textarea.blur()
        }
      }
      return next
    })
  }, [])

  const handleToggleCommandBar = useCallback(() => {
    setCommandBarVisible(prev => !prev)
  }, [])

  // On mobile, textarea is only writable when keyboard is explicitly shown AND in control mode
  useEffect(() => {
    if (!isMobile) return
    const textarea = termElRef.current?.querySelector('textarea')
    if (!textarea) return
    textarea.readOnly = !(keyboardVisible && isController)
  }, [isMobile, keyboardVisible, isController])

  // Hide keyboard when mode changes to Watch
  useEffect(() => {
    if (!isController && keyboardVisible) {
      setKeyboardVisible(false)
      const textarea = termElRef.current?.querySelector('textarea')
      if (textarea) textarea.blur()
    }
  }, [isController]) // eslint-disable-line react-hooks/exhaustive-deps

  // VisualViewport resize handling for keyboard appearance
  useEffect(() => {
    if (!isMobile || !maximized) return

    const handleViewportResize = () => {
      const fit = fitRef.current
      if (!fit) return
      setTimeout(() => {
        try { fit.fit() } catch { /* ignore */ }
      }, 100)
    }

    window.visualViewport?.addEventListener('resize', handleViewportResize)
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
    }
  }, [isMobile, maximized])

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
      lineHeight: 1,
      letterSpacing: 0,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      allowTransparency: false,
      rescaleOverlappingGlyphs: true,
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

    const ws = new WebSocket(terminalWsUrl(terminal.machine_id, terminal.id, deviceId))
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
      if (isControllerRef.current) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: TERM_COLS,
          rows: TERM_ROWS,
        }))
      }
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN && isControllerRef.current) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Intercept paste events for image detection
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          e.stopPropagation()
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1]
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'image_paste',
                data: base64,
                mime: item.type,
                filename: `tc-paste-${Date.now()}.png`,
              }))
            }
          }
          reader.readAsDataURL(blob)
          return
        }
      }
    }
    termEl.addEventListener('paste', handlePaste)

    return () => {
      termEl.removeEventListener('paste', handlePaste)
      ws.close()
      term.dispose()
    }
  }, [terminal.id, terminal.machine_id, deviceId])

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

      const viewport = termEl.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport) viewport.style.overflow = ''

      const doFit = () => {
        try {
          fit.fit()
          const dims = fit.proposeDimensions()
          if (dims && ws?.readyState === WebSocket.OPEN && isControllerRef.current) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: dims.cols,
              rows: dims.rows,
            }))
          }
        } catch { /* ignore */ }
        if (!isMobile && isControllerRef.current) {
          termRef.current?.focus()
        }
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

  const handleToolbarKey = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command_input', data }))
    }
    if (isControllerRef.current) termRef.current?.focus()
  }, [])

  const handleImagePaste = useCallback((base64: string, mime: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'image_paste',
        data: base64,
        mime,
        filename: `tc-paste-${Date.now()}.png`,
      }))
    }
  }, [])

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
              onClick={(e) => { e.stopPropagation(); if (isController) onDestroy() }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--danger)',
                cursor: isController ? 'pointer' : 'default',
                fontSize: 12,
                padding: '0 4px',
                opacity: isController ? 0.6 : 0.2,
              }}
              onMouseEnter={e => { if (isController) e.currentTarget.style.opacity = '1' }}
              onMouseLeave={e => { if (isController) e.currentTarget.style.opacity = '0.6' }}
              title="Close terminal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Terminal content + side panel */}
        {maximized ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            <div
              ref={maxMountRef}
              style={{
                flex: 1,
                padding: '8px 10px',
                overflow: 'hidden',
              }}
            />
            {!isController && (
              <div style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(0,0,0,0.6)',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 11,
                color: 'var(--text-muted)',
                zIndex: 10,
                pointerEvents: 'none',
              }}>
                Watch Mode
              </div>
            )}
            {!isMobile && (
              <div style={{ width: 200, minWidth: 200, borderLeft: '1px solid var(--border)' }}>
                <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
              </div>
            )}
          </div>
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

        {/* Mobile CommandBar bottom sheet */}
        {maximized && isMobile && commandBarVisible && (
          <div style={{
            maxHeight: '40vh',
            background: 'var(--bg-secondary)',
            borderTop: '2px solid var(--border-active)',
            overflow: 'auto',
            flexShrink: 0,
            animation: 'slideUp 0.2s ease-out',
          }}>
            <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
          </div>
        )}

        {/* Mobile toolbar */}
        {maximized && isMobile && (
          <ExtendedKeyBar
            onKey={handleToolbarKey}
            onToggleKeyboard={handleToggleKeyboard}
            onToggleCommandBar={handleToggleCommandBar}
            keyboardVisible={keyboardVisible}
            commandBarVisible={commandBarVisible}
            isController={isController}
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
