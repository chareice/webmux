import { useState, useCallback } from 'react'

interface TerminalToolbarProps {
  onKey: (data: string) => void
}

const KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: '|', data: '|' },
  { label: '/', data: '/' },
  { label: '-', data: '-' },
  { label: '~', data: '~' },
]

const CTRL_KEYS = [
  { label: 'C', data: '\x03' },
  { label: 'D', data: '\x04' },
  { label: 'Z', data: '\x1a' },
  { label: 'L', data: '\x0c' },
  { label: 'A', data: '\x01' },
  { label: 'E', data: '\x05' },
  { label: 'R', data: '\x12' },
  { label: 'W', data: '\x17' },
]

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 10px',
  minWidth: 36,
  textAlign: 'center',
  flexShrink: 0,
  userSelect: 'none',
  WebkitUserSelect: 'none',
}

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent-dim)',
  borderColor: 'var(--accent)',
  color: 'var(--accent)',
}

export function TerminalToolbar({ onKey }: TerminalToolbarProps) {
  const [ctrlMode, setCtrlMode] = useState(false)

  const handleCtrlToggle = useCallback(() => {
    setCtrlMode(prev => !prev)
  }, [])

  const handleKey = useCallback((data: string) => {
    onKey(data)
    setCtrlMode(false)
  }, [onKey])

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '6px 8px',
      background: 'var(--bg-sidebar)',
      borderTop: '1px solid var(--border)',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
      flexShrink: 0,
    }}>
      <button
        style={ctrlMode ? activeBtnStyle : btnStyle}
        onClick={handleCtrlToggle}
      >
        Ctrl
      </button>

      {ctrlMode ? (
        CTRL_KEYS.map(k => (
          <button
            key={k.label}
            style={btnStyle}
            onClick={() => handleKey(k.data)}
          >
            ^{k.label}
          </button>
        ))
      ) : (
        KEYS.map(k => (
          <button
            key={k.label}
            style={btnStyle}
            onClick={() => handleKey(k.data)}
          >
            {k.label}
          </button>
        ))
      )}
    </div>
  )
}
