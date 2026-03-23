export interface UpdateState {
  latestVersion: string | null;
  status: "available" | "current" | "unavailable";
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue < rightValue) {
      return -1;
    }

    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

export function getUpdateState(
  currentVersion: string,
  latestVersion: string | null,
): UpdateState {
  if (!latestVersion) {
    return {
      latestVersion: null,
      status: "unavailable",
    };
  }

  if (compareVersions(currentVersion, latestVersion) >= 0) {
    return {
      latestVersion,
      status: "current",
    };
  }

  return {
    latestVersion,
    status: "available",
  };
}
