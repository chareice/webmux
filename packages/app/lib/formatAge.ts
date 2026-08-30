/** Compact age label: "just now", "4m", "2h", "3d". */
export function formatAge(fromMs: number): string {
  const deltaMs = Math.max(0, Date.now() - fromMs);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
