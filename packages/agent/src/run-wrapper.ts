import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'

import type { RunStatus, RunTimelineEventPayload, RunTool } from '@webmux/shared'
import { createCodexClient, type CodexClient } from './codex-client.js'
import { prepareCodexInput } from './codex-input.js'
import { parseCodexThreadEvent } from './codex-event.js'
import { createRunAdapter } from './run-adapter.js'
import type { RunImageAttachmentUpload } from '@webmux/shared'

const execFileAsync = promisify(execFile)

export interface RunWrapperOptions {
  runId: string
  tool: RunTool
  toolThreadId?: string
  repoPath: string
  prompt: string
  attachments?: RunImageAttachmentUpload[]
  onEvent: (status: RunStatus, summary?: string, hasDiff?: boolean) => void
  onFinish: (status: RunStatus) => void
  onItem: (item: RunTimelineEventPayload) => void
  onThreadReady?: (toolThreadId: string) => void
  codexClientFactory?: () => CodexClient
}

export class RunWrapper {
  private readonly tool: RunTool
  private readonly toolThreadId?: string
  private readonly repoPath: string
  private readonly prompt: string
  private readonly attachments: RunImageAttachmentUpload[]
  private readonly onEvent: RunWrapperOptions['onEvent']
  private readonly onFinish: RunWrapperOptions['onFinish']
  private readonly onItem: RunWrapperOptions['onItem']
  private readonly onThreadReady?: RunWrapperOptions['onThreadReady']
  private readonly codexClientFactory: () => CodexClient

  private readonly adapter
  private child: ChildProcessWithoutNullStreams | null = null
  private abortController: AbortController | null = null
  private currentStatus: RunStatus = 'starting'
  private disposed = false
  private interrupted = false
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private latestSummary: string | undefined
  private finished = false

  constructor(options: RunWrapperOptions) {
    this.tool = options.tool
    this.toolThreadId = options.toolThreadId
    this.repoPath = options.repoPath
    this.prompt = options.prompt
    this.attachments = options.attachments ?? []
    this.onEvent = options.onEvent
    this.onFinish = options.onFinish
    this.onItem = options.onItem
    this.onThreadReady = options.onThreadReady
    this.codexClientFactory = options.codexClientFactory ?? createCodexClient
    this.adapter = createRunAdapter(this.tool)
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return
    }

    if (this.tool === 'codex') {
      await this.startCodexThread()
      return
    }

    if (this.attachments.length > 0) {
      throw new Error('Image attachments are currently supported for Codex only')
    }

    this.emitStatus('starting')
    this.onItem({
      type: 'activity',
      status: 'info',
      label: 'Starting Claude',
      detail: this.repoPath,
    })

    const command = this.adapter.buildCommand()
    const child = spawn(command.command, command.args, {
      cwd: this.repoPath,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.handleChunk('stdout', chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      this.handleChunk('stderr', chunk)
    })

    child.on('error', (error) => {
      if (this.disposed || this.finished) {
        return
      }

      this.onItem({
        type: 'activity',
        status: 'error',
        label: 'Run failed to start',
        detail: error.message,
      })
      this.finalize('failed', false, `Failed to start: ${error.message}`)
    })

    child.on('close', (exitCode) => {
      if (this.disposed || this.finished) {
        return
      }

      this.flushBufferedLines()
      const finalStatus =
        this.interrupted ? 'interrupted' : exitCode === 0 ? 'success' : 'failed'

      void this.complete(finalStatus)
    })

    if (command.readPromptFromStdin) {
      child.stdin.end(this.prompt)
    } else {
      child.stdin.end()
    }

    this.emitStatus('running')
  }

  interrupt(): void {
    if ((this.tool === 'codex' && !this.abortController) || (this.tool !== 'codex' && !this.child) || this.disposed || this.finished) {
      return
    }

    this.interrupted = true
    this.onItem({
      type: 'activity',
      status: 'warning',
      label: 'Interrupt requested',
    })
    this.emitStatus('interrupted', this.latestSummary)
    if (this.abortController) {
      this.abortController.abort()
      return
    }

    this.child?.kill('SIGINT')
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    if (this.child) {
      this.child.kill('SIGKILL')
      this.child = null
    }
  }

