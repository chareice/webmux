import fs from 'node:fs'

interface AgentPackageMetadata {
  name: string
  version: string
}

const packageMetadata = readAgentPackageMetadata()

export const AGENT_PACKAGE_NAME = packageMetadata.name
export const AGENT_VERSION = packageMetadata.version

function readAgentPackageMetadata(): AgentPackageMetadata {
  const packageJsonPath = new URL('../package.json', import.meta.url)
  const raw = fs.readFileSync(packageJsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<AgentPackageMetadata>

  if (!parsed.name || !parsed.version) {
    throw new Error('Agent package metadata is missing name or version')
  }

  return {
    name: parsed.name,
    version: parsed.version,
  }
}
