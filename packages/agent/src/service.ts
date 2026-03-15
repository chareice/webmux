import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const SERVICE_NAME = 'webmux-agent'

export interface ManagedRelease {
  cliPath: string
  releaseDir: string
}

export interface RenderServiceUnitOptions {
  agentName: string
  homeDir: string
  nodePath: string
  cliPath: string
  autoUpgrade: boolean
  pathEnv: string
}

export interface InstallServiceOptions {
  agentName: string
  packageName: string
  version: string
  autoUpgrade: boolean
  homeDir?: string
}

export interface UpgradeServiceOptions {
  agentName: string
  packageName: string
  version: string
  autoUpgrade?: boolean
  homeDir?: string
}

export interface InstalledServiceConfig {
  autoUpgrade: boolean
  version: string | null
}

export function renderServiceUnit(options: RenderServiceUnitOptions): string {
  return `[Unit]
Description=Webmux Agent (${options.agentName})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${options.nodePath} ${options.cliPath} start
Restart=always
RestartSec=10
Environment=WEBMUX_AGENT_SERVICE=1
Environment=WEBMUX_AGENT_AUTO_UPGRADE=${options.autoUpgrade ? '1' : '0'}
Environment=WEBMUX_AGENT_NAME=${options.agentName}
Environment=HOME=${options.homeDir}
Environment=PATH=${options.pathEnv}
WorkingDirectory=${options.homeDir}

[Install]
WantedBy=default.target
`
}

export function installService(options: InstallServiceOptions): void {
  const homeDir = options.homeDir ?? os.homedir()
  const autoUpgrade = options.autoUpgrade
  const release = installManagedRelease({
    packageName: options.packageName,
    version: options.version,
    homeDir,
  })

  writeServiceUnit({
    agentName: options.agentName,
    autoUpgrade,
    cliPath: release.cliPath,
    homeDir,
  })

  runSystemctl(['--user', 'daemon-reload'])
  runSystemctl(['--user', 'enable', SERVICE_NAME])
  runSystemctl(['--user', 'restart', SERVICE_NAME])
  runCommand('loginctl', ['enable-linger', os.userInfo().username])
}

export function upgradeService(options: UpgradeServiceOptions): void {
  const homeDir = options.homeDir ?? os.homedir()
  const installedConfig = readInstalledServiceConfig(homeDir)
  const autoUpgrade = options.autoUpgrade ?? installedConfig?.autoUpgrade ?? true
  const release = installManagedRelease({
    packageName: options.packageName,
    version: options.version,
    homeDir,
  })

  writeServiceUnit({
    agentName: options.agentName,
    autoUpgrade,
    cliPath: release.cliPath,
    homeDir,
  })

  runSystemctl(['--user', 'daemon-reload'])
  runSystemctl(['--user', 'restart', SERVICE_NAME])
}

export function uninstallService(homeDir = os.homedir()): void {
  const unitPath = servicePath(homeDir)

  try {
    runSystemctl(['--user', 'stop', SERVICE_NAME])
  } catch {
    // Ignore if the service is not running.
  }

  try {
    runSystemctl(['--user', 'disable', SERVICE_NAME])
  } catch {
    // Ignore if the service is not installed.
  }

  if (fs.existsSync(unitPath)) {
    fs.unlinkSync(unitPath)
  }

  try {
    runSystemctl(['--user', 'daemon-reload'])
  } catch {
    // Ignore reload errors during cleanup.
  }
}

export function readInstalledServiceConfig(homeDir = os.homedir()): InstalledServiceConfig | null {
  const unitPath = servicePath(homeDir)
  if (!fs.existsSync(unitPath)) {
    return null
  }

  const unit = fs.readFileSync(unitPath, 'utf-8')
  const autoUpgradeMatch = unit.match(/^Environment=WEBMUX_AGENT_AUTO_UPGRADE=(\d)$/m)
  const versionMatch = unit.match(/\/releases\/([^/\s]+)\/node_modules\//)

  return {
    autoUpgrade: autoUpgradeMatch?.[1] !== '0',
    version: versionMatch?.[1] ?? null,
  }
}

export function servicePath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`)
}

function writeServiceUnit(options: {
  agentName: string
  autoUpgrade: boolean
  cliPath: string
  homeDir: string
}): void {
  const serviceDir = path.dirname(servicePath(options.homeDir))
  fs.mkdirSync(serviceDir, { recursive: true })
  fs.writeFileSync(
    servicePath(options.homeDir),
    renderServiceUnit({
      agentName: options.agentName,
      autoUpgrade: options.autoUpgrade,
      cliPath: options.cliPath,
      homeDir: options.homeDir,
      nodePath: findBinary('node') ?? process.execPath,
      pathEnv: process.env.PATH ?? '',
    }),
  )
}

function installManagedRelease(options: {
  packageName: string
  version: string
  homeDir: string
}): ManagedRelease {
  const releaseDir = path.join(options.homeDir, '.webmux', 'releases', options.version)
  const cliPath = path.join(
    releaseDir,
    'node_modules',
    ...options.packageName.split('/'),
    'dist',
    'cli.js',
  )

  if (fs.existsSync(cliPath)) {
    return { cliPath, releaseDir }
  }

  fs.mkdirSync(releaseDir, { recursive: true })
  ensureRuntimePackageJson(releaseDir)

  const packageManager = findBinary('pnpm') ? 'pnpm' : 'npm'
  if (packageManager === 'pnpm') {
    runCommand('pnpm', ['add', '--dir', releaseDir, `${options.packageName}@${options.version}`])
  } else {
    if (!findBinary('npm')) {
      throw new Error('Cannot find pnpm or npm. Install one package manager before installing the service.')
    }
    runCommand('npm', ['install', '--omit=dev', `${options.packageName}@${options.version}`], releaseDir)
  }

  if (!fs.existsSync(cliPath)) {
    throw new Error(`Managed release did not produce a CLI at ${cliPath}`)
  }

  return { cliPath, releaseDir }
}

function ensureRuntimePackageJson(releaseDir: string): void {
  const packageJsonPath = path.join(releaseDir, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    return
  }

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify({
      name: 'webmux-agent-runtime',
      private: true,
    }, null, 2) + '\n',
  )
}

function runSystemctl(args: string[]): void {
  runCommand('systemctl', args)
}

function runCommand(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  })
}

function findBinary(name: string): string | null {
  try {
    return execFileSync('which', [name], { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}
