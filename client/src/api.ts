import type { TerminalInfo, DirEntry } from './types'

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await fetch('/api/terminals')
  return res.json()
}

export async function createTerminal(cwd: string): Promise<TerminalInfo> {
  const res = await fetch('/api/terminals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, cols: 80, rows: 24 }),
  })
  return res.json()
}

export async function destroyTerminal(id: string): Promise<void> {
  await fetch(`/api/terminals/${id}`, { method: 'DELETE' })
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  await fetch(`/api/terminals/${id}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  })
}

export async function listDirectory(path: string): Promise<DirEntry[]> {
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`)
  return res.json()
}

export function terminalWsUrl(id: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/terminal/${id}`
}
