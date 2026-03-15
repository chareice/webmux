import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { Command } from 'commander'

import type { RegisterAgentRequest, RegisterAgentResponse } from '@webmux/shared'
import { loadCredentials, saveCredentials, credentialsPath } from './credentials.js'
import { TmuxClient } from './tmux.js'
import { AgentConnection } from './connection.js'

const SERVICE_NAME = 'webmux-agent'

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
    console.log(`  npx @webmux/agent start              # run once`)
    console.log(`  npx @webmux/agent service install     # install as systemd service`)
  })

program
  .command('start')
  .description('Start the agent and connect to the server')
  .action(() => {
    const creds = loadCredentials()
    if (!creds) {
      console.error(
        `[agent] No credentials found at ${credentialsPath()}. Run "npx @webmux/agent register" first.`,
      )
      process.exit(1)
    }

    console.log(`[agent] Starting agent "${creds.name}"...`)
    console.log(`[agent] Server: ${creds.serverUrl}`)
    console.log(`[agent] Agent ID: ${creds.agentId}`)

    const tmux = new TmuxClient({
      socketName: 'webmux',
      workspaceRoot: os.homedir(),
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

    // Check systemd service status
    try {
      const result = execSync(`systemctl --user is-active ${SERVICE_NAME} 2>/dev/null`, { encoding: 'utf-8' }).trim()
      console.log(`Service:          ${result}`)
    } catch {
      console.log(`Service:          not installed`)
    }
  })

// --- Service management ---

const service = program
  .command('service')
  .description('Manage the systemd service')

service
  .command('install')
  .description('Install and start the agent as a systemd user service')
  .action(() => {
    const creds = loadCredentials()
    if (!creds) {
      console.error(`[agent] Not registered. Run "npx @webmux/agent register" first.`)
      process.exit(1)
    }

    // Find the npx binary path
    const npxPath = findBinary('npx')
    if (!npxPath) {
      console.error(`[agent] Cannot find npx. Make sure Node.js is installed.`)
      process.exit(1)
    }

    const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
    const servicePath = path.join(serviceDir, `${SERVICE_NAME}.service`)

    const npmPath = findBinary('npm') ?? 'npm'

    const unit = `[Unit]
Description=Webmux Agent (${creds.name})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=${npmPath} install -g @webmux/agent@latest
ExecStart=${findBinary('webmux-agent') ?? `${npxPath} -y @webmux/agent`} start
Restart=always
RestartSec=10
Environment=HOME=${os.homedir()}
Environment=PATH=${process.env.PATH}
WorkingDirectory=${os.homedir()}

[Install]
WantedBy=default.target
`

    fs.mkdirSync(serviceDir, { recursive: true })
    fs.writeFileSync(servicePath, unit)
    console.log(`[agent] Service file created: ${servicePath}`)

    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' })
      execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'inherit' })
      execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'inherit' })

      // Enable linger so the service runs without login
      execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'inherit' })

      console.log(``)
      console.log(`[agent] Service installed and started!`)
      console.log(`[agent] It will auto-start on boot.`)
      console.log(``)
      console.log(`Useful commands:`)
      console.log(`  systemctl --user status ${SERVICE_NAME}`)
      console.log(`  journalctl --user -u ${SERVICE_NAME} -f`)
      console.log(`  npx @webmux/agent service uninstall`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] Failed to enable service: ${message}`)
      console.error(`[agent] Service file was written to ${servicePath}`)
      console.error(`[agent] You can try manually: systemctl --user enable --now ${SERVICE_NAME}`)
      process.exit(1)
    }
  })

service
  .command('uninstall')
  .description('Stop and remove the systemd user service')
  .action(() => {
    const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`)

    try {
      execSync(`systemctl --user stop ${SERVICE_NAME} 2>/dev/null`, { stdio: 'inherit' })
      execSync(`systemctl --user disable ${SERVICE_NAME} 2>/dev/null`, { stdio: 'inherit' })
    } catch {
      // Service might not exist
    }

    if (fs.existsSync(servicePath)) {
      fs.unlinkSync(servicePath)
      console.log(`[agent] Service file removed: ${servicePath}`)
    }

    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' })
    } catch {
      // Ignore
    }

    console.log(`[agent] Service uninstalled.`)
  })

service
  .command('status')
  .description('Show systemd service status')
  .action(() => {
    try {
      execSync(`systemctl --user status ${SERVICE_NAME}`, { stdio: 'inherit' })
    } catch {
      console.log(`[agent] Service is not installed or not running.`)
    }
  })

service
  .command('upgrade')
  .description('Upgrade agent to latest version and restart service')
  .action(() => {
    console.log('[agent] Upgrading @webmux/agent to latest...')
    try {
      execSync('npm install -g @webmux/agent@latest', { stdio: 'inherit' })
    } catch {
      console.error('[agent] Failed to upgrade. Try manually: npm install -g @webmux/agent@latest')
      process.exit(1)
    }

    console.log('[agent] Restarting service...')
    try {
      execSync(`systemctl --user restart ${SERVICE_NAME}`, { stdio: 'inherit' })
      console.log('[agent] Upgrade complete!')
    } catch {
      console.log('[agent] Package upgraded. Service not installed or restart failed.')
      console.log('[agent] If running manually, restart with: npx @webmux/agent@latest start')
    }
  })

function findBinary(name: string): string | null {
  try {
    return execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

program.parse()
