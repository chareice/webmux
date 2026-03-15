import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}))

import { RunWrapper } from './run-wrapper.js'

describe('RunWrapper', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves the interrupted terminal state when the process exits non-zero', async () => {
    let exitHandler: ((event: { exitCode: number }) => void) | undefined

    const ptyProcess = {
      onData: vi.fn(),
      onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
        exitHandler = handler
      }),
      write: vi.fn(),
      kill: vi.fn(),
    }
    spawnMock.mockReturnValue(ptyProcess)

    const onEvent = vi.fn()
    const onFinish = vi.fn()
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix the failing test',
      tmux: {
        socketName: 'webmux',
        createSession: vi.fn().mockResolvedValue(undefined),
        killSession: vi.fn().mockResolvedValue(undefined),
      } as never,
      onEvent,
      onFinish,
      onOutput: vi.fn(),
    })

    await wrapper.start()
    await vi.advanceTimersByTimeAsync(500)

    wrapper.interrupt()
    exitHandler?.({ exitCode: 130 })

    expect(onEvent).toHaveBeenLastCalledWith('interrupted', undefined, undefined)
    expect(onFinish).toHaveBeenCalledWith('interrupted')
  })
})
