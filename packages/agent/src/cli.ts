import { Command } from 'commander'

import type { RegisterAgentRequest, RegisterAgentResponse } from '@webmux/shared'
import { loadCredentials, saveCredentials, credentialsPath } from './credentials.js'
import { TmuxClient } from './tmux.js'
import { AgentConnection } from './connection.js'

const program = new Command()

program
  .name('webmux-agent')
  .description('Webmux agent — connects your machine to the webmux server')
  .version('0.0.0')

program
  .command('register')
  .description('Register this agent with a webmux server')
  .requiredOption('--server <url>', 'Server URL (e.g. https://webmux.example.com)')
  .requiredOption('--token <token>', 'One-time registration token from the server')
  .requiredOption('--name <name>', 'Display name for this agent')
  .action(async (opts: { server: string; token: string; name: string }) => {
    const serverUrl = opts.server.replace(/\/+$/, '')

    console.log(`[agent] Registering with server ${serverUrl}...`)

    const body: RegisterAgentRequest = {
      token: opts.token,
      name: opts.name,
    }

    let response: Response
    try {
      response = await fetch(`${serverUrl}/api/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to connect to server: ${message}`)
      process.exit(1)
    }

    if (!response.ok) {
      let errorMessage: string
      try {
        const errorBody = (await response.json()) as { error?: string }
        errorMessage = errorBody.error ?? response.statusText
      } catch {
        errorMessage = response.statusText
      }
      console.error(`[agent] Registration failed: ${errorMessage}`)
      process.exit(1)
    }

    const result = (await response.json()) as RegisterAgentResponse

    saveCredentials({
      serverUrl,
      agentId: result.agentId,
      agentSecret: result.agentSecret,
      name: opts.name,
    })

    console.log(`[agent] Registration successful!`)
    console.log(`[agent] Agent ID: ${result.agentId}`)
    console.log(`[agent] Credentials saved to ${credentialsPath()}`)
    console.log(`[agent] Run "webmux-agent start" to connect.`)
  })

program
  .command('start')
  .description('Start the agent and connect to the server')
  .action(() => {
    const creds = loadCredentials()
    if (!creds) {
      console.error(
        `[agent] No credentials found at ${credentialsPath()}. Run "webmux-agent register" first.`,
      )
      process.exit(1)
    }

    console.log(`[agent] Starting agent "${creds.name}"...`)
    console.log(`[agent] Server: ${creds.serverUrl}`)
    console.log(`[agent] Agent ID: ${creds.agentId}`)

    const tmux = new TmuxClient({
      socketName: 'webmux',
      workspaceRoot: process.cwd(),
    })

    const connection = new AgentConnection(
      creds.serverUrl,
      creds.agentId,
      creds.agentSecret,
      tmux,
    )

    const shutdown = () => {
      console.log('\n[agent] Shutting down...')
      connection.stop()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    connection.start()
  })

program
  .command('status')
  .description('Show agent status and credentials info')
  .action(() => {
    const creds = loadCredentials()
    if (!creds) {
      console.log(`[agent] Not registered. No credentials found at ${credentialsPath()}.`)
      process.exit(0)
    }

    console.log(`Agent Name:       ${creds.name}`)
    console.log(`Server URL:       ${creds.serverUrl}`)
    console.log(`Agent ID:         ${creds.agentId}`)
    console.log(`Credentials File: ${credentialsPath()}`)
  })

program.parse()
