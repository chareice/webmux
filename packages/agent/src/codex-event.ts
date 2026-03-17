import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk'
import type { RunStatus, RunTimelineEventPayload } from '@webmux/shared'

export interface CodexEventParseResult {
  items: RunTimelineEventPayload[]
  summary?: string
  finalStatus?: RunStatus
  threadId?: string
}

export function parseCodexThreadEvent(event: ThreadEvent): CodexEventParseResult {
  switch (event.type) {
    case 'thread.started':
      return {
        items: [],
        threadId: event.thread_id,
      }

    case 'turn.failed':
      return {
        items: [
          {
            type: 'activity',
            status: 'error',
            label: 'Turn failed',
            detail: event.error.message,
          },
        ],
        finalStatus: 'failed',
        summary: event.error.message,
      }

    case 'error':
      return {
        items: [
          {
            type: 'activity',
            status: 'error',
            label: 'Thread error',
            detail: event.message,
          },
        ],
        finalStatus: 'failed',
        summary: event.message,
      }

    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return parseThreadItem(event.item, event.type)

    case 'turn.started':
    case 'turn.completed':
      return { items: [] }
  }
}

function parseThreadItem(
  item: ThreadItem,
  eventType: 'item.started' | 'item.updated' | 'item.completed',
): CodexEventParseResult {
  switch (item.type) {
    case 'agent_message': {
      const text = item.text.trim()
      if (!text || eventType !== 'item.completed') {
        return { items: [] }
      }

      return {
        items: [
          {
            type: 'message',
            role: 'assistant',
            text,
          },
        ],
        summary: text,
      }
    }

    case 'reasoning': {
      const text = item.text.trim()
      if (!text || eventType !== 'item.completed') {
        return { items: [] }
      }

      return {
        items: [
          {
            type: 'activity',
            status: 'info',
            label: 'Reasoning',
            detail: text,
          },
        ],
      }
    }

    case 'command_execution':
      if (eventType === 'item.started') {
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: 'Running command',
              detail: item.command,
            },
          ],
        }
      }

      if (eventType !== 'item.completed') {
        return { items: [] }
      }

      return {
        items: [
          {
            type: 'command',
            status: item.status === 'failed' || item.exit_code !== 0 ? 'failed' : 'completed',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code ?? null,
          },
        ],
      }

    case 'file_change':
      return {
        items: [
          {
            type: 'activity',
            status: item.status === 'failed' ? 'error' : 'success',
            label: item.status === 'failed' ? 'File changes failed' : 'Applied file changes',
            detail: formatFileChangeSummary(item.changes),
          },
        ],
      }

    case 'mcp_tool_call':
      if (eventType === 'item.started') {
        return {
          items: [
            {
              type: 'activity',
              status: 'info',
              label: `Tool: ${item.tool}`,
              detail: `${item.server} / ${item.tool}`,
            },
          ],
        }
      }

      if (eventType !== 'item.completed') {
        return { items: [] }
      }

      return {
        items: [
          {
            type: 'activity',
            status: item.status === 'failed' ? 'error' : 'success',
            label: item.status === 'failed' ? `Tool failed: ${item.tool}` : `Tool finished: ${item.tool}`,
            detail: item.status === 'failed' ? item.error?.message : `${item.server} / ${item.tool}`,
          },
        ],
      }

    case 'web_search':
      return {
        items: [
          {
            type: 'activity',
            status: 'info',
            label: 'Web search',
            detail: item.query,
          },
        ],
      }

    case 'todo_list':
      return {
        items: [
          {
            type: 'todo',
            items: item.items.map((entry) => ({
              text: entry.text,
              status: entry.completed ? 'completed' as const : 'pending' as const,
            })),
          },
        ],
      }

    case 'error':
      return {
        items: [
          {
            type: 'activity',
            status: 'error',
            label: 'Tool error',
            detail: item.message,
          },
        ],
        summary: item.message,
      }
  }
}

function formatFileChangeSummary(
  changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>,
): string {
  if (changes.length === 0) {
    return 'No files changed'
  }

  return changes.map((change) => `${change.kind}: ${change.path}`).join('\n')
}

