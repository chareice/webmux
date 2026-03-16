import type { ClaudeMessage } from './claude-client.js'
import type { RunStatus, RunTimelineEventPayload } from '@webmux/shared'

export interface ClaudeEventParseResult {
  items: RunTimelineEventPayload[]
  summary?: string
  finalStatus?: RunStatus
}

interface PendingToolUse {
  name: string
  command?: string
}

export class ClaudeMessageParser {
  private readonly pendingToolUses = new Map<string, PendingToolUse>()

  parse(message: ClaudeMessage): ClaudeEventParseResult {
    switch (message.type) {
      case 'assistant':
        return this.parseAssistantMessage(message)

      case 'user':
        return this.parseUserMessage(message)

      case 'result':
        return this.parseResultMessage(message)

      case 'auth_status':
        return message.error
          ? {
              items: [
                {
                  type: 'activity',
                  status: 'error',
                  label: 'Claude authentication failed',
                  detail: message.error,
                },
              ],
              summary: message.error,
              finalStatus: 'failed',
            }
          : { items: [] }

      case 'system':
        return this.parseSystemMessage(message)

      case 'tool_progress':
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: `Running tool: ${message.tool_name}`,
              detail: formatElapsedSeconds(message.elapsed_time_seconds),
            },
          ],
        }

      case 'tool_use_summary':
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: 'Tool summary',
              detail: message.summary,
            },
          ],
        }

      case 'stream_event':
      case 'rate_limit_event':
        return { items: [] }

      default:
        return { items: [] }
    }
  }

  private parseAssistantMessage(message: Extract<ClaudeMessage, { type: 'assistant' }>): ClaudeEventParseResult {
    const items: RunTimelineEventPayload[] = []
    const textBlocks: string[] = []
    let summary: string | undefined

    for (const block of message.message.content ?? []) {
      if (!block || typeof block !== 'object') {
        continue
      }

      if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
        items.push({
          type: 'activity',
          status: 'info',
          label: 'Thinking',
          detail: block.thinking.trim(),
        })
        continue
      }

      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        textBlocks.push(block.text.trim())
        continue
      }

      if (
        block.type === 'tool_use'
        && typeof block.id === 'string'
        && typeof block.name === 'string'
      ) {
        this.pendingToolUses.set(block.id, {
          name: block.name,
          command:
            block.name === 'Bash' && isRecord(block.input) && typeof block.input.command === 'string'
              ? block.input.command
              : undefined,
        })

        if (block.name === 'Bash' && isRecord(block.input) && typeof block.input.command === 'string') {
          items.push({
            type: 'command',
            status: 'started',
            command: block.input.command,
            output: '',
            exitCode: null,
          })
        } else {
          items.push({
            type: 'activity',
            status: 'info',
            label: `Tool: ${block.name}`,
            detail: formatToolInput(block.input),
          })
        }
      }
    }

    const text = textBlocks.join('\n\n')
    if (text) {
      items.push({
        type: 'message',
        role: 'assistant',
        text,
      })
      summary = text
    }

    if (message.error) {
      items.push({
        type: 'activity',
        status: 'error',
        label: 'Claude response error',
        detail: message.error,
      })
      summary = summary ?? message.error
    }

    return { items, summary }
  }

  private parseUserMessage(message: Extract<ClaudeMessage, { type: 'user' }>): ClaudeEventParseResult {
    const items: RunTimelineEventPayload[] = []
    const textBlocks: string[] = []

    for (const block of message.message.content ?? []) {
      if (!block || typeof block !== 'object') {
        continue
      }

      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        textBlocks.push(block.text.trim())
        continue
      }

      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue
      }

      const pendingToolUse = this.pendingToolUses.get(block.tool_use_id)
      if (pendingToolUse) {
        this.pendingToolUses.delete(block.tool_use_id)
      }

      const output = extractToolResultOutput(block.content, message.tool_use_result)
      const isError = block.is_error === true

      if (pendingToolUse?.name === 'Bash') {
        items.push({
          type: 'command',
          status: isError ? 'failed' : 'completed',
          command: pendingToolUse.command ?? 'Bash',
          output,
          exitCode: inferExitCode(block.content, message.tool_use_result, isError),
        })
        continue
      }

      if (pendingToolUse) {
        items.push({
          type: 'activity',
          status: isError ? 'error' : 'success',
          label: isError ? `Tool failed: ${pendingToolUse.name}` : `Tool finished: ${pendingToolUse.name}`,
          detail: output || undefined,
        })
      }
    }

    if (items.length > 0) {
      return { items }
    }

    const text = textBlocks.join('\n\n')
    if (!text) {
      return { items: [] }
    }

    return {
      items: [
        {
          type: 'message',
          role: 'user',
          text,
        },
      ],
    }
  }

  private parseResultMessage(message: Extract<ClaudeMessage, { type: 'result' }>): ClaudeEventParseResult {
    if (message.subtype === 'success') {
      const summary = message.result.trim() || undefined
      return {
        items: [],
        summary,
        finalStatus: 'success',
      }
    }

    const detail = message.errors.join('\n').trim()
    return {
      items: [
        {
          type: 'activity',
          status: 'error',
          label: 'Claude thread failed',
          detail,
        },
      ],
      summary: detail || undefined,
      finalStatus: 'failed',
    }
  }

  private parseSystemMessage(message: Extract<ClaudeMessage, { type: 'system' }>): ClaudeEventParseResult {
    switch (message.subtype) {
      case 'status':
        if (message.status === 'compacting') {
          return {
            items: [
              {
                type: 'activity',
                status: 'info',
                label: 'Compacting conversation',
              },
            ],
          }
        }
        return { items: [] }

      case 'compact_boundary':
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: 'Conversation compacted',
            },
          ],
        }

      case 'local_command_output':
        return {
          items: [
            {
              type: 'message',
              role: 'system',
              text: message.content.trim(),
            },
          ],
        }

      case 'task_started':
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: message.description,
              detail: message.prompt,
            },
          ],
        }

      case 'task_progress':
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: message.summary?.trim() || message.description,
              detail: message.last_tool_name,
            },
          ],
        }

      case 'task_notification':
        return {
          items: [
            {
              type: 'activity',
              status: mapTaskStatus(message.status),
              label: message.summary,
              detail: message.output_file,
            },
          ],
        }

      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'files_persisted':
      case 'elicitation_complete':
      case 'init':
        return { items: [] }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractToolResultOutput(content: unknown, toolUseResult: unknown): string {
  if (isRecord(toolUseResult)) {
    const stdout = typeof toolUseResult.stdout === 'string' ? toolUseResult.stdout.trim() : ''
    const stderr = typeof toolUseResult.stderr === 'string' ? toolUseResult.stderr.trim() : ''
    const chunks = [stdout, stderr].filter(Boolean)
    if (chunks.length > 0) {
      return chunks.join('\n')
    }
  }

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim()
        }
        if (isRecord(entry) && typeof entry.text === 'string') {
          return entry.text.trim()
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (typeof toolUseResult === 'string') {
    return toolUseResult.trim()
  }

  return ''
}

function inferExitCode(content: unknown, toolUseResult: unknown, isError: boolean): number | null {
  if (!isError) {
    return 0
  }

  const candidates = [
    typeof content === 'string' ? content : '',
    typeof toolUseResult === 'string' ? toolUseResult : '',
  ]

  for (const candidate of candidates) {
    const match = candidate.match(/exit code\s+(\d+)/i)
    if (match) {
      return Number(match[1])
    }
  }

  return null
}

function formatElapsedSeconds(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return `${value.toFixed(1)}s`
}

function formatToolInput(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input
  }

  if (!isRecord(input)) {
    return undefined
  }

  if (typeof input.command === 'string') {
    return input.command
  }

  try {
    return JSON.stringify(input)
  } catch {
    return undefined
  }
}

function mapTaskStatus(status: 'completed' | 'failed' | 'stopped'): 'success' | 'error' | 'warning' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'stopped':
      return 'warning'
  }
}
