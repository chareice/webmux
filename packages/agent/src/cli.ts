import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'

import type { RegisterAgentRequest, RegisterAgentResponse } from '@webmux/shared'
import { loadCredentials, saveCredentials, credentialsPath } from './credentials.js'
import {
  SERVICE_NAME,
  installService,
  readInstalledServiceConfig,
  servicePath,
  uninstallService,
  upgradeService,
} from './service.js'
import { AGENT_PACKAGE_NAME, AGENT_VERSION } from './version.js'

async function loadAgentRuntime(): Promise<{
  AgentConnection: typeof import('./connection.js').AgentConnection
}> {
  const { AgentConnection } = await import('./connection.js')
  return { AgentConnection }
}

export function createProgram(): Command {
  const program = new Command()

  program
    .name('webmux-agent')
    .description('Webmux agent — connects your machine to the webmux server')
    .version(AGENT_VERSION)

  program
    .command('register')
    .description('Register this agent with a webmux server')
    .requiredOption('--server <url>', 'Server URL (e.g. https://webmux.example.com)')
    .requiredOption('--token <token>', 'One-time registration token from the server')
    .option('--name <name>', 'Display name for this agent (defaults to hostname)')
    .action(async (opts: { server: string; token: string; name?: string }) => {
      const serverUrl = opts.server.replace(/\/+$/, '')
      const agentName = opts.name ?? os.hostname()

      console.log(`[agent] Registering with server ${serverUrl}...`)
      console.log(`[agent] Agent name: ${agentName}`)

      const body: RegisterAgentRequest = {
        token: opts.token,
        name: agentName,
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
        name: agentName,
      })

      console.log(`[agent] Registration successful!`)
      console.log(`[agent] Agent ID: ${result.agentId}`)
      console.log(`[agent] Credentials saved to ${credentialsPath()}`)
      console.log(``)
      console.log(`Next steps:`)
      console.log(`  pnpm dlx @webmux/agent start         # run once`)
      console.log(`  pnpm dlx @webmux/agent service install    # install as managed systemd service`)
    })

  program
    .command('start')
    .description('Start the agent and connect to the server')
    .action(async () => {
      const creds = loadCredentials()
      if (!creds) {
        console.error(
          `[agent] No credentials found at ${credentialsPath()}. Run "npx @webmux/agent register" first.`,
        )
        process.exit(1)
      }

      const { AgentConnection } = await loadAgentRuntime()

      console.log(`[agent] Starting agent "${creds.name}"...`)
      console.log(`[agent] Server: ${creds.serverUrl}`)
      console.log(`[agent] Agent ID: ${creds.agentId}`)

      const connection = new AgentConnection(
        creds.serverUrl,
        creds.agentId,
        creds.agentSecret,
        os.homedir(),
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
      console.log(`Agent Version:    ${AGENT_VERSION}`)
      console.log(`Server URL:       ${creds.serverUrl}`)
      console.log(`Agent ID:         ${creds.agentId}`)
      console.log(`Credentials File: ${credentialsPath()}`)

      const installedService = readInstalledServiceConfig()
      try {
        const result = execFileSync('systemctl', ['--user', 'is-active', SERVICE_NAME], { encoding: 'utf-8' }).trim()
        console.log(`Service:          ${result}`)
      } catch {
        console.log(`Service:          not installed`)
      }

      if (installedService?.version) {
        console.log(`Service Version:  ${installedService.version}`)
      }
    })

  // --- Service management ---

  const service = program
    .command('service')
    .description('Manage the systemd service')

  service
    .command('install')
    .description('Install and start the agent as a managed systemd user service')
    .option('--no-auto-upgrade', 'Disable automatic upgrades for the managed service')
    .action((opts: { autoUpgrade: boolean }) => {
      const creds = loadCredentials()
      if (!creds) {
        console.error(`[agent] Not registered. Run "npx @webmux/agent register" first.`)
        process.exit(1)
      }

      try {
        installService({
          agentName: creds.name,
          packageName: AGENT_PACKAGE_NAME,
          version: AGENT_VERSION,
          autoUpgrade: opts.autoUpgrade,
        })

        console.log(``)
        console.log(`[agent] Service installed and started!`)
        console.log(`[agent] Managed version: ${AGENT_VERSION}`)
        console.log(`[agent] It will auto-start on boot.`)
        console.log(``)
        console.log(`Useful commands:`)
        console.log(`  systemctl --user status ${SERVICE_NAME}`)
        console.log(`  journalctl --user -u ${SERVICE_NAME} -f`)
        console.log(`  pnpm dlx @webmux/agent service upgrade --to <version>`)
        console.log(`  pnpm dlx @webmux/agent service uninstall`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[agent] Failed to install managed service: ${message}`)
        console.error(`[agent] Service file path: ${servicePath()}`)
        process.exit(1)
      }
    })

  service
    .command('uninstall')
    .description('Stop and remove the systemd user service')
    .action(() => {
      try {
        uninstallService()
        console.log(`[agent] Service file removed: ${servicePath()}`)
        console.log(`[agent] Service uninstalled.`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[agent] Failed to uninstall service: ${message}`)
        process.exit(1)
      }
    })

  service
    .command('status')
    .description('Show systemd service status')
    .action(() => {
      try {
        execFileSync('systemctl', ['--user', 'status', SERVICE_NAME], { stdio: 'inherit' })
      } catch {
        console.log(`[agent] Service is not installed or not running.`)
      }
    })

  service
    .command('upgrade')
    .description('Switch the managed service to a specific agent version and restart it')
    .requiredOption('--to <version>', 'Target agent version (for example 0.1.5)')
    .action((opts: { to: string }) => {
      const creds = loadCredentials()
      if (!creds) {
        console.error(`[agent] Not registered. Run "npx @webmux/agent register" first.`)
        process.exit(1)
      }

      console.log(`[agent] Switching managed service to ${opts.to}...`)
      try {
        upgradeService({
          agentName: creds.name,
          packageName: AGENT_PACKAGE_NAME,
          version: opts.to,
        })
        console.log('[agent] Managed service updated successfully.')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[agent] Failed to upgrade managed service: ${message}`)
        process.exit(1)
      }
    })

  return program
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv)
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }

  // Resolve symlinks so pnpm's node_modules structure doesn't break the check
  try {
    const realEntry = realpathSync(entryPath)
    return import.meta.url === pathToFileURL(realEntry).href
  } catch {
    return import.meta.url === pathToFileURL(entryPath).href
  }
}

if (isDirectExecution()) {
  void run()
}
