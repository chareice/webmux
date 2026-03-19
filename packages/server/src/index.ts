import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { verifyJwt } from './auth.js'
import type { JwtPayload } from './auth.js'
import { buildAgentUpgradePolicy } from './agent-upgrade.js'
import { buildApp } from './app.js'
import { findRunById } from './db.js'
import { runRowToRun } from './agent-hub.js'

// --- Parse environment ---

const PORT = parseInt(process.env.PORT ?? '4317', 10)
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret'
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? ''
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const WEBMUX_BASE_URL = process.env.WEBMUX_BASE_URL ?? `http://localhost:${PORT}`
const DEV_MODE = process.env.WEBMUX_DEV_MODE === 'true'
const DATABASE_PATH = process.env.DATABASE_PATH ?? './webmux.db'
const FIREBASE_SERVICE_ACCOUNT_BASE64 =
  process.env.WEBMUX_FIREBASE_SERVICE_ACCOUNT_BASE64 ?? ''
const GITHUB_REPO = process.env.WEBMUX_GITHUB_REPO ?? 'chareice/webmux'
const MOBILE_LATEST_VERSION = process.env.WEBMUX_MOBILE_LATEST_VERSION ?? ''
const MOBILE_DOWNLOAD_URL = process.env.WEBMUX_MOBILE_DOWNLOAD_URL ?? ''
const MOBILE_MIN_VERSION = process.env.WEBMUX_MOBILE_MIN_VERSION ?? ''

const AGENT_UPGRADE_POLICY = buildAgentUpgradePolicy({
  packageName: process.env.WEBMUX_AGENT_PACKAGE_NAME,
  targetVersion: process.env.WEBMUX_AGENT_TARGET_VERSION,
  minimumVersion: process.env.WEBMUX_AGENT_MIN_VERSION,
})

if (DEV_MODE) {
  console.warn('=== WARNING: Running in DEV MODE — authentication is relaxed ===')
}

if (!DEV_MODE && (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET)) {
  console.warn('WARNING: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set. GitHub OAuth will fail.')
}

if (JWT_SECRET === 'dev-secret' && !DEV_MODE) {
  console.warn('WARNING: Using default JWT_SECRET. Set JWT_SECRET for production.')
}

// --- Initialize ---

const { app, db, hub } = buildApp({
  dbPath: DATABASE_PATH,
  config: {
    jwtSecret: JWT_SECRET,
    githubClientId: GITHUB_CLIENT_ID,
    githubClientSecret: GITHUB_CLIENT_SECRET,
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    baseUrl: WEBMUX_BASE_URL,
    devMode: DEV_MODE,
    agentUpgradePolicy: AGENT_UPGRADE_POLICY,
    firebaseServiceAccountBase64: FIREBASE_SERVICE_ACCOUNT_BASE64,
    githubRepo: GITHUB_REPO || undefined,
    mobileVersion: {
      latestVersion: MOBILE_LATEST_VERSION || undefined,
      downloadUrl: MOBILE_DOWNLOAD_URL || undefined,
      minVersion: MOBILE_MIN_VERSION || undefined,
    },
  },
})

// --- WebSocket servers ---

const server = app.server

const agentWss = new WebSocketServer({ noServer: true })
const runWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const parsed = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const pathname = parsed.pathname ?? ''

  if (pathname === '/ws/agent') {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit('connection', ws, request)
    })
    return
  }

  if (pathname === '/ws/thread') {
    // Verify JWT from query params
    const token = parsed.searchParams.get('token') ?? undefined
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    let payload: JwtPayload
    try {
      payload = verifyJwt(token, JWT_SECRET)
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const threadId = parsed.searchParams.get('threadId') ?? undefined
    if (!threadId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    // Verify thread exists and belongs to user
    const runRow = findRunById(db, threadId)
    if (!runRow || runRow.user_id !== payload.userId) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    runWss.handleUpgrade(request, socket, head, (ws) => {
      // Register as thread event client
      hub.addRunClient(threadId, ws)

      // Send current thread state immediately
      const run = runRowToRun(runRow)
      ws.send(JSON.stringify({ type: 'run-status', run }))
    })
    return
  }

  // Unknown WebSocket path
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
  socket.destroy()
})

// Agent WebSocket connections
agentWss.on('connection', (ws: WebSocket) => {
  hub.handleConnection(ws, db)
})

// --- Start ---

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
  console.log(`Webmux server listening on port ${PORT}`)
  if (DEV_MODE) {
    console.log(`Dev login: ${WEBMUX_BASE_URL}/api/auth/dev`)
  }
})
