import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import type Database from 'better-sqlite3'

import { AgentHub } from './agent-hub.js'
import { initDb } from './db.js'
import { registerRoutes } from './router.js'

export interface ServerConfig {
  jwtSecret: string
  githubClientId: string
  githubClientSecret: string
  googleClientId: string
  googleClientSecret: string
  baseUrl: string
  devMode: boolean
}

interface BuildAppOptions {
  config: ServerConfig
  db?: Database.Database
  dbPath?: string
  hub?: AgentHub
  staticRoot?: string
}

export function buildApp(options: BuildAppOptions) {
  const db = options.db ?? initDb(options.dbPath ?? './webmux.db')
  const hub = options.hub ?? new AgentHub()
  const app = Fastify({
    logger: true,
  })

  app.get('/api/health', async () => ({ ok: true }))

  registerRoutes(app, db, hub, options.config)

  const staticRoot = options.staticRoot ?? resolveWebDistPath()
  if (staticRoot && fs.existsSync(staticRoot)) {
    app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    })

    const indexHtml = fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf-8')
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.raw.url?.split('?')[0] ?? ''
      const isSpaRoute =
        (request.method === 'GET' || request.method === 'HEAD') &&
        !pathname.startsWith('/api') &&
        !pathname.startsWith('/ws')

      if (isSpaRoute) {
        return reply.type('text/html').send(indexHtml)
      }

      return reply.status(404).send({
        message: `Route ${request.method}:${pathname} not found`,
        error: 'Not Found',
        statusCode: 404,
      })
    })
  }

  return { app, db, hub }
}

function resolveWebDistPath(): string | null {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
  const packageBuildPath = path.resolve(__dirname, '../web')
  if (fs.existsSync(packageBuildPath)) {
    return packageBuildPath
  }

  const monorepoBuildPath = path.resolve(__dirname, '../../web/dist')
  if (fs.existsSync(monorepoBuildPath)) {
    return monorepoBuildPath
  }

  return null
}
