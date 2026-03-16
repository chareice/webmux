import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { RunStatus, RunTimelineEventPayload, RunTool, RunTurnOptions } from '@webmux/shared'
import { createClaudeClient, type ClaudeClient } from './claude-client.js'
import { ClaudeMessageParser } from './claude-event.js'
import { createCodexClient, type CodexClient } from './codex-client.js'
import { prepareCodexInput } from './codex-input.js'
import { parseCodexThreadEvent } from './codex-event.js'
import type { RunImageAttachmentUpload } from '@webmux/shared'

const execFileAsync = promisify(execFile)

export interface RunWrapperOptions {
  runId: string
  tool: RunTool
  toolThreadId?: string
  repoPath: string
  prompt: string
  attachments?: RunImageAttachmentUpload[]
  options?: RunTurnOptions
  onEvent: (status: RunStatus, summary?: string, hasDiff?: boolean) => void
  onFinish: (status: RunStatus) => void
  onItem: (item: RunTimelineEventPayload) => void
  onThreadReady?: (toolThreadId: string) => void
  codexClientFactory?: () => CodexClient
  claudeClientFactory?: () => ClaudeClient
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
  private readonly turnOptions: RunTurnOptions
  private readonly onThreadReady?: RunWrapperOptions['onThreadReady']
  private readonly codexClientFactory: () => CodexClient
  private readonly claudeClientFactory: () => ClaudeClient
  private abortController: AbortController | null = null
  private claudeQuery: ReturnType<ClaudeClient['query']> | null = null
  private currentStatus: RunStatus = 'starting'
  private disposed = false
  private interrupted = false
  private latestSummary: string | undefined
  private finished = false

  constructor(options: RunWrapperOptions) {
    this.tool = options.tool
    this.toolThreadId = options.toolThreadId
    this.repoPath = options.repoPath
    this.prompt = options.prompt
    this.attachments = options.attachments ?? []
    this.turnOptions = options.options ?? {}
    this.onEvent = options.onEvent
    this.onFinish = options.onFinish
    this.onItem = options.onItem
    this.onThreadReady = options.onThreadReady
    this.codexClientFactory = options.codexClientFactory ?? createCodexClient
    this.claudeClientFactory = options.claudeClientFactory ?? createClaudeClient
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return
    }

    if (this.tool === 'codex') {
      await this.startCodexThread()
      return
    }

    await this.startClaudeThread()
  }

  interrupt(): void {
    if ((this.tool === 'codex' && !this.abortController) || (this.tool !== 'codex' && !this.claudeQuery) || this.disposed || this.finished) {
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

    void this.claudeQuery?.interrupt().catch((error) => {
      if (this.disposed || this.finished) {
        return
      }

      const detail = error instanceof Error ? error.message : String(error)
      this.onItem({
        type: 'activity',
        status: 'warning',
        label: 'Interrupt request failed',
        detail,
      })
    })
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

    if (this.claudeQuery) {
      this.claudeQuery.close()
      this.claudeQuery = null
    }
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
    this.abortController = null
    this.claudeQuery = null
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
      ...(this.turnOptions.model ? { model: this.turnOptions.model } : {}),
      ...(this.turnOptions.codexEffort ? { modelReasoningEffort: this.turnOptions.codexEffort } : {}),
    }
    const resumeId = this.turnOptions.clearSession ? undefined : this.toolThreadId
    const thread = resumeId
      ? client.resumeThread(resumeId, threadOptions)
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

  private async startClaudeThread(): Promise<void> {
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

    const client = this.claudeClientFactory()
    const parser = new ClaudeMessageParser()
    const query = client.query(this.prompt, {
      cwd: this.repoPath,
      resume: this.turnOptions.clearSession ? undefined : this.toolThreadId,
      persistSession: true,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(this.turnOptions.model ? { model: this.turnOptions.model } : {}),
      ...(this.turnOptions.claudeEffort ? { effort: this.turnOptions.claudeEffort } : {}),
    })

    this.claudeQuery = query
    this.emitStatus('running')

    let announcedThreadId = this.toolThreadId ?? undefined

    try {
      for await (const message of query) {
        if (this.disposed || this.finished) {
          return
        }

        const nextThreadId = message.session_id
        if (nextThreadId && nextThreadId !== announcedThreadId) {
          announcedThreadId = nextThreadId
          this.onThreadReady?.(nextThreadId)
        }

        const result = parser.parse(message)
        if (result.summary) {
          this.latestSummary = result.summary
          this.emitStatus(this.currentStatus, result.summary)
        }

        for (const item of result.items) {
          this.onItem(item)
        }

        if (result.finalStatus) {
          await this.complete(this.interrupted ? 'interrupted' : result.finalStatus)
          return
        }
      }

      if (this.finished) {
        return
      }

      await this.complete(this.interrupted ? 'interrupted' : 'failed')
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
