import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}))

import { RunWrapper } from './run-wrapper.js'

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function createChildProcess() {
  let closeHandler: ((exitCode: number | null) => void) | undefined
  let errorHandler: ((error: Error) => void) | undefined
  let stdoutHandler: ((chunk: string) => void) | undefined
  let stderrHandler: ((chunk: string) => void) | undefined

  const child = {
    stdout: {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, handler: (chunk: string) => void) => {
        if (event === 'data') {
          stdoutHandler = handler
        }
      }),
    },
    stderr: {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, handler: (chunk: string) => void) => {
        if (event === 'data') {
          stderrHandler = handler
        }
      }),
    },
    stdin: {
      end: vi.fn(),
    },
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'close') {
        closeHandler = handler as (exitCode: number | null) => void
      }
      if (event === 'error') {
        errorHandler = handler as (error: Error) => void
      }
    }),
    kill: vi.fn(),
    emitStdout(data: string) {
      stdoutHandler?.(data)
    },
    emitStderr(data: string) {
      stderrHandler?.(data)
    },
    emitClose(exitCode: number | null) {
      closeHandler?.(exitCode)
    },
    emitError(error: Error) {
      errorHandler?.(error)
    },
  }

  return child
}

describe('RunWrapper', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    execFileMock.mockReset()
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', '')
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits structured timeline items from adapter output', async () => {
    const child = createChildProcess()
    spawnMock.mockReturnValue(child)

    const onEvent = vi.fn()
    const onItem = vi.fn()
    const onFinish = vi.fn()
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Count files',
      onEvent,
      onFinish,
      onItem,
    })

    await wrapper.start()
    child.emitStdout(
      `${JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'agent_message',
          text: 'I will inspect the repository first.',
        },
      })}\n`,
    )
    child.emitClose(0)
    await flushMicrotasks()

    expect(onItem).toHaveBeenCalledWith({
      type: 'activity',
      status: 'info',
      label: 'Starting Codex',
      detail: '/tmp/project',
    })
    expect(onItem).toHaveBeenCalledWith({
      type: 'message',
      role: 'assistant',
      text: 'I will inspect the repository first.',
    })
    expect(onEvent).toHaveBeenLastCalledWith(
      'success',
      'I will inspect the repository first.',
      false,
    )
    expect(onFinish).toHaveBeenCalledWith('success')
  })

  it('preserves the interrupted terminal state when the process exits non-zero', async () => {
    const child = createChildProcess()
    spawnMock.mockReturnValue(child)

    const onEvent = vi.fn()
    const onFinish = vi.fn()
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Fix the failing test',
      onEvent,
      onFinish,
      onItem: vi.fn(),
    })

    await wrapper.start()
    wrapper.interrupt()
    child.emitClose(130)
    await flushMicrotasks()

    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    expect(onEvent).toHaveBeenLastCalledWith('interrupted', undefined, false)
    expect(onFinish).toHaveBeenCalledWith('interrupted')
  })
})
