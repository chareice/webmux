import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LoaderCircle, Plus, Pencil, Trash2, Key, Save, X } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { LlmConfig, Project } from '@webmux/shared'

function maskApiKey(key: string): string {
  if (key.length <= 4) return '****'
  return '****' + key.slice(-4)
}

interface ConfigFormData {
  apiBaseUrl: string
  apiKey: string
  model: string
  projectId: string // empty string = default (null)
}

const EMPTY_FORM: ConfigFormData = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
  projectId: '',
}

export function LlmConfigPage() {
  const location = useLocation()
  const [configs, setConfigs] = useState<LlmConfig[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<ConfigFormData>({ ...EMPTY_FORM })
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ConfigFormData>({ ...EMPTY_FORM })
  const [isUpdating, setIsUpdating] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [configsRes, projectsRes] = await Promise.all([
        fetchApi('/api/llm-configs'),
        fetchApi('/api/projects'),
      ])
      if (!configsRes.ok) throw new Error('Failed to load LLM configs')
      if (!projectsRes.ok) throw new Error('Failed to load projects')
      const configsData = (await configsRes.json()) as { configs: LlmConfig[] }
      const projectsData = (await projectsRes.json()) as { projects: Project[] }
      setConfigs(configsData.configs)
      setProjects(projectsData.projects)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleCreate = async () => {
    setCreateError(null)
    if (!createForm.apiBaseUrl.trim()) { setCreateError('API Base URL is required'); return }
    if (!createForm.apiKey.trim()) { setCreateError('API Key is required'); return }
    if (!createForm.model.trim()) { setCreateError('Model is required'); return }

    setIsCreating(true)
    try {
      const body: Record<string, string> = {
        apiBaseUrl: createForm.apiBaseUrl.trim(),
        apiKey: createForm.apiKey.trim(),
        model: createForm.model.trim(),
      }
      if (createForm.projectId) {
        body.projectId = createForm.projectId
      }

      const res = await fetchApi('/api/llm-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to create config')
      }
      const data = (await res.json()) as { config: LlmConfig }
      setConfigs((prev) => [...prev, data.config])
      setCreateForm({ ...EMPTY_FORM })
      setShowCreateForm(false)
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleStartEdit = (config: LlmConfig) => {
    setEditingId(config.id)
    setEditForm({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: '', // Don't pre-fill API key for security
      model: config.model,
      projectId: config.projectId ?? '',
    })
    setEditError(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditForm({ ...EMPTY_FORM })
    setEditError(null)
  }

  const handleUpdate = async () => {
    if (!editingId) return
    setEditError(null)

    setIsUpdating(true)
    try {
      const body: Record<string, string> = {}
      if (editForm.apiBaseUrl.trim()) body.apiBaseUrl = editForm.apiBaseUrl.trim()
      if (editForm.apiKey.trim()) body.apiKey = editForm.apiKey.trim()
      if (editForm.model.trim()) body.model = editForm.model.trim()

      if (Object.keys(body).length === 0) {
        setEditError('No changes to save')
        setIsUpdating(false)
        return
      }

      const res = await fetchApi(`/api/llm-configs/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to update config')
      }
      const data = (await res.json()) as { config: LlmConfig }
      setConfigs((prev) => prev.map((c) => (c.id === editingId ? data.config : c)))
      setEditingId(null)
      setEditForm({ ...EMPTY_FORM })
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = async (configId: string) => {
    if (!confirm('Delete this LLM config?')) return
    try {
      setDeletingId(configId)
      const res = await fetchApi(`/api/llm-configs/${configId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete config')
      setConfigs((prev) => prev.filter((c) => c.id !== configId))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const projectName = (projectId: string | null): string => {
    if (!projectId) return 'Default'
    const project = projects.find((p) => p.id === projectId)
    return project?.name ?? projectId
  }

  // Sort: default configs first, then by project name
  const sortedConfigs = [...configs].sort((a, b) => {
    if (!a.projectId && b.projectId) return -1
    if (a.projectId && !b.projectId) return 1
    return projectName(a.projectId).localeCompare(projectName(b.projectId))
  })

  if (isLoading) {
    return (
      <div className="llm-config-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading LLM configs...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="llm-config-page">
      <div className="settings-subnav">
        <Link
          className={`settings-subnav-link ${location.pathname === '/settings/llm' ? 'active' : ''}`}
          to="/settings/llm"
        >
          LLM Config
        </Link>
        <Link
          className={`settings-subnav-link ${location.pathname === '/settings/instructions' ? 'active' : ''}`}
          to="/settings/instructions"
        >
          Instructions
        </Link>
      </div>
      <div className="threads-header">
        <h1>LLM Configuration</h1>
        <div className="threads-header-actions">
          <button
            className="primary-button"
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            <Plus size={16} />
            New Config
          </button>
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {/* Create form */}
      {showCreateForm ? (
        <div className="llm-config-form-card">
          <h2 className="llm-config-form-title">New LLM Config</h2>
          <div className="llm-config-form">
            <div className="form-section">
              <label className="form-label">API Base URL</label>
              <input
                className="session-input"
                placeholder="https://api.openai.com/v1"
                type="text"
                value={createForm.apiBaseUrl}
                onChange={(e) => setCreateForm((f) => ({ ...f, apiBaseUrl: e.target.value }))}
              />
            </div>
            <div className="form-section">
              <label className="form-label">API Key</label>
              <input
                className="session-input"
                placeholder="sk-..."
                type="password"
                value={createForm.apiKey}
                onChange={(e) => setCreateForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
            <div className="form-section">
              <label className="form-label">Model</label>
              <input
                className="session-input"
                placeholder="gpt-4o, claude-sonnet-4-20250514, etc."
                type="text"
                value={createForm.model}
                onChange={(e) => setCreateForm((f) => ({ ...f, model: e.target.value }))}
              />
            </div>
            <div className="form-section">
              <label className="form-label">Project (optional)</label>
              <select
                className="session-input llm-config-select"
                value={createForm.projectId}
                onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Default (all projects)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="form-hint">
                Leave as default to apply to all projects, or pick a project for a project-specific override.
              </p>
            </div>
            {createError ? <p className="error-banner">{createError}</p> : null}
            <div className="llm-config-form-actions">
              <button
                className="primary-button"
                disabled={isCreating || !createForm.apiBaseUrl.trim() || !createForm.apiKey.trim() || !createForm.model.trim()}
                onClick={() => void handleCreate()}
                type="button"
              >
                {isCreating ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                {isCreating ? 'Creating...' : 'Create Config'}
              </button>
              <button
                className="secondary-button"
                onClick={() => { setShowCreateForm(false); setCreateForm({ ...EMPTY_FORM }); setCreateError(null) }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Config list */}
      {sortedConfigs.length === 0 && !showCreateForm ? (
        <div className="threads-empty">
          <Key size={32} />
          <h2>No LLM configs yet</h2>
          <p>
            Add an LLM configuration to enable the agent loop.
            You need at least a default config with your API endpoint, key, and model.
          </p>
        </div>
      ) : (
        <div className="llm-config-list">
          {sortedConfigs.map((config) => (
            <div className="llm-config-card" key={config.id}>
              {editingId === config.id ? (
                // Edit mode
                <div className="llm-config-edit-form">
                  <div className="form-section">
                    <label className="form-label">API Base URL</label>
                    <input
                      className="session-input"
                      type="text"
                      value={editForm.apiBaseUrl}
                      onChange={(e) => setEditForm((f) => ({ ...f, apiBaseUrl: e.target.value }))}
                    />
                  </div>
                  <div className="form-section">
                    <label className="form-label">API Key (leave empty to keep current)</label>
                    <input
                      className="session-input"
                      placeholder="Leave empty to keep current key"
                      type="password"
                      value={editForm.apiKey}
                      onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))}
                    />
                  </div>
                  <div className="form-section">
                    <label className="form-label">Model</label>
                    <input
                      className="session-input"
                      type="text"
                      value={editForm.model}
                      onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                    />
                  </div>
                  {editError ? <p className="error-banner">{editError}</p> : null}
                  <div className="llm-config-form-actions">
                    <button
                      className="primary-button"
                      disabled={isUpdating}
                      onClick={() => void handleUpdate()}
                      type="button"
                    >
                      {isUpdating ? <LoaderCircle className="spin" size={16} /> : <Save size={14} />}
                      {isUpdating ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={handleCancelEdit}
                      type="button"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // Display mode
                <>
                  <div className="llm-config-card-header">
                    <span className={`llm-config-scope ${config.projectId ? 'project' : 'default'}`}>
                      {projectName(config.projectId)}
                    </span>
                    <span className="llm-config-model">{config.model}</span>
                  </div>
                  <div className="llm-config-card-details">
                    <div className="llm-config-detail">
                      <span className="llm-config-detail-label">Endpoint</span>
                      <span className="llm-config-detail-value">{config.apiBaseUrl}</span>
                    </div>
                    <div className="llm-config-detail">
                      <span className="llm-config-detail-label">API Key</span>
                      <span className="llm-config-detail-value llm-config-key">{maskApiKey(config.apiKey)}</span>
                    </div>
                  </div>
                  <div className="llm-config-card-actions">
                    <button
                      className="secondary-button"
                      onClick={() => handleStartEdit(config)}
                      type="button"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    <button
                      className="icon-button kill-button"
                      disabled={deletingId === config.id}
                      onClick={() => void handleDelete(config.id)}
                      title="Delete config"
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
