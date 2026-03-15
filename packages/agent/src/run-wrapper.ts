import { spawn, type IPty } from 'node-pty'

import type { RunStatus, RunTool } from '@webmux/shared'
import type { TmuxClient } from './tmux.js'
import { TerminalOutputSanitizer } from './plain-output.js'

const STATUS_DEBOUNCE_MS = 300
const OUTPUT_BUFFER_MAX_LINES = 20

export interface RunWrapperOptions {
  runId: string
  tool: RunTool
  repoPath: string
  prompt: string
  tmux: TmuxClient
  onEvent: (status: RunStatus, summary?: string, hasDiff?: boolean) => void
  onFinish: (status: RunStatus) => void
  onOutput: (data: string) => void
}

// Patterns used to detect tool status from pty output
const CLAUDE_APPROVAL_PATTERNS = [
  /do you want to/i,
  /\ballow\b/i,
  /\bdeny\b/i,
  /\bpermission\b/i,
  /proceed\?/i,
]

const CLAUDE_INPUT_PATTERNS = [
  /^>\s*$/m,
  /❯/,
  /\$ $/m,
]

const CODEX_APPROVAL_PATTERNS = [
  /apply changes/i,
  /\[y\/n\]/i,
  /\bapprove\b/i,
]

const CODEX_INPUT_PATTERNS = [
  /what would you like/i,
  /❯/,
  /^>\s*$/m,
]

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

export class RunWrapper {
  private readonly runId: string
  private readonly tool: RunTool
  private readonly repoPath: string
  private readonly prompt: string
  private readonly tmux: TmuxClient
  private readonly onEvent: RunWrapperOptions['onEvent']
  private readonly onFinish: RunWrapperOptions['onFinish']
  private readonly onOutput: RunWrapperOptions['onOutput']

  private ptyProcess: IPty | null = null
  private currentStatus: RunStatus = 'starting'
  private outputBuffer: string[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private interrupted = false
  private readonly outputSanitizer = new TerminalOutputSanitizer()

  readonly sessionName: string

  constructor(options: RunWrapperOptions) {
    this.runId = options.runId
    this.tool = options.tool
    this.repoPath = options.repoPath
    this.prompt = options.prompt
    this.tmux = options.tmux
    this.onEvent = options.onEvent
    this.onFinish = options.onFinish
    this.onOutput = options.onOutput

    // Use first 8 chars of runId to keep tmux session name short
    const shortId = this.runId.slice(0, 8)
    this.sessionName = `run-${shortId}`
  }

  async start(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.emitStatus('starting')

    // Create a tmux session for this run
    await this.tmux.createSession(this.sessionName)

    // Build the command to run inside the tmux session
    const command = this.buildCommand()

    // Spawn a pty attached to the tmux session
    const ptyProcess = spawn(
      'tmux',
      ['-L', this.tmux.socketName, 'attach-session', '-t', this.sessionName],
      {
        cols: 120,
        rows: 36,
        cwd: this.repoPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
        name: 'xterm-256color',
      },
    )

    this.ptyProcess = ptyProcess

    ptyProcess.onData((data: string) => {
      if (this.disposed) {
        return
      }

      const plainOutput = this.outputSanitizer.push(data)
      if (plainOutput) {
        this.onOutput(plainOutput)
      }
      this.appendToBuffer(data)
      this.scheduleStatusDetection()
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (this.disposed) {
        return
      }

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
        this.debounceTimer = null
      }

      const finalStatus =
        this.interrupted ? 'interrupted' : exitCode === 0 ? 'success' : 'failed'
      if (finalStatus !== this.currentStatus) {
        this.emitStatus(finalStatus)
      }

      const trailingOutput = this.outputSanitizer.flush()
      if (trailingOutput) {
        this.onOutput(trailingOutput)
      }

      this.onFinish(finalStatus)

      this.ptyProcess = null
    })

    // Send the tool command into the tmux session via pty
    // Small delay to let the shell initialize
    setTimeout(() => {
      if (this.ptyProcess && !this.disposed) {
        this.ptyProcess.write(command + '\n')
        this.emitStatus('running')
      }
    }, 500)
  }

  sendInput(input: string): void {
    if (this.ptyProcess && !this.disposed) {
      this.ptyProcess.write(input)
    }
  }

  interrupt(): void {
    if (this.ptyProcess && !this.disposed) {
      // Send Ctrl+C
      this.interrupted = true
      this.ptyProcess.write('\x03')
      this.emitStatus('interrupted')
    }
  }

  approve(): void {
    if (this.ptyProcess && !this.disposed) {
      this.ptyProcess.write('y\n')
    }
  }

  reject(): void {
    if (this.ptyProcess && !this.disposed) {
      this.ptyProcess.write('n\n')
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = null
    }

    // Best-effort kill the tmux session
    this.tmux.killSession(this.sessionName).catch(() => {
      // Ignore errors when cleaning up
    })
  }

  private buildCommand(): string {
    // Escape the prompt for shell use: wrap in single quotes, escaping inner single quotes
    const escapedPrompt = this.prompt.replace(/'/g, "'\\''")

    switch (this.tool) {
      case 'claude':
        return `cd '${this.repoPath.replace(/'/g, "'\\''")}' && claude '${escapedPrompt}'`
      case 'codex':
        return `cd '${this.repoPath.replace(/'/g, "'\\''")}' && codex '${escapedPrompt}'`
    }
  }

  private appendToBuffer(data: string): void {
    // Split incoming data into lines and append to rolling buffer
    const newLines = data.split('\n')
    this.outputBuffer.push(...newLines)

    // Keep only the last N lines
    if (this.outputBuffer.length > OUTPUT_BUFFER_MAX_LINES) {
      this.outputBuffer = this.outputBuffer.slice(-OUTPUT_BUFFER_MAX_LINES)
    }
  }

  private scheduleStatusDetection(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.detectStatus()
    }, STATUS_DEBOUNCE_MS)
  }

  private detectStatus(): void {
    if (this.disposed) {
      return
    }

    // Terminal states should not be overwritten
    if (
      this.currentStatus === 'success' ||
      this.currentStatus === 'failed' ||
      this.currentStatus === 'interrupted'
    ) {
      return
    }

    const recentText = this.outputBuffer.join('\n')
    const detectedStatus = this.detectStatusFromText(recentText)

    if (detectedStatus && detectedStatus !== this.currentStatus) {
      this.emitStatus(detectedStatus)
    }
  }

  private detectStatusFromText(text: string): RunStatus | null {
    // Check approval patterns first (higher priority than input)
    const approvalPatterns =
      this.tool === 'claude' ? CLAUDE_APPROVAL_PATTERNS : CODEX_APPROVAL_PATTERNS
    if (matchesAny(text, approvalPatterns)) {
      return 'waiting_approval'
    }

    // Check input patterns
    const inputPatterns =
      this.tool === 'claude' ? CLAUDE_INPUT_PATTERNS : CODEX_INPUT_PATTERNS
    if (matchesAny(text, inputPatterns)) {
      return 'waiting_input'
    }

    // Default: if we have recent output and none of the above matched, we're running
    if (text.trim().length > 0) {
      return 'running'
    }

    return null
  }

  private emitStatus(status: RunStatus, summary?: string, hasDiff?: boolean): void {
    this.currentStatus = status
    this.onEvent(status, summary, hasDiff)
  }
}
