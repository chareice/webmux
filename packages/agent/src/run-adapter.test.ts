import { describe, expect, it } from 'vitest'

import { createRunAdapter } from './run-adapter.js'

describe('createRunAdapter', () => {
  it('maps Codex JSON events into timeline items and summary updates', () => {
    const adapter = createRunAdapter('codex')

    expect(
      adapter.parseLine(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_0',
            type: 'agent_message',
            text: 'I will inspect the repository first.',
          },
        }),
      ),
    ).toEqual({
      items: [
        {
          type: 'message',
          role: 'assistant',
          text: 'I will inspect the repository first.',
        },
      ],
      summary: 'I will inspect the repository first.',
    })

    expect(
      adapter.parseLine(
        JSON.stringify({
          type: 'item.started',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: "/usr/bin/bash -lc 'find . -maxdepth 1 -type f | wc -l'",
            aggregated_output: '',
            exit_code: null,
            status: 'in_progress',
          },
        }),
      ),
    ).toEqual({
      items: [
        {
          type: 'command',
          status: 'started',
          command: "/usr/bin/bash -lc 'find . -maxdepth 1 -type f | wc -l'",
          output: '',
          exitCode: null,
        },
      ],
    })

    expect(
      adapter.parseLine(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'command_execution',
            command: "/usr/bin/bash -lc 'find . -maxdepth 1 -type f | wc -l'",
            aggregated_output: '2\\n',
            exit_code: 0,
            status: 'completed',
          },
        }),
      ),
    ).toEqual({
      items: [
        {
          type: 'command',
          status: 'completed',
          command: "/usr/bin/bash -lc 'find . -maxdepth 1 -type f | wc -l'",
          output: '2\n',
          exitCode: 0,
        },
      ],
    })
  })

  it('maps Claude stream-json output into timeline items', () => {
    const adapter = createRunAdapter('claude')

    expect(
      adapter.parseLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'thinking', thinking: 'The user wants exactly hello.' }],
          },
        }),
      ),
    ).toEqual({
      items: [
        {
          type: 'activity',
          status: 'info',
          label: 'Thinking',
          detail: 'The user wants exactly hello.',
        },
      ],
    })

    expect(
      adapter.parseLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'hello' }],
          },
        }),
      ),
    ).toEqual({
      items: [
        {
          type: 'message',
          role: 'assistant',
          text: 'hello',
        },
      ],
      summary: 'hello',
    })
  })
})
