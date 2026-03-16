import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'

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

  it('emits structured timeline items from Claude adapter output', async () => {
    const child = createChildProcess()
    spawnMock.mockReturnValue(child)

    const onEvent = vi.fn()
    const onItem = vi.fn()
    const onFinish = vi.fn()
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'claude',
      repoPath: '/tmp/project',
      prompt: 'Count files',
      onEvent,
      onFinish,
      onItem,
    })

    await wrapper.start()
    child.emitStdout(
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'I will inspect the repository first.' }],
        },
      })}\n`,
    )
    child.emitClose(0)
    await flushMicrotasks()

    expect(onItem).toHaveBeenCalledWith({
      type: 'activity',
      status: 'info',
      label: 'Starting Claude',
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

  it('resumes an existing Codex thread for follow-up turns', async () => {
    const onEvent = vi.fn()
    const onItem = vi.fn()
    const onFinish = vi.fn()
    const onThreadReady = vi.fn()
    const events = (async function* () {
      yield {
        type: 'item.completed',
        item: {
          id: 'msg-1',
          type: 'agent_message',
          text: 'Follow-up complete.',
        },
      }
      yield {
        type: 'turn.completed',
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
        },
      }
    })()

    const resumeThread = vi.fn().mockReturnValue({
      id: 'codex-thread-1',
      runStreamed: vi.fn().mockResolvedValue({ events }),
    })
    const startThread = vi.fn()
    const wrapper = new RunWrapper({
      runId: 'run-1',
      tool: 'codex',
      toolThreadId: 'codex-thread-1',
      repoPath: '/tmp/project',
      prompt: 'Continue working',
      onEvent,
      onFinish,
      onItem,
      onThreadReady,
      codexClientFactory: () => ({
        startThread,
        resumeThread,
      }),
    })

    await wrapper.start()
    await flushMicrotasks()

    expect(startThread).not.toHaveBeenCalled()
    expect(resumeThread).toHaveBeenCalledWith(
      'codex-thread-1',
      expect.objectContaining({
        workingDirectory: '/tmp/project',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
      }),
    )
    expect(onThreadReady).not.toHaveBeenCalled()
    expect(onItem).toHaveBeenCalledWith({
      type: 'message',
      role: 'assistant',
      text: 'Follow-up complete.',
    })
    expect(onFinish).toHaveBeenCalledWith('success')
  })

  it('persists the newly created Codex thread id on the first turn', async () => {
    const onThreadReady = vi.fn()
    const events = (async function* () {
      yield {
        type: 'thread.started',
        thread_id: 'codex-thread-2',
      }
      yield {
        type: 'turn.completed',
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
        },
      }
    })()

    const startThread = vi.fn().mockReturnValue({
      id: null,
      runStreamed: vi.fn().mockResolvedValue({ events }),
    })
    const wrapper = new RunWrapper({
      runId: 'run-1',
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Continue working',
      onEvent: vi.fn(),
      onFinish: vi.fn(),
      onItem: vi.fn(),
      onThreadReady,
      codexClientFactory: () => ({
        startThread,
        resumeThread: vi.fn(),
      }),
    })

    await wrapper.start()
    await flushMicrotasks()

    expect(startThread).toHaveBeenCalledOnce()
    expect(onThreadReady).toHaveBeenCalledWith('codex-thread-2')
  })

  it('passes image attachments to Codex as local image inputs', async () => {
    const runStreamed = vi.fn().mockImplementation(async (input: unknown) => {
      expect(Array.isArray(input)).toBe(true)
      expect(input).toMatchObject([
        {
          type: 'text',
          text: 'Describe the screenshot',
        },
        {
          type: 'local_image',
          path: expect.any(String),
        },
      ])

      const localImageInput = (input as Array<{ type: string; path?: string }>)[1]
      expect(localImageInput.path).toBeTruthy()
      expect(existsSync(localImageInput.path!)).toBe(true)

      return {
        events: (async function* () {
          yield {
            type: 'turn.completed',
            usage: {
              input_tokens: 1,
              cached_input_tokens: 0,
              output_tokens: 1,
            },
          }
        })(),
      }
    })

    const wrapper = new RunWrapper({
      runId: 'run-1',
      tool: 'codex',
      repoPath: '/tmp/project',
      prompt: 'Describe the screenshot',
      attachments: [
        {
          id: 'image-1',
          name: 'screen.png',
          mimeType: 'image/png',
          sizeBytes: 10,
          base64: Buffer.from('fake-image').toString('base64'),
        },
      ],
      onEvent: vi.fn(),
      onFinish: vi.fn(),
      onItem: vi.fn(),
      codexClientFactory: () => ({
        startThread: vi.fn().mockReturnValue({
          id: null,
          runStreamed,
        }),
        resumeThread: vi.fn(),
      }),
    })

    await wrapper.start()
    await flushMicrotasks()

    expect(runStreamed).toHaveBeenCalledOnce()
    const localImageInput = runStreamed.mock.calls[0]?.[0]?.[1] as { path: string }
    expect(existsSync(localImageInput.path)).toBe(false)
  })

  it('preserves the interrupted terminal state when the process exits non-zero', async () => {
    const child = createChildProcess()
    spawnMock.mockReturnValue(child)

    const onEvent = vi.fn()
    const onFinish = vi.fn()
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'claude',
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
