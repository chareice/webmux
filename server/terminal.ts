import { spawn, type IPty } from 'node-pty'

import { DEFAULT_TERMINAL_SIZE } from '../shared/contracts.js'
import { TmuxClient, assertValidSessionName } from './tmux.js'

export interface TerminalBridgeOptions {
  tmux: TmuxClient
  sessionName: string
  cols?: number
  rows?: number
  onData: (chunk: string) => void
  onExit: (exitCode: number) => void
}

export interface TerminalBridge {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  dispose: () => void
}

export async function createTerminalBridge(
  options: TerminalBridgeOptions,
): Promise<TerminalBridge> {
  const {
    tmux,
    sessionName,
    cols = DEFAULT_TERMINAL_SIZE.cols,
    rows = DEFAULT_TERMINAL_SIZE.rows,
    onData,
    onExit,
  } = options

  assertValidSessionName(sessionName)
  await tmux.createSession(sessionName)

  const ptyProcess: IPty = spawn(
    'tmux',
    ['-L', tmux.socketName, 'attach-session', '-t', sessionName],
    {
      cols,
      rows,
      cwd: tmux.workspaceRoot,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
      name: 'xterm-256color',
    },
  )

  ptyProcess.onData(onData)
  ptyProcess.onExit(({ exitCode }) => {
    onExit(exitCode)
  })

  return {
    write(data: string) {
      ptyProcess.write(data)
    },
    resize(nextCols: number, nextRows: number) {
      ptyProcess.resize(nextCols, nextRows)
    },
    dispose() {
      ptyProcess.kill()
    },
  }
}
