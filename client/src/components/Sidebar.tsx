import { useState, useCallback, useRef, useEffect } from 'react'
import type { MachineInfo } from '../types'
import { listDirectory } from '../api'

interface SidebarProps {
  machines: MachineInfo[]
  onCreateTerminal: (machineId: string, cwd: string) => void
}

interface Bookmark {
  path: string
  label: string
}

function getBookmarks(machineId: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(`tc-bookmarks-${machineId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveBookmarks(machineId: string, bookmarks: Bookmark[]) {
  localStorage.setItem(`tc-bookmarks-${machineId}`, JSON.stringify(bookmarks))
}

function pathLabel(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

// Path autocomplete input
function PathInput({ machineId, onSubmit, onCancel }: {
  machineId: string
  onSubmit: (path: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch directory suggestions when input changes
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current)

    const trimmed = value.trim()
    if (!trimmed || !trimmed.startsWith('/') && !trimmed.startsWith('~')) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    fetchTimer.current = setTimeout(async () => {
      // Determine which directory to list
      const lastSlash = trimmed.lastIndexOf('/')
      const parentDir = lastSlash > 0 ? trimmed.substring(0, lastSlash) : '/'
      const prefix = lastSlash >= 0 ? trimmed.substring(lastSlash + 1).toLowerCase() : ''

      try {
        const entries = await listDirectory(machineId, parentDir)
        const dirs = entries
          .filter(e => e.is_dir && (prefix === '' || e.name.toLowerCase().startsWith(prefix)))
          .map(e => e.path)
          .slice(0, 8)
        setSuggestions(dirs)
        setShowSuggestions(dirs.length > 0)
        setSelectedIndex(-1)
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 150)

    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current)
    }
  }, [value, machineId])

  const handleSelect = useCallback((path: string) => {
    setValue(path)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false)
      } else {
        onCancel()
      }
      return
    }

    if (e.key === 'Tab' && showSuggestions && suggestions.length > 0) {
      e.preventDefault()
      const idx = selectedIndex >= 0 ? selectedIndex : 0
      handleSelect(suggestions[idx])
      return
    }

    if (e.key === 'Enter') {
      if (showSuggestions && selectedIndex >= 0) {
        handleSelect(suggestions[selectedIndex])
      } else {
        onSubmit(value.trim())
      }
      return
    }

    if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    }
  }, [showSuggestions, suggestions, selectedIndex, value, handleSelect, onSubmit, onCancel])

  return (
    <div style={{ padding: '6px 12px', position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          style={{
            flex: 1,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            padding: '4px 8px',
            fontSize: 12,
            outline: 'none',
          }}
          placeholder="/path/to/directory"
        />
        <button
          onClick={() => onSubmit(value.trim())}
          style={{
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--accent)',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 12,
          }}
        >
          Add
        </button>
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <div style={{
          position: 'absolute',
          left: 12,
          right: 12,
          top: '100%',
          marginTop: 2,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          zIndex: 50,
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          {suggestions.map((path, i) => (
            <div
              key={path}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(path) }}
              style={{
                padding: '5px 8px',
                fontSize: 12,
                color: i === selectedIndex ? 'var(--accent)' : 'var(--text-primary)',
                background: i === selectedIndex ? 'var(--accent-dim)' : 'transparent',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {path}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MachineSection({ machine, onCreateTerminal }: {
  machine: MachineInfo
  onCreateTerminal: (machineId: string, cwd: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    const saved = getBookmarks(machine.id)
    if (saved.length === 0) {
      const initial = [{ path: machine.home_dir || '/home', label: '~' }]
      saveBookmarks(machine.id, initial)
      return initial
    }
    return saved
  })
  const [showAdd, setShowAdd] = useState(false)

  const handleAddBookmark = useCallback((path: string) => {
    if (!path) return
    if (bookmarks.some(b => b.path === path)) {
      setShowAdd(false)
      return
    }
    const next = [...bookmarks, { path, label: pathLabel(path) }]
    setBookmarks(next)
    saveBookmarks(machine.id, next)
    setShowAdd(false)
  }, [machine.id, bookmarks])

  const handleRemoveBookmark = useCallback((path: string) => {
    const next = bookmarks.filter(b => b.path !== path)
    setBookmarks(next)
    saveBookmarks(machine.id, next)
  }, [machine.id, bookmarks])

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Machine header */}
      <div
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          cursor: 'pointer',
          background: 'rgba(0,0,0,0.15)',
        }}
      >
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--accent)',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {machine.name}
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
        }}>
          {machine.os}
        </span>
        <span style={{
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          transition: 'transform 0.15s',
          fontSize: 10,
          color: 'var(--text-secondary)',
        }}>
          ▶
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '6px 0' }}>
          {/* Bookmark list */}
          {bookmarks.map(bm => (
            <div
              key={bm.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg-card)'
                const btn = e.currentTarget.querySelector('[data-remove]') as HTMLElement
                if (btn) btn.style.opacity = '1'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                const btn = e.currentTarget.querySelector('[data-remove]') as HTMLElement
                if (btn) btn.style.opacity = '0'
              }}
              onClick={() => onCreateTerminal(machine.id, bm.path)}
            >
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', flexShrink: 0 }}>
                ▸
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {bm.label}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {bm.path}
                </div>
              </div>
              <button
                data-remove
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveBookmark(bm.path)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '2px 4px',
                  opacity: 0,
                  transition: 'opacity 0.15s',
                  flexShrink: 0,
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add bookmark */}
          {showAdd ? (
            <PathInput
              machineId={machine.id}
              onSubmit={handleAddBookmark}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <div
              onClick={() => setShowAdd(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-muted)',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <span style={{ fontSize: 14 }}>+</span>
              <span>Add directory</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ machines, onCreateTerminal }: SidebarProps) {
  return (
    <aside style={{
      width: 260,
      minWidth: 260,
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 12px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        <h2 style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          Machines
        </h2>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {machines.length === 0 ? (
          <div style={{
            padding: 20,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            No machines connected
          </div>
        ) : (
          machines.map(machine => (
            <MachineSection
              key={machine.id}
              machine={machine}
              onCreateTerminal={onCreateTerminal}
            />
          ))
        )}
      </div>
    </aside>
  )
}
