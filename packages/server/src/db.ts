import Database from 'better-sqlite3'
import crypto from 'node:crypto'

export interface UserRow {
  id: string
  provider: string
  provider_id: string
  display_name: string
  avatar_url: string | null
  role: string
  created_at: number
}

export interface AgentRow {
  id: string
  user_id: string
  name: string
  agent_secret_hash: string
  status: string
  last_seen_at: number | null
  created_at: number
}

export interface RegistrationTokenRow {
  id: string
  user_id: string
  agent_name: string
  token_hash: string
  expires_at: number
  used: number
}

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // If old schema exists (github_id column), drop and recreate
  const tableInfo = db.pragma('table_info(users)') as { name: string }[]
  if (tableInfo.some((col) => col.name === 'github_id')) {
    db.exec('DROP TABLE IF EXISTS run_output_chunks')
    db.exec('DROP TABLE IF EXISTS runs')
    db.exec('DROP TABLE IF EXISTS registration_tokens')
    db.exec('DROP TABLE IF EXISTS agents')
    db.exec('DROP TABLE IF EXISTS users')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      provider        TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      display_name    TEXT NOT NULL,
      avatar_url      TEXT,
      role            TEXT NOT NULL DEFAULT 'user',
      created_at      INTEGER NOT NULL,
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id),
      name                TEXT NOT NULL,
      agent_secret_hash   TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'offline',
      last_seen_at        INTEGER,
      created_at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registration_tokens (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      agent_name  TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool          TEXT NOT NULL,
      repo_path     TEXT NOT NULL,
      branch        TEXT NOT NULL DEFAULT '',
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'starting',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      summary       TEXT,
      has_diff      INTEGER NOT NULL DEFAULT 0,
      unread        INTEGER NOT NULL DEFAULT 1,
      tmux_session  TEXT NOT NULL
    );
  `)

  migrateRunsTableIfNeeded(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_output_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      chunk       TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_output_chunks_run_id_id
      ON run_output_chunks(run_id, id);
  `)

  return db
}

// --- Users ---

export function findUserByProvider(db: Database.Database, provider: string, providerId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId) as UserRow | undefined
}

export function findUserById(db: Database.Database, userId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
}

export function createUser(
  db: Database.Database,
  opts: { provider: string; providerId: string; displayName: string; avatarUrl: string | null; role?: string }
): UserRow {
  const id = crypto.randomUUID()
  const now = Date.now()
  const role = opts.role ?? 'user'

  db.prepare(
    'INSERT INTO users (id, provider, provider_id, display_name, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, opts.provider, opts.providerId, opts.displayName, opts.avatarUrl, role, now)

  return { id, provider: opts.provider, provider_id: opts.providerId, display_name: opts.displayName, avatar_url: opts.avatarUrl, role, created_at: now }
}

export function countUsers(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
  return row.cnt
}

// --- Agents ---

export function findAgentsByUserId(db: Database.Database, userId: string): AgentRow[] {
  return db.prepare('SELECT * FROM agents WHERE user_id = ?').all(userId) as AgentRow[]
}

export function findAgentById(db: Database.Database, agentId: string): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined
}

export function createAgent(
  db: Database.Database,
  opts: { userId: string; name: string; agentSecretHash: string }
): AgentRow {
  const id = crypto.randomUUID()
  const now = Date.now()

  db.prepare(
    'INSERT INTO agents (id, user_id, name, agent_secret_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, opts.userId, opts.name, opts.agentSecretHash, 'offline', now)

  return {
    id,
    user_id: opts.userId,
    name: opts.name,
    agent_secret_hash: opts.agentSecretHash,
    status: 'offline',
    last_seen_at: null,
    created_at: now,
  }
}

export function deleteAgent(db: Database.Database, agentId: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
}

export function renameAgent(db: Database.Database, agentId: string, name: string): void {
  db.prepare('UPDATE agents SET name = ? WHERE id = ?').run(name, agentId)
}

export function updateAgentStatus(db: Database.Database, agentId: string, status: 'online' | 'offline'): void {
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, agentId)
}

export function updateAgentLastSeen(db: Database.Database, agentId: string): void {
  db.prepare('UPDATE agents SET last_seen_at = ? WHERE id = ?').run(Date.now(), agentId)
}

// --- Registration Tokens ---

