import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, FolderGit2, Folder, LoaderCircle, ArrowUp, ImagePlus, Star, X } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type {
  AgentInfo,
  AgentListResponse,
  RepositoryBrowseResponse,
  RepositoryEntry,
  Run,
  RunDetailResponse,
  RunListResponse,
  RunTool,
  StartRunRequest,
  RunImageAttachmentUpload,
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

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code CLI' },
  { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
]

const MAX_ATTACHMENTS = 4

interface DraftAttachment {
  id: string
  file: File
  previewUrl: string
  base64: string
}

function extractRecentRepositories(runs: Run[]): string[] {
  const seen = new Set<string>()
  return [...runs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => r.repoPath)
    .filter((p) => {
      if (!p || seen.has(p)) return false
      seen.add(p)
      return true
    })
    .slice(0, 8)
}

function repositoryName(repoPath: string): string {
  const parts = repoPath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? repoPath
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // result is "data:<mime>;base64,<data>" - extract <data>
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function NewThreadPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState(agentId || '')
  const [selectedTool, setSelectedTool] = useState<RunTool>('claude')
  const [repoPath, setRepoPath] = useState('')
  const [prompt, setPrompt] = useState('')
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteRepos())
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])

  const [repoBrowser, setRepoBrowser] = useState<RepositoryBrowseResponse | null>(null)
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState(false)
  const [isLoadingAgents, setIsLoadingAgents] = useState(true)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previousAgentRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        if (agentId && onlineAgents.some((a) => a.id === agentId)) return agentId
        if (current && onlineAgents.some((a) => a.id === current)) return current
        return onlineAgents[0]?.id ?? ''
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoadingAgents(false)
    }
  }, [agentId])

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

  // Load repos when agent changes
  useEffect(() => {
    if (!selectedAgent) {
      setRecentRepos([])
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

    void Promise.allSettled([
      fetchApi(`/api/agents/${selectedAgent}/threads`).then(async (r) => {
        if (!r.ok) throw new Error('Failed')
        return (await r.json()) as RunListResponse
      }),
      fetchApi(`/api/agents/${selectedAgent}/repositories`).then(async (r) => {
        if (!r.ok) throw new Error('Failed')
        return (await r.json()) as RepositoryBrowseResponse
      }),
    ]).then(([runsResult, browseResult]) => {
      if (cancelled) return
      if (runsResult.status === 'fulfilled') {
        setRecentRepos(extractRecentRepositories(runsResult.value.runs))
      } else {
        setRecentRepos([])
      }
      if (browseResult.status === 'fulfilled') {
        setRepoBrowser(browseResult.value)
      } else {
        setRepoBrowser(null)
        setRepoError('Failed to browse repositories')
      }
      setIsLoadingRepos(false)
    })

    return () => { cancelled = true }
  }, [selectedAgent])


  const selectedAgentInfo = useMemo(
    () => agents.find((a) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  )

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const remaining = MAX_ATTACHMENTS - attachments.length
    const toAdd = Array.from(files).slice(0, remaining)

    const newAttachments: DraftAttachment[] = []
    for (const file of toAdd) {
      const base64 = await fileToBase64(file)
      newAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        base64,
      })
    }

    setAttachments((prev) => [...prev, ...newAttachments])
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  const hasContent = prompt.trim().length > 0 || attachments.length > 0

  const handleSubmit = async () => {
    setError(null)
    if (!selectedAgent) { setError('Please select an agent'); return }
    if (!repoPath.trim()) { setError('Please choose a working directory'); return }
    if (!hasContent) { setError('Please enter a prompt or attach images'); return }

    setIsSubmitting(true)
    try {
      const uploadAttachments: RunImageAttachmentUpload[] = attachments.map((a) => ({
        id: a.id,
        name: a.file.name,
        mimeType: a.file.type,
        sizeBytes: a.file.size,
        base64: a.base64,
      }))

      const body: StartRunRequest = {
        tool: selectedTool,
        repoPath: repoPath.trim(),
        prompt: prompt.trim(),
        ...(uploadAttachments.length > 0 ? { attachments: uploadAttachments } : {}),
      }
      const res = await fetchApi(`/api/agents/${selectedAgent}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to start thread')
      }
      const data = (await res.json()) as RunDetailResponse
      // Clean up object URLs before navigating
      for (const a of attachments) URL.revokeObjectURL(a.previewUrl)
      navigate(`/agents/${selectedAgent}/threads/${data.run.id}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoadingAgents) {
    return (
      <div className="new-thread-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="new-thread-page">
      <div className="new-thread-header">
        <button className="secondary-button" onClick={() => navigate('/threads')} type="button">
          <ArrowLeft size={14} />
          Back
        </button>
        <h1>New Thread</h1>
      </div>

      <div className="new-thread-form">
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

        {/* Tool Selection */}
        <div className="form-section">
          <label className="form-label">Tool</label>
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

        {/* Repository Selection */}
        <div className="form-section">
          <label className="form-label">Working Directory</label>
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
              {repoPath ? repositoryName(repoPath) : 'Choose a directory'}
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

          {recentRepos.length > 0 ? (
            <>
              <span className="form-hint-label">Recent repositories</span>
              <div className="chip-group">
                {recentRepos.filter((rp) => !favorites.includes(rp)).map((rp) => (
                  <button
                    key={rp}
                    className={`chip repo-chip ${repoPath === rp ? 'selected' : ''}`}
                    onClick={() => setRepoPath(rp)}
                    type="button"
                  >
                    <span className="repo-chip-top">
                      <span className="repo-chip-name">{repositoryName(rp)}</span>
                      <span
                        className="repo-chip-star"
                        onClick={(e) => handleToggleFavorite(rp, e)}
                        role="button"
                        title="Add to favorites"
                      >
                        <Star size={12} />
                      </span>
                    </span>
                    <span className="repo-chip-path">{rp}</span>
                  </button>
                ))}
              </div>
            </>
          ) : selectedAgent && !isLoadingRepos && favorites.length === 0 ? (
            <p className="form-hint">No recent repositories. Use the picker above to browse.</p>
          ) : null}

          {repoError ? <p className="error-banner">{repoError}</p> : null}
        </div>

        {/* Prompt */}
        <div className="form-section">
          <label className="form-label">Prompt</label>
          <textarea
            className="prompt-textarea"
            placeholder="What would you like the AI to do?"
            rows={6}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* Image Attachments */}
        <div className="form-section">
            <label className="form-label">Image Attachments</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />

            {attachments.length > 0 ? (
              <div className="attachment-thumbnails">
                {attachments.map((a) => (
                  <div key={a.id} className="attachment-thumb">
                    <img src={a.previewUrl} alt={a.file.name} className="attachment-thumb-img" />
                    <button
                      className="attachment-thumb-remove"
                      onClick={() => removeAttachment(a.id)}
                      title="Remove"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                    <div className="attachment-thumb-info">
                      <span className="attachment-thumb-name">{a.file.name}</span>
                      <span className="attachment-thumb-size">{formatFileSize(a.file.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {attachments.length < MAX_ATTACHMENTS ? (
              <button
                className="secondary-button attachment-add-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <ImagePlus size={14} />
                {attachments.length === 0 ? 'Add Images' : 'Add More'}
                <span className="attachment-count-hint">
                  ({attachments.length}/{MAX_ATTACHMENTS})
                </span>
              </button>
            ) : (
              <p className="form-hint">Maximum {MAX_ATTACHMENTS} images reached.</p>
            )}
          </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <button
          className="primary-button new-thread-submit"
          disabled={isSubmitting || !selectedAgent || !repoPath.trim() || !hasContent}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}
          {isSubmitting ? 'Starting...' : 'Start Thread'}
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
          <h2>Browse Directories</h2>
          <button className="icon-button" onClick={onClose} type="button">✕</button>
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
          <span className="form-hint">Click folder to browse, click Select to choose</span>
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
        onClick={() => onNavigate(entry.path)}
        type="button"
      >
        {isRepo ? (
          <FolderGit2 size={14} className="repo-icon-git" />
        ) : (
          <Folder size={14} className="repo-icon-dir" />
        )}
        <span className="repo-browser-entry-name">{entry.name}</span>
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
        <span
          className="repo-browser-entry-badge"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(entry.path)
          }}
        >
          Select
        </span>
        <ChevronRight size={14} className="repo-browser-entry-arrow" />
      </button>
    </div>
  )
}
