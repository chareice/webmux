import Database from 'better-sqlite3'
import crypto from 'node:crypto'

import type {
  RunTimelineEvent,
  RunTimelineEventPayload,
  RunTurn,
  RunTurnDetail,
} from '@webmux/shared'

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
    db.exec('DROP TABLE IF EXISTS run_events')
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
      unread        INTEGER NOT NULL DEFAULT 1
    );
  `)

  migrateRunsTableIfNeeded(db)
  ensureRunTurnsTable(db)
  migrateRunTurnsIfNeeded(db)
  migrateRunEventsIfNeeded(db)
  ensureRunEventsTable(db)
  db.exec('DROP TABLE IF EXISTS run_output_chunks')

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
}

export interface RunTurnRow {
  id: string
  run_id: string
  turn_index: number
  prompt: string
  status: string
  created_at: number
  updated_at: number
  summary: string | null
  has_diff: number
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
    branch?: string
  }
): RunRow {
  const now = Date.now()
  const branch = opts.branch ?? ''

  db.prepare(
    `INSERT INTO runs (id, agent_id, user_id, tool, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, NULL, 0, 1)`
  ).run(opts.id, opts.agentId, opts.userId, opts.tool, opts.repoPath, branch, opts.prompt, now, now)

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
  }
}

export function createRunWithInitialTurn(
  db: Database.Database,
  opts: {
    runId: string
    turnId: string
    agentId: string
    userId: string
    tool: string
    repoPath: string
    prompt: string
    branch?: string
  },
): { run: RunRow; turn: RunTurnRow } {
  const create = db.transaction(() => {
    const run = createRun(db, {
      id: opts.runId,
      agentId: opts.agentId,
      userId: opts.userId,
      tool: opts.tool,
      repoPath: opts.repoPath,
      prompt: opts.prompt,
      branch: opts.branch,
    })
    const turn = createRunTurn(db, {
      id: opts.turnId,
      runId: opts.runId,
      prompt: opts.prompt,
    })
    return { run, turn }
  })

  return create()
}

export function findRunById(db: Database.Database, runId: string): RunRow | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
}

export function findRunTurnById(db: Database.Database, turnId: string): RunTurnRow | undefined {
  return db.prepare('SELECT * FROM run_turns WHERE id = ?').get(turnId) as RunTurnRow | undefined
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
       AND status IN ('starting', 'running')
     ORDER BY updated_at DESC`,
  ).all(agentId) as RunRow[]
}

export function findRunTurnsByRunId(db: Database.Database, runId: string): RunTurnRow[] {
  return db.prepare(
    'SELECT * FROM run_turns WHERE run_id = ? ORDER BY turn_index ASC',
  ).all(runId) as RunTurnRow[]
}

export function findLatestRunTurnByRunId(db: Database.Database, runId: string): RunTurnRow | undefined {
  return db.prepare(
    'SELECT * FROM run_turns WHERE run_id = ? ORDER BY turn_index DESC LIMIT 1',
  ).get(runId) as RunTurnRow | undefined
}

export function findActiveRunTurnByRunId(db: Database.Database, runId: string): RunTurnRow | undefined {
  return db.prepare(
    `SELECT * FROM run_turns
     WHERE run_id = ?
       AND status IN ('starting', 'running')
     ORDER BY turn_index DESC
     LIMIT 1`,
  ).get(runId) as RunTurnRow | undefined
}

