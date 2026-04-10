import { useState, useCallback, useRef } from 'react'

interface CommandBarProps {
  onSend: (data: string) => void
  onImagePaste?: (base64: string, mime: string) => void
}

const SHORTCUTS = [
  { label: 'Ctrl+C', data: '\x03', desc: 'Interrupt' },
  { label: 'Ctrl+D', data: '\x04', desc: 'EOF' },
  { label: 'Ctrl+Z', data: '\x1a', desc: 'Suspend' },
  { label: 'Ctrl+L', data: '\x0c', desc: 'Clear' },
  { label: 'Ctrl+R', data: '\x12', desc: 'Search history' },
  { label: 'Ctrl+A', data: '\x01', desc: 'Line start' },
  { label: 'Ctrl+E', data: '\x05', desc: 'Line end' },
  { label: 'Tab', data: '\t', desc: 'Autocomplete' },
  { label: 'Esc', data: '\x1b', desc: 'Escape' },
  { label: '↑', data: '\x1b[A', desc: 'Previous' },
  { label: '↓', data: '\x1b[B', desc: 'Next' },
]

function readImageFile(file: File, onImagePaste: (b64: string, mime: string) => void) {
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = (reader.result as string).split(',')[1]
    onImagePaste(base64, file.type || 'image/png')
  }
  reader.readAsDataURL(file)
}

export function CommandBar({ onSend, onImagePaste }: CommandBarProps) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    if (!value) return
    onSend(value)
    setHistory(prev => {
      const next = [...prev, value]
      return next.length > 50 ? next.slice(-50) : next
    })
    setValue('')
    setHistoryIndex(-1)
  }, [value, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'ArrowUp' && !value.includes('\n')) {
      e.preventDefault()
      if (history.length === 0) return
      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(newIndex)
      setValue(history[newIndex])
    } else if (e.key === 'ArrowDown' && !value.includes('\n')) {
      e.preventDefault()
      if (historyIndex === -1) return
      if (historyIndex >= history.length - 1) {
        setHistoryIndex(-1)
        setValue('')
      } else {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setValue(history[newIndex])
      }
    }
  }, [handleSubmit, history, historyIndex, value])

  const handleShortcut = useCallback((data: string) => {
    onSend(data)
    inputRef.current?.focus()
  }, [onSend])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!onImagePaste) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (blob) readImageFile(blob, onImagePaste)
        return
      }
    }
  }, [onImagePaste])

  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div style={{
      width: 200,
      minWidth: 200,
      borderLeft: '1px solid var(--border)',
      background: 'rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        Control
      </div>

      {/* Command input */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => { setValue(e.target.value); setHistoryIndex(-1) }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={3}
          style={{
            width: '100%',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            padding: '6px 8px',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            outline: 'none',
            resize: 'none',
            lineHeight: 1.4,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          placeholder="Command..."
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Paste image or drag file
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {onImagePaste && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file && onImagePaste) readImageFile(file, onImagePaste)
                    e.target.value = ''
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '3px 8px',
                    fontSize: 13,
                  }}
                  title="Upload image"
                >
                  🖼
                </button>
              </>
            )}
            <button
              onClick={handleSubmit}
              style={{
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Shortcuts */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 0',
      }}>
        {SHORTCUTS.map(s => (
          <div
            key={s.label}
            onClick={() => handleShortcut(s.data)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 10px',
              cursor: 'pointer',
              transition: 'background 0.1s',
              fontSize: 12,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
            }}>
              {s.label}
            </span>
            <span style={{
              color: 'var(--text-muted)',
              fontSize: 10,
            }}>
              {s.desc}
            </span>
          </div>
        ))}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)',
          maxHeight: 120,
          overflowY: 'auto',
        }}>
          <div style={{
            padding: '6px 10px 2px',
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
          }}>
            History
          </div>
          {[...history].reverse().slice(0, 10).map((cmd, i) => (
            <div
              key={`${i}-${cmd}`}
              onClick={() => { setValue(cmd); inputRef.current?.focus() }}
              style={{
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title={cmd}
            >
              {cmd}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
