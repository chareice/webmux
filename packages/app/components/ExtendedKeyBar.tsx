import { useRef, useState } from "react";
import { colors, colorAlpha } from "@/lib/colors";

interface ExtendedKeyBarProps {
  onKey: (data: string) => void;
  onToggleKeyboard: () => void;
  onAttachFile?: (file: File) => void | Promise<void>;
  // Select-mode plumbing — when both callbacks are provided the bar will
  // render a "Select" toggle in the fixed cluster, and morph into a slim
  // [Done] · hint · [Copy] strip while selectMode is true.
  onEnterSelectMode?: () => void;
  onExitSelectMode?: () => void;
  onCopySelection?: () => Promise<string | null> | string | null;
  selectMode?: boolean;
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
  onEnterSelectMode,
  onExitSelectMode,
  onCopySelection,
  selectMode = false,
  keyboardVisible,
  isController,
}: ExtendedKeyBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [copying, setCopying] = useState(false);

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

  const selectModeAvailable =
    typeof onEnterSelectMode === "function" &&
    typeof onExitSelectMode === "function" &&
    typeof onCopySelection === "function";

  const handleCopyClick = async () => {
    if (!onCopySelection || copying) return;
    setCopying(true);
    try {
      await onCopySelection();
    } finally {
      setCopying(false);
    }
  };

  // Select mode collapses the bar to [Done] · hint · [Copy]. Most keys
  // are useless during selection so we hide the noise.
  if (selectMode && selectModeAvailable) {
    return (
      <div
        data-testid="extended-keybar-select-mode"
        style={{
          display: 'flex',
          alignItems: 'center',
          borderTop: `1px solid ${colors.border}`,
          background: colorAlpha.accentSoft,
          height: BAR_HEIGHT,
          flexShrink: 0,
          touchAction: 'none',
        }}
      >
        <button
          onClick={onExitSelectMode}
          disabled={copying}
          data-testid="extended-keybar-select-done"
          style={{
            height: BAR_HEIGHT,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            borderRight: `1px solid ${colorAlpha.accentLine}`,
            color: colors.accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: copying ? 'wait' : 'pointer',
            flexShrink: 0,
          }}
        >
          Done
        </button>
        <div style={{
          flex: 1,
          minWidth: 0,
          padding: '0 12px',
          fontSize: 11,
          color: colors.accent,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: 0.85,
        }}>
          Drag on the terminal to select text
        </div>
        <button
          onClick={handleCopyClick}
          disabled={copying}
          data-testid="extended-keybar-copy"
          style={{
            height: BAR_HEIGHT,
            padding: '0 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: colors.accent,
            border: 'none',
            color: '#120904',
            fontSize: 13,
            fontWeight: 700,
            cursor: copying ? 'wait' : 'pointer',
            flexShrink: 0,
            opacity: copying ? 0.6 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copying ? 'Copying…' : 'Copy'}
        </button>
      </div>
    );
  }

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
              background: uploading ? colorAlpha.accentSoft : 'transparent',
              border: 'none',
              borderRight: `1px solid ${colors.border}`,
              color: uploading
                ? colors.accent
                : isController
                  ? colors.foregroundSecondary
                  : colors.foregroundMuted,
              cursor: isController && !uploading ? 'pointer' : 'not-allowed',
              flexShrink: 0,
            }}
            title={uploading ? 'Uploading…' : 'Attach image'}
            aria-label={uploading ? 'Uploading attachment' : 'Attach image'}
            data-testid="extended-keybar-attach"
          >
            {uploading ? (
              // Three-quarter ring rotated by webmuxSpin keyframe — gives
              // a clear "I'm doing something" cue, much more visible than
              // the previous opacity dim.
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{
                  animation: 'webmuxSpin 800ms linear infinite',
                  transformOrigin: 'center',
                }}
                data-testid="extended-keybar-attach-spinner"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
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

      {selectModeAvailable && (
        <button
          onClick={onEnterSelectMode}
          disabled={!isController}
          data-testid="extended-keybar-select-toggle"
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
            cursor: isController ? 'pointer' : 'not-allowed',
            flexShrink: 0,
          }}
          title="Select text to copy"
          aria-label="Select text to copy"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.5V4a1 1 0 0 1 1-1h2.5" />
            <path d="M4 17.5V20a1 1 0 0 0 1 1h2.5" />
            <path d="M16.5 3H19a1 1 0 0 1 1 1v2.5" />
            <path d="M16.5 21H19a1 1 0 0 0 1-1v-2.5" />
            <path d="M9 8v8M15 8v8M9 12h6" />
          </svg>
        </button>
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
