import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

import { RunWrapper } from './run-wrapper.js'

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('RunWrapper', () => {
  beforeEach(() => {
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

  it('emits structured timeline items from Claude SDK output and persists the session id', async () => {
    const onEvent = vi.fn()
    const onItem = vi.fn()
    const onFinish = vi.fn()
    const onThreadReady = vi.fn()
    const queryMock = vi.fn().mockReturnValue({
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'claude-session-1',
        }
        yield {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: {
                  command: 'pwd',
                  description: 'Print working directory',
                },
              },
            ],
          },
        }
        yield {
          type: 'user',
          session_id: 'claude-session-1',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: '/tmp/project',
                is_error: false,
              },
            ],
          },
          tool_use_result: {
            stdout: '/tmp/project',
            stderr: '',
            interrupted: false,
          },
        }
        yield {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            content: [{ type: 'text', text: 'I found the repository root.' }],
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'claude-session-1',
          result: 'I found the repository root.',
        }
      },
    })

    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'claude',
      repoPath: '/tmp/project',
      prompt: 'Count files',
      onEvent,
      onFinish,
      onItem,
      onThreadReady,
      claudeClientFactory: () => ({
        query: queryMock,
      }) as any,
    })

    await wrapper.start()
    await flushMicrotasks()

    expect(queryMock).toHaveBeenCalledWith(
      'Count files',
      expect.objectContaining({
        cwd: '/tmp/project',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: true,
      }),
    )
    expect(onThreadReady).toHaveBeenCalledWith('claude-session-1')
    expect(onItem).toHaveBeenCalledWith({
      type: 'activity',
      status: 'info',
      label: 'Starting Claude',
      detail: '/tmp/project',
    })
    expect(onItem).toHaveBeenCalledWith({
      type: 'command',
      status: 'started',
      command: 'pwd',
      output: '',
      exitCode: null,
    })
    expect(onItem).toHaveBeenCalledWith({
      type: 'command',
      status: 'completed',
      command: 'pwd',
      output: '/tmp/project',
      exitCode: 0,
    })
    expect(onItem).toHaveBeenCalledWith({
      type: 'message',
      role: 'assistant',
      text: 'I found the repository root.',
    })
    expect(onEvent).toHaveBeenLastCalledWith(
      'success',
      'I found the repository root.',
      false,
    )
    expect(onFinish).toHaveBeenCalledWith('success')
  })

  it('resumes an existing Claude session for follow-up turns', async () => {
    const onThreadReady = vi.fn()
    const queryMock = vi.fn().mockReturnValue({
      interrupt: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          session_id: 'claude-session-1',
          message: {
            content: [{ type: 'text', text: 'Follow-up complete.' }],
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'claude-session-1',
          result: 'Follow-up complete.',
        }
      },
    })

    const wrapper = new RunWrapper({
      runId: 'run-1',
      tool: 'claude',
      toolThreadId: 'claude-session-1',
      repoPath: '/tmp/project',
      prompt: 'Continue working',
      onEvent: vi.fn(),
      onFinish: vi.fn(),
      onItem: vi.fn(),
      onThreadReady,
      claudeClientFactory: () => ({
        query: queryMock,
      }) as any,
    })

    await wrapper.start()
    await flushMicrotasks()

    expect(queryMock).toHaveBeenCalledWith(
      'Continue working',
      expect.objectContaining({
        cwd: '/tmp/project',
        resume: 'claude-session-1',
      }),
    )
    expect(onThreadReady).not.toHaveBeenCalled()
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

  it('preserves the interrupted Claude session state', async () => {
    const onEvent = vi.fn()
    const onFinish = vi.fn()
    let releaseRun: (() => void) | undefined
    const interrupt = vi.fn().mockImplementation(async () => {
      releaseRun?.()
    })
    const wrapper = new RunWrapper({
      runId: '12345678-abcd-efgh-ijkl-1234567890ab',
      tool: 'claude',
      repoPath: '/tmp/project',
      prompt: 'Fix the failing test',
      onEvent,
      onFinish,
      onItem: vi.fn(),
      claudeClientFactory: () => ({
        query: () => ({
          interrupt,
          close: vi.fn(),
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'system',
              subtype: 'init',
              session_id: 'claude-session-2',
            }
            await new Promise<void>((resolve) => {
              releaseRun = resolve
            })
          },
        }),
      }) as any,
    })

    const startPromise = wrapper.start()
    await flushMicrotasks()
    wrapper.interrupt()
    await startPromise

    expect(interrupt).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenLastCalledWith('interrupted', undefined, false)
    expect(onFinish).toHaveBeenCalledWith('interrupted')
  })
})
