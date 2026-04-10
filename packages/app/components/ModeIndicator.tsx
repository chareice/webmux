interface ModeIndicatorProps {
  isController: boolean;
  onRequestControl: () => void;
  onReleaseControl: () => void;
}

export function ModeIndicator({ isController, onRequestControl, onReleaseControl }: ModeIndicatorProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: isController ? 'rgba(0, 212, 170, 0.15)' : 'rgba(255,255,255,0.05)',
      borderRadius: 6,
      border: '1px solid ' + (isController ? 'rgb(0, 212, 170)' : 'rgb(26, 58, 92)'),
      fontSize: 12,
      userSelect: 'none' as const,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: isController ? 'rgb(0, 212, 170)' : 'rgb(74, 97, 120)',
        flexShrink: 0,
      }} />
      <span style={{ color: isController ? 'rgb(0, 212, 170)' : 'rgb(122, 143, 166)' }}>
        {isController ? 'Control' : 'Watch'}
      </span>
      <button
        onClick={isController ? onReleaseControl : onRequestControl}
        style={{
          background: 'none',
          border: '1px solid ' + (isController ? 'rgb(74, 97, 120)' : 'rgb(0, 212, 170)'),
          borderRadius: 4,
          color: isController ? 'rgb(122, 143, 166)' : 'rgb(0, 212, 170)',
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: 11,
        }}
      >
        {isController ? 'Release' : 'Take Control'}
      </button>
    </div>
  );
}
