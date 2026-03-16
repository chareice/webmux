import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionSummary } from '@webmux/shared'

import { AgentConnection } from './connection.js'

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AgentConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps syncing tmux sessions after auth succeeds', async () => {
    const sessions: SessionSummary[] = [
      {
        name: 'codex',
        windows: 1,
        attachedClients: 0,
        createdAt: 1_700_000_000,
        lastActivityAt: 1_700_000_100,
        path: '/tmp',
        preview: ['ready'],
        currentCommand: 'bash',
      },
    ]
    const tmux = {
      listSessions: vi.fn().mockResolvedValue(sessions),
      createSession: vi.fn(),
      killSession: vi.fn(),
    }
    const fakeSocket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    }

    const connection = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      tmux as never,
    )

    ;(connection as unknown as { ws: typeof fakeSocket | null }).ws = fakeSocket

    ;(connection as unknown as {
      handleMessage: (message: { type: 'auth-ok' }) => void
    }).handleMessage({ type: 'auth-ok' })

    await flushMicrotasks()
    expect(tmux.listSessions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    await flushMicrotasks()

    expect(tmux.listSessions).toHaveBeenCalledTimes(2)
    expect(fakeSocket.send).toHaveBeenCalled()

    connection.stop()
  })

  it('ignores run-turn-kill when the wrapper is already gone', async () => {
    const tmux = {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn(),
      killSession: vi.fn().mockResolvedValue(undefined),
    }

    const connection = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      tmux as never,
    )

    ;(connection as unknown as {
      handleMessage: (message: { type: 'run-turn-kill'; runId: string; turnId: string }) => void
    }).handleMessage({
      type: 'run-turn-kill',
      runId: '12345678-dead-beef-cafe-000000000000',
      turnId: '12345678-dead-beef-cafe-000000000001',
    })

    await flushMicrotasks()

    expect(tmux.killSession).not.toHaveBeenCalled()
  })
})
