import {
  compareSemanticVersions,
  isValidSemanticVersion,
  type AgentUpgradePolicy,
} from '@webmux/shared'

export interface AgentUpgradePolicyOptions {
  packageName?: string
  targetVersion?: string
  minimumVersion?: string
}

export function buildAgentUpgradePolicy(options: AgentUpgradePolicyOptions): AgentUpgradePolicy | null {
  const packageName = options.packageName?.trim() || '@webmux/agent'
  const targetVersion = normalizeVersionOption(options.targetVersion)
  const minimumVersion = normalizeVersionOption(options.minimumVersion)

  if (!targetVersion && !minimumVersion) {
    return null
  }

  if (targetVersion && !isValidSemanticVersion(targetVersion)) {
    throw new Error(`Invalid WEBMUX_AGENT_TARGET_VERSION: ${targetVersion}`)
  }

  if (minimumVersion && !isValidSemanticVersion(minimumVersion)) {
    throw new Error(`Invalid WEBMUX_AGENT_MIN_VERSION: ${minimumVersion}`)
  }

  if (targetVersion && minimumVersion && compareSemanticVersions(targetVersion, minimumVersion) < 0) {
    throw new Error('WEBMUX_AGENT_TARGET_VERSION cannot be lower than WEBMUX_AGENT_MIN_VERSION')
  }

  return {
    packageName,
    targetVersion: targetVersion ?? undefined,
    minimumVersion: minimumVersion ?? undefined,
  }
}

export function describeMinimumVersionFailure(
  currentVersion: string | undefined,
  upgradePolicy: AgentUpgradePolicy,
): string {
  const currentLabel = currentVersion ?? 'unknown'
  const minimumVersion = upgradePolicy.minimumVersion ?? 'unknown'
  const targetVersion = upgradePolicy.targetVersion

  if (targetVersion) {
    return `Agent version ${currentLabel} is below the minimum supported version ${minimumVersion}. Upgrade to ${targetVersion} or newer.`
  }

  return `Agent version ${currentLabel} is below the minimum supported version ${minimumVersion}.`
}

function normalizeVersionOption(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
