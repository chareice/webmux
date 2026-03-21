import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunTool } from '@webmux/shared'

// Mock RunWrapper to prevent actual Claude/Codex sessions
const { mockRunWrapperInstances } = vi.hoisted(() => ({
  mockRunWrapperInstances: [] as Array<{ opts: Record<string, unknown>; start: () => Promise<void>; dispose: () => void }>,
}))

vi.mock('./run-wrapper.js', () => {
  return {
    RunWrapper: class MockRunWrapper {
      public opts: Record<string, unknown>
      start = vi.fn().mockResolvedValue(undefined)
      dispose = vi.fn()
      constructor(opts: Record<string, unknown>) {
        this.opts = opts
        mockRunWrapperInstances.push(this as unknown as (typeof mockRunWrapperInstances)[number])
      }
    },
  }
})

import { AgentConnection } from './connection.js'

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

type TaskSessionMap = Map<string, { toolThreadId?: string; repoPath: string; tool: RunTool }>

function getPrivate(conn: AgentConnection) {
  return conn as unknown as {
    ws: { send: (...args: unknown[]) => void; readyState: number } | null
    taskSessions: TaskSessionMap
    handleMessage: (msg: Record<string, unknown>) => void
    disposeAllRuns: () => void
  }
}

describe('AgentConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts heartbeat after auth succeeds', async () => {
    const fakeSocket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    }

    const connection = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      '/home/user',
    )

    ;(connection as unknown as { ws: typeof fakeSocket | null }).ws = fakeSocket

    ;(connection as unknown as {
      handleMessage: (message: { type: 'auth-ok' }) => void
    }).handleMessage({ type: 'auth-ok' })

    await flushMicrotasks()

    // Heartbeat should be started — advance timer and check for heartbeat messages
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()

    expect(fakeSocket.send).toHaveBeenCalled()

    connection.stop()
  })

  it('ignores run-turn-kill when the wrapper is already gone', async () => {
    const connection = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      '/home/user',
    )

    ;(connection as unknown as {
      handleMessage: (message: { type: 'run-turn-kill'; runId: string; turnId: string }) => void
    }).handleMessage({
      type: 'run-turn-kill',
      runId: '12345678-dead-beef-cafe-000000000000',
      turnId: '12345678-dead-beef-cafe-000000000001',
    })

    await flushMicrotasks()

    // Should not throw
    expect(true).toBe(true)
  })
})

