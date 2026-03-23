import { repoName } from "@webmux/shared";

export function getRepoNameFromPath(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }

  return repoName(trimmedPath);
}

export function resolveProjectNameFromRepoPath(
  currentName: string,
  repoPath: string,
): string {
  if (currentName.trim()) {
    return currentName;
  }

  return getRepoNameFromPath(repoPath);
}
