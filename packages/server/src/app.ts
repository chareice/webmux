import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import type Database from 'libsql'
import type { AgentUpgradePolicy } from '@webmux/shared'

import { AgentHub } from './agent-hub.js'
import { initDb } from './db.js'
import { createMobileVersionResolver } from './mobile-version.js'
import { createNotificationService } from './notification-service.js'
import { registerRoutes } from './router.js'
import { TaskDispatcher } from './task-dispatcher.js'

export interface MobileVersionConfig {
  latestVersion?: string
  downloadUrl?: string
  minVersion?: string
}

export interface ServerConfig {
  jwtSecret: string
  githubClientId: string
  githubClientSecret: string
  googleClientId: string
  googleClientSecret: string
  baseUrl: string
  devMode: boolean
  agentUpgradePolicy: AgentUpgradePolicy | null
  firebaseServiceAccountBase64?: string
  mobileVersion?: MobileVersionConfig
  githubRepo?: string
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
  const notificationService = createNotificationService(db, {
    firebaseServiceAccountBase64: options.config.firebaseServiceAccountBase64,
  })
  const hub = options.hub ?? new AgentHub({
    upgradePolicy: options.config.agentUpgradePolicy,
    notificationService,
  })
  hub.upgradePolicy = options.config.agentUpgradePolicy
  const app = Fastify({
    logger: true,
    bodyLimit: 30 * 1024 * 1024,
  })

  app.get('/api/health', async () => ({ ok: true }))

  // Mobile version check (no auth required)
  const resolveMobileVersion = createMobileVersionResolver(
    options.config.githubRepo,
    options.config.mobileVersion,
  )
  app.get('/api/mobile/version', async () => resolveMobileVersion())

  const taskDispatcher = new TaskDispatcher(db, hub)
  if (typeof hub.setTaskDispatcher === 'function') {
    hub.setTaskDispatcher(taskDispatcher)
  }
  registerRoutes(app, db, hub, options.config, taskDispatcher)

  const staticRoot = options.staticRoot ?? resolveWebDistPath()
  const indexHtmlPath = staticRoot ? path.join(staticRoot, 'index.html') : null
  if (staticRoot && indexHtmlPath && fs.existsSync(indexHtmlPath)) {
    app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    })

    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8')
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