  private handleChunk(source: 'stdout' | 'stderr', chunk: string): void {
    if (this.disposed || this.finished) {
      return
    }

    const key = source === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer'
    let buffer = this[key] + chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    this[key] = buffer

    for (const line of lines) {
      this.processLine(line)
    }
  }

  private processLine(line: string): void {
    const result = this.adapter.parseLine(line)
    if (result.summary) {
      this.latestSummary = result.summary
      this.emitStatus(this.currentStatus, result.summary)
    }

    for (const item of result.items) {
      this.onItem(item)
    }
  }

  private flushBufferedLines(): void {
    if (this.stdoutBuffer.trim()) {
      this.processLine(this.stdoutBuffer)
    }
    if (this.stderrBuffer.trim()) {
      this.processLine(this.stderrBuffer)
    }

    this.stdoutBuffer = ''
    this.stderrBuffer = ''
  }

  private async complete(finalStatus: RunStatus): Promise<void> {
    const hasDiff = await detectRepoChanges(this.repoPath)

    if (finalStatus === 'success') {
      this.onItem({
        type: 'activity',
        status: 'success',
        label: 'Run completed',
      })
    } else if (finalStatus === 'failed') {
      this.onItem({
        type: 'activity',
        status: 'error',
        label: 'Run failed',
      })
    }

    this.finalize(finalStatus, hasDiff, this.latestSummary)
  }

  private finalize(
    finalStatus: RunStatus,
    hasDiff: boolean,
    summary?: string,
  ): void {
    if (this.finished) {
      return
    }

    this.finished = true
    this.child = null
    this.abortController = null
    this.emitStatus(finalStatus, summary, hasDiff)
    this.onFinish(finalStatus)
  }

  private emitStatus(status: RunStatus, summary?: string, hasDiff?: boolean): void {
    this.currentStatus = status
    this.onEvent(status, summary, hasDiff)
  }

  private async startCodexThread(): Promise<void> {
    this.emitStatus('starting')
    this.onItem({
      type: 'activity',
      status: 'info',
      label: 'Starting Codex',
      detail: this.repoPath,
    })

    const client = this.codexClientFactory()
    const threadOptions = {
      workingDirectory: this.repoPath,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'never' as const,
      networkAccessEnabled: true,
    }
    const thread = this.toolThreadId
      ? client.resumeThread(this.toolThreadId, threadOptions)
      : client.startThread(threadOptions)
    const preparedInput = await prepareCodexInput(this.prompt, this.attachments)

    this.abortController = new AbortController()
    this.emitStatus('running')

    let sawTurnCompleted = false
    let announcedThreadId = this.toolThreadId ?? undefined

    try {
      const streamedTurn = await thread.runStreamed(preparedInput.input, {
        signal: this.abortController.signal,
      })

      for await (const event of streamedTurn.events) {
        if (this.disposed || this.finished) {
          return
        }

        const result = parseCodexThreadEvent(event)
        const nextThreadId = result.threadId ?? thread.id ?? undefined
        if (nextThreadId && nextThreadId !== announcedThreadId) {
          announcedThreadId = nextThreadId
          this.onThreadReady?.(nextThreadId)
        }

        if (result.summary) {
          this.latestSummary = result.summary
          this.emitStatus(this.currentStatus, result.summary)
        }

        for (const item of result.items) {
          this.onItem(item)
        }

        if (event.type === 'turn.completed') {
          sawTurnCompleted = true
        }

        if (result.finalStatus) {
          await this.complete(result.finalStatus)
          return
        }
      }

      if (this.finished) {
        return
      }

      const finalStatus = this.interrupted
        ? 'interrupted'
        : sawTurnCompleted
          ? 'success'
          : 'failed'
      await this.complete(finalStatus)
    } catch (error) {
      if (this.disposed || this.finished) {
        return
      }

      if (this.interrupted || isAbortError(error)) {
        await this.complete('interrupted')
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      this.onItem({
        type: 'activity',
        status: 'error',
        label: 'Run failed',
        detail: message,
      })
      this.finalize('failed', false, message)
    } finally {
      await preparedInput.cleanup()
    }
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as { name?: string; code?: string }
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR'
}

async function detectRepoChanges(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain'],
      { cwd: repoPath },
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}
