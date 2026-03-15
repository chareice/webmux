export interface SessionSummary {
  name: string
  windows: number
  attachedClients: number
  createdAt: number
  lastActivityAt: number
  path: string
  preview: string[]
  currentCommand: string
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
}

export interface CreateSessionRequest {
  name: string
}

export interface CreateSessionResponse {
  session: SessionSummary
}

export type TerminalClientMessage =
  | {
      type: 'input'
      data: string
    }
  | {
      type: 'resize'
      cols: number
      rows: number
    }

export type TerminalServerMessage =
  | {
      type: 'ready'
      sessionName: string
    }
  | {
      type: 'data'
      data: string
    }
  | {
      type: 'exit'
      exitCode: number
    }
  | {
      type: 'error'
      message: string
    }

export type SessionEvent = {
  type: 'sessions-sync'
  sessions: SessionSummary[]
}

export const DEFAULT_TERMINAL_SIZE = {
  cols: 120,
  rows: 36,
} as const
