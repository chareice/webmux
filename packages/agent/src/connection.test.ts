import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
