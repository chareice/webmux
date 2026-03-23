export function getThreadsRoute(): string {
  return "/(main)/(tabs)/threads";
}

export function getProjectsRoute(): string {
  return "/(main)/(tabs)/projects";
}

export function getSettingsRoute(): string {
  return "/(main)/(tabs)/settings";
}

export function buildProjectRoute(projectId: string): string {
  return `/(main)/projects/${encodeURIComponent(projectId)}`;
}
