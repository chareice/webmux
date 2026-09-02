//! The agent as a user service. The mechanics live in
//! `offdesk_protocol::service`, shared with the hub; this is the agent's
//! description of itself plus the same verbs it has always exposed.

use offdesk_protocol::service::{self as shared, ServiceSpec};

pub const SERVICE_NAME: &str = "offdesk-node";

fn spec(machine_name: &str) -> ServiceSpec {
    ServiceSpec {
        name: SERVICE_NAME,
        label: "dev.offdesk.node",
        description: format!("offdesk Node ({machine_name})"),
        args: vec!["start".to_string()],
    }
}

/// The name only matters for the unit's description; anything else asked by
/// name — status, restart — does not need it.
fn anonymous() -> ServiceSpec {
    spec("machine")
}

pub fn install(name: &str, _no_auto_upgrade: bool) -> Result<(), String> {
    shared::install(&spec(name))
}

pub fn uninstall() -> Result<(), String> {
    shared::uninstall(&anonymous())
}

pub fn restart() -> Result<(), String> {
    shared::restart(&anonymous())
}

pub fn status() {
    shared::status(&anonymous())
}

pub fn is_active() -> Option<String> {
    shared::is_active(&anonymous())
}

pub fn service_file_path(home_dir: &str) -> String {
    shared::service_file_path(&anonymous(), home_dir)
}