export function createRunTurn(
  db: Database.Database,
  opts: {
    id: string
    runId: string
    prompt: string
  },
): RunTurnRow {
  const now = Date.now()
  const latest = findLatestRunTurnByRunId(db, opts.runId)
  const turnIndex = latest ? latest.turn_index + 1 : 1

  db.prepare(
    `INSERT INTO run_turns (
      id,
      run_id,
      turn_index,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff
    ) VALUES (?, ?, ?, ?, 'starting', ?, ?, NULL, 0)`,
  ).run(opts.id, opts.runId, turnIndex, opts.prompt, now, now)

  db.prepare(
    'UPDATE runs SET status = ?, summary = NULL, unread = 1, updated_at = ? WHERE id = ?',
  ).run('starting', now, opts.runId)

  return {
    id: opts.id,
    run_id: opts.runId,
    turn_index: turnIndex,
    prompt: opts.prompt,
    status: 'starting',
    created_at: now,
    updated_at: now,
    summary: null,
    has_diff: 0,
  }
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

export function updateRunTurnStatus(
  db: Database.Database,
  turnId: string,
  status: string,
  summary?: string,
  hasDiff?: boolean,
): void {
  const existingTurn = findRunTurnById(db, turnId)
  if (!existingTurn) {
    return
  }

  const now = Date.now()
  const nextSummary = summary !== undefined ? summary : existingTurn.summary
  const nextHasDiff = hasDiff !== undefined ? (hasDiff ? 1 : 0) : existingTurn.has_diff

  db.prepare(
    'UPDATE run_turns SET status = ?, summary = ?, has_diff = ?, updated_at = ? WHERE id = ?',
  ).run(status, nextSummary ?? null, nextHasDiff, now, turnId)

  db.prepare(
    'UPDATE runs SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ? WHERE id = ?',
  ).run(status, nextSummary ?? null, nextHasDiff, now, existingTurn.run_id)
}

export function appendRunTimelineEvent(
  db: Database.Database,
  runId: string,
  turnId: string,
  event: RunTimelineEventPayload,
): RunTimelineEvent {
  const now = Date.now()
  const result = db.prepare(
    'INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(runId, turnId, event.type, JSON.stringify(event), now)
  const eventId = Number(result.lastInsertRowid)

  db.prepare('UPDATE runs SET unread = 1, updated_at = ? WHERE id = ?').run(now, runId)
  db.prepare('UPDATE run_turns SET updated_at = ? WHERE id = ?').run(now, turnId)

  return {
    ...event,
    id: eventId,
    createdAt: now,
  }
}

export function findRunTimelineEventsByTurn(db: Database.Database, turnId: string): RunTimelineEvent[] {
  const rows = db.prepare(
    'SELECT id, payload_json, created_at FROM run_events WHERE turn_id = ? ORDER BY id ASC',
  ).all(turnId) as Array<{ id: number; payload_json: string; created_at: number }>

  return rows.map((row) => ({
    ...(JSON.parse(row.payload_json) as RunTimelineEventPayload),
    id: row.id,
    createdAt: row.created_at,
  }))
}

export function findRunTurnDetails(db: Database.Database, runId: string): RunTurnDetail[] {
  const turns = findRunTurnsByRunId(db, runId)
  if (turns.length === 0) {
    return []
  }

  const eventRows = db.prepare(
    'SELECT id, turn_id, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY id ASC',
  ).all(runId) as Array<{
    id: number
    turn_id: string
    payload_json: string
    created_at: number
  }>

  const itemsByTurnId = new Map<string, RunTimelineEvent[]>()
  for (const row of eventRows) {
    const items = itemsByTurnId.get(row.turn_id) ?? []
    items.push({
      ...(JSON.parse(row.payload_json) as RunTimelineEventPayload),
      id: row.id,
      createdAt: row.created_at,
    })
    itemsByTurnId.set(row.turn_id, items)
  }

  return turns.map((turn) => ({
    ...runTurnRowToRunTurn(turn),
    items: itemsByTurnId.get(turn.id) ?? [],
  }))
}

export function markRunRead(db: Database.Database, runId: string): void {
  db.prepare('UPDATE runs SET unread = 0 WHERE id = ?').run(runId)
}

export function deleteRun(db: Database.Database, runId: string): void {
  db.prepare('DELETE FROM runs WHERE id = ?').run(runId)
}

export function deleteRunTurn(db: Database.Database, turnId: string): void {
  const turn = findRunTurnById(db, turnId)
  if (!turn) {
    return
  }

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM run_turns WHERE id = ?').run(turnId)
    const latestRemainingTurn = findLatestRunTurnByRunId(db, turn.run_id)

    if (!latestRemainingTurn) {
      db.prepare('DELETE FROM runs WHERE id = ?').run(turn.run_id)
      return
    }

    db.prepare(
      `UPDATE runs
       SET status = ?, summary = ?, has_diff = ?, unread = 1, updated_at = ?
       WHERE id = ?`,
    ).run(
      latestRemainingTurn.status,
      latestRemainingTurn.summary,
      latestRemainingTurn.has_diff,
      latestRemainingTurn.updated_at,
      turn.run_id,
    )
  })

  remove()
}

