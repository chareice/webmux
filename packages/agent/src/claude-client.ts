import {
  query as createClaudeQuery,
  type Options as ClaudeQueryOptions,
  type Query as ClaudeQuery,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import type { RunImageAttachmentUpload } from '@webmux/shared'

export type ClaudeMessage = SDKMessage

export type ClaudeOptions = Pick<
  ClaudeQueryOptions,
  'allowDangerouslySkipPermissions' | 'cwd' | 'effort' | 'model' | 'permissionMode' | 'persistSession' | 'resume' | 'settingSources'
>

export interface ClaudeQueryHandle extends AsyncIterable<ClaudeMessage> {
  interrupt(): Promise<void>
  close(): void
}

export type ClaudePrompt = string | AsyncIterable<SDKUserMessage>

export interface ClaudeClient {
  query(prompt: ClaudePrompt, options: ClaudeOptions): ClaudeQueryHandle
}

export function createClaudeClient(): ClaudeClient {
  return {
    query(prompt: ClaudePrompt, options: ClaudeOptions): ClaudeQuery {
      return createClaudeQuery({
        prompt,
        options,
      })
    },
  }
}

/**
 * Build a prompt that includes image attachments as a multi-content MessageParam
 * wrapped in an async iterable of SDKUserMessage.
 */
export function buildClaudePromptWithImages(
  prompt: string,
  attachments: RunImageAttachmentUpload[],
  sessionId: string,
): AsyncIterable<SDKUserMessage> {
  const contentBlocks: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'text'; text: string }
  > = []

  for (const attachment of attachments) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType,
        data: attachment.base64,
      },
    })
  }

  if (prompt.trim()) {
    contentBlocks.push({
      type: 'text',
      text: prompt.trim(),
    })
  }

  const message: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: contentBlocks,
    } as SDKUserMessage['message'],
    parent_tool_use_id: null,
    session_id: sessionId,
  }

  return (async function* () {
    yield message
  })()
}
