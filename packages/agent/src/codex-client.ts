import { Codex, type Input, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk'

export type CodexInput = Input

export interface CodexThreadHandle {
  readonly id: string | null
  runStreamed(
    input: CodexInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>
}

export interface CodexClient {
  startThread(options?: ThreadOptions): CodexThreadHandle
  resumeThread(id: string, options?: ThreadOptions): CodexThreadHandle
}

const DEFAULT_CODEX_PATH = process.env.WEBMUX_CODEX_PATH?.trim() || 'codex'

export function createCodexClient(): CodexClient {
  return new Codex({
    codexPathOverride: DEFAULT_CODEX_PATH,
  })
}