export function createRegistrationToken(
  db: Database.Database,
  opts: { userId: string; agentName: string; tokenHash: string; expiresAt: number }
): RegistrationTokenRow {
  // Clean up expired and used tokens
  db.prepare('DELETE FROM registration_tokens WHERE used = 1 OR expires_at < ?').run(Date.now())

  const id = crypto.randomUUID()

  db.prepare(
    'INSERT INTO registration_tokens (id, user_id, agent_name, token_hash, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(id, opts.userId, opts.agentName, opts.tokenHash, opts.expiresAt)

  return {
    id,
    user_id: opts.userId,
    agent_name: opts.agentName,
    token_hash: opts.tokenHash,
    expires_at: opts.expiresAt,
    used: 0,
  }
}

export function consumeRegistrationToken(
  db: Database.Database,
  tokenHash: string
): RegistrationTokenRow | undefined {
  const token = db
    .prepare('SELECT * FROM registration_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?')
    .get(tokenHash, Date.now()) as RegistrationTokenRow | undefined

  if (!token) return undefined

  db.prepare('UPDATE registration_tokens SET used = 1 WHERE id = ?').run(token.id)

  return token
}

// --- Runs ---

export interface RunRow {
  id: string
  agent_id: string
  user_id: string
  tool: string
  repo_path: string
  branch: string
  prompt: string
  status: string
  created_at: number
  updated_at: number
  summary: string | null
  has_diff: number
  unread: number
  tmux_session: string
}

export function createRun(
  db: Database.Database,
  opts: {
    id: string
    agentId: string
    userId: string
    tool: string
    repoPath: string
    prompt: string
    tmuxSession: string
    branch?: string
  }
): RunRow {
  const now = Date.now()
  const branch = opts.branch ?? ''

  db.prepare(
    `INSERT INTO runs (id, agent_id, user_id, tool, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread, tmux_session)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, NULL, 0, 1, ?)`
  ).run(opts.id, opts.agentId, opts.userId, opts.tool, opts.repoPath, branch, opts.prompt, now, now, opts.tmuxSession)

  return {
    id: opts.id,
    agent_id: opts.agentId,
    user_id: opts.userId,
    tool: opts.tool,
    repo_path: opts.repoPath,
    branch,
    prompt: opts.prompt,
    status: 'starting',
    created_at: now,
    updated_at: now,
    summary: null,
    has_diff: 0,
    unread: 1,
    tmux_session: opts.tmuxSession,
  }
}

export function findRunById(db: Database.Database, runId: string): RunRow | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
}

export function findRunsByAgentId(db: Database.Database, agentId: string): RunRow[] {
  return db.prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY updated_at DESC').all(agentId) as RunRow[]
}

export function findRunsByUserId(db: Database.Database, userId: string): RunRow[] {
  return db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as RunRow[]
}

export function findActiveRunsByAgentId(db: Database.Database, agentId: string): RunRow[] {
  return db.prepare(
    `SELECT * FROM runs
     WHERE agent_id = ?
       AND status IN ('starting', 'running', 'waiting_input', 'waiting_approval')
     ORDER BY updated_at DESC`,
  ).all(agentId) as RunRow[]
}

export function updateRunStatus(
  db: Database.Database,
  runId: string,
  status: string,
  summary?: string,
  hasDiff?: boolean
): void {
  const now = Date.now()
  if (summary !== undefined && hasDiff !== undefined) {
    db.prepare('UPDATE runs SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?')
      .run(status, summary, hasDiff ? 1 : 0, now, runId)
  } else if (summary !== undefined) {
    db.prepare('UPDATE runs SET status = ?, summary = ?, unread = 1, updated_at = ? WHERE id = ?')
      .run(status, summary, now, runId)
  } else if (hasDiff !== undefined) {
    db.prepare('UPDATE runs SET status = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?')
      .run(status, hasDiff ? 1 : 0, now, runId)
  } else {
    db.prepare('UPDATE runs SET status = ?, unread = 1, updated_at = ? WHERE id = ?')
      .run(status, now, runId)
  }
}

export function appendRunOutput(db: Database.Database, runId: string, chunk: string): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO run_output_chunks (run_id, chunk, created_at) VALUES (?, ?, ?)',
  ).run(runId, chunk, now)
  db.prepare('UPDATE runs SET unread = 1, updated_at = ? WHERE id = ?').run(now, runId)
}

export function findRunOutput(db: Database.Database, runId: string): string {
  const rows = db.prepare(
    'SELECT chunk FROM run_output_chunks WHERE run_id = ? ORDER BY id ASC',
  ).all(runId) as Array<{ chunk: string }>
  return rows.map((row) => row.chunk).join('')
}

export function markRunRead(db: Database.Database, runId: string): void {
  db.prepare('UPDATE runs SET unread = 0 WHERE id = ?').run(runId)
}

export function deleteRun(db: Database.Database, runId: string): void {
  db.prepare('DELETE FROM runs WHERE id = ?').run(runId)
}

function migrateRunsTableIfNeeded(db: Database.Database): void {
  const hasRunsTable = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'`,
  ).get()

  if (!hasRunsTable) {
    return
  }

  const foreignKeys = db.pragma('foreign_key_list(runs)') as Array<{
    table: string
    on_delete: string
  }>
  const hasCascadeAgentFk = foreignKeys.some(
    (fk) => fk.table === 'agents' && fk.on_delete.toUpperCase() === 'CASCADE',
  )
  const hasCascadeUserFk = foreignKeys.some(
    (fk) => fk.table === 'users' && fk.on_delete.toUpperCase() === 'CASCADE',
  )

  if (hasCascadeAgentFk && hasCascadeUserFk) {
    return
  }

  db.pragma('foreign_keys = OFF')
  db.exec(`
    ALTER TABLE runs RENAME TO runs_legacy;

    CREATE TABLE runs (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool          TEXT NOT NULL,
      repo_path     TEXT NOT NULL,
      branch        TEXT NOT NULL DEFAULT '',
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'starting',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      summary       TEXT,
      has_diff      INTEGER NOT NULL DEFAULT 0,
      unread        INTEGER NOT NULL DEFAULT 1,
      tmux_session  TEXT NOT NULL
    );

    INSERT INTO runs (
      id,
      agent_id,
      user_id,
      tool,
      repo_path,
      branch,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff,
      unread,
      tmux_session
    )
    SELECT
      id,
      agent_id,
      user_id,
      tool,
      repo_path,
      branch,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff,
      unread,
      tmux_session
    FROM runs_legacy;

    DROP TABLE runs_legacy;
  `)
  db.pragma('foreign_keys = ON')
}
