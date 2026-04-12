use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineConfig {
    pub machine_id: String,
    pub machine_secret: String,
    pub hub_url: String,
}

/// Get the config file path: ~/.config/webmux/machine.json
pub fn config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("webmux");
    config_dir.join("machine.json")
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
