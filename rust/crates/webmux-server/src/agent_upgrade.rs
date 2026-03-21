use webmux_shared::AgentUpgradePolicy;

/// Options for building an agent upgrade policy from environment variables.
pub struct AgentUpgradePolicyOptions {
    pub package_name: Option<String>,
    pub target_version: Option<String>,
    pub minimum_version: Option<String>,
}

/// Build an agent upgrade policy from configuration.
/// Returns None if no target or minimum version is set.
pub fn build_agent_upgrade_policy(
    options: &AgentUpgradePolicyOptions,
) -> Result<Option<AgentUpgradePolicy>, String> {
    let package_name = options
        .package_name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("@webmux/agent")
        .to_string();

    let target_version = normalize_version_option(options.target_version.as_deref());
    let minimum_version = normalize_version_option(options.minimum_version.as_deref());

    if target_version.is_none() && minimum_version.is_none() {
        return Ok(None);
    }

    if let Some(ref tv) = target_version {
        if !is_valid_semver(tv) {
            return Err(format!("Invalid WEBMUX_AGENT_TARGET_VERSION: {}", tv));
        }
    }

    if let Some(ref mv) = minimum_version {
        if !is_valid_semver(mv) {
            return Err(format!("Invalid WEBMUX_AGENT_MIN_VERSION: {}", mv));
        }
    }

    if let (Some(tv), Some(mv)) = (&target_version, &minimum_version) {
        if compare_semver(tv, mv) < 0 {
            return Err(
                "WEBMUX_AGENT_TARGET_VERSION cannot be lower than WEBMUX_AGENT_MIN_VERSION"
                    .to_string(),
            );
        }
    }

    Ok(Some(AgentUpgradePolicy {
        package_name,
        target_version,
        minimum_version,
    }))
}

/// Describe why an agent version is below the minimum.
pub fn describe_minimum_version_failure(
    current_version: Option<&str>,
    upgrade_policy: &AgentUpgradePolicy,
) -> String {
    let current_label = current_version.unwrap_or("unknown");
    let minimum_version = upgrade_policy
        .minimum_version
        .as_deref()
        .unwrap_or("unknown");

    if let Some(ref target) = upgrade_policy.target_version {
        format!(
            "Agent version {} is below the minimum supported version {}. Upgrade to {} or newer.",
            current_label, minimum_version, target
        )
    } else {
        format!(
            "Agent version {} is below the minimum supported version {}.",
            current_label, minimum_version
        )
    }
}

fn normalize_version_option(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn is_valid_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|p| p.parse::<u32>().is_ok())
}

fn compare_semver(a: &str, b: &str) -> i32 {
    let parse = |s: &str| -> (u32, u32, u32) {
        let parts: Vec<u32> = s.split('.').filter_map(|p| p.parse().ok()).collect();
        if parts.len() == 3 {
            (parts[0], parts[1], parts[2])
        } else {
            (0, 0, 0)
        }
    };

    let (a_major, a_minor, a_patch) = parse(a);
    let (b_major, b_minor, b_patch) = parse(b);

    if a_major != b_major {
        return a_major as i32 - b_major as i32;
    }
    if a_minor != b_minor {
        return a_minor as i32 - b_minor as i32;
    }
    a_patch as i32 - b_patch as i32
}
