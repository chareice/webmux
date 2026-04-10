import type { TerminalInfo, DirEntry, MachineInfo } from './types'

export function getDeviceId(): string {
  let id = sessionStorage.getItem('tc-device-id')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('tc-device-id', id)
  }
  return id
}

export async function listMachines(): Promise<MachineInfo[]> {
  const res = await fetch('/api/machines')
  return res.json()
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await fetch('/api/terminals')
  return res.json()
}

export async function createTerminal(machineId: string, cwd: string): Promise<TerminalInfo> {
  const res = await fetch(`/api/machines/${machineId}/terminals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, cols: 80, rows: 24 }),
  })
  return res.json()
}

export async function destroyTerminal(machineId: string, terminalId: string): Promise<void> {
  await fetch(`/api/machines/${machineId}/terminals/${terminalId}`, { method: 'DELETE' })
}

export async function listDirectory(machineId: string, path: string): Promise<DirEntry[]> {
  const res = await fetch(`/api/machines/${machineId}/fs/list?path=${encodeURIComponent(path)}`)
  return res.json()
}

export async function getMode(): Promise<{ controller_device_id: string | null }> {
  const res = await fetch('/api/mode')
  return res.json()
}

export async function requestControl(deviceId: string): Promise<void> {
  await fetch('/api/mode/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
}

export async function releaseControl(deviceId: string): Promise<void> {
  await fetch('/api/mode/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
}

export function terminalWsUrl(machineId: string, terminalId: string, deviceId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/terminal/${machineId}/${terminalId}?device_id=${deviceId}`
}

export function eventsWsUrl(deviceId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/events?device_id=${deviceId}`
}
