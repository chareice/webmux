use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tc_protocol::{DiskInfo, ResourceStats};

pub const MAX_SILENT_STATS_INTERVALS: u8 = 6;

pub struct StatsCollector {
    system: System,
    disks: Disks,
}

impl StatsCollector {
    pub fn new() -> Self {
        let system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        let disks = Disks::new_with_refreshed_list();
        Self { system, disks }
    }

    pub fn collect(&mut self) -> ResourceStats {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.disks.refresh(true);

        let cpu_percent = self.system.global_cpu_usage();
        let memory_total = self.system.total_memory();
        let memory_used = self.system.used_memory();

        let disks: Vec<DiskInfo> = self
            .disks
            .iter()
            .filter(|d| {
                let mp = d.mount_point().to_string_lossy();
                mp == "/"
                    || mp.starts_with("/home")
                    || mp.starts_with("/mnt")
                    || mp.starts_with("/Volumes")
                    || mp.starts_with("/data")
            })
            .map(|d| DiskInfo {
                mount_point: d.mount_point().to_string_lossy().to_string(),
                total_bytes: d.total_space(),
                used_bytes: d.total_space() - d.available_space(),
            })
            .collect();

        ResourceStats {
            cpu_percent,
            memory_total,
            memory_used,
            disks,
        }
    }
}

pub fn should_emit_stats(
    previous: Option<&ResourceStats>,
    next: &ResourceStats,
    silent_intervals: u8,
) -> bool {
    let Some(previous) = previous else {
        return true;
    };

    if silent_intervals >= MAX_SILENT_STATS_INTERVALS {
        return true;
    }

    stats_changed_enough(previous, next)
}

fn stats_changed_enough(previous: &ResourceStats, next: &ResourceStats) -> bool {
    if (previous.cpu_percent - next.cpu_percent).abs() >= 1.0 {
        return true;
    }

    if previous.memory_total != next.memory_total {
        return true;
    }

    if previous.memory_used.abs_diff(next.memory_used) >= 64 * 1024 * 1024 {
        return true;
    }

    if previous.disks.len() != next.disks.len() {
        return true;
    }

    previous
        .disks
        .iter()
        .zip(next.disks.iter())
        .any(|(left, right)| {
            left.mount_point != right.mount_point
                || left.total_bytes != right.total_bytes
                || left.used_bytes.abs_diff(right.used_bytes) >= 128 * 1024 * 1024
        })
}

#[cfg(test)]
mod tests {
    use super::{should_emit_stats, MAX_SILENT_STATS_INTERVALS};
    use tc_protocol::{DiskInfo, ResourceStats};

    fn stats(cpu_percent: f32, memory_used: u64, disk_used: u64) -> ResourceStats {
        ResourceStats {
            cpu_percent,
            memory_total: 1024 * 1024 * 1024,
            memory_used,
            disks: vec![DiskInfo {
                mount_point: "/".to_string(),
                total_bytes: 2 * 1024 * 1024 * 1024,
                used_bytes: disk_used,
            }],
        }
    }

    #[test]
    fn first_stats_sample_is_always_emitted() {
        assert!(should_emit_stats(None, &stats(10.0, 512, 1024), 0));
    }

    #[test]
    fn small_changes_are_suppressed_before_keepalive_interval() {
        assert!(!should_emit_stats(
            Some(&stats(10.0, 512, 1024)),
            &stats(10.4, 512 + 1024, 1024 + 1024),
            2,
        ));
    }

    #[test]
    fn keepalive_interval_forces_a_stats_emit() {
        assert!(should_emit_stats(
            Some(&stats(10.0, 512, 1024)),
            &stats(10.1, 512 + 1024, 1024 + 1024),
            MAX_SILENT_STATS_INTERVALS,
        ));
    }

    #[test]
    fn significant_resource_changes_are_emitted_immediately() {
        assert!(should_emit_stats(
            Some(&stats(10.0, 512, 1024)),
            &stats(12.0, 512, 1024),
            0,
        ));
        assert!(should_emit_stats(
            Some(&stats(10.0, 512, 1024)),
            &stats(10.0, 512 + 64 * 1024 * 1024, 1024),
            0,
        ));
        assert!(should_emit_stats(
            Some(&stats(10.0, 512, 1024)),
            &stats(10.0, 512, 1024 + 128 * 1024 * 1024),
            0,
        ));
    }
}
