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
    #[serde(default = "default_reachable")]
    pub reachable: bool,
}

fn default_reachable() -> bool {
    true
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
#[serde(tag = "status", rename_all = "snake_case")]
pub enum NativeZellijStatus {
    Ready {
        session_name: String,
        session_path: String,
        base_url: String,
        login_token: String,
    },
    Unavailable {
        reason: NativeZellijUnavailableReason,
        instructions: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NativeZellijUnavailableReason {
    MissingBinary,
    PublicBaseUrlMissing,
    MissingTlsConfig,
    WebClientUnavailable,
    WebServerStartFailed,
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
    #[serde(rename = "fs_list")]
    FsListDir { request_id: String, path: String },
    #[serde(rename = "auth_result")]
    AuthResult { ok: bool, message: Option<String> },
    #[serde(rename = "check_foreground_process")]
    CheckForegroundProcess {
        request_id: String,
        terminal_id: String,
    },
    #[serde(rename = "open_attach")]
    OpenAttach {
        attach_id: String,
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "close_attach")]
    CloseAttach { attach_id: String },
    #[serde(rename = "attach_input")]
    AttachInput { attach_id: String, data: String },
    #[serde(rename = "attach_resize")]
    AttachResize {
        attach_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "attach_image_paste")]
    AttachImagePaste {
        attach_id: String,
        data: String,
        mime: String,
        filename: String,
    },
    #[serde(rename = "ensure_native_zellij")]
    EnsureNativeZellij { request_id: String, user_id: String },
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
    #[serde(rename = "attach_died")]
    AttachDied { attach_id: String, reason: String },
    #[serde(rename = "terminal_died")]
    TerminalDied { terminal_id: String, reason: String },
    #[serde(rename = "terminal_resized")]
    TerminalResized {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "native_zellij_ready")]
    NativeZellijReady {
        request_id: String,
        status: NativeZellijStatus,
    },
    #[serde(rename = "native_zellij_error")]
    NativeZellijError { request_id: String, error: String },
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
    #[serde(rename = "terminal_reachable_changed")]
    TerminalReachableChanged {
        machine_id: String,
        terminal_id: String,
        reachable: bool,
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

/// Magic byte at the head of every per-attach binary frame. Originally
/// added to disambiguate from the legacy `encode_terminal_output_frame`
/// during the migration window; that codec is gone now, but the magic
/// byte stays as a forward-compatible discriminator (any future binary
/// frame variants get a different magic and dispatch trivially).
const ATTACH_FRAME_MAGIC: u8 = 0x01;

pub fn encode_attach_output_frame(attach_id: &str, data: &[u8]) -> Vec<u8> {
    let attach_id_bytes = attach_id.as_bytes();
    let attach_id_len: u16 = attach_id_bytes
        .len()
        .try_into()
        .expect("attach_id is too long to encode");

    let mut frame = Vec::with_capacity(1 + 2 + attach_id_bytes.len() + data.len());
    frame.push(ATTACH_FRAME_MAGIC);
    frame.extend_from_slice(&attach_id_len.to_be_bytes());
    frame.extend_from_slice(attach_id_bytes);
    frame.extend_from_slice(data);
    frame
}

pub fn decode_attach_output_frame(frame: &[u8]) -> Result<(String, Bytes), String> {
    if frame.is_empty() {
        return Err("frame is empty".to_string());
    }
    if frame[0] != ATTACH_FRAME_MAGIC {
        return Err(format!("frame magic is 0x{:02x}, expected attach", frame[0]));
    }
    let body = &frame[1..];
    if body.len() < 2 {
        return Err("frame is missing attach id length".to_string());
    }
    let attach_id_len = u16::from_be_bytes([body[0], body[1]]) as usize;
    if body.len() < 2 + attach_id_len {
        return Err("frame is truncated".to_string());
    }
    let attach_id = std::str::from_utf8(&body[2..2 + attach_id_len])
        .map_err(|error| format!("attach id is not valid utf-8: {error}"))?
        .to_string();
    Ok((attach_id, Bytes::copy_from_slice(&body[2 + attach_id_len..])))
}

#[cfg(test)]
mod tests {
    use super::{
        decode_attach_output_frame, encode_attach_output_frame, NativeZellijStatus,
        NativeZellijUnavailableReason,
    };

    #[test]
    fn attach_output_frame_round_trips_without_loss() {
        let frame = encode_attach_output_frame("attach-x", b"\x1b[38;5;246mhello\x00\xff");
        let (attach_id, payload) = decode_attach_output_frame(&frame).unwrap();
        assert_eq!(attach_id, "attach-x");
        assert_eq!(payload.as_ref(), b"\x1b[38;5;246mhello\x00\xff");
    }

    #[test]
    fn attach_output_frame_rejects_truncated_payloads() {
        // 0x01 magic + truncated body
        let error = decode_attach_output_frame(&[0x01, 0, 10, b't']).unwrap_err();
        assert!(error.contains("truncated"));
    }

    #[test]
    fn attach_output_frame_rejects_wrong_magic() {
        // A frame starting with anything other than 0x01 isn't ours.
        let bad = [0xff_u8, 0, 4, b't', b'e', b's', b't'];
        assert!(decode_attach_output_frame(&bad).is_err());
    }

    #[test]
    fn native_zellij_status_serializes_missing_binary_reason() {
        let status = NativeZellijStatus::Unavailable {
            reason: NativeZellijUnavailableReason::MissingBinary,
            instructions: "Install zellij".to_string(),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"status\":\"unavailable\""));
        assert!(json.contains("\"reason\":\"missing_binary\""));
    }
}
