import { useEffect, useRef, useState } from 'react'
import { Search, Terminal } from 'lucide-react'

import type { SessionSummary } from '../../shared/contracts.ts'

interface CommandPaletteProps {
  sessions: SessionSummary[]
  onSelect: (name: string) => void
  onClose: () => void
}

export function CommandPalette({ sessions, onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = sessions.filter((session) =>
    session.name.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const updateQuery = (value: string) => {
    setQuery(value)
    setActiveIndex(0)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }

    if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault()
      onSelect(filtered[activeIndex].name)
      return
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="palette-container"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="palette-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Switch session..."
            type="text"
            value={query}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="palette-empty">No matching sessions</div>
        ) : (
          <div className="palette-results" role="listbox">
            {filtered.map((session, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`palette-item${index === activeIndex ? ' active' : ''}`}
                key={session.name}
                onClick={() => onSelect(session.name)}
                role="option"
                type="button"
              >
                <Terminal size={15} />
                <span className="palette-item-name">{session.name}</span>
                <span className="palette-item-cmd">{session.currentCommand}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
