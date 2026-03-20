import { describe, expect, it, vi } from 'vitest'
import type Database from 'libsql'

import type { AgentUpgradePolicy, ServerToAgentMessage } from '@webmux/shared'

import { hashSecret } from './auth.js'
import { AgentHub } from './agent-hub.js'
import { createAgent, createProject, createRunWithInitialTurn, createTask, createUser, findRunById, findRunTurnById, findStepsByTaskId, findTaskById, initDb } from './db.js'
import type { TaskDispatcher } from './task-dispatcher.js'

function createSocket() {
  const messages: ServerToAgentMessage[] = []

  return {
    messages,
    send(raw: string) {
      messages.push(JSON.parse(raw) as ServerToAgentMessage)
    },
    close: vi.fn(),
  }
}

type TestSocket = ReturnType<typeof createSocket>
type AuthenticateAgent = (
  socket: TestSocket,
  db: Database.Database,
  agentId: string,
  agentSecret: string,
  version?: string,
) => Promise<boolean>

describe('AgentHub upgrade policy', () => {
  it('sends the configured upgrade policy to compatible agents', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: await hashSecret(secret),
    })
    const socket = createSocket()
    const upgradePolicy: AgentUpgradePolicy = {
      packageName: '@webmux/agent',
      targetVersion: '0.1.6',
      minimumVersion: '0.1.4',
    }

    const hub = new AgentHub({ upgradePolicy })
    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.4')

    expect(authenticated).toBe(true)
    expect(socket.messages).toContainEqual({
      type: 'auth-ok',
      upgradePolicy,
    })
  })

  it('rejects agents below the configured minimum version', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'nas',
      agentSecretHash: await hashSecret(secret),
    })
    const socket = createSocket()

    const hub = new AgentHub({
      upgradePolicy: {
        packageName: '@webmux/agent',
        targetVersion: '0.1.6',
        minimumVersion: '0.1.5',
      },
    })

    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.4')

    expect(authenticated).toBe(false)
    expect(socket.messages).toHaveLength(1)
    expect(socket.messages[0]).toMatchObject({
      type: 'auth-fail',
      message: expect.stringContaining('0.1.5'),
    })
    expect(socket.close).toHaveBeenCalledTimes(1)
  })
})

describe('AgentHub run lifecycle', () => {
  it('ignores run events from the wrong authenticated agent', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const owner = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const intruder = createAgent(db, { userId: user.id, name: 'intruder', agentSecretHash: 'hash' })
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-1',
      turnId: 'run-1:turn:1',
      agentId: owner.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })

    const hub = new AgentHub()
    hub.handleAgentMessage(
      intruder.id,
      { type: 'run-status', runId: run.id, turnId: turn.id, status: 'success', summary: 'done' },
      db,
    )

    expect(findRunById(db, run.id)?.status).toBe('starting')
  })

  it('stores the external Codex thread id reported by the agent', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-thread-id',
      turnId: 'run-thread-id:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })

    const hub = new AgentHub()
    hub.handleAgentMessage(
      agent.id,
      {
        type: 'run-status',
        runId: run.id,
        turnId: turn.id,
        status: 'running',
        toolThreadId: 'codex-thread-1',
      },
      db,
    )

    expect(findRunById(db, run.id)?.tool_thread_id).toBe('codex-thread-1')
  })

  it('notifies the user when a running turn completes', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-notify',
      turnId: 'run-notify:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    db.prepare('UPDATE run_turns SET status = ? WHERE id = ?').run('running', turn.id)

    const notifyTurnCompleted = vi.fn().mockResolvedValue(undefined)
    const hub = new AgentHub({
      notificationService: {
        notifyTurnCompleted,
      },
    })

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'run-status',
        runId: run.id,
        turnId: turn.id,
        status: 'success',
        summary: 'All done',
      },
      db,
    )

    expect(notifyTurnCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        agentId: agent.id,
        runId: run.id,
        turnId: turn.id,
        repoPath: '/tmp/project',
        tool: 'codex',
        status: 'success',
        summary: 'All done',
        turnIndex: 1,
      }),
    )
  })

  it('marks active runs as failed when an agent disconnects unexpectedly', () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const { run, turn } = createRunWithInitialTurn(db, {
      runId: 'run-1',
      turnId: 'run-1:turn:1',
      agentId: agent.id,
      userId: user.id,
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix it',
    })
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', run.id)
    db.prepare('UPDATE run_turns SET status = ? WHERE id = ?').run('running', turn.id)

    const hub = new AgentHub()
    ;(hub as unknown as {
      agents: Map<
        string,
        {
          socket: { close: () => void }
          userId: string
          name: string
          sessions: []
        }
      >
    }).agents.set(agent.id, {
      socket: { close: vi.fn() },
      userId: user.id,
      name: agent.name,
      sessions: [],
    })

    hub.removeAgent(agent.id, db)

    expect(findRunById(db, run.id)).toMatchObject({
      status: 'failed',
      summary: 'Agent disconnected before the run completed.',
    })
    expect(findRunTurnById(db, turn.id)).toMatchObject({
      status: 'failed',
      summary: 'Agent disconnected before the run completed.',
    })
  })

  it('resolves repository browse requests with the agent response payload', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'owner', agentSecretHash: 'hash' })
    const socket = createSocket()
    const hub = new AgentHub()

    ;(hub as unknown as {
      agents: Map<
        string,
        {
          socket: TestSocket
          userId: string
          name: string
          sessions: []
        }
      >
    }).agents.set(agent.id, {
      socket,
      userId: user.id,
      name: agent.name,
      sessions: [],
    })

    const browsePromise = hub.requestRepositoryBrowse(agent.id, '/home/chareice/projects')
    const message = socket.messages[0] as Extract<ServerToAgentMessage, { type: 'repository-browse' }>

    expect(message).toMatchObject({
      type: 'repository-browse',
      path: '/home/chareice/projects',
    })

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'repository-browse-result',
        requestId: message.requestId,
        ok: true,
        currentPath: '/home/chareice/projects',
        parentPath: '/home/chareice',
        entries: [
          {
            kind: 'repository',
            name: 'webmux',
            path: '/home/chareice/projects/webmux',
          },
        ],
      },
      db,
    )

    await expect(browsePromise).resolves.toEqual({
      currentPath: '/home/chareice/projects',
      parentPath: '/home/chareice',
      entries: [
        {
          kind: 'repository',
          name: 'webmux',
          path: '/home/chareice/projects/webmux',
        },
      ],
    })
  })
})

