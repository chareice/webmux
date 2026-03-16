import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SessionSummary } from '@webmux/shared'

const execFileAsync = promisify(execFile)
const FIELD_SEPARATOR = '\u001f'
const SESSION_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/

const TMUX_EMPTY_STATE_MARKERS = [
  'error connecting to',
  'failed to connect to server',
  'no server running',
  'no sessions',
]

export interface TmuxClientOptions {
  socketName: string
  workspaceRoot: string
}

interface SessionMeta {
  name: string
  windows: number
  attachedClients: number
  createdAt: number
  lastActivityAt: number
  path: string
  currentCommand: string
}

interface SessionAvailabilityOptions {
  attempts?: number
  delayMs?: number
}

export class TmuxClient {
  readonly socketName: string
  readonly workspaceRoot: string

  constructor(options: TmuxClientOptions) {
    this.socketName = options.socketName
    this.workspaceRoot = options.workspaceRoot
  }

  async listSessions(): Promise<SessionSummary[]> {
    const stdout = await this.run(
      [
        'list-sessions',
        '-F',
        [
          '#{session_name}',
          '#{session_windows}',
          '#{session_attached}',
          '#{session_created}',
          '#{session_activity}',
          '#{session_path}',
          '#{pane_current_command}',
        ].join(FIELD_SEPARATOR),
      ],
      { allowEmptyState: true },
    )

    const sessions = parseSessionList(stdout)
    const enriched = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        preview: await this.getPreview(session.name),
      })),
    )

    return enriched.sort((left, right) => {
      if (left.lastActivityAt !== right.lastActivityAt) {
        return right.lastActivityAt - left.lastActivityAt
      }

      return left.name.localeCompare(right.name)
    })
  }

  async createSession(name: string): Promise<void> {
    assertValidSessionName(name)

    if (await this.hasSession(name)) {
      return
    }

    await this.run(['new-session', '-d', '-s', name, '-c', this.workspaceRoot])

    await waitForSessionAvailability(() => this.readSession(name))
  }

  async killSession(name: string): Promise<void> {
    assertValidSessionName(name)
    await this.run(['kill-session', '-t', name])
  }

  async readSession(name: string): Promise<SessionSummary | null> {
    const sessions = await this.listSessions()
    return sessions.find((session) => session.name === name) ?? null
  }

  private async hasSession(name: string): Promise<boolean> {
    try {
      await this.run(['has-session', '-t', name])
      return true
    } catch (error) {
      const message = String(
        (error as { stderr?: string }).stderr ?? (error as Error).message,
      )

      if (isTmuxEmptyStateMessage(message)) {
        return false
      }

      return false
    }
  }

  private async getPreview(name: string): Promise<string[]> {
    try {
      const stdout = await this.run(
        ['capture-pane', '-p', '-J', '-S', '-18', '-E', '-', '-t', `${name}:`],
        { allowEmptyState: true },
      )
      return formatPreview(stdout)
    } catch {
      return ['Session available. Tap to attach.']
    }
  }

  private async run(
    args: string[],
    options: { allowEmptyState?: boolean } = {},
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'tmux',
        ['-L', this.socketName, ...args],
        {
          cwd: this.workspaceRoot,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
          },
        },
      )

      return stdout
    } catch (error) {
      const message = String(
        (error as { stderr?: string }).stderr ?? (error as Error).message,
      )

      if (
        options.allowEmptyState &&
        TMUX_EMPTY_STATE_MARKERS.some((marker) => message.includes(marker))
      ) {
        return ''
      }

      throw error
    }
  }
}

export async function waitForSessionAvailability(
  readSession: () => Promise<SessionSummary | null>,
  options: SessionAvailabilityOptions = {},
): Promise<SessionSummary | null> {
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 25

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await readSession()

    if (session) {
      return session
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs)
    }
  }

  return null
}

export function assertValidSessionName(name: string): void {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error(
      'Invalid session name. Use up to 32 letters, numbers, dot, dash, or underscore.',
    )
  }
}

export function parseSessionList(stdout: string): SessionMeta[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(FIELD_SEPARATOR)
      const [name, windows, attachedClients, createdAt, lastActivityAt, path] = parts
      const currentCommand = parts[6] ?? ''

      if (!name || !windows || !attachedClients || !createdAt || !lastActivityAt || !path) {
        return []
      }

      return [
        {
          name,
          windows: Number(windows),
          attachedClients: Number(attachedClients),
          createdAt: Number(createdAt),
          lastActivityAt: Number(lastActivityAt),
          path,
          currentCommand,
        },
      ]
    })
}

export function formatPreview(stdout: string): string[] {
  const lines = stdout
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-3)

  if (lines.length > 0) {
    return lines
  }

  return ['Fresh session. Nothing has run yet.']
}

export function isTmuxEmptyStateMessage(message: string): boolean {
  return TMUX_EMPTY_STATE_MARKERS.some((marker) => message.includes(marker))
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
