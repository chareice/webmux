use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineConfig {
    pub machine_id: String,
    pub machine_secret: String,
    pub hub_url: String,
    /// Optional spawn-command overrides for agent sessions, keyed by agent
    /// kind ("claude" | "codex" | "grok" | "kimi"); values are argv vectors.
    /// Missing entries fall back to the built-in defaults.
    #[serde(default)]
    pub acp_agents: HashMap<String, Vec<String>>,
}

/// Get the config file path, e.g. `~/.config/offdesk/machine.json` on
/// Linux. See `offdesk_protocol::config_dir` for the macOS location and
/// the one-time move from the old `webmux` directory.
pub fn config_path() -> PathBuf {
    offdesk_protocol::config_dir().join("machine.json")
}

pub fn load_config() -> Result<MachineConfig, String> {
    let path = config_path();
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config at {}: {}", path.display(), e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
}

pub fn save_config(config: &MachineConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))?;
    tracing::info!("Config saved to {}", path.display());
    Ok(())
}
