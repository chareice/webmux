import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderGit2,
  LoaderCircle,
  Star,
} from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type {
  AgentInfo,
  AgentListResponse,
  CreateProjectRequest,
  RepositoryBrowseResponse,
  RepositoryEntry,
  RunTool,
} from '@webmux/shared'

const FAVORITES_KEY = 'webmux:favorite-repos'

function getFavoriteRepos(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

function setFavoriteRepos(paths: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(paths))
}

function toggleFavoriteRepo(path: string): string[] {
  const current = getFavoriteRepos()
  const next = current.includes(path)
    ? current.filter((p) => p !== path)
    : [...current, path]
  setFavoriteRepos(next)
  return next
}

function repositoryName(repoPath: string): string {
  const parts = repoPath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? repoPath
}

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code CLI' },
  { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
]

export function NewProjectPage() {
  const navigate = useNavigate()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedTool, setSelectedTool] = useState<RunTool>('claude')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteRepos())

  const [repoBrowser, setRepoBrowser] = useState<RepositoryBrowseResponse | null>(null)
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false)
  const [isLoadingAgents, setIsLoadingAgents] = useState(true)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previousAgentRef = useRef('')

  const handleToggleFavorite = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setFavorites(toggleFavoriteRepo(path))
  }

  const fetchAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true)
      const res = await fetchApi('/api/agents')
      if (!res.ok) throw new Error('Failed to load agents')
      const data = (await res.json()) as AgentListResponse
      const onlineAgents = data.agents.filter((a) => a.status === 'online')
      setAgents(onlineAgents)
      setSelectedAgent((current) => {
        if (current && onlineAgents.some((a) => a.id === current)) return current
        return onlineAgents[0]?.id ?? ''
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoadingAgents(false)
    }
  }, [])

  const loadRepoBrowser = useCallback(async (aid: string, path?: string) => {
    setIsLoadingRepos(true)
    setRepoError(null)
    try {
      const url = path
        ? `/api/agents/${aid}/repositories?path=${encodeURIComponent(path)}`
        : `/api/agents/${aid}/repositories`
      const res = await fetchApi(url)
      if (!res.ok) throw new Error('Failed to browse repositories')
      const data = (await res.json()) as RepositoryBrowseResponse
      setRepoBrowser(data)
    } catch (err) {
      setRepoError((err as Error).message)
    } finally {
      setIsLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    void fetchAgents()
  }, [fetchAgents])

  // Load repo browser when agent changes
  useEffect(() => {
    if (!selectedAgent) {
      setRepoBrowser(null)
      setRepoError(null)
      return
    }

    const agentChanged =
      previousAgentRef.current !== '' && previousAgentRef.current !== selectedAgent
    previousAgentRef.current = selectedAgent

    if (agentChanged) {
      setRepoPath('')
      setRepoBrowser(null)
    }

    let cancelled = false
    setIsLoadingRepos(true)
    setRepoError(null)

    void fetchApi(`/api/agents/${selectedAgent}/repositories`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to browse repositories')
        return (await r.json()) as RepositoryBrowseResponse
      })
      .then((data) => {
        if (!cancelled) {
          setRepoBrowser(data)
          setIsLoadingRepos(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRepoError((err as Error).message)
          setIsLoadingRepos(false)
        }
      })

    return () => { cancelled = true }
  }, [selectedAgent])

  const selectedAgentInfo = useMemo(
    () => agents.find((a) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  )

  const handleSubmit = async () => {
    setError(null)
    if (!name.trim()) { setError('Please enter a project name'); return }
    if (!selectedAgent) { setError('Please select an agent'); return }
    if (!repoPath.trim()) { setError('Please choose a repository'); return }

    setIsSubmitting(true)
    try {
      const body: CreateProjectRequest = {
        name: name.trim(),
        repoPath: repoPath.trim(),
        agentId: selectedAgent,
        defaultTool: selectedTool,
      }
      if (description.trim()) body.description = description.trim()

      const res = await fetchApi('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to create project')
      }
      const data = (await res.json()) as { project: { id: string } }
      navigate(`/projects/${data.project.id}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoadingAgents) {
    return (
      <div className="new-project-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="new-project-page">
      <div className="new-thread-header">
        <button className="secondary-button" onClick={() => navigate('/projects')} type="button">
          <ArrowLeft size={14} />
          Back
        </button>
        <h1>New Project</h1>
      </div>

      <div className="new-thread-form">
        {/* Project Name */}
        <div className="form-section">
          <label className="form-label">Project Name</label>
          <input
            className="session-input"
            placeholder="My awesome project"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="form-section">
          <label className="form-label">Description (optional)</label>
          <textarea
            className="prompt-textarea"
            placeholder="What is this project about?"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Agent Selection */}
        <div className="form-section">
          <label className="form-label">Agent</label>
          {agents.length === 0 ? (
            <p className="form-hint">No agents online right now.</p>
          ) : (
            <div className="chip-group">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className={`chip ${selectedAgent === agent.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAgent(agent.id)}
                  type="button"
                >
                  {agent.name || agent.id}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Repository Selection */}
        <div className="form-section">
          <label className="form-label">Repository</label>
          <button
            className="repo-picker-button"
            disabled={!selectedAgent}
            onClick={() => {
              if (!selectedAgent) return
              setIsRepoBrowserOpen(true)
              if (!repoBrowser && !isLoadingRepos) {
                void loadRepoBrowser(selectedAgent)
              }
            }}
            type="button"
          >
            <span className="repo-picker-name">
              {repoPath ? repositoryName(repoPath) : 'Choose a repository'}
            </span>
            <span className="repo-picker-path">
              {repoPath ||
                (selectedAgentInfo
                  ? `Browse folders on ${selectedAgentInfo.name || selectedAgentInfo.id}`
                  : 'Select an agent first')}
            </span>
            <ChevronRight className="repo-picker-arrow" size={16} />
          </button>

          {isLoadingRepos && !repoBrowser ? (
            <div className="repo-loading">
              <LoaderCircle className="spin" size={14} />
            </div>
          ) : null}

          {favorites.length > 0 ? (
            <>
              <span className="form-hint-label">Favorites</span>
              <div className="chip-group">
                {favorites.map((rp) => (
                  <button
                    key={rp}
                    className={`chip repo-chip ${repoPath === rp ? 'selected' : ''}`}
                    onClick={() => setRepoPath(rp)}
                    type="button"
                  >
                    <span className="repo-chip-top">
                      <span className="repo-chip-name">{repositoryName(rp)}</span>
                      <span
                        className="repo-chip-star favorited"
                        onClick={(e) => handleToggleFavorite(rp, e)}
                        role="button"
                        title="Remove from favorites"
                      >
                        <Star size={12} />
                      </span>
                    </span>
                    <span className="repo-chip-path">{rp}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {repoError ? <p className="error-banner">{repoError}</p> : null}
        </div>

        {/* Tool Selection */}
        <div className="form-section">
          <label className="form-label">Default Tool</label>
          <div className="tool-cards">
            {TOOLS.map((tool) => (
              <button
                key={tool.value}
                className={`tool-card ${selectedTool === tool.value ? 'selected' : ''}`}
                onClick={() => setSelectedTool(tool.value)}
                type="button"
              >
                <span className="tool-card-title">{tool.label}</span>
                <span className="tool-card-desc">{tool.description}</span>
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <button
          className="primary-button new-thread-submit"
          disabled={isSubmitting || !selectedAgent || !repoPath.trim() || !name.trim()}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
          {isSubmitting ? 'Creating...' : 'Create Project'}
        </button>
      </div>

      {/* Repository Browser Modal */}
      {isRepoBrowserOpen ? (
        <RepositoryBrowserModal
          browser={repoBrowser}
          isLoading={isLoadingRepos}
          error={repoError}
          favorites={favorites}
          onClose={() => setIsRepoBrowserOpen(false)}
          onNavigate={(path) => {
            if (selectedAgent) void loadRepoBrowser(selectedAgent, path)
          }}
          onSelect={(path) => {
            setRepoPath(path)
            setIsRepoBrowserOpen(false)
          }}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : null}
    </div>
  )
}

function RepositoryBrowserModal({
  browser,
  isLoading,
  error,
  favorites,
  onClose,
  onNavigate,
  onSelect,
  onToggleFavorite,
}: {
  browser: RepositoryBrowseResponse | null
  isLoading: boolean
  error: string | null
  favorites: string[]
  onClose: () => void
  onNavigate: (path: string) => void
  onSelect: (path: string) => void
  onToggleFavorite: (path: string, e?: React.MouseEvent) => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container repo-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Browse Repositories</h2>
          <button className="icon-button" onClick={onClose} type="button">&#x2715;</button>
        </div>
        <div className="repo-browser-body">
          {browser?.currentPath ? (
            <div className="repo-browser-path">
              <code>{browser.currentPath}</code>
            </div>
          ) : null}

          {browser?.parentPath !== undefined && browser?.parentPath !== null ? (
            <button
              className="repo-browser-entry"
              onClick={() => onNavigate(browser.parentPath!)}
              type="button"
            >
              <ArrowUp size={14} />
              <span className="repo-browser-entry-name">Up one level</span>
            </button>
          ) : null}

          {isLoading ? (
            <div className="repo-browser-loading">
              <LoaderCircle className="spin" size={16} />
              <span>Loading...</span>
            </div>
          ) : error ? (
            <p className="error-banner">{error}</p>
          ) : browser?.entries.length === 0 ? (
            <p className="repo-browser-empty">No entries found</p>
          ) : (
            <div className="repo-browser-list">
              {browser?.entries.map((entry) => (
                <RepositoryEntryRow
                  key={entry.path}
                  entry={entry}
                  isFavorited={favorites.includes(entry.path)}
                  onNavigate={onNavigate}
                  onSelect={onSelect}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          )}
        </div>
        <div className="repo-browser-footer">
          <span className="form-hint">Only Git repositories can be selected</span>
        </div>
      </div>
    </div>
  )
}

function RepositoryEntryRow({
  entry,
  isFavorited,
  onNavigate,
  onSelect,
  onToggleFavorite,
}: {
  entry: RepositoryEntry
  isFavorited: boolean
  onNavigate: (path: string) => void
  onSelect: (path: string) => void
  onToggleFavorite: (path: string, e?: React.MouseEvent) => void
}) {
  const isRepo = entry.kind === 'repository'
  return (
    <div className="repo-browser-entry-row">
      <button
        className="repo-browser-entry"
        onClick={() => (isRepo ? onSelect(entry.path) : onNavigate(entry.path))}
        type="button"
      >
        {isRepo ? (
          <FolderGit2 size={14} className="repo-icon-git" />
        ) : (
          <Folder size={14} className="repo-icon-dir" />
        )}
        <span className="repo-browser-entry-name">{entry.name}</span>
        {isRepo ? (
          <>
            <span
              className={`repo-browser-entry-star ${isFavorited ? 'favorited' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(entry.path, e)
              }}
              role="button"
              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star size={13} />
            </span>
            <span className="repo-browser-entry-badge">Select</span>
          </>
        ) : (
          <ChevronRight size={14} className="repo-browser-entry-arrow" />
        )}
      </button>
    </div>
  )
}
