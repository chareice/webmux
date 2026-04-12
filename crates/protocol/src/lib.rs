use bytes::Bytes;
use serde::{Deserialize, Serialize};

// ── Shared data types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MachineInfo {
    pub id: String,
    pub name: String,
    pub os: String,
    pub home_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerminalInfo {
    pub id: String,
    pub machine_id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceStats {
    /// CPU usage percentage (0.0 - 100.0), averaged across all cores
    pub cpu_percent: f32,
    /// Total physical memory in bytes
    pub memory_total: u64,
    /// Used physical memory in bytes
    pub memory_used: u64,
    /// Disk info
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MachineStatsSnapshot {
    pub machine_id: String,
    pub stats: ResourceStats,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ControlLeaseSnapshot {
    pub machine_id: String,
    pub controller_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserStateSnapshot {
    pub snapshot_seq: u64,
    pub machines: Vec<MachineInfo>,
    pub terminals: Vec<TerminalInfo>,
    pub machine_stats: Vec<MachineStatsSnapshot>,
    pub control_leases: Vec<ControlLeaseSnapshot>,
}

// ── Hub → Machine messages ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum HubToMachine {
    #[serde(rename = "create_terminal")]
    CreateTerminal {
        request_id: String,
        cwd: String,
        cols: u16,
        rows: u16,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        startup_command: Option<String>,
    },
    #[serde(rename = "destroy_terminal")]
    DestroyTerminal { terminal_id: String },
    #[serde(rename = "terminal_input")]
    TerminalInput { terminal_id: String, data: String },
    #[serde(rename = "terminal_resize")]
    TerminalResize {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "fs_list")]
    FsListDir { request_id: String, path: String },
    #[serde(rename = "image_paste")]
    ImagePaste {
        terminal_id: String,
        /// Base64-encoded image data
        data: String,
        /// MIME type (e.g. "image/png")
        mime: String,
        /// Suggested filename
        filename: String,
    },
    #[serde(rename = "auth_result")]
    AuthResult { ok: bool, message: Option<String> },
    #[serde(rename = "check_foreground_process")]
    CheckForegroundProcess {
        request_id: String,
        terminal_id: String,
    },
    #[serde(rename = "ping")]
    Ping,
}

// ── Machine → Hub messages ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MachineToHub {
    #[serde(rename = "register")]
    Register {
        machine_id: String,
        machine_secret: String,
        name: String,
        os: String,
        home_dir: String,
    },
    #[serde(rename = "terminal_created")]
    TerminalCreated {
        request_id: String,
        terminal_id: String,
        title: String,
        cwd: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "terminal_create_error")]
    TerminalCreateError { request_id: String, error: String },
    #[serde(rename = "terminal_destroyed")]
    TerminalDestroyed { terminal_id: String },
    #[serde(rename = "terminal_output")]
    TerminalOutput { terminal_id: String, data: String },
    #[serde(rename = "fs_list_result")]
    FsListResult {
        request_id: String,
        entries: Vec<DirEntry>,
    },
    #[serde(rename = "fs_list_error")]
    FsListError { request_id: String, error: String },
    #[serde(rename = "existing_terminals")]
    ExistingTerminals { terminals: Vec<TerminalInfo> },
    #[serde(rename = "resource_stats")]
    ResourceStats { stats: ResourceStats },
    #[serde(rename = "foreground_process_result")]
    ForegroundProcessResult {
        request_id: String,
        has_foreground_process: bool,
        process_name: Option<String>,
    },
    #[serde(rename = "pong")]
    Pong,
}

// ── Browser-facing events (Hub → Browser via events WebSocket) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BrowserEvent {
    #[serde(rename = "machine_online")]
    MachineOnline { machine: MachineInfo },
    #[serde(rename = "machine_offline")]
    MachineOffline { machine_id: String },
    #[serde(rename = "terminal_created")]
    TerminalCreated { terminal: TerminalInfo },
    #[serde(rename = "terminal_resized")]
    TerminalResized { terminal: TerminalInfo },
    #[serde(rename = "terminal_destroyed")]
    TerminalDestroyed {
        machine_id: String,
        terminal_id: String,
    },
    #[serde(rename = "machine_stats")]
    MachineStats {
        machine_id: String,
        stats: ResourceStats,
    },
    #[serde(rename = "mode_changed")]
    ModeChanged {
        machine_id: String,
        controller_device_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserEventEnvelope {
    pub seq: u64,
    pub event: BrowserEvent,
}

pub fn encode_terminal_output_frame(terminal_id: &str, data: &[u8]) -> Vec<u8> {
    let terminal_id_bytes = terminal_id.as_bytes();
    let terminal_id_len: u16 = terminal_id_bytes
        .len()
        .try_into()
        .expect("terminal_id is too long to encode");

    let mut frame = Vec::with_capacity(2 + terminal_id_bytes.len() + data.len());
    frame.extend_from_slice(&terminal_id_len.to_be_bytes());
    frame.extend_from_slice(terminal_id_bytes);
    frame.extend_from_slice(data);
    frame
}

pub fn decode_terminal_output_frame(frame: &[u8]) -> Result<(String, Bytes), String> {
    if frame.len() < 2 {
        return Err("frame is missing terminal id length".to_string());
    }

    let terminal_id_len = u16::from_be_bytes([frame[0], frame[1]]) as usize;
    if frame.len() < 2 + terminal_id_len {
        return Err("frame is truncated".to_string());
    }

    let terminal_id = std::str::from_utf8(&frame[2..2 + terminal_id_len])
        .map_err(|error| format!("terminal id is not valid utf-8: {error}"))?
        .to_string();
    Ok((terminal_id, Bytes::copy_from_slice(&frame[2 + terminal_id_len..])))
}

#[cfg(test)]
mod tests {
    use super::{decode_terminal_output_frame, encode_terminal_output_frame};

    #[test]
    fn terminal_output_frame_round_trips_without_loss() {
        let frame = encode_terminal_output_frame("term-a", b"\x1b[31mhello\x00world");
        let (terminal_id, payload) = decode_terminal_output_frame(&frame).unwrap();

        assert_eq!(terminal_id, "term-a");
        assert_eq!(payload.as_ref(), b"\x1b[31mhello\x00world");
    }

    #[test]
    fn terminal_output_frame_rejects_truncated_payloads() {
        let error = decode_terminal_output_frame(&[0, 10, b't']).unwrap_err();
        assert!(error.contains("truncated"));
    }
}
