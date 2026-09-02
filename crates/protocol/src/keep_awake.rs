//! Keeping the machine awake while an offdesk process runs.
//!
//! A hub whose host has gone to sleep is a hub that is down; a machine whose
//! host has gone to sleep is a terminal nobody can reach. On macOS the fix is
//! `caffeinate -i`, which asserts that the system must not idle-sleep. `-w
//! <pid>` ties the assertion to our process, so it is released even if we die
//! without running destructors. Display sleep, lid-close sleep, explicit sleep
//! and low-battery sleep are unaffected — this only stops the machine from
//! nodding off on its own.
//!
//! Other platforms are a no-op: Linux servers do not idle-sleep by default,
//! and laptops running one of these are told so.

#[cfg(target_os = "macos")]
use std::process::{Child, Command, Stdio};

/// Holds the idle-sleep assertion for as long as it lives.
#[must_use = "dropping the guard releases the idle-sleep assertion"]
pub struct KeepAwakeGuard {
    #[cfg(target_os = "macos")]
    caffeinate: Child,
}

/// What happened when we asked.
#[derive(Debug, PartialEq, Eq)]
pub enum KeepAwake {
    /// The machine will stay awake while this process runs.
    Held,
    /// This platform has nothing to hold.
    Unsupported,
}

/// Keep the machine from idle-sleeping while this process runs.
pub fn prevent_idle_sleep() -> Result<(Option<KeepAwakeGuard>, KeepAwake), String> {
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
            Ok(None) => {}
            Ok(Some(status)) => {
                return Err(format!(
                    "/usr/bin/caffeinate exited before taking the idle-sleep assertion: {status}"
                ))
            }
            Err(error) => {
                let _ = caffeinate.kill();
                let _ = caffeinate.wait();
                return Err(format!("failed to check /usr/bin/caffeinate: {error}"));
            }
        }
        Ok((Some(KeepAwakeGuard { caffeinate }), KeepAwake::Held))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok((None, KeepAwake::Unsupported))
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
    fn the_assertion_is_tied_to_our_pid() {
        assert_eq!(
            caffeinate_arguments(42),
            ["-i".to_string(), "-w".to_string(), "42".to_string()]
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn elsewhere_there_is_nothing_to_hold() {
        let (guard, outcome) = prevent_idle_sleep().unwrap();
        assert!(guard.is_none());
        assert_eq!(outcome, KeepAwake::Unsupported);
    }
}
