import { colors, colorAlpha } from "@/lib/colors";

interface ExtendedKeyBarProps {
  onKey: (data: string) => void;
  onToggleKeyboard: () => void;
  keyboardVisible: boolean;
  isController: boolean;
}

const KEY_GROUPS = [
  [
    { label: 'Esc', data: '\x1b' },
    { label: 'Tab', data: '\t' },
    { label: '|', data: '|' },
    { label: '~', data: '~' },
  ],
  [
    { label: '\u2191', data: '\x1b[A' },
    { label: '\u2193', data: '\x1b[B' },
    { label: '\u2190', data: '\x1b[D' },
    { label: '\u2192', data: '\x1b[C' },
  ],
  [
    { label: 'C-c', data: '\x03' },
    { label: 'C-d', data: '\x04' },
    { label: 'C-z', data: '\x1a' },
    { label: 'C-l', data: '\x0c' },
  ],
  [
    { label: 'C-a', data: '\x01' },
    { label: 'C-e', data: '\x05' },
    { label: 'C-r', data: '\x12' },
    { label: 'C-w', data: '\x17' },
  ],
  [
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: '_', data: '_' },
    { label: '.', data: '.' },
  ],
];

export function ExtendedKeyBar({
  onKey, onToggleKeyboard,
  keyboardVisible, isController,
}: ExtendedKeyBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      borderTop: `1px solid ${colors.border}`,
      background: colors.backgroundSecondary,
      height: 44,
      flexShrink: 0,
      touchAction: 'none',
    }}>
      {/* Left: Keyboard toggle (only in control mode) */}
      {isController && (
        <button
          onClick={onToggleKeyboard}
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: keyboardVisible ? colorAlpha.accentMedium15 : 'transparent',
            border: 'none',
            borderRight: `1px solid ${colors.border}`,
            color: keyboardVisible ? colors.accent : colors.foregroundSecondary,
            fontSize: 18,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title={keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6.01" y2="8" />
            <line x1="10" y1="8" x2="10.01" y2="8" />
            <line x1="14" y1="8" x2="14.01" y2="8" />
            <line x1="18" y1="8" x2="18.01" y2="8" />
            <line x1="6" y1="12" x2="6.01" y2="12" />
            <line x1="10" y1="12" x2="10.01" y2="12" />
            <line x1="14" y1="12" x2="14.01" y2="12" />
            <line x1="18" y1="12" x2="18.01" y2="12" />
            <line x1="8" y1="16" x2="16" y2="16" />
          </svg>
        </button>
      )}

      {/* Center: Scrollable key groups */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        gap: 2,
        padding: '0 4px',
      }}>
        {KEY_GROUPS.map((group, gi) => (
          <div key={gi} style={{
            display: 'flex',
            gap: 2,
            padding: '0 2px',
            borderRight: gi < KEY_GROUPS.length - 1 ? `1px solid ${colors.border}` : 'none',
            paddingRight: gi < KEY_GROUPS.length - 1 ? 6 : 2,
            marginRight: gi < KEY_GROUPS.length - 1 ? 2 : 0,
          }}>
            {group.map(key => (
              <button
                key={key.label}
                onClick={() => {
                  if (!isController) return;
                  onKey(key.data);
                }}
                disabled={!isController}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  color: isController ? colors.foreground : colors.foregroundMuted,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: isController ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                  minWidth: 36,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                {key.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
