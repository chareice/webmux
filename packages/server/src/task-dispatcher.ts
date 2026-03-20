import type { Database } from 'libsql'
import type { ServerToAgentMessage, RunTool } from '@webmux/shared'
import type { AgentHub } from './agent-hub.js'
import {
  findProjectsByAgentId,
  findPendingTasksByProjectId,
  findProjectById,
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
      `SELECT t.*, p.agent_id, p.repo_path, p.default_tool
       FROM tasks t
       JOIN projects p ON t.project_id = p.id
       WHERE t.status = 'pending'
       ORDER BY t.priority DESC, t.created_at ASC`,
    ).all() as Array<TaskRow & { agent_id: string; repo_path: string; default_tool: string }>

    for (const task of allPending) {
      if (!this.hub.getAgent(task.agent_id)) continue
      this.dispatchTask(task.agent_id, task, task.repo_path, task.default_tool)
    }
  }

  /** Dispatch all pending tasks for a specific agent. */
  dispatchPendingTasksForAgent(agentId: string): void {
    if (!this.hub.getAgent(agentId)) return

    const projects = findProjectsByAgentId(this.db, agentId)
    for (const project of projects) {
      const pending = findPendingTasksByProjectId(this.db, project.id)
      for (const task of pending) {
        this.dispatchTask(agentId, task, project.repo_path, project.default_tool)
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
      this.dispatchTask(project.agent_id, task, project.repo_path, project.default_tool)
    }
  }

  private dispatchTask(
    agentId: string,
    task: TaskRow,
    repoPath: string,
    tool: string,
  ): boolean {
    const msg: ServerToAgentMessage = {
      type: 'task-dispatch',
      taskId: task.id,
      projectId: task.project_id,
      repoPath,
      tool: tool as RunTool,
      title: task.title,
      prompt: task.prompt,
      llmConfig: null,
    }

    const sent = this.hub.sendToAgent(agentId, msg)
    if (sent) {
      updateTaskStatus(this.db, task.id, 'dispatched')
    }
    return sent
  }
}
