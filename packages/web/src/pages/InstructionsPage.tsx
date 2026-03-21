import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LoaderCircle, Save, FileText, WifiOff } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { AgentInfo, AgentListResponse, RunTool } from '@webmux/shared'

const TOOLS: { key: RunTool; label: string; file: string }[] = [
  { key: 'claude', label: 'Claude Code', file: '~/.claude/CLAUDE.md' },
  { key: 'codex', label: 'Codex', file: '~/.codex/AGENTS.md' },
]

export function InstructionsPage() {
  const location = useLocation()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [activeTool, setActiveTool] = useState<RunTool>('claude')
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    fetchApi('/api/agents')
      .then(res => res.json())
      .then((data: AgentListResponse) => {
        setAgents(data.agents)
        const onlineAgent = data.agents.find(a => a.status === 'online')
        if (onlineAgent) setSelectedAgentId(onlineAgent.id)
      })
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [])

  const fetchInstructions = useCallback(async () => {
    if (!selectedAgentId) return
    const agent = agents.find(a => a.id === selectedAgentId)
    if (!agent || agent.status !== 'online') {
      setContent('')
      setOriginalContent('')
      return
    }

    setIsFetching(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetchApi(`/api/agents/${selectedAgentId}/instructions?tool=${activeTool}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to load instructions')
      }
      const data = await res.json()
      setContent(data.content ?? '')
      setOriginalContent(data.content ?? '')
    } catch (err) {
      setError((err as Error).message)
      setContent('')
      setOriginalContent('')
    } finally {
      setIsFetching(false)
    }
  }, [selectedAgentId, activeTool, agents])

  useEffect(() => {
    void fetchInstructions()
  }, [fetchInstructions])

  const handleSave = async () => {
    if (!selectedAgentId) return
    setIsSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetchApi(`/api/agents/${selectedAgentId}/instructions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: activeTool, content }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error((errData as any)?.error || 'Failed to save instructions')
      }
      setOriginalContent(content)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const isDirty = content !== originalContent
  const selectedAgent = agents.find(a => a.id === selectedAgentId)
  const isOffline = selectedAgent?.status !== 'online'

  if (isLoading) {
    return (
      <div className="instructions-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="instructions-page">
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
        <h1>Global Instructions</h1>
      </div>

      <div className="instructions-agent-selector">
        <label className="form-label">Agent</label>
        <select
          className="session-input"
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          <option value="" disabled>Select an agent...</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id} disabled={agent.status !== 'online'}>
              {agent.name} {agent.status !== 'online' ? '(offline)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedAgentId && isOffline ? (
        <div className="instructions-offline">
          <WifiOff size={32} />
          <p>Agent is offline. Connect the agent to manage instructions.</p>
        </div>
      ) : selectedAgentId ? (
        <>
          <div className="instructions-tabs">
            {TOOLS.map(t => (
              <button
                key={t.key}
                className={`instructions-tab ${activeTool === t.key ? 'active' : ''}`}
                onClick={() => setActiveTool(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="instructions-file-hint">
            {TOOLS.find(t => t.key === activeTool)?.file}
          </p>

          {error ? <p className="error-banner">{error}</p> : null}

          {isFetching ? (
            <div className="threads-loading">
              <LoaderCircle className="spin" size={20} />
              <span>Loading instructions...</span>
            </div>
          ) : (
            <>
              <textarea
                className="instructions-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Enter global instructions for ${activeTool === 'claude' ? 'Claude Code' : 'Codex'}...`}
                spellCheck={false}
              />
              <div className="instructions-actions">
                <button
                  className="primary-button"
                  disabled={isSaving || !isDirty}
                  onClick={() => void handleSave()}
                  type="button"
                >
                  {isSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                  {saveSuccess ? 'Saved!' : isSaving ? 'Saving...' : 'Save'}
                </button>
                {isDirty ? (
                  <span className="instructions-dirty-hint">Unsaved changes</span>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="instructions-offline">
          <FileText size={32} />
          <p>Select an agent to manage its global instructions.</p>
        </div>
      )}
    </div>
  )
}
