import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  formatPreview,
  isTmuxEmptyStateMessage,
  parseSessionList,
  TmuxClient,
  waitForSessionAvailability,
} from './tmux.js'

const execFileAsync = promisify(execFile)

describe('parseSessionList', () => {
  it('parses tmux list output into structured sessions', () => {
    const stdout = [
      'alpha\u001f2\u001f1\u001f1700000000\u001f1700000100\u001f/home/chareice/projects\u001fbash',
      'beta\u001f1\u001f0\u001f1700000200\u001f1700000300\u001f/home/chareice\u001fvim',
    ].join('\n')

    expect(parseSessionList(stdout)).toEqual([
      {
        name: 'alpha',
        windows: 2,
        attachedClients: 1,
        createdAt: 1700000000,
        lastActivityAt: 1700000100,
        path: '/home/chareice/projects',
        currentCommand: 'bash',
      },
      {
        name: 'beta',
        windows: 1,
        attachedClients: 0,
        createdAt: 1700000200,
        lastActivityAt: 1700000300,
        path: '/home/chareice',
        currentCommand: 'vim',
      },
    ])
  })

  it('handles missing currentCommand field gracefully', () => {
    const stdout =
      'gamma\u001f1\u001f0\u001f1700000000\u001f1700000100\u001f/home/chareice'

    expect(parseSessionList(stdout)).toEqual([
      {
        name: 'gamma',
        windows: 1,
        attachedClients: 0,
        createdAt: 1700000000,
        lastActivityAt: 1700000100,
        path: '/home/chareice',
        currentCommand: '',
      },
    ])
  })

  it('drops malformed rows', () => {
    expect(parseSessionList('broken-row')).toEqual([])
  })
})

describe('formatPreview', () => {
  it('keeps the latest three non-empty lines', () => {
    const stdout = ['one', 'two', '', 'three', 'four'].join('\n')
    expect(formatPreview(stdout)).toEqual(['two', 'three', 'four'])
  })

  it('returns a default preview when the pane is empty', () => {
    expect(formatPreview('\n\n')).toEqual(['Fresh session. Nothing has run yet.'])
  })
})

describe('isTmuxEmptyStateMessage', () => {
  it('treats missing server errors as empty state', () => {
    expect(
      isTmuxEmptyStateMessage('no server running on /tmp/tmux-1000/webmux-test'),
    ).toBe(true)
    expect(
      isTmuxEmptyStateMessage(
        'error connecting to /tmp/tmux-1000/webmux-test (No such file or directory)',
      ),
    ).toBe(true)
  })
})

describe('waitForSessionAvailability', () => {
  it('retries until the session becomes visible', async () => {
    let attempts = 0

    const session = await waitForSessionAvailability(
      async () => {
        attempts += 1

        if (attempts < 3) {
          return null
        }

        return {
          name: 'spec',
          windows: 1,
          attachedClients: 0,
          createdAt: 1,
          lastActivityAt: 1,
          path: '/tmp/spec',
          preview: ['Fresh session. Nothing has run yet.'],
          currentCommand: 'tmux',
        }
      },
      { attempts: 4, delayMs: 0 },
    )

    expect(session?.name).toBe('spec')
    expect(attempts).toBe(3)
  })
})

describe('TmuxClient integration', () => {
  it('creates a new session when the socket does not exist yet', async () => {
    const socketName = `webmux-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const client = new TmuxClient({
      socketName,
      workspaceRoot: process.cwd(),
    })

    try {
      await client.createSession('spec')
      const session = await client.readSession('spec')
      expect(session?.name).toBe('spec')
      expect(session?.currentCommand).toBeTruthy()
    } finally {
      await execFileAsync('tmux', ['-L', socketName, 'kill-server']).catch(() => undefined)
    }
  })
})
