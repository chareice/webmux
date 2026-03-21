use std::path::{Path, PathBuf};
use webmux_shared::{RepositoryBrowseResponse, RepositoryEntry, RepositoryEntryKind};

/// Browse directories under `root_path`, optionally scoped to `requested_path`.
/// Returns the list of child directories classified as either repositories
/// (contain `.git`) or plain directories.
pub async fn browse_repositories(
    root_path: &str,
    requested_path: Option<&str>,
) -> Result<RepositoryBrowseResponse, String> {
    let root = PathBuf::from(root_path).canonicalize().map_err(|e| e.to_string())?;
    let current = resolve_requested_path(&root, requested_path)?;

    let mut read_dir = tokio::fs::read_dir(&current)
        .await
        .map_err(|e| e.to_string())?;

    let mut entries: Vec<RepositoryEntry> = Vec::new();

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let metadata = entry.metadata().await.map_err(|e| e.to_string())?;
        if !metadata.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path();
        let classified = classify_entry(&entry_path, &name).await;
        entries.push(classified);
    }

    entries.sort_by(compare_repository_entries);

    let parent_path = if current == root {
        None
    } else {
        current.parent().map(|p| p.to_string_lossy().to_string())
    };

    Ok(RepositoryBrowseResponse {
        current_path: current.to_string_lossy().to_string(),
        parent_path,
        entries,
    })
}

async fn classify_entry(entry_path: &Path, name: &str) -> RepositoryEntry {
    let git_path = entry_path.join(".git");
    let kind = match tokio::fs::metadata(&git_path).await {
        Ok(meta) if meta.is_dir() || meta.is_file() => RepositoryEntryKind::Repository,
        _ => RepositoryEntryKind::Directory,
    };

    RepositoryEntry {
        name: name.to_string(),
        path: entry_path.to_string_lossy().to_string(),
        kind,
    }
}

fn resolve_requested_path(root: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let candidate = match requested {
        Some(p) => PathBuf::from(p)
            .canonicalize()
            .map_err(|e| format!("Failed to resolve requested path: {e}"))?,
        None => root.to_path_buf(),
    };

    let relative = candidate
        .strip_prefix(root)
        .map_err(|_| "Requested path is outside the allowed root".to_string())?;

    // strip_prefix succeeds for the root itself (relative is empty) and for children.
    // We additionally guard against .. segments that somehow passed canonicalize.
    let rel_str = relative.to_string_lossy();
    if !rel_str.is_empty() && rel_str.starts_with("..") {
        return Err("Requested path is outside the allowed root".to_string());
    }

    Ok(candidate)
}

fn compare_repository_entries(left: &RepositoryEntry, right: &RepositoryEntry) -> std::cmp::Ordering {
    let kind_order = |k: &RepositoryEntryKind| -> i32 {
        match k {
            RepositoryEntryKind::Repository => 0,
            RepositoryEntryKind::Directory => 1,
        }
    };

    let ko = kind_order(&left.kind).cmp(&kind_order(&right.kind));
    if ko != std::cmp::Ordering::Equal {
        return ko;
    }

    let hidden_order = |n: &str| -> i32 {
        if n.starts_with('.') {
            1
        } else {
            0
        }
    };

    let ho = hidden_order(&left.name).cmp(&hidden_order(&right.name));
    if ho != std::cmp::Ordering::Equal {
        return ho;
    }

    left.name.cmp(&right.name)
}