describe('AgentConnection task session recovery on reconnect', () => {
  function createTestConnection() {
    const conn = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      '/home/user',
    )
    const priv = getPrivate(conn)
    // readyState 1 = WebSocket.OPEN, required by sendMessage guard
    priv.ws = { send: vi.fn(), readyState: 1 }
    return { conn, priv }
  }

  beforeEach(() => {
    mockRunWrapperInstances.length = 0
  })

  it('starts a new session when no existing taskSession exists', async () => {
    const { priv } = createTestConnection()

    priv.handleMessage({
      type: 'task-dispatch',
      taskId: 'task-1',
      projectId: 'proj-1',
      repoPath: '/repo',
      tool: 'claude',
      title: 'Fix bug',
      prompt: 'Fix the login bug',
      llmConfig: null,
    })

    await flushMicrotasks()

    // RunWrapper should be created without a toolThreadId
    expect(mockRunWrapperInstances).toHaveLength(1)
    const opts = mockRunWrapperInstances[0].opts
    expect(opts.prompt).toBe('Task: Fix bug\n\nFix the login bug')
    expect(opts.toolThreadId).toBeUndefined()
    expect(opts.tool).toBe('claude')

    // Session should be created without toolThreadId
    expect(priv.taskSessions.get('task-1')?.toolThreadId).toBeUndefined()
  })

  it('resumes existing session when taskSession has a toolThreadId', async () => {
    const { priv } = createTestConnection()

    // Simulate an existing session from before disconnect
    priv.taskSessions.set('task-1', {
      repoPath: '/repo',
      tool: 'claude' as RunTool,
      toolThreadId: 'claude-thread-abc123',
    })

    priv.handleMessage({
      type: 'task-dispatch',
      taskId: 'task-1',
      projectId: 'proj-1',
      repoPath: '/repo',
      tool: 'claude',
      title: 'Fix bug',
      prompt: 'Fix the login bug',
      llmConfig: null,
    })

    await flushMicrotasks()

    // RunWrapper should be created WITH the preserved toolThreadId
    expect(mockRunWrapperInstances).toHaveLength(1)
    const opts = mockRunWrapperInstances[0].opts
    expect(opts.toolThreadId).toBe('claude-thread-abc123')
    expect(opts.prompt).toContain('continue where you left off')

    // Session should preserve toolThreadId
    expect(priv.taskSessions.get('task-1')?.toolThreadId).toBe('claude-thread-abc123')
  })

  it('taskSessions are preserved across disposeAllRuns', async () => {
    const { priv } = createTestConnection()

    // Simulate a session with toolThreadId
    priv.taskSessions.set('task-1', {
      repoPath: '/repo',
      tool: 'claude' as RunTool,
      toolThreadId: 'thread-xyz',
    })

    // Simulate disconnect — disposeAllRuns clears runs/tasks but NOT taskSessions
    priv.disposeAllRuns()

    // taskSessions should still have the entry
    expect(priv.taskSessions.get('task-1')).toBeDefined()
    expect(priv.taskSessions.get('task-1')?.toolThreadId).toBe('thread-xyz')
  })

  it('does not use toolThreadId from a different task', async () => {
    const { priv } = createTestConnection()

    // Session for task-2 has a toolThreadId
    priv.taskSessions.set('task-2', {
      repoPath: '/repo',
      tool: 'claude' as RunTool,
      toolThreadId: 'thread-for-task-2',
    })

    // Dispatching task-1 should NOT use task-2's toolThreadId
    priv.handleMessage({
      type: 'task-dispatch',
      taskId: 'task-1',
      projectId: 'proj-1',
      repoPath: '/repo',
      tool: 'claude',
      title: 'New task',
      prompt: 'Do something',
      llmConfig: null,
    })

    await flushMicrotasks()

    expect(mockRunWrapperInstances).toHaveLength(1)
    const opts = mockRunWrapperInstances[0].opts
    expect(opts.toolThreadId).toBeUndefined()
    expect(opts.prompt).toBe('Task: New task\n\nDo something')
  })

  it('ignores conversation history when no toolThreadId exists', async () => {
    const { priv } = createTestConnection()

    priv.handleMessage({
      type: 'task-dispatch',
      taskId: 'task-1',
      projectId: 'proj-1',
      repoPath: '/repo',
      tool: 'claude',
      title: 'Fix bug',
      prompt: 'Fix the login bug',
      llmConfig: null,
      conversationHistory: [
        { role: 'agent', content: 'I found the issue in auth.ts' },
        { role: 'user', content: 'Great, please also fix the tests' },
      ],
    })

    await flushMicrotasks()

    expect(mockRunWrapperInstances).toHaveLength(1)
    const opts = mockRunWrapperInstances[0].opts
    expect(opts.toolThreadId).toBeUndefined()
    const prompt = opts.prompt as string
    expect(prompt).toBe('Task: Fix bug\n\nFix the login bug')
  })

  it('sends task-claimed message on dispatch', async () => {
    const { priv } = createTestConnection()

    priv.handleMessage({
      type: 'task-dispatch',
      taskId: 'task-42',
      projectId: 'proj-1',
      repoPath: '/repo',
      tool: 'claude',
      title: 'Test',
      prompt: 'Test prompt',
      llmConfig: null,
    })

    await flushMicrotasks()

    const sentMessages = (priv.ws!.send as ReturnType<typeof vi.fn>).mock.calls
      .map((call: string[]) => JSON.parse(call[0]))

    expect(sentMessages).toContainEqual(
      expect.objectContaining({ type: 'task-claimed', taskId: 'task-42' }),
    )
  })
})
