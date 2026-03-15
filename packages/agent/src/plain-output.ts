function joinOutputParts(parts: string[]): string {
  const output = parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return output
}

function parseCount(paramText: string, fallback: number): number {
  const value = Number.parseInt(paramText, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export class TerminalOutputSanitizer {
  private currentLine = ''
  private cursor = 0
  private clearOnWrite = false
  private completedLines: string[] = []

  push(rawText: string): string {
    for (let index = 0; index < rawText.length; index += 1) {
      const char = rawText[index]

      if (char === '\u001b' || char === '\u009b') {
        index = this.handleEscapeSequence(rawText, index)
        continue
      }

      if (char === '\r') {
        this.cursor = 0
        this.clearOnWrite = true
        continue
      }

      if (char === '\n') {
        this.commitLine()
        continue
      }

      if (char === '\b') {
        this.cursor = Math.max(0, this.cursor - 1)
        continue
      }

      if (char === '\t') {
        this.writeChar(' ')
        continue
      }

      const code = char.charCodeAt(0)
      if ((code >= 0 && code <= 8) || (code >= 11 && code <= 31) || code === 127) {
        continue
      }

      this.writeChar(char)
    }

    const lines = this.completedLines
    this.completedLines = []
    return joinOutputParts(lines)
  }

  flush(): string {
    const line = this.normalizeLine(this.currentLine)
    this.currentLine = ''
    this.cursor = 0
    this.clearOnWrite = false
    return line
  }

  private handleEscapeSequence(text: string, startIndex: number): number {
    if (text[startIndex] === '\u009b') {
      return this.handleCsiSequence(text, startIndex + 1)
    }

    const nextChar = text[startIndex + 1]
    if (!nextChar) {
      return startIndex
    }

    if (nextChar === '[') {
      return this.handleCsiSequence(text, startIndex + 2)
    }

    if (nextChar === ']') {
      for (let index = startIndex + 2; index < text.length; index += 1) {
        if (text[index] === '\u0007') {
          return index
        }
        if (text[index] === '\u001b' && text[index + 1] === '\\') {
          return index + 1
        }
      }
      return text.length - 1
    }

    if (nextChar === '(' || nextChar === ')' || nextChar === '#') {
      return Math.min(startIndex + 2, text.length - 1)
    }

    return startIndex + 1
  }

  private handleCsiSequence(text: string, cursorIndex: number): number {
    let paramText = ''
    let index = cursorIndex

    while (index < text.length) {
      const char = text[index]
      const code = char.charCodeAt(0)

      if (code >= 0x40 && code <= 0x7e) {
        this.applyCsiSequence(paramText, char)
        return index
      }

      paramText += char
      index += 1
    }

    return text.length - 1
  }

  private applyCsiSequence(paramText: string, command: string): void {
    const normalizedParams = paramText.replace(/^\?/, '')
    const parts = normalizedParams.length > 0 ? normalizedParams.split(';') : []

    switch (command) {
      case 'm':
        return
      case 'J':
        if (parseCount(parts[0] ?? '', 0) === 2) {
          this.currentLine = ''
          this.cursor = 0
          this.clearOnWrite = false
        }
        return
      case 'K': {
        const mode = parseCount(parts[0] ?? '', 0)
        if (mode === 2) {
          this.currentLine = ''
          this.cursor = 0
        } else if (mode === 1) {
          this.currentLine = this.currentLine.slice(this.cursor)
          this.cursor = 0
        } else {
          this.currentLine = this.currentLine.slice(0, this.cursor)
        }
        this.clearOnWrite = false
        return
      }
      case 'H':
      case 'f':
        if (this.normalizeLine(this.currentLine)) {
          this.commitLine()
        } else {
          this.currentLine = ''
          this.cursor = 0
          this.clearOnWrite = false
        }
        return
      case 'G':
        this.cursor = Math.max(0, parseCount(parts[0] ?? '', 1) - 1)
        this.clearOnWrite = false
        return
      case 'C':
        this.cursor += parseCount(parts[0] ?? '', 1)
        this.clearOnWrite = false
        return
      case 'D':
        this.cursor = Math.max(0, this.cursor - parseCount(parts[0] ?? '', 1))
        this.clearOnWrite = false
        return
      case 'P': {
        const count = parseCount(parts[0] ?? '', 1)
        this.currentLine =
          this.currentLine.slice(0, this.cursor) +
          this.currentLine.slice(this.cursor + count)
        this.clearOnWrite = false
        return
      }
      default:
        return
    }
  }

  private writeChar(char: string): void {
    if (this.clearOnWrite && this.cursor === 0) {
      this.currentLine = ''
    }
    this.clearOnWrite = false

    if (this.cursor > this.currentLine.length) {
      this.currentLine += ' '.repeat(this.cursor - this.currentLine.length)
    }

    if (this.cursor === this.currentLine.length) {
      this.currentLine += char
    } else {
      this.currentLine =
        this.currentLine.slice(0, this.cursor) +
        char +
        this.currentLine.slice(this.cursor + 1)
    }

    this.cursor += 1
  }

  private commitLine(): void {
    const line = this.normalizeLine(this.currentLine)
    if (line) {
      this.completedLines.push(line)
    }
    this.currentLine = ''
    this.cursor = 0
    this.clearOnWrite = false
  }

  private normalizeLine(line: string): string {
    return line.replace(/[ \t]+$/g, '').trim()
  }
}

export function sanitizeTerminalOutput(rawText: string): string {
  const sanitizer = new TerminalOutputSanitizer()
  const output = sanitizer.push(rawText)
  const finalLine = sanitizer.flush()
  return joinOutputParts([output, finalLine])
}
