import type { RunTimelineEventPayload, RunTool } from '@webmux/shared'

export interface RunCommandSpec {
  command: string
  args: string[]
  readPromptFromStdin: boolean
}

export interface RunAdapterParseResult {
  items: RunTimelineEventPayload[]
  summary?: string
}

export interface RunAdapter {
  buildCommand(): RunCommandSpec
  parseLine(line: string): RunAdapterParseResult
}

export function createRunAdapter(tool: RunTool): RunAdapter {
  return tool === 'codex' ? new CodexRunAdapter() : new ClaudeRunAdapter()
}

class CodexRunAdapter implements RunAdapter {
  buildCommand(): RunCommandSpec {
    return {
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '--dangerously-bypass-approvals-and-sandbox',
        '-',
      ],
      readPromptFromStdin: true,
    }
  }

  parseLine(line: string): RunAdapterParseResult {
    const parsed = parseJsonLine(line)
    if (!parsed) {
      return rawLineFallback(line)
    }

    if (parsed.type !== 'item.started' && parsed.type !== 'item.completed') {
      return emptyResult()
    }

    const item = parsed.item
    if (!item || typeof item !== 'object') {
      return emptyResult()
    }

    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      const text = item.text.trim()
      return {
        items: [{ type: 'message', role: 'assistant', text }],
        summary: text,
      }
    }

    if (item.type === 'command_execution' && typeof item.command === 'string') {
      const exitCode =
        typeof item.exit_code === 'number' ? item.exit_code : item.exit_code === null ? null : null
      const output =
        typeof item.aggregated_output === 'string' ? unescapeNewlines(item.aggregated_output) : ''

      return {
        items: [
          {
            type: 'command',
            status: item.status === 'in_progress' ? 'started' : exitCode === 0 ? 'completed' : 'failed',
            command: item.command,
            output,
            exitCode,
          },
        ],
      }
    }

    return emptyResult()
  }
}

class ClaudeRunAdapter implements RunAdapter {
  buildCommand(): RunCommandSpec {
    return {
      command: 'claude',
      args: [
        '-p',
        '--verbose',
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
      ],
      readPromptFromStdin: true,
    }
  }

  parseLine(line: string): RunAdapterParseResult {
    const parsed = parseJsonLine(line)
    if (!parsed) {
      return rawLineFallback(line)
    }

    if (parsed.type === 'assistant' && parsed.message && typeof parsed.message === 'object') {
      return this.parseAssistantMessage(parsed.message as {
        content?: Array<Record<string, unknown>>
      })
    }

    if (parsed.type === 'user') {
      const text = extractTextBlocks(parsed.message)
      if (!text) {
        return emptyResult()
      }

      return {
        items: [{ type: 'message', role: 'user', text }],
      }
    }

    return emptyResult()
  }

  private parseAssistantMessage(message: {
    content?: Array<Record<string, unknown>>
  }): RunAdapterParseResult {
    const items: RunTimelineEventPayload[] = []
    let summary: string | undefined

    for (const block of message.content ?? []) {
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
        const text = block.text.trim()
        items.push({
          type: 'message',
          role: 'assistant',
          text,
        })
        summary = text
      }
    }

    return { items, summary }
  }
}

function parseJsonLine(line: string): Record<string, any> | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as Record<string, any>
  } catch {
    return null
  }
}

function extractTextBlocks(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return ''
  }

  const content = (message as { content?: Array<Record<string, unknown>> }).content ?? []
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text).trim())
    .filter(Boolean)
    .join('\n\n')
}

function rawLineFallback(line: string): RunAdapterParseResult {
  const trimmed = line.trim()
  if (!trimmed) {
    return emptyResult()
  }

  return {
    items: [
      {
        type: 'activity',
        status: 'warning',
        label: 'Raw tool output',
        detail: trimmed,
      },
    ],
  }
}

function emptyResult(): RunAdapterParseResult {
  return { items: [] }
}

function unescapeNewlines(text: string): string {
  return text.replace(/\\n/g, '\n')
}
