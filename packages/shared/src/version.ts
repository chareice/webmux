export interface SemanticVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemanticVersion(version: string): SemanticVersion | null {
  const match = version.trim().match(SEMVER_PATTERN)
  if (!match) {
    return null
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export function compareSemanticVersions(left: string, right: string): number {
  const parsedLeft = parseSemanticVersion(left)
  const parsedRight = parseSemanticVersion(right)

  if (!parsedLeft || !parsedRight) {
    throw new Error(`Invalid semantic version comparison: "${left}" vs "${right}"`)
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

export function isValidSemanticVersion(version: string): boolean {
  return parseSemanticVersion(version) !== null
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  if (left.length === 0) {
    return 1
  }

  if (right.length === 0) {
    return -1
  }

  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]

    if (leftIdentifier === undefined) {
      return -1
    }

    if (rightIdentifier === undefined) {
      return 1
    }

    const numericLeft = Number.parseInt(leftIdentifier, 10)
    const numericRight = Number.parseInt(rightIdentifier, 10)
    const leftIsNumber = String(numericLeft) === leftIdentifier
    const rightIsNumber = String(numericRight) === rightIdentifier

    if (leftIsNumber && rightIsNumber && numericLeft !== numericRight) {
      return numericLeft - numericRight
    }

    if (leftIsNumber !== rightIsNumber) {
      return leftIsNumber ? -1 : 1
    }

    if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1
    }
  }

  return 0
}
