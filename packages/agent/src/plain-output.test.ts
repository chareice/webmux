import { describe, expect, it } from 'vitest'

import { sanitizeTerminalOutput, TerminalOutputSanitizer } from './plain-output.js'

describe('sanitizeTerminalOutput', () => {
  it('removes cursor-control sequences from terminal redraw output', () => {
    const rawText =
      '\u001b[?1049h\u001b[27;1H\u001b[KPlanning next step\u001b[28;1H\u001b[KRunning checks'

    expect(sanitizeTerminalOutput(rawText)).toBe('Planning next step\nRunning checks')
  })

  it('removes color escapes while keeping visible text', () => {
    const rawText = '\u001b[32mReady\u001b[0m\r\n\u001b[33mDone\u001b[0m'

    expect(sanitizeTerminalOutput(rawText)).toBe('Ready\nDone')
  })

  it('keeps only the latest carriage-return redraw text', () => {
    const rawText = 'Working\rWorkingX\rDone\n'

    expect(sanitizeTerminalOutput(rawText)).toBe('Done')
  })

  it('keeps redraw state across streamed chunks', () => {
    const sanitizer = new TerminalOutputSanitizer()

    expect(sanitizer.push('Working\r')).toBe('')
    expect(sanitizer.push('WorkingX\r')).toBe('')
    expect(sanitizer.push('Done\n')).toBe('Done')
  })
})
