import { useState, useEffect, useCallback } from 'react'
import type { DirEntry } from '../types'
import { listDirectory } from '../api'

interface SidebarProps {
  onCreateTerminal: (cwd: string) => void
}

function TreeNode({ entry, onSelect }: { entry: DirEntry; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  const handleToggle = useCallback(async () => {
    if (!entry.is_dir) return
    if (!loaded) {
      try {
        const entries = await listDirectory(entry.path)
        setChildren(entries)
        setLoaded(true)
      } catch {
        return
      }
    }
    setExpanded(prev => !prev)
  }, [entry, loaded])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          borderRadius: 4,
          fontSize: 13,
          color: 'var(--text-primary)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={handleToggle}
      >
        {entry.is_dir && (
          <span style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            fontSize: 10,
            color: 'var(--text-secondary)',
          }}>
            ▶
          </span>
        )}
        {!entry.is_dir && <span style={{ width: 10 }} />}
        <span style={{
          color: entry.is_dir ? 'var(--text-primary)' : 'var(--text-secondary)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.name}
        </span>
        {entry.is_dir && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSelect(entry.path)
            }}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 3,
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '1px 6px',
              opacity: 0.6,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
            title="Open terminal here"
          >
            +
          </button>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          {children.map(child => (
            <TreeNode key={child.path} entry={child} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ onCreateTerminal }: SidebarProps) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([])
  const [rootPath, setRootPath] = useState(() => {
    return localStorage.getItem('terminal-canvas-root') || '/home'
  })
  const [inputPath, setInputPath] = useState(rootPath)

  useEffect(() => {
    listDirectory(rootPath)
      .then(setRootEntries)
      .catch(() => setRootEntries([]))
  }, [rootPath])

  const handleSetRoot = useCallback(() => {
    setRootPath(inputPath)
    localStorage.setItem('terminal-canvas-root', inputPath)
  }, [inputPath])

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
          marginBottom: 8,
        }}>
          Workspace
        </h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={inputPath}
            onChange={e => setInputPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetRoot()}
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
            placeholder="Root path..."
          />
          <button
            onClick={handleSetRoot}
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
            Go
          </button>
        </div>
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 4px',
      }}>
        {rootEntries.map(entry => (
          <TreeNode key={entry.path} entry={entry} onSelect={onCreateTerminal} />
        ))}
      </div>
    </aside>
  )
}