describe('AgentHub task message handling', () => {
  function setupTaskEnv() {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const agent = createAgent(db, { userId: user.id, name: 'worker', agentSecretHash: 'hash' })
    const project = createProject(db, {
      userId: user.id,
      agentId: agent.id,
      name: 'test-project',
      repoPath: '/tmp/project',
    })
    const task = createTask(db, {
      projectId: project.id,
      title: 'Fix bug',
      prompt: 'Please fix the bug',
    })
    // Move task to dispatched so it simulates a real flow
    db.prepare("UPDATE tasks SET status = 'dispatched' WHERE id = ?").run(task.id)

    const hub = new AgentHub()
    return { db, user, agent, project, task, hub }
  }

  it('task-claimed updates worktree info', () => {
    const { db, agent, task, hub } = setupTaskEnv()

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'task-claimed',
        taskId: task.id,
        branchName: 'feat/fix-bug',
        worktreePath: '/tmp/project-worktree',
      },
      db,
    )

    const updated = findTaskById(db, task.id)
    expect(updated?.branch_name).toBe('feat/fix-bug')
    expect(updated?.worktree_path).toBe('/tmp/project-worktree')
  })

  it('task-claimed without worktree info does not crash', () => {
    const { db, agent, task, hub } = setupTaskEnv()

    hub.handleAgentMessage(
      agent.id,
      { type: 'task-claimed', taskId: task.id },
      db,
    )

    const updated = findTaskById(db, task.id)
    expect(updated?.branch_name).toBeNull()
    expect(updated?.worktree_path).toBeNull()
  })

  it('task-running sets status to running and stores run_id', () => {
    const { db, agent, task, hub } = setupTaskEnv()

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'task-running',
        taskId: task.id,
        runId: 'run-123',
        turnId: 'turn-456',
        branchName: 'feat/fix-bug',
        worktreePath: '/tmp/worktree',
      },
      db,
    )

    const updated = findTaskById(db, task.id)
    expect(updated?.status).toBe('running')
    expect(updated?.run_id).toBe('run-123')
    expect(updated?.branch_name).toBe('feat/fix-bug')
    expect(updated?.worktree_path).toBe('/tmp/worktree')
  })

  it('task-completed sets status to completed and persists summary', () => {
    const { db, agent, task, hub } = setupTaskEnv()
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id)

    hub.handleAgentMessage(
      agent.id,
      { type: 'task-completed', taskId: task.id, summary: 'All done' },
      db,
    )

    const updated = findTaskById(db, task.id)
    expect(updated?.status).toBe('completed')
    expect(updated?.completed_at).not.toBeNull()
    expect(updated?.summary).toBe('All done')
  })

  it('task-failed sets status to failed with error message', () => {
    const { db, agent, task, hub } = setupTaskEnv()
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id)

    hub.handleAgentMessage(
      agent.id,
      { type: 'task-failed', taskId: task.id, error: 'Something went wrong' },
      db,
    )

    const updated = findTaskById(db, task.id)
    expect(updated?.status).toBe('failed')
    expect(updated?.error_message).toBe('Something went wrong')
    expect(updated?.completed_at).not.toBeNull()
  })

  it('agent disconnect marks dispatched and running tasks as failed', () => {
    const { db, user, agent, project, task, hub } = setupTaskEnv()

    // Create a second task in running state
    const task2 = createTask(db, {
      projectId: project.id,
      title: 'Another task',
      prompt: 'Do something',
    })
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task2.id)

    // Register the agent in the hub's internal map
    ;(hub as unknown as {
      agents: Map<string, { socket: { close: () => void }; userId: string; name: string }>
    }).agents.set(agent.id, {
      socket: { close: vi.fn() },
      userId: user.id,
      name: agent.name,
    })

    hub.removeAgent(agent.id, db)

    // The first task (dispatched) should be failed
    const updatedTask1 = findTaskById(db, task.id)
    expect(updatedTask1?.status).toBe('failed')
    expect(updatedTask1?.error_message).toBe('Agent disconnected')

    // The second task (running) should also be failed
    const updatedTask2 = findTaskById(db, task2.id)
    expect(updatedTask2?.status).toBe('failed')
    expect(updatedTask2?.error_message).toBe('Agent disconnected')
  })

  it('ignores task-claimed for nonexistent task', () => {
    const { db, agent, hub } = setupTaskEnv()

    // Should not throw
    hub.handleAgentMessage(
      agent.id,
      { type: 'task-claimed', taskId: 'nonexistent-id', branchName: 'b', worktreePath: '/w' },
      db,
    )
  })

  it('task-step-update creates a new step when status is running', () => {
    const { db, agent, task, hub } = setupTaskEnv()
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id)

    hub.handleAgentMessage(
      agent.id,
      {
        type: 'task-step-update',
        taskId: task.id,
        step: {
          id: 'step-1',
          type: 'code',
          label: 'Writing code',
          status: 'running',
          toolName: 'write_file',
          createdAt: 1000,
        },
      },
      db,
    )

    const steps = findStepsByTaskId(db, task.id)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      id: 'step-1',
      task_id: task.id,
      type: 'code',
      label: 'Writing code',
      status: 'running',
      tool_name: 'write_file',
      created_at: 1000,
    })
  })

  it('task-step-update updates an existing step when status is completed', () => {
    const { db, agent, task, hub } = setupTaskEnv()
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id)

    // First create a running step
    hub.handleAgentMessage(
      agent.id,
      {
        type: 'task-step-update',
        taskId: task.id,
        step: {
          id: 'step-2',
          type: 'command',
          label: 'Running tests',
          status: 'running',
          toolName: 'bash',
          createdAt: 2000,
        },
      },
      db,
    )

    // Then complete it
    hub.handleAgentMessage(
      agent.id,
      {
        type: 'task-step-update',
        taskId: task.id,
        step: {
          id: 'step-2',
          type: 'command',
          label: 'Running tests',
          status: 'completed',
          toolName: 'bash',
          durationMs: 500,
          completedAt: 2500,
          createdAt: 2000,
        },
      },
      db,
    )

    const steps = findStepsByTaskId(db, task.id)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      id: 'step-2',
      status: 'completed',
      duration_ms: 500,
      completed_at: 2500,
    })
  })
})

