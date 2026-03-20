import type { Database } from 'libsql'
import type { ServerToAgentMessage, RunTool } from '@webmux/shared'
import type { AgentHub } from './agent-hub.js'
import {
  findProjectsByAgentId,
  findPendingTasksByProjectId,
  findProjectById,
  resolveLlmConfig,
  updateTaskStatus,
} from './db.js'
import type { TaskRow } from './db.js'

export class TaskDispatcher {
  constructor(
    private readonly db: Database,
    private readonly hub: AgentHub,
  ) {}

  /** Dispatch all pending tasks across all projects. */
  dispatchPendingTasks(): void {
    // Query all pending tasks with project info via JOIN
    const allPending = this.db.prepare(
      `SELECT t.*, p.agent_id, p.repo_path, p.default_tool, p.user_id
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE t.status = 'pending'
       ORDER BY t.priority DESC, t.created_at ASC`,
    ).all() as Array<TaskRow & { agent_id: string; repo_path: string; default_tool: string; user_id: string }>

    for (const task of allPending) {
      if (!this.hub.getAgent(task.agent_id)) continue
      this.dispatchTask(task.agent_id, task, task.repo_path, task.default_tool, task.user_id)
    }
  }

  /** Dispatch all pending tasks for a specific agent. */
  dispatchPendingTasksForAgent(agentId: string): void {
    if (!this.hub.getAgent(agentId)) return

    const projects = findProjectsByAgentId(this.db, agentId)
    for (const project of projects) {
      const pending = findPendingTasksByProjectId(this.db, project.id)
      for (const task of pending) {
        this.dispatchTask(agentId, task, project.repo_path, project.default_tool, project.user_id)
      }
    }
  }

  /** Dispatch all pending tasks for a specific project. */
  dispatchPendingTasksForProject(projectId: string): void {
    const project = findProjectById(this.db, projectId)
    if (!project) return
    if (!this.hub.getAgent(project.agent_id)) return

    const pending = findPendingTasksByProjectId(this.db, projectId)
    for (const task of pending) {
      this.dispatchTask(project.agent_id, task, project.repo_path, project.default_tool, project.user_id)
    }
  }

  /** Dispatch a specific task with optional conversation history (for re-dispatch after completion). */
  public dispatchSingleTask(
    db: Database,
    taskId: string,
    conversationHistory?: Array<{ role: 'agent' | 'user'; content: string }>,
  ): void {
    const row = db.prepare(`
      SELECT t.*, p.agent_id, p.repo_path, p.default_tool, p.user_id
      FROM tasks t JOIN projects p ON t.project_id = p.id
      WHERE t.id = ?
    `).get(taskId) as (TaskRow & { agent_id: string; repo_path: string; default_tool: string; user_id: string }) | undefined

    if (!row) return

    const llmConfig = resolveLlmConfig(db, row.user_id, row.project_id)

    const message: ServerToAgentMessage = {
      type: 'task-dispatch',
      taskId: row.id,
      projectId: row.project_id,
      repoPath: row.repo_path,
      tool: (row.tool || row.default_tool) as RunTool,
      title: row.title,
      prompt: row.prompt,
      llmConfig: llmConfig
        ? { apiBaseUrl: llmConfig.api_base_url, apiKey: llmConfig.api_key, model: llmConfig.model }
        : null,
      conversationHistory,
    }

    const sent = this.hub.sendToAgent(row.agent_id, message)
    if (sent) {
      updateTaskStatus(db, taskId, 'dispatched')
    }
  }

  private dispatchTask(
    agentId: string,
    task: TaskRow,
    repoPath: string,
    tool: string,
    userId: string,
  ): boolean {
    const llmConfig = resolveLlmConfig(this.db, userId, task.project_id)

    const msg: ServerToAgentMessage = {
      type: 'task-dispatch',
      taskId: task.id,
      projectId: task.project_id,
      repoPath,
      tool: (task.tool || tool) as RunTool,
      title: task.title,
      prompt: task.prompt,
      llmConfig: llmConfig
        ? { apiBaseUrl: llmConfig.api_base_url, apiKey: llmConfig.api_key, model: llmConfig.model }
        : null,
    }

    const sent = this.hub.sendToAgent(agentId, msg)
    if (sent) {
      updateTaskStatus(this.db, task.id, 'dispatched')
    }
    return sent
  }
}
