interface ModeIndicatorProps {
  isController: boolean
  onRequestControl: () => void
  onReleaseControl: () => void
}

export function ModeIndicator({ isController, onRequestControl, onReleaseControl }: ModeIndicatorProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: isController ? 'var(--accent-dim)' : 'rgba(255,255,255,0.05)',
      borderRadius: 6,
      border: '1px solid ' + (isController ? 'var(--accent)' : 'var(--border)'),
      fontSize: 12,
      userSelect: 'none',
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: isController ? 'var(--accent)' : 'var(--text-muted)',
        flexShrink: 0,
      }} />
      <span style={{ color: isController ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {isController ? 'Control' : 'Watch'}
      </span>
      <button
        onClick={isController ? onReleaseControl : onRequestControl}
        style={{
          background: 'none',
          border: '1px solid ' + (isController ? 'var(--text-muted)' : 'var(--accent)'),
          borderRadius: 4,
          color: isController ? 'var(--text-secondary)' : 'var(--accent)',
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: 11,
        }}
      >
        {isController ? 'Release' : 'Take Control'}
      </button>
    </div>
  )
}
