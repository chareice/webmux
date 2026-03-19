import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntime } from './connection.js'

import { AgentConnection } from './connection.js'

describe('AgentConnection upgrade handling', () => {
  const baseRuntime: AgentRuntime = {
    version: '0.1.4',
    serviceMode: true,
    autoUpgrade: true,
    applyServiceUpgrade: vi.fn(),
    exit: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies the recommended upgrade before starting heartbeat in service mode', async () => {
    vi.useFakeTimers()
    const fakeSocket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    }
    const runtime: AgentRuntime = {
      ...baseRuntime,
      applyServiceUpgrade: vi.fn(),
      exit: vi.fn(),
    }

    const connection = new AgentConnection(
      'http://127.0.0.1:4317',
      'agent-1',
      'secret',
      '/home/user',
      runtime,
    )

    ;(connection as unknown as { ws: typeof fakeSocket | null }).ws = fakeSocket

    ;(connection as unknown as {
      handleMessage: (message: {
        type: 'auth-ok'
        upgradePolicy: { packageName: string; targetVersion: string }
      }) => void
    }).handleMessage({
      type: 'auth-ok',
      upgradePolicy: {
        packageName: '@webmux/agent',
        targetVersion: '0.1.5',
      },
    })

    expect(runtime.applyServiceUpgrade).toHaveBeenCalledWith({
      packageName: '@webmux/agent',
      targetVersion: '0.1.5',
    })
    expect(runtime.exit).toHaveBeenCalledWith(0)

    connection.stop()
  })
})
