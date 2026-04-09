import { useEffect, useCallback } from 'react'
import type { TerminalInfo } from '../types'
import { TerminalCard } from './TerminalCard'

interface TerminalModalProps {
  terminal: TerminalInfo
  onClose: () => void
  onDestroy: (id: string) => void
}

export function TerminalModal({ terminal, onClose, onDestroy }: TerminalModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={{
        width: '85vw',
        height: '80vh',
        maxWidth: 1200,
      }}>
        <TerminalCard
          terminal={terminal}
          expanded
          onClose={onClose}
          onDestroy={() => onDestroy(terminal.id)}
        />
      </div>
    </div>
  )
}
