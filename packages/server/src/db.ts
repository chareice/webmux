import Database from 'libsql'
import crypto from 'node:crypto'

import type {
  RunImageAttachment,
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

export interface NotificationDeviceRow {
  installation_id: string
  user_id: string
  platform: string
  provider: string
  push_token: string
  device_name: string | null
  created_at: number
  updated_at: number
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
      tool_thread_id TEXT,
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

    CREATE TABLE IF NOT EXISTS notification_devices (
      installation_id TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform        TEXT NOT NULL,
      provider        TEXT NOT NULL,
      push_token      TEXT NOT NULL,
      device_name     TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_devices_user_id
      ON notification_devices(user_id);
  `)

  migrateRunsTableIfNeeded(db)
  ensureRunTurnsTable(db)
  ensureRunTurnAttachmentsTable(db)
  migrateRunTurnsTableIfNeeded(db)
  migrateRunTurnsIfNeeded(db)
  migrateRunEventsIfNeeded(db)
  ensureRunEventsTable(db)
  db.exec('DROP TABLE IF EXISTS run_output_chunks')

  // On server startup, clean up stale state from a previous run:
  // 1. Mark all agents as offline (they will reconnect if still alive)
  db.prepare("UPDATE agents SET status = 'offline'").run()
  // 2. Fail any runs/turns that were active when the server stopped
  const now = Date.now()
  db.prepare(
    `UPDATE run_turns SET status = 'failed', summary = 'Server restarted while this task was running.', updated_at = ?
     WHERE status IN ('starting', 'running')`,
  ).run(now)
  db.prepare(
    `UPDATE runs SET status = 'failed', summary = 'Server restarted while this task was running.', updated_at = ?
     WHERE status IN ('starting', 'running')`,
  ).run(now)

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

// --- Notification Devices ---

export function upsertNotificationDevice(
  db: Database.Database,
  opts: {
    installationId: string
    userId: string
    platform: string
    provider: string
    pushToken: string
    deviceName?: string
  },
): NotificationDeviceRow {
  const now = Date.now()
  const existing = db.prepare(
    'SELECT created_at FROM notification_devices WHERE installation_id = ?',
  ).get(opts.installationId) as { created_at: number } | undefined

  db.prepare(
    `INSERT INTO notification_devices (
      installation_id,
      user_id,
      platform,
      provider,
      push_token,
      device_name,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      provider = excluded.provider,
      push_token = excluded.push_token,
      device_name = excluded.device_name,
      updated_at = excluded.updated_at`,
  ).run(
    opts.installationId,
    opts.userId,
    opts.platform,
    opts.provider,
    opts.pushToken,
    opts.deviceName ?? null,
    existing?.created_at ?? now,
    now,
  )

  return db.prepare(
    'SELECT * FROM notification_devices WHERE installation_id = ?',
  ).get(opts.installationId) as NotificationDeviceRow
}

export function findNotificationDevicesByUserId(
  db: Database.Database,
  userId: string,
): NotificationDeviceRow[] {
  return db.prepare(
    'SELECT * FROM notification_devices WHERE user_id = ? ORDER BY updated_at DESC',
  ).all(userId) as NotificationDeviceRow[]
}

export function deleteNotificationDevice(
  db: Database.Database,
  userId: string,
  installationId: string,
): void {
  db.prepare(
    'DELETE FROM notification_devices WHERE installation_id = ? AND user_id = ?',
  ).run(installationId, userId)
}

// --- Runs ---

export interface RunRow {
  id: string
  agent_id: string
  user_id: string
  tool: string
  tool_thread_id: string | null
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

export interface RunTurnAttachmentRow {
  id: string
  turn_id: string
  name: string
  mime_type: string
  size_bytes: number
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
    `INSERT INTO runs (id, agent_id, user_id, tool, tool_thread_id, repo_path, branch, prompt, status, created_at, updated_at, summary, has_diff, unread)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'starting', ?, ?, NULL, 0, 1)`
  ).run(opts.id, opts.agentId, opts.userId, opts.tool, opts.repoPath, branch, opts.prompt, now, now)

  return {
    id: opts.id,
    agent_id: opts.agentId,
    user_id: opts.userId,
    tool: opts.tool,
    tool_thread_id: null,
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
    attachments?: RunImageAttachment[]
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
      attachments: opts.attachments,
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
  return db.prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as RunRow[]
}

export function findRunsByUserId(db: Database.Database, userId: string): RunRow[] {
  return db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC').all(userId) as RunRow[]
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
    attachments?: RunImageAttachment[]
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

  if (opts.attachments?.length) {
    createRunTurnAttachments(db, opts.id, opts.attachments)
  }

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

function createRunTurnAttachments(
  db: Database.Database,
  turnId: string,
  attachments: RunImageAttachment[],
): void {
  const insert = db.prepare(
    `INSERT INTO run_turn_attachments (
      id,
      turn_id,
      name,
      mime_type,
      size_bytes
    ) VALUES (?, ?, ?, ?, ?)`,
  )

  for (const attachment of attachments) {
    insert.run(
      attachment.id,
      turnId,
      attachment.name,
      attachment.mimeType,
      attachment.sizeBytes,
    )
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

export function updateRunToolThreadId(
  db: Database.Database,
  runId: string,
  toolThreadId: string,
): void {
  db.prepare(
    'UPDATE runs SET tool_thread_id = ?, updated_at = ? WHERE id = ?',
  ).run(toolThreadId, Date.now(), runId)
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

  const attachmentRows = db.prepare(
    `SELECT id, turn_id, name, mime_type, size_bytes
     FROM run_turn_attachments
     WHERE turn_id IN (
       SELECT id FROM run_turns WHERE run_id = ?
     )
     ORDER BY rowid ASC`,
  ).all(runId) as RunTurnAttachmentRow[]

  const attachmentsByTurnId = new Map<string, RunImageAttachment[]>()
  for (const row of attachmentRows) {
    const attachments = attachmentsByTurnId.get(row.turn_id) ?? []
    attachments.push({
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    })
    attachmentsByTurnId.set(row.turn_id, attachments)
  }

  return turns.map((turn) => ({
    ...runTurnRowToRunTurn(turn, attachmentsByTurnId.get(turn.id) ?? []),
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

// --- Queued turns ---

export function createQueuedRunTurn(
  db: Database.Database,
  opts: {
    id: string
    runId: string
    prompt: string
    attachments?: RunImageAttachment[]
  },
): RunTurnRow {
  const now = Date.now()
  const latest = findLatestRunTurnByRunId(db, opts.runId)
  const turnIndex = latest ? latest.turn_index + 1 : 1

  db.prepare(
    `INSERT INTO run_turns (
      id, run_id, turn_index, prompt, status, created_at, updated_at, summary, has_diff
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, 0)`,
  ).run(opts.id, opts.runId, turnIndex, opts.prompt, now, now)

  if (opts.attachments?.length) {
    createRunTurnAttachments(db, opts.id, opts.attachments)
  }

  return {
    id: opts.id,
    run_id: opts.runId,
    turn_index: turnIndex,
    prompt: opts.prompt,
    status: 'queued',
    created_at: now,
    updated_at: now,
    summary: null,
    has_diff: 0,
  }
}

export function findQueuedRunTurnsByRunId(db: Database.Database, runId: string): RunTurnRow[] {
  return db.prepare(
    `SELECT * FROM run_turns WHERE run_id = ? AND status = 'queued' ORDER BY turn_index ASC`,
  ).all(runId) as RunTurnRow[]
}

export function updateQueuedTurnPrompt(
  db: Database.Database,
  turnId: string,
  prompt: string,
): RunTurnRow | undefined {
  const turn = findRunTurnById(db, turnId)
  if (!turn || turn.status !== 'queued') return undefined

  const now = Date.now()
  db.prepare('UPDATE run_turns SET prompt = ?, updated_at = ? WHERE id = ?')
    .run(prompt, now, turnId)

  return { ...turn, prompt, updated_at: now }
}

export function deleteQueuedTurnsByRunId(db: Database.Database, runId: string): number {
  const result = db.prepare(
    `DELETE FROM run_turns WHERE run_id = ? AND status = 'queued'`,
  ).run(runId)
  return result.changes
}

export function runTurnRowToRunTurn(
  row: RunTurnRow,
  attachments: RunImageAttachment[] = [],
): RunTurn {
  return {
    id: row.id,
    runId: row.run_id,
    index: row.turn_index,
    prompt: row.prompt,
    attachments,
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
  const hasToolThreadIdColumn = columns.some((column) => column.name === 'tool_thread_id')

  if (hasCascadeAgentFk && hasCascadeUserFk && !hasLegacyTmuxSessionColumn && hasToolThreadIdColumn) {
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
      tool_thread_id TEXT,
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
      tool_thread_id,
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
      NULL,
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

function ensureRunTurnAttachmentsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_turn_attachments (
      id          TEXT PRIMARY KEY,
      turn_id     TEXT NOT NULL REFERENCES run_turns(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_turn_attachments_turn_id
      ON run_turn_attachments(turn_id);
  `)
}

function migrateRunTurnsTableIfNeeded(db: Database.Database): void {
  const hasRunTurnsTable = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_turns'`,
  ).get()

  if (!hasRunTurnsTable) {
    return
  }

  const columns = db.pragma('table_info(run_turns)') as Array<{ name: string }>
  const foreignKeys = db.pragma('foreign_key_list(run_turns)') as Array<{
    table: string
    on_delete: string
  }>
  const hasRunIdColumn = columns.some((column) => column.name === 'run_id')
  const hasRunCascadeFk = foreignKeys.some(
    (fk) => fk.table === 'runs' && fk.on_delete.toUpperCase() === 'CASCADE',
  )

  if (hasRunIdColumn && hasRunCascadeFk) {
    return
  }

  db.pragma('foreign_keys = OFF')
  db.exec(`
    ALTER TABLE run_turns RENAME TO run_turns_legacy;
    DROP INDEX IF EXISTS idx_run_turns_run_id_turn_index;

    CREATE TABLE run_turns (
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

    CREATE INDEX idx_run_turns_run_id_turn_index
      ON run_turns(run_id, turn_index);

    INSERT INTO run_turns (
      id,
      run_id,
      turn_index,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff
    )
    SELECT
      id,
      run_id,
      turn_index,
      prompt,
      status,
      created_at,
      updated_at,
      summary,
      has_diff
    FROM run_turns_legacy;

    DROP TABLE run_turns_legacy;
  `)
  db.pragma('foreign_keys = ON')
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
  const foreignKeys = db.pragma('foreign_key_list(run_events)') as Array<{
    table: string
    on_delete: string
  }>
  const hasRunCascadeFk = foreignKeys.some(
    (fk) => fk.table === 'runs' && fk.on_delete.toUpperCase() === 'CASCADE',
  )
  const hasTurnCascadeFk = foreignKeys.some(
    (fk) => fk.table === 'run_turns' && fk.on_delete.toUpperCase() === 'CASCADE',
  )

  if (hasTurnId && hasRunCascadeFk && hasTurnCascadeFk) {
    return
  }

  db.pragma('foreign_keys = OFF')
  db.exec(`
    ALTER TABLE run_events RENAME TO run_events_legacy;
    DROP INDEX IF EXISTS idx_run_events_run_turn_id_id;

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

  const insertEvent = db.prepare(
    'INSERT INTO run_events (run_id, turn_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  const migrate = db.transaction(() => {
    if (hasTurnId) {
      const legacyRows = db.prepare(
        'SELECT run_id, turn_id, event_type, payload_json, created_at FROM run_events_legacy ORDER BY id ASC',
      ).all() as Array<{
        run_id: string
        turn_id: string
        event_type: string
        payload_json: string
        created_at: number
      }>

      for (const row of legacyRows) {
        insertEvent.run(
          row.run_id,
          row.turn_id,
          row.event_type,
          row.payload_json,
          row.created_at,
        )
      }
      return
    }

    const legacyRows = db.prepare(
      'SELECT run_id, event_type, payload_json, created_at FROM run_events_legacy ORDER BY id ASC',
    ).all() as Array<{
      run_id: string
      event_type: string
      payload_json: string
      created_at: number
    }>

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
