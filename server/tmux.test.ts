import { describe, expect, it } from 'vitest'

import { formatPreview, parseSessionList } from './tmux.js'

describe('parseSessionList', () => {
  it('parses tmux list output into structured sessions', () => {
    const stdout = [
      'alpha\u001f2\u001f1\u001f1700000000\u001f1700000100\u001f/home/chareice/projects',
      'beta\u001f1\u001f0\u001f1700000200\u001f1700000300\u001f/home/chareice',
    ].join('\n')

    expect(parseSessionList(stdout)).toEqual([
      {
        name: 'alpha',
        windows: 2,
        attachedClients: 1,
        createdAt: 1700000000,
        lastActivityAt: 1700000100,
        path: '/home/chareice/projects',
      },
      {
        name: 'beta',
        windows: 1,
        attachedClients: 0,
        createdAt: 1700000200,
        lastActivityAt: 1700000300,
        path: '/home/chareice',
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
