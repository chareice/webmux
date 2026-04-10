export interface MachineInfo {
  id: string
  name: string
  os: string
  home_dir: string
}

export interface TerminalInfo {
  id: string
  machine_id: string
  title: string
  cwd: string
  cols: number
  rows: number
}

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
}
