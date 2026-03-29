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
  return tool === 'codex' ? 'Codex' : 'Claude'
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
    case 'queued': return '#9a9a9a'
    case 'starting': return '#6b6b6b'
    case 'running': return '#1a1a1a'
    case 'success': return '#1a1a1a'
    case 'failed': return '#b44444'
    case 'interrupted': return '#9a9a9a'
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
    case 'pending': return '#9a9a9a'
    case 'dispatched': return '#6b6b6b'
    case 'running': return '#1a1a1a'
    case 'waiting': return '#6b6b6b'
    case 'completed': return '#1a1a1a'
    case 'failed': return '#b44444'
  }
}

export function isTaskActive(status: TaskStatus): boolean {
  return status === 'dispatched' || status === 'running' || status === 'waiting'
}

// Image attachments
export const MAX_ATTACHMENTS = 4
