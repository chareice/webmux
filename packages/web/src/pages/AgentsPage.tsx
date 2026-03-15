import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Check,
  LoaderCircle,
  Monitor,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import type {
  AgentInfo,
  AgentListResponse,
  CreateRegistrationTokenResponse,
} from '@webmux/shared'

import { fetchApi } from '../auth.tsx'

export function AgentsPage() {
  const navigate = useNavigate()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add-agent modal
  const [modalOpen, setModalOpen] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registrationCommand, setRegistrationCommand] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  const handleAddAgent = async () => {
    const name = agentName.trim()
    if (!name) return
    setRegistering(true)
    setError(null)
    try {
      const res = await fetchApi('/api/agents/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as CreateRegistrationTokenResponse
      const baseUrl = window.location.origin
      setRegistrationCommand(
        `webmux-agent register \\\n  --server ${baseUrl} \\\n  --token ${data.token} \\\n  --name ${name}`,
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRegistering(false)
    }
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

  const closeModal = () => {
    setModalOpen(false)
    setAgentName('')
    setRegistrationCommand(null)
    setCopied(false)
    // Refresh agents list in case a new one registered
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
        <button
          className="primary-button"
          onClick={() => setModalOpen(true)}
          type="button"
        >
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
            provide terminal access through webmux.
          </p>
          <button
            className="primary-button"
            onClick={() => setModalOpen(true)}
            type="button"
          >
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
              onClick={() => navigate(`/agents/${agent.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/agents/${agent.id}`)
              }}
            >
              <div className="agent-card-header">
                <div className="agent-name-row">
                  <span
                    className={`agent-status-dot ${agent.status}`}
                    title={agent.status}
                  />
                  <h3>{agent.name}</h3>
                </div>
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
        <div
          className="modal-overlay"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add Agent"
          >
            <div className="modal-header">
              <h2>{registrationCommand ? 'Register Agent' : 'Add Agent'}</h2>
              <button
                className="icon-button"
                onClick={closeModal}
                type="button"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {registrationCommand ? (
              <div className="modal-body">
                <p className="modal-description">
                  Run this command on the target machine to register the agent:
                </p>
                <div className="registration-command">
                  <pre>{registrationCommand}</pre>
                  <button
                    className="secondary-button copy-button"
                    onClick={() => {
                      void copyCommand()
                    }}
                    type="button"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  className="primary-button modal-done-button"
                  onClick={closeModal}
                  type="button"
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                className="modal-body"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleAddAgent()
                }}
              >
                <label className="field-label" htmlFor="agent-name">
                  Agent name
                </label>
                <input
                  id="agent-name"
                  autoComplete="off"
                  autoFocus
                  className="session-input"
                  disabled={registering}
                  maxLength={32}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="my-nas, dev-box, homelab"
                  value={agentName}
                />
                <p className="field-hint">
                  A friendly name for this machine.
                </p>
                <button
                  className="primary-button modal-submit-button"
                  disabled={registering || !agentName.trim()}
                  type="submit"
                >
                  {registering ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    'Generate Registration Token'
                  )}
                </button>
              </form>
            )}
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
