import { describe, expect, it } from 'vitest'

import { parseCodexThreadEvent } from './codex-event.js'

describe('parseCodexThreadEvent', () => {
  it('returns a thread id when Codex starts a new thread', () => {
    expect(
      parseCodexThreadEvent({
        type: 'thread.started',
        thread_id: 'codex-thread-1',
      }),
    ).toEqual({
      items: [],
      threadId: 'codex-thread-1',
    })
  })

  it('maps completed command items into timeline command payloads', () => {
    expect(
      parseCodexThreadEvent({
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'git status --short',
          aggregated_output: ' M src/app.ts\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
    ).toEqual({
      items: [
        {
          type: 'command',
          status: 'completed',
          command: 'git status --short',
          output: ' M src/app.ts\n',
          exitCode: 0,
        },
      ],
    })
  })

  it('maps failed turns into a failed status and activity item', () => {
    expect(
      parseCodexThreadEvent({
        type: 'turn.failed',
        error: {
          message: 'The tool was interrupted',
        },
      }),
    ).toEqual({
      items: [
        {
          type: 'activity',
          status: 'error',
          label: 'Turn failed',
          detail: 'The tool was interrupted',
        },
      ],
      finalStatus: 'failed',
      summary: 'The tool was interrupted',
    })
  })
})

