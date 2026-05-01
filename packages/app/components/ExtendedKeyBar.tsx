import { useRef, useState } from "react";
import { colors, colorAlpha } from "@/lib/colors";

interface ExtendedKeyBarProps {
  onKey: (data: string) => void;
  onToggleKeyboard: () => void;
  onAttachFile?: (file: File) => void | Promise<void>;
  keyboardVisible: boolean;
  isController: boolean;
}

const ARROW_KEYS = [
  { label: '←', data: '\x1b[D' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '→', data: '\x1b[C' },
];

const SCROLLABLE_GROUPS = [
  [
    { label: 'Esc', data: '\x1b' },
    { label: 'Tab', data: '\t' },
    { label: '|', data: '|' },
    { label: '~', data: '~' },
  ],
  [
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

const BAR_HEIGHT = 44;
const BUTTON_HEIGHT = 32;

export function ExtendedKeyBar({
  onKey,
  onToggleKeyboard,
  onAttachFile,
  keyboardVisible,
  isController,
}: ExtendedKeyBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleAttachClick = () => {
    if (!isController || uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset value so the same file can be picked twice in a row.
    e.target.value = "";
    if (!file || !onAttachFile) return;
    setUploading(true);
    try {
      await onAttachFile(file);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      borderTop: `1px solid ${colors.border}`,
      background: colors.backgroundSecondary,
      height: BAR_HEIGHT,
      flexShrink: 0,
      touchAction: 'none',
    }}>
      {/* Left fixed cluster — keyboard toggle, attach, ^C, arrows */}
      {isController && (
        <button
          onClick={onToggleKeyboard}
          style={{
            width: BAR_HEIGHT,
            height: BAR_HEIGHT,
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
          aria-label={keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
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

      {onAttachFile && (
        <>
          <button
            onClick={handleAttachClick}
            disabled={!isController || uploading}
            style={{
              width: BAR_HEIGHT,
              height: BAR_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRight: `1px solid ${colors.border}`,
              color: isController ? colors.foregroundSecondary : colors.foregroundMuted,
              cursor: isController && !uploading ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              opacity: uploading ? 0.5 : 1,
            }}
            title={uploading ? 'Uploading…' : 'Attach image'}
            aria-label="Attach image"
            data-testid="extended-keybar-attach"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            data-testid="extended-keybar-file-input"
          />
        </>
      )}

      {/* Pinned ^C — interrupting the running process is the highest-frequency
          action on Claude Code / Codex sessions, so it must never scroll off. */}
      <KeyButton
        label="^C"
        onPress={() => isController && onKey('\x03')}
        isController={isController}
        pinned
        testid="extended-keybar-ctrl-c"
      />

      {/* Pinned arrows — TUI navigation needs them within reach. */}
      <div style={{
        display: 'flex',
        gap: 2,
        padding: '0 4px',
        borderRight: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        {ARROW_KEYS.map((key) => (
          <KeyButton
            key={key.label}
            label={key.label}
            onPress={() => isController && onKey(key.data)}
            isController={isController}
          />
        ))}
      </div>

      {/* Right scrollable area with edge fade hinting more keys exist. */}
      <div style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: '100%',
      }}>
        <div style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          gap: 2,
          padding: '0 4px',
        }}>
          {SCROLLABLE_GROUPS.map((group, gi) => (
            <div key={gi} style={{
              display: 'flex',
              gap: 2,
              padding: '0 2px',
              borderRight: gi < SCROLLABLE_GROUPS.length - 1 ? `1px solid ${colors.border}` : 'none',
              paddingRight: gi < SCROLLABLE_GROUPS.length - 1 ? 6 : 2,
              marginRight: gi < SCROLLABLE_GROUPS.length - 1 ? 2 : 0,
            }}>
              {group.map((key) => (
                <KeyButton
                  key={key.label}
                  label={key.label}
                  onPress={() => isController && onKey(key.data)}
                  isController={isController}
                />
              ))}
            </div>
          ))}
        </div>
        {/* Edge fade — purely visual hint that more keys are scrollable. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 18,
            height: '100%',
            pointerEvents: 'none',
            background: `linear-gradient(to right, transparent, ${colors.backgroundSecondary})`,
          }}
        />
      </div>
    </div>
  );
}

interface KeyButtonProps {
  label: string;
  onPress: () => void;
  isController: boolean;
  pinned?: boolean;
  testid?: string;
}

function KeyButton({ label, onPress, isController, pinned, testid }: KeyButtonProps) {
  return (
    <button
      onClick={onPress}
      disabled={!isController}
      data-testid={testid}
      style={{
        background: pinned ? colorAlpha.accentSoft : colors.surface,
        border: `1px solid ${pinned ? colorAlpha.accentLine : colors.border}`,
        borderRadius: 4,
        color: !isController
          ? colors.foregroundMuted
          : pinned
            ? colors.accent
            : colors.foreground,
        padding: '4px 10px',
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: pinned ? 700 : 400,
        cursor: isController ? 'pointer' : 'not-allowed',
        whiteSpace: 'nowrap',
        minWidth: 36,
        height: BUTTON_HEIGHT,
        marginLeft: pinned ? 6 : 0,
        marginRight: pinned ? 6 : 0,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {label}
    </button>
  );
}
