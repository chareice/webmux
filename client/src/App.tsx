import { useState, useCallback, useEffect } from 'react'
import type { TerminalInfo } from './types'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { TerminalModal } from './components/TerminalModal'
import { createTerminal, destroyTerminal, listTerminals } from './api'

export function App() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [expandedTerminal, setExpandedTerminal] = useState<TerminalInfo | null>(null)

  useEffect(() => {
    listTerminals().then(setTerminals)
  }, [])

  const handleCreateTerminal = useCallback(async (cwd: string) => {
    const info = await createTerminal(cwd)
    setTerminals(prev => [...prev, info])
  }, [])

  const handleDestroyTerminal = useCallback(async (id: string) => {
    await destroyTerminal(id)
    setTerminals(prev => prev.filter(t => t.id !== id))
    if (expandedTerminal?.id === id) {
      setExpandedTerminal(null)
    }
  }, [expandedTerminal])

  const handleExpand = useCallback((terminal: TerminalInfo) => {
    setExpandedTerminal(terminal)
  }, [])

  const handleCloseModal = useCallback(() => {
    setExpandedTerminal(null)
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
        onExpand={handleExpand}
        onDestroy={handleDestroyTerminal}
      />
      {expandedTerminal && (
        <TerminalModal
          terminal={expandedTerminal}
          onClose={handleCloseModal}
          onDestroy={handleDestroyTerminal}
        />
      )}
    </div>
  )
}
