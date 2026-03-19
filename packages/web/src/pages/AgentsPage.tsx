import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Check,
  LoaderCircle,
  Monitor,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react'

import type {
  AgentInfo,
  AgentListResponse,
  CreateRegistrationTokenResponse,
} from '@webmux/shared'

import { fetchApi } from '../auth.tsx'

interface CachedToken {
  token: string
  expiresAt: number
}

export function AgentsPage() {
  const navigate = useNavigate()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add-agent modal
  const [modalOpen, setModalOpen] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [copied, setCopied] = useState(false)
  const cachedTokenRef = useRef<CachedToken | null>(null)
  const [registrationCommand, setRegistrationCommand] = useState<string | null>(null)

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetchApi('/api/agents')
      if (!res.ok) throw new Error('Failed to load agents')
      const data = (await res.json()) as AgentListResponse
      setAgents(data.agents)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const buildCommand = (token: string) => {
    const baseUrl = window.location.origin
    return `npx @webmux/agent register \\\n  --server ${baseUrl} \\\n  --token ${token}`
  }

  const fetchNewToken = async () => {
    setRegistering(true)
    setError(null)
    try {
      const res = await fetchApi('/api/agents/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as CreateRegistrationTokenResponse
      cachedTokenRef.current = { token: data.token, expiresAt: data.expiresAt }
      setRegistrationCommand(buildCommand(data.token))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRegistering(false)
    }
  }

  const openModal = () => {
    setModalOpen(true)
    setCopied(false)

    // Reuse cached token if still valid (with 1 min buffer)
    const cached = cachedTokenRef.current
    if (cached && cached.expiresAt > Date.now() + 60000) {
      setRegistrationCommand(buildCommand(cached.token))
      return
    }

    // Otherwise fetch a new one
    cachedTokenRef.current = null
    setRegistrationCommand(null)
    void fetchNewToken()
  }

  const handleRegenerate = () => {
    cachedTokenRef.current = null
    setRegistrationCommand(null)
    setCopied(false)
    void fetchNewToken()
  }

  const handleDeleteAgent = async (agent: AgentInfo) => {
    const confirmed = window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)
    if (!confirmed) return
    setError(null)
    try {
      const res = await fetchApi(`/api/agents/${agent.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete agent')
      void loadAgents()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleRename = async (agentId: string) => {
    const name = renameValue.trim()
    if (!name) return
    try {
      const res = await fetchApi(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('Failed to rename agent')
      setRenamingId(null)
      void loadAgents()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const closeModal = () => {
    setModalOpen(false)
    setCopied(false)
    void loadAgents()
  }

  const copyCommand = async () => {
    if (!registrationCommand) return
    await navigator.clipboard.writeText(registrationCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) {
    return (
      <div className="agents-page">
        <div className="agents-loading">
          <LoaderCircle className="spin" size={24} />
          <span>Loading agents...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="agents-page">
      <div className="agents-header">
        <h1>Your Agents</h1>
        <button className="primary-button" onClick={openModal} type="button">
          <Plus size={16} />
          Add Agent
        </button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {agents.length === 0 ? (
        <div className="agents-empty">
          <Monitor size={48} strokeWidth={1} />
          <h2>No agents yet</h2>
          <p>
            Add an agent to connect a machine. Agents run on your servers and
            provide AI-powered coding assistance through webmux.
          </p>
          <button className="primary-button" onClick={openModal} type="button">
            <Plus size={16} />
            Add your first agent
          </button>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((agent) => (
            <article
              className="agent-card"
              key={agent.id}
              onClick={() => {
                if (renamingId) return
                navigate(`/agents/${agent.id}/threads/new`)
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !renamingId) navigate(`/agents/${agent.id}/threads/new`)
              }}
            >
              <div className="agent-card-header">
                <div className="agent-name-row">
                  <span
                    className={`agent-status-dot ${agent.status}`}
                    title={agent.status}
                  />
                  {renamingId === agent.id ? (
                    <form
                      className="agent-rename-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        void handleRename(agent.id)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        className="agent-rename-input"
                        maxLength={32}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setRenamingId(null)
                          }
                        }}
                        value={renameValue}
                      />
                      <button className="icon-button" type="submit">
                        <Check size={14} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(null)
                        }}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </form>
                  ) : (
                    <h3>{agent.name}</h3>
                  )}
                </div>
                <div className="agent-card-actions">
                  {renamingId !== agent.id ? (
                    <button
                      aria-label={`Rename ${agent.name}`}
                      className="icon-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingId(agent.id)
                        setRenameValue(agent.name)
                      }}
                      type="button"
                    >
                      <Pencil size={13} />
                    </button>
                  ) : null}
                  <button
                    aria-label={`Delete ${agent.name}`}
                    className="icon-button kill-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteAgent(agent)
                    }}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="agent-card-meta">
                <span className={`agent-status-badge ${agent.status}`}>
                  {agent.status === 'online' ? 'Online' : 'Offline'}
                </span>
                {agent.lastSeenAt ? (
                  <span className="agent-last-seen">
                    Last seen {formatRelative(agent.lastSeenAt)}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add Agent Modal */}
      {modalOpen ? (
        <div className="modal-overlay" onClick={closeModal} role="presentation">
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add Agent"
          >
            <div className="modal-header">
              <h2>Register Agent</h2>
              <button
                className="icon-button"
                onClick={closeModal}
                type="button"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {registering ? (
                <div className="modal-loading">
                  <LoaderCircle className="spin" size={20} />
                  <span>Generating token...</span>
                </div>
              ) : registrationCommand ? (
                <>
                  <p className="modal-description">
                    Run this command on the target machine:
                  </p>
                  <div className="registration-command">
                    <pre>{registrationCommand}</pre>
                    <div className="registration-actions">
                      <button
                        className="secondary-button copy-button"
                        onClick={() => { void copyCommand() }}
                        type="button"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={handleRegenerate}
                        type="button"
                        title="Generate a new token"
                      >
                        <RefreshCcw size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="field-hint">
                    The agent name defaults to the machine's hostname. Use --name to override.
                  </p>
                  <button
                    className="primary-button modal-done-button"
                    onClick={closeModal}
                    type="button"
                  >
                    Done
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatRelative(timestamp: number): string {
  const now = Date.now()
  const then = timestamp * 1000
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}d ago`
}
