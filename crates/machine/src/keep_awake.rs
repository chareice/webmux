#[cfg(target_os = "macos")]
use std::process::{Child, Command, Stdio};

/// Keeps the macOS idle-sleep assertion alive for as long as this value lives.
///
/// `caffeinate -w` also watches the node PID, so the assertion is released when
/// the node is terminated in a way that does not run Rust destructors.
#[must_use = "dropping the guard releases the idle-sleep assertion"]
pub struct KeepAwakeGuard {
    #[cfg(target_os = "macos")]
    caffeinate: Child,
}

/// Prevent idle system sleep while the node is running.
///
/// Other platforms deliberately return `None`; this setting is macOS-only.
/// Display sleep, explicit sleep, lid-close sleep, and low-battery sleep are
/// not affected by the idle-sleep assertion.
pub fn prevent_idle_sleep(enabled: bool) -> Result<Option<KeepAwakeGuard>, String> {
    if !enabled {
        return Ok(None);
    }

    #[cfg(target_os = "macos")]
    {
        let args = caffeinate_arguments(std::process::id());
        let mut caffeinate = Command::new("/usr/bin/caffeinate")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("failed to start /usr/bin/caffeinate: {error}"))?;

        match caffeinate.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "/usr/bin/caffeinate exited before acquiring the idle-sleep assertion: {status}"
                ));
            }
            Ok(None) => {}
            Err(error) => {
                let _ = caffeinate.kill();
                let _ = caffeinate.wait();
                return Err(format!("failed to check /usr/bin/caffeinate: {error}"));
            }
        }

        Ok(Some(KeepAwakeGuard { caffeinate }))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

#[cfg(any(target_os = "macos", test))]
fn caffeinate_arguments(pid: u32) -> [String; 3] {
    ["-i".to_string(), "-w".to_string(), pid.to_string()]
}

impl Drop for KeepAwakeGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            let _ = self.caffeinate.kill();
            let _ = self.caffeinate.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caffeinate_prevents_idle_sleep_until_the_node_pid_exits() {
        assert_eq!(
            caffeinate_arguments(42),
            ["-i".to_string(), "-w".to_string(), "42".to_string()]
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn unsupported_platforms_do_not_create_a_guard() {
        assert!(prevent_idle_sleep(true).unwrap().is_none());
    }

    #[test]
    fn disabled_setting_does_not_create_a_guard() {
        assert!(prevent_idle_sleep(false).unwrap().is_none());
    }
}
