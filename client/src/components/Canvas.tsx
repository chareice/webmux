import type { TerminalInfo } from '../types'
import { TerminalCard } from './TerminalCard'

interface CanvasProps {
  terminals: TerminalInfo[]
  maximizedId: string | null
  isMobile: boolean
  onMaximize: (id: string) => void
  onMinimize: () => void
  onDestroy: (id: string) => void
}

export function Canvas({ terminals, maximizedId, isMobile, onMaximize, onMinimize, onDestroy }: CanvasProps) {
  return (
    <main style={{
      flex: 1,
      overflow: 'auto',
      padding: isMobile ? 12 : 20,
      paddingTop: isMobile ? 52 : 20,
      background: 'var(--bg-primary)',
    }}>
      {terminals.length === 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>⬡</div>
            <div>{isMobile ? 'Tap ☰ to open a terminal' : 'Select a directory to open a terminal'}</div>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? '1fr'
            : 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: isMobile ? 12 : 16,
          alignContent: 'start',
        }}>
          {terminals.map(terminal => (
            <TerminalCard
              key={terminal.id}
              terminal={terminal}
              maximized={maximizedId === terminal.id}
              isMobile={isMobile}
              onMaximize={() => onMaximize(terminal.id)}
              onMinimize={onMinimize}
              onDestroy={() => onDestroy(terminal.id)}
            />
          ))}
        </div>
      )}
    </main>
  )
}
