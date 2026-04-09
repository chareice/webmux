import { useState, useCallback, useEffect, useRef } from 'react'
import type { TerminalInfo } from './types'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { createTerminal, destroyTerminal, listTerminals, eventsWsUrl } from './api'
import { useIsMobile } from './hooks'

export function App() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const maximizedRef = useRef<string | null>(null)

  // Sync sidebar state when switching between mobile/desktop
  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  useEffect(() => {
    maximizedRef.current = maximizedId
  }, [maximizedId])

  useEffect(() => {
    listTerminals().then(setTerminals)
  }, [])

  useEffect(() => {
    const ws = new WebSocket(eventsWsUrl())

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'created') {
          setTerminals(prev => {
            if (prev.some(t => t.id === msg.terminal.id)) return prev
            return [...prev, msg.terminal]
          })
        } else if (msg.type === 'destroyed') {
          setTerminals(prev => prev.filter(t => t.id !== msg.id))
          if (maximizedRef.current === msg.id) {
            setMaximizedId(null)
          }
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setTimeout(() => {
        listTerminals().then(setTerminals)
      }, 1000)
    }

    return () => ws.close()
  }, [])

  const handleCreateTerminal = useCallback(async (cwd: string) => {
    await createTerminal(cwd)
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

  const handleDestroyTerminal = useCallback(async (id: string) => {
    await destroyTerminal(id)
  }, [])

  const handleMaximize = useCallback((id: string) => {
    setMaximizedId(id)
  }, [])

  const handleMinimize = useCallback(() => {
    setMaximizedId(null)
  }, [])

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Mobile hamburger button */}
      {isMobile && !maximizedId && (
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          style={{
            position: 'fixed',
            top: 12,
            left: 12,
            zIndex: 90,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 18,
            padding: '6px 10px',
            lineHeight: 1,
          }}
        >
          ☰
        </button>
      )}

      {/* Sidebar backdrop on mobile */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0, 0, 0, 0.5)',
          }}
        />
      )}

      {/* Sidebar */}
      {(sidebarOpen || !isMobile) && (
        <div style={{
          ...(isMobile ? {
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100vh',
            zIndex: 85,
          } : {}),
        }}>
          <Sidebar onCreateTerminal={handleCreateTerminal} />
        </div>
      )}

      {/* Main content */}
      <Canvas
        terminals={terminals}
        maximizedId={maximizedId}
        isMobile={isMobile}
        onMaximize={handleMaximize}
        onMinimize={handleMinimize}
        onDestroy={handleDestroyTerminal}
      />
    </div>
  )
}
