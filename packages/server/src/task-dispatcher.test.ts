import { describe, expect, it, vi, beforeEach } from 'vitest'
import { initDb, createUser, createAgent, createProject, createTask, createLlmConfig, findTaskById } from './db.js'
import { TaskDispatcher } from './task-dispatcher.js'
import type { AgentHub } from './agent-hub.js'
import type Database from 'libsql'

let db: Database.Database

beforeEach(() => {
  db = initDb(':memory:')
})

function setupFixtures() {
  const user = createUser(db, { provider: 'github', providerId: 'td-1', displayName: 'alice', avatarUrl: null })
  const agent = createAgent(db, { userId: user.id, name: 'nas', agentSecretHash: 'hash' })
  const project = createProject(db, {
    userId: user.id,
    agentId: agent.id,
    name: 'Test',
    description: '',
    repoPath: '/repo',
    defaultTool: 'claude',
  })
  return { user, agent, project }
}

describe('TaskDispatcher', () => {
  it('dispatches all pending tasks when agent is online', () => {
    const { project } = setupFixtures()
    const t1 = createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })
    const t2 = createTask(db, { projectId: project.id, title: 'T2', prompt: 'p2', priority: 0 })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasks()

    expect(sendToAgent).toHaveBeenCalledTimes(2)
    expect(findTaskById(db, t1.id)?.status).toBe('dispatched')
    expect(findTaskById(db, t2.id)?.status).toBe('dispatched')
  })

  it('skips tasks when agent is offline', () => {
    const { project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })

    const hub = {
      getAgent: vi.fn().mockReturnValue(undefined),
      sendToAgent: vi.fn(),
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasks()

    expect(hub.sendToAgent).not.toHaveBeenCalled()
  })

  it('dispatches for a specific agent', () => {
    const { agent, project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasksForAgent(agent.id)

    expect(sendToAgent).toHaveBeenCalledTimes(1)
  })

  it('dispatches for a specific project', () => {
    const { project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })
    createTask(db, { projectId: project.id, title: 'T2', prompt: 'p2', priority: 0 })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasksForProject(project.id)

    expect(sendToAgent).toHaveBeenCalledTimes(2)
  })

  it('sends correct task-dispatch message format', () => {
    const { agent, project } = setupFixtures()
    const task = createTask(db, { projectId: project.id, title: 'Fix bug', prompt: 'Fix the login bug', priority: 5 })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasksForProject(project.id)

    expect(sendToAgent).toHaveBeenCalledWith(agent.id, {
      type: 'task-dispatch',
      taskId: task.id,
      projectId: project.id,
      repoPath: '/repo',
      tool: 'claude',
      title: 'Fix bug',
      prompt: 'Fix the login bug',
      llmConfig: null,
    })
  })

  it('does not dispatch already dispatched tasks', () => {
    const { project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasks()
    dispatcher.dispatchPendingTasks()

    expect(sendToAgent).toHaveBeenCalledTimes(1)
  })

  it('includes LLM config in task-dispatch when configured', () => {
    const { user, agent, project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })

    // Create a default LLM config for the user
    createLlmConfig(db, user.id, {
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test-key',
      model: 'gpt-4',
    })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasksForProject(project.id)

    expect(sendToAgent).toHaveBeenCalledWith(agent.id, expect.objectContaining({
      type: 'task-dispatch',
      llmConfig: {
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
    }))
  })

  it('includes project-specific LLM config over default when available', () => {
    const { user, agent, project } = setupFixtures()
    createTask(db, { projectId: project.id, title: 'T1', prompt: 'p1', priority: 0 })

    // Create a default LLM config
    createLlmConfig(db, user.id, {
      api_base_url: 'https://default.api/v1',
      api_key: 'sk-default',
      model: 'gpt-3.5',
    })

    // Create a project-specific LLM config
    createLlmConfig(db, user.id, {
      api_base_url: 'https://project.api/v1',
      api_key: 'sk-project',
      model: 'gpt-4',
      project_id: project.id,
    })

    const sendToAgent = vi.fn().mockReturnValue(true)
    const hub = {
      getAgent: vi.fn().mockReturnValue({ socket: {} }),
      sendToAgent,
    } as unknown as AgentHub

    const dispatcher = new TaskDispatcher(db, hub)
    dispatcher.dispatchPendingTasksForProject(project.id)

    expect(sendToAgent).toHaveBeenCalledWith(agent.id, expect.objectContaining({
      llmConfig: {
        apiBaseUrl: 'https://project.api/v1',
        apiKey: 'sk-project',
        model: 'gpt-4',
      },
    }))
  })
})
