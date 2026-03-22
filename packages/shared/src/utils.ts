import type { RunStatus, TaskStatus } from './contracts.js'

// Time formatting
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}

// Tool helpers
export function toolLabel(tool: string): string {
  return tool === 'codex' ? 'Codex' : 'Claude Code'
}

export function toolIcon(tool: string): string {
  return tool === 'codex' ? 'CX' : 'CC'
}

// Repo helpers
export function repoName(repoPath: string): string {
  const parts = repoPath.split('/')
  return parts[parts.length - 1] || repoPath
}

// Run status helpers
export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'queued': return 'Queued'
    case 'starting': return 'Starting'
    case 'running': return 'Running'
    case 'success': return 'Success'
    case 'failed': return 'Failed'
    case 'interrupted': return 'Interrupted'
  }
}

export function runStatusColor(status: RunStatus): string {
  switch (status) {
    case 'queued': return '#565f89'
    case 'starting': return '#e0af68'
    case 'running': return '#7aa2f7'
    case 'success': return '#9ece6a'
    case 'failed': return '#f7768e'
    case 'interrupted': return '#565f89'
  }
}

// Task status helpers
export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending': return 'Pending'
    case 'dispatched': return 'Dispatched'
    case 'running': return 'Running'
    case 'waiting': return 'Waiting'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
  }
}

export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'pending': return '#565f89'
    case 'dispatched': return '#e0af68'
    case 'running': return '#7aa2f7'
    case 'waiting': return '#e0af68'
    case 'completed': return '#9ece6a'
    case 'failed': return '#f7768e'
  }
}

export function isTaskActive(status: TaskStatus): boolean {
  return status === 'dispatched' || status === 'running' || status === 'waiting'
}

// Image attachments
export const MAX_ATTACHMENTS = 4
