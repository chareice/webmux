import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface AgentCredentials {
  serverUrl: string
  agentId: string
  agentSecret: string
  name: string
}

export function credentialsDir(): string {
  return path.join(os.homedir(), '.webmux')
}

export function credentialsPath(): string {
  return path.join(credentialsDir(), 'credentials.json')
}

export function loadCredentials(): AgentCredentials | null {
  const filePath = credentialsPath()

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as AgentCredentials

    if (!data.serverUrl || !data.agentId || !data.agentSecret || !data.name) {
      return null
    }

    return data
  } catch {
    return null
  }
}

export function saveCredentials(creds: AgentCredentials): void {
  const dir = credentialsDir()

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  fs.writeFileSync(credentialsPath(), JSON.stringify(creds, null, 2) + '\n', {
    mode: 0o600,
  })
}
