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

export interface AgentInfo {
  id: string
  name: string
  status: 'online' | 'offline'
  lastSeenAt: number | null
}

// Agent → Server
export type AgentMessage =
  | { type: 'auth'; agentId: string; agentSecret: string }
  | { type: 'heartbeat' }
  | { type: 'sessions-sync'; sessions: SessionSummary[] }
  | { type: 'terminal-output'; browserId: string; data: string }
  | { type: 'terminal-ready'; browserId: string; sessionName: string }
  | { type: 'terminal-exit'; browserId: string; exitCode: number }
  | { type: 'error'; browserId?: string; message: string }

// Server → Agent
export type ServerToAgentMessage =
  | { type: 'auth-ok' }
  | { type: 'auth-fail'; message: string }
  | { type: 'sessions-list' }
  | { type: 'terminal-attach'; browserId: string; sessionName: string; cols: number; rows: number }
  | { type: 'terminal-detach'; browserId: string }
  | { type: 'terminal-input'; browserId: string; data: string }
  | { type: 'terminal-resize'; browserId: string; cols: number; rows: number }
  | { type: 'session-create'; name: string }
  | { type: 'session-kill'; name: string }

// Browser → Server
export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// Server → Browser
export type TerminalServerMessage =
  | { type: 'ready'; sessionName: string }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }

// Server → Browser (events WebSocket)
export type SessionEvent = {
  type: 'sessions-sync'
  agentId: string
  sessions: SessionSummary[]
}

// REST API types

export interface LoginResponse {
  token: string
}

export interface AgentListResponse {
  agents: AgentInfo[]
}

export interface CreateRegistrationTokenResponse {
  token: string
  expiresAt: number
}

export interface RegisterAgentRequest {
  token: string
  name?: string
}

export interface RegisterAgentResponse {
  agentId: string
  agentSecret: string
}

export interface CreateSessionRequest {
  name: string
}

export interface CreateSessionResponse {
  session: SessionSummary
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
}

export const DEFAULT_TERMINAL_SIZE = {
  cols: 120,
  rows: 36,
} as const
