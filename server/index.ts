import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'

import staticPlugin from '@fastify/static'
import Fastify from 'fastify'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { z } from 'zod'

import {
  DEFAULT_TERMINAL_SIZE,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ListSessionsResponse,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from '../shared/contracts.js'
import { createTerminalBridge, type TerminalBridge } from './terminal.js'
import { TmuxClient } from './tmux.js'

const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(32),
})

const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('input'),
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(10).max(200),
  }),
])

function getRuntimeConfig() {
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? '4317'),
    socketName: process.env.WEBMUX_TMUX_SOCKET ?? 'webmux',
    workspaceRoot: process.env.WEBMUX_WORKSPACE_ROOT ?? process.cwd(),
  }
}

export async function buildServer() {
  const config = getRuntimeConfig()
  const tmux = new TmuxClient({
    socketName: config.socketName,
    workspaceRoot: config.workspaceRoot,
  })

  const server = Fastify({
    logger: true,
  })

  const terminalSocketServer = new WebSocketServer({
    noServer: true,
  })

  server.server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`,
    )

    if (requestUrl.pathname !== '/ws/terminal') {
      socket.destroy()
      return
    }

    terminalSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      handleTerminalSocket(webSocket, request, tmux)
    })
  })

  server.addHook('onClose', (_, done) => {
    terminalSocketServer.close(() => done())
  })

  server.get('/api/health', async () => ({
    ok: true,
    workspaceRoot: config.workspaceRoot,
    socketName: config.socketName,
  }))

  server.get('/api/sessions', async (): Promise<ListSessionsResponse> => ({
    sessions: await tmux.listSessions(),
  }))

  server.post('/api/sessions', async (request, reply): Promise<CreateSessionResponse> => {
    const body = createSessionSchema.parse(request.body as CreateSessionRequest)
    await tmux.createSession(body.name)
    const session = await tmux.readSession(body.name)

    if (!session) {
      reply.code(500)
      throw new Error('Session was created but could not be read back.')
    }

    reply.code(201)
    return { session }
  })

  server.delete('/api/sessions/:name', async (request, reply) => {
    const params = z.object({ name: z.string() }).parse(request.params)
    await tmux.killSession(params.name)
    reply.code(204)
    return reply.send()
  })

  const clientRoot = fileURLToPath(new URL('../client', import.meta.url))

  if (await exists(clientRoot)) {
    await server.register(staticPlugin, {
      root: clientRoot,
      prefix: '/',
      wildcard: false,
    })

    server.setNotFoundHandler((_, reply) => {
      reply.type('text/html').sendFile('index.html')
    })
  }

  return server
}

function parseTerminalMessage(payload: string): TerminalClientMessage | null {
  try {
    return terminalClientMessageSchema.parse(JSON.parse(payload))
  } catch {
    return null
  }
}

function handleTerminalSocket(
  socket: WebSocket,
  request: IncomingMessage,
  tmux: TmuxClient,
) {
  const requestUrl = new URL(
    request.url ?? '/ws/terminal',
    `http://${request.headers.host ?? 'localhost'}`,
  )
  const sessionName = requestUrl.searchParams.get('session')
  const cols = Number(requestUrl.searchParams.get('cols') ?? DEFAULT_TERMINAL_SIZE.cols)
  const rows = Number(requestUrl.searchParams.get('rows') ?? DEFAULT_TERMINAL_SIZE.rows)

  if (!sessionName) {
    socket.send(
      JSON.stringify({
        type: 'error',
        message: 'Missing session query parameter.',
      } satisfies TerminalServerMessage),
    )
    socket.close()
    return
  }

  let bridge: TerminalBridge | null = null

  const dispose = () => {
    bridge?.dispose()
    bridge = null
  }

  void (async () => {
    try {
      bridge = await createTerminalBridge({
        tmux,
        sessionName,
        cols,
        rows,
        onData(chunk) {
          socket.send(
            JSON.stringify({
              type: 'data',
              data: chunk,
            } satisfies TerminalServerMessage),
          )
        },
        onExit(exitCode) {
          socket.send(
            JSON.stringify({
              type: 'exit',
              exitCode,
            } satisfies TerminalServerMessage),
          )
          socket.close()
        },
      })

      socket.send(
        JSON.stringify({
          type: 'ready',
          sessionName,
        } satisfies TerminalServerMessage),
      )
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: 'error',
          message: (error as Error).message,
        } satisfies TerminalServerMessage),
      )
      socket.close()
    }
  })()

  socket.on('message', (payload: RawData) => {
    if (!bridge) {
      return
    }

    const message = parseTerminalMessage(String(payload))

    if (!message) {
      return
    }

    if (message.type === 'input') {
      bridge.write(message.data)
      return
    }

    bridge.resize(message.cols, message.rows)
  })

  socket.on('close', dispose)
  socket.on('error', dispose)
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then(({ access }) => access(targetPath))
    return true
  } catch {
    return false
  }
}

async function main() {
  const config = getRuntimeConfig()
  const server = await buildServer()
  await server.listen({
    host: config.host,
    port: config.port,
  })
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const currentFilePath = fileURLToPath(import.meta.url)

if (entrypointPath === currentFilePath) {
  void main()
}
