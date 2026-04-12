use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};
use tc_protocol::{DiskInfo, ResourceStats};

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
