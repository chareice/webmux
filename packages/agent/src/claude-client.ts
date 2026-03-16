import {
  query as createClaudeQuery,
  type Options as ClaudeQueryOptions,
  type Query as ClaudeQuery,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'

export type ClaudeMessage = SDKMessage

export type ClaudeOptions = Pick<
  ClaudeQueryOptions,
  'allowDangerouslySkipPermissions' | 'cwd' | 'effort' | 'model' | 'permissionMode' | 'persistSession' | 'resume'
>

export interface ClaudeQueryHandle extends AsyncIterable<ClaudeMessage> {
  interrupt(): Promise<void>
  close(): void
}

export interface ClaudeClient {
  query(prompt: string, options: ClaudeOptions): ClaudeQueryHandle
}

export function createClaudeClient(): ClaudeClient {
  return {
    query(prompt: string, options: ClaudeOptions): ClaudeQuery {
      return createClaudeQuery({
        prompt,
        options,
      })
    },
  }
}
