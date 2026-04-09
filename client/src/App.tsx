import { useState, useCallback, useEffect, useRef } from 'react'
import type { TerminalInfo } from './types'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { createTerminal, destroyTerminal, listTerminals, eventsWsUrl } from './api'

export function App() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const maximizedRef = useRef<string | null>(null)

  useEffect(() => {
    maximizedRef.current = maximizedId
  }, [maximizedId])

  useEffect(() => {
    listTerminals().then(setTerminals)
  }, [])

  // Subscribe to server events for cross-tab sync
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
  }, [])

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
    }}>
      <Sidebar onCreateTerminal={handleCreateTerminal} />
      <Canvas
        terminals={terminals}
        maximizedId={maximizedId}
        onMaximize={handleMaximize}
        onMinimize={handleMinimize}
        onDestroy={handleDestroyTerminal}
      />
    </div>
  )
}