describe('AgentHub dispatch on connect', () => {
  it('calls dispatchPendingTasksForAgent when an agent authenticates', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'worker',
      agentSecretHash: await hashSecret(secret),
    })

    const dispatchPendingTasksForAgent = vi.fn()
    const mockTaskDispatcher = {
      dispatchPendingTasksForAgent,
    } as unknown as TaskDispatcher

    const hub = new AgentHub({ taskDispatcher: mockTaskDispatcher })
    const socket = createSocket()

    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.0')

    expect(authenticated).toBe(true)
    expect(dispatchPendingTasksForAgent).toHaveBeenCalledWith(agent.id)
    expect(dispatchPendingTasksForAgent).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when no taskDispatcher is configured', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'worker',
      agentSecretHash: await hashSecret(secret),
    })

    const hub = new AgentHub()
    const socket = createSocket()

    // Should not throw even without a taskDispatcher
    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.0')

    expect(authenticated).toBe(true)
  })

  it('dispatches pending tasks via setTaskDispatcher', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: '1',
      displayName: 'alice',
      avatarUrl: null,
    })
    const secret = 'agent-secret'
    const agent = createAgent(db, {
      userId: user.id,
      name: 'worker',
      agentSecretHash: await hashSecret(secret),
    })

    const dispatchPendingTasksForAgent = vi.fn()
    const mockTaskDispatcher = {
      dispatchPendingTasksForAgent,
    } as unknown as TaskDispatcher

    const hub = new AgentHub()
    hub.setTaskDispatcher(mockTaskDispatcher)
    const socket = createSocket()

    const authenticated = await (hub as unknown as { authenticateAgent: AuthenticateAgent })
      .authenticateAgent(socket, db, agent.id, secret, '0.1.0')

    expect(authenticated).toBe(true)
    expect(dispatchPendingTasksForAgent).toHaveBeenCalledWith(agent.id)
  })
})
