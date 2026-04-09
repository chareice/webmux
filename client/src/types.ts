export interface TerminalInfo {
  id: string
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
