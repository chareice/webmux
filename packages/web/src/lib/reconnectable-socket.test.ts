import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createReconnectableSocket } from './reconnectable-socket.ts'

interface FakeSocket {
  close: (code?: number, reason?: string) => void
  onclose: ((event?: unknown) => void) | null
  onerror: ((event?: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
}

function createFakeSocket(): FakeSocket {
  return {
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
  }
}

describe('createReconnectableSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects after unexpected close', async () => {
    const sockets: FakeSocket[] = []
    const controller = createReconnectableSocket({
      connect() {
        const socket = createFakeSocket()
        sockets.push(socket)
        return socket
      },
      onMessage() {},
      getDelayMs: () => 1000,
    })

    expect(sockets).toHaveLength(1)
    sockets[0].onclose?.()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sockets).toHaveLength(2)

    controller.dispose()
  })

  it('does not reconnect after dispose', async () => {
    const sockets: FakeSocket[] = []
    const controller = createReconnectableSocket({
      connect() {
        const socket = createFakeSocket()
        sockets.push(socket)
        return socket
      },
      onMessage() {},
      getDelayMs: () => 1000,
    })

    expect(sockets).toHaveLength(1)
    controller.dispose()
    sockets[0].onclose?.()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sockets).toHaveLength(1)
  })
})
