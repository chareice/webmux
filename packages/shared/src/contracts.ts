// ── Shared data types (mirrors tc-protocol Rust types) ──

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

export interface DiskInfo {
  mount_point: string
  total_bytes: number
  used_bytes: number
}

export interface MachineStatsSnapshot {
  machine_id: string
  stats: ResourceStats
}

export interface ControlLeaseSnapshot {
  machine_id: string
  controller_device_id: string | null
}

export interface BrowserStateSnapshot {
  snapshot_seq: number
  machines: MachineInfo[]
  terminals: TerminalInfo[]
  machine_stats: MachineStatsSnapshot[]
  control_leases: ControlLeaseSnapshot[]
}

export interface ResourceStats {
  cpu_percent: number
  memory_total: number
  memory_used: number
  disks: DiskInfo[]
}

// ── Hub → Machine messages (discriminated union on "type") ──

export type HubToMachine =
  | HubToMachine.CreateTerminal
  | HubToMachine.DestroyTerminal
  | HubToMachine.TerminalInput
  | HubToMachine.TerminalResize
  | HubToMachine.FsListDir
  | HubToMachine.ImagePaste
  | HubToMachine.Ping

export namespace HubToMachine {
  export interface CreateTerminal {
    type: 'create_terminal'
    request_id: string
    cwd: string
    cols: number
    rows: number
  }

  export interface DestroyTerminal {
    type: 'destroy_terminal'
    terminal_id: string
  }

  export interface TerminalInput {
    type: 'terminal_input'
    terminal_id: string
    data: string
  }

  export interface TerminalResize {
    type: 'terminal_resize'
    terminal_id: string
    cols: number
    rows: number
  }

  export interface FsListDir {
    type: 'fs_list'
    request_id: string
    path: string
  }

  export interface ImagePaste {
    type: 'image_paste'
    terminal_id: string
    /** Base64-encoded image data */
    data: string
    /** MIME type (e.g. "image/png") */
    mime: string
    /** Suggested filename */
    filename: string
  }

  export interface Ping {
    type: 'ping'
  }
}

// ── Machine → Hub messages (discriminated union on "type") ──

export type MachineToHub =
  | MachineToHub.Register
  | MachineToHub.TerminalCreated
  | MachineToHub.TerminalCreateError
  | MachineToHub.TerminalDestroyed
  | MachineToHub.TerminalOutput
  | MachineToHub.FsListResult
  | MachineToHub.FsListError
  | MachineToHub.ResourceStatsMessage
  | MachineToHub.Pong

export namespace MachineToHub {
  export interface Register {
    type: 'register'
    machine_id: string
    name: string
    os: string
    home_dir: string
  }

  export interface TerminalCreated {
    type: 'terminal_created'
    request_id: string
    terminal_id: string
    title: string
    cwd: string
    cols: number
    rows: number
  }

  export interface TerminalCreateError {
    type: 'terminal_create_error'
    request_id: string
    error: string
  }

  export interface TerminalDestroyed {
    type: 'terminal_destroyed'
    terminal_id: string
  }

  export interface TerminalOutput {
    type: 'terminal_output'
    terminal_id: string
    data: string
  }

  export interface FsListResult {
    type: 'fs_list_result'
    request_id: string
    entries: DirEntry[]
  }

  export interface FsListError {
    type: 'fs_list_error'
    request_id: string
    error: string
  }

  export interface ResourceStatsMessage {
    type: 'resource_stats'
    stats: ResourceStats
  }

  export interface Pong {
    type: 'pong'
  }
}

// ── Browser-facing events (Hub → Browser via events WebSocket) ──

export type BrowserEvent =
  | BrowserEvent.MachineOnline
  | BrowserEvent.MachineOffline
  | BrowserEvent.TerminalCreated
  | BrowserEvent.TerminalResized
  | BrowserEvent.TerminalDestroyed
  | BrowserEvent.MachineStats
  | BrowserEvent.ModeChanged

export namespace BrowserEvent {
  export interface MachineOnline {
    type: 'machine_online'
    machine: MachineInfo
  }

  export interface MachineOffline {
    type: 'machine_offline'
    machine_id: string
  }

  export interface TerminalCreated {
    type: 'terminal_created'
    terminal: TerminalInfo
  }

  export interface TerminalResized {
    type: 'terminal_resized'
    terminal: TerminalInfo
  }

  export interface TerminalDestroyed {
    type: 'terminal_destroyed'
    machine_id: string
    terminal_id: string
  }

  export interface MachineStats {
    type: 'machine_stats'
    machine_id: string
    stats: ResourceStats
  }

  export interface ModeChanged {
    type: 'mode_changed'
    machine_id: string
    controller_device_id: string | null
  }
}

export interface BrowserEventEnvelope {
  seq: number
  event: BrowserEvent
}

// ── Auth / persistence types (not in Rust yet) ──

export interface User {
  id: string
  displayName: string
  avatarUrl: string | null
  role: string
}

export interface Bookmark {
  id: string
  machineId: string
  path: string
  label: string
  sortOrder: number
}

export interface LoginResponse {
  token: string
}

export interface CreateRegistrationTokenResponse {
  token: string
  expires_at: number
}

export interface RegisterMachineResponse {
  machineId: string
  machineSecret: string
}
