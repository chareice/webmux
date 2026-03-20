import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderGit2, LoaderCircle } from 'lucide-react'
import { fetchApi } from '../auth.tsx'
import type { Project, AgentInfo } from '@webmux/shared'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function repoName(repoPath: string): string {
  const parts = repoPath.split('/')
  return parts[parts.length - 1] || repoPath
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [projectsRes, agentsRes] = await Promise.all([
        fetchApi('/api/projects'),
        fetchApi('/api/agents'),
      ])
      if (!projectsRes.ok) throw new Error('Failed to load projects')
      if (!agentsRes.ok) throw new Error('Failed to load agents')
      const projectsData = (await projectsRes.json()) as { projects: Project[] }
      const agentsData = (await agentsRes.json()) as { agents: AgentInfo[] }
      setProjects(projectsData.projects)
      setAgents(new Map(agentsData.agents.map((a) => [a.id, a])))
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

  if (isLoading) {
    return (
      <div className="projects-page">
        <div className="threads-loading">
          <LoaderCircle className="spin" size={20} />
          <span>Loading projects...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="projects-page">
      <div className="threads-header">
        <h1>Projects</h1>
        <div className="threads-header-actions">
          <button
            className="primary-button"
            onClick={() => navigate('/projects/new')}
            type="button"
          >
            <Plus size={16} />
            New Project
          </button>
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {projects.length === 0 && !error ? (
        <div className="threads-empty">
          <h2>No projects yet</h2>
          <p>Create a project to manage tasks and dispatch them to agents automatically.</p>
        </div>
      ) : null}

      <div className="projects-grid">
        {projects.map((project) => {
          const agent = agents.get(project.agentId)
          const isOnline = agent?.status === 'online'
          return (
            <div
              className="project-card"
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              role="button"
              tabIndex={0}
            >
              <div className="project-card-header">
                <FolderGit2 size={16} className="project-card-icon" />
                <span className="project-card-name">{project.name}</span>
              </div>
              {project.description ? (
                <p className="project-card-desc">{project.description}</p>
              ) : null}
              <div className="project-card-meta">
                <span className="project-card-repo" title={project.repoPath}>
                  {repoName(project.repoPath)}
                </span>
                <span className="project-card-sep">&middot;</span>
                <span className="project-card-tool">
                  {project.defaultTool === 'codex' ? 'Codex' : 'Claude'}
                </span>
              </div>
              <div className="project-card-footer">
                <span className={`project-agent-status ${isOnline ? 'online' : 'offline'}`}>
                  <span className={`thread-status-dot ${isOnline ? 'success' : 'muted'}`} />
                  {agent?.name || project.agentId}
                </span>
                <span className="project-card-time">{timeAgo(project.updatedAt)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
