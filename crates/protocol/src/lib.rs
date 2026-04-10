use serde::{Deserialize, Serialize};

// ── Shared data types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineInfo {
    pub id: String,
    pub name: String,
    pub os: String,
    pub home_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub machine_id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
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
    AuthResult {
        ok: bool,
        message: Option<String>,
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
    ExistingTerminals {
        terminals: Vec<TerminalInfo>,
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
    #[serde(rename = "terminal_destroyed")]
    TerminalDestroyed {
        machine_id: String,
        terminal_id: String,
    },
}
