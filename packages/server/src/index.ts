import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { verifyJwt } from './auth.js'
import type { JwtPayload } from './auth.js'
import { buildAgentUpgradePolicy } from './agent-upgrade.js'
import { buildApp } from './app.js'
import { handleTerminalConnection } from './relay.js'
import { DEFAULT_TERMINAL_SIZE } from '@webmux/shared'

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
  },
})

// --- WebSocket servers ---

const server = app.server

const agentWss = new WebSocketServer({ noServer: true })
const terminalWss = new WebSocketServer({ noServer: true })
const eventsWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const parsed = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const pathname = parsed.pathname ?? ''

  if (pathname === '/ws/agent') {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit('connection', ws, request)
    })
    return
  }

  if (pathname === '/ws/terminal') {
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

    const agentId = parsed.searchParams.get('agent') ?? undefined
    const sessionName = parsed.searchParams.get('session') ?? undefined
    const cols = parseInt(parsed.searchParams.get('cols') ?? String(DEFAULT_TERMINAL_SIZE.cols), 10)
    const rows = parseInt(parsed.searchParams.get('rows') ?? String(DEFAULT_TERMINAL_SIZE.rows), 10)

    if (!agentId || !sessionName) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      const browserId = crypto.randomUUID()
      handleTerminalConnection(ws, hub, agentId, sessionName, cols, rows, payload.userId, browserId)
    })
    return
  }

  if (pathname === '/ws/events') {
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

    eventsWss.handleUpgrade(request, socket, head, (ws) => {
      hub.addEventClient(ws, payload.userId)
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