export function runTurnRowToRunTurn(row: RunTurnRow): RunTurn {
  return {
    id: row.id,
    runId: row.run_id,
    index: row.turn_index,
    prompt: row.prompt,
    status: row.status as RunTurn['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: row.summary ?? undefined,
    hasDiff: row.has_diff === 1,
  }
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
  const columns = db.pragma('table_info(runs)') as Array<{ name: string }>
  const hasCascadeAgentFk = foreignKeys.some(
    (fk) => fk.table === 'agents' && fk.on_delete.toUpperCase() === 'CASCADE',
  )
  const hasCascadeUserFk = foreignKeys.some(
    (fk) => fk.table === 'users' && fk.on_delete.toUpperCase() === 'CASCADE',
  )
  const hasLegacyTmuxSessionColumn = columns.some((column) => column.name === 'tmux_session')

  if (hasCascadeAgentFk && hasCascadeUserFk && !hasLegacyTmuxSessionColumn) {
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
      unread        INTEGER NOT NULL DEFAULT 1
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
      unread
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
      unread
    FROM runs_legacy;

    DROP TABLE runs_legacy;
  `)
  db.pragma('foreign_keys = ON')
}

function ensureRunTurnsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_turns (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      turn_index  INTEGER NOT NULL,
      prompt      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'starting',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      summary     TEXT,
      has_diff    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(run_id, turn_index)
    );

    CREATE INDEX IF NOT EXISTS idx_run_turns_run_id_turn_index
      ON run_turns(run_id, turn_index);
  `)
}

function migrateRunTurnsIfNeeded(db: Database.Database): void {
  const turnCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM run_turns').get() as { cnt: number }
  if (turnCountRow.cnt > 0) {
    return
  }

  const runs = db.prepare(
    'SELECT id, prompt, status, created_at, updated_at, summary, has_diff FROM runs ORDER BY created_at ASC',
  ).all() as Array<{
    id: string
    prompt: string
    status: string
    created_at: number
    updated_at: number
    summary: string | null
    has_diff: number
  }>

  const insertTurn = db.prepare(
    `INSERT INTO run_turns (
      id,
      run_id,
      turn_index,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  )

  const seedTurns = db.transaction(() => {
    for (const run of runs) {
      insertTurn.run(
        initialTurnIdForRun(run.id),
        run.id,
        run.prompt,
        run.status,
        run.created_at,
        run.updated_at,
        run.summary,
        run.has_diff,
      )
    }
  })

  seedTurns()
}

function ensureRunEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      turn_id      TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
      event_type   TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_run_turn_id_id
      ON run_events(run_id, turn_id, id);
  `)
}

function migrateRunEventsIfNeeded(db: Database.Database): void {
  const hasRunEventsTable = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_events'`,
  ).get()

  if (!hasRunEventsTable) {
    return
  }

  const columns = db.pragma('table_info(run_events)') as Array<{ name: string }>
  const hasTurnId = columns.some((column) => column.name === 'turn_id')
  if (hasTurnId) {
    return
  }

  db.pragma('foreign_keys = OFF')
  db.exec(`
    ALTER TABLE run_events RENAME TO run_events_legacy;

    CREATE TABLE run_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      turn_id      TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
      event_type   TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX idx_run_events_run_turn_id_id
      ON run_events(run_id, turn_id, id);
  `)

  const legacyRows = db.prepare(
    'SELECT run_id, event_type, payload_json, created_at FROM run_events_legacy ORDER BY id ASC',
  ).all() as Array<{
    run_id: string
    event_type: string
    payload_json: string
    created_at: number
  }>

  const insertEvent = db.prepare(
    'INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  const migrate = db.transaction(() => {
    for (const row of legacyRows) {
      insertEvent.run(
        row.run_id,
        initialTurnIdForRun(row.run_id),
        row.event_type,
        row.payload_json,
        row.created_at,
      )
    }
  })

  migrate()
  db.exec('DROP TABLE run_events_legacy')
  db.pragma('foreign_keys = ON')
}

function initialTurnIdForRun(runId: string): string {
  return `${runId}:turn:1`
}
