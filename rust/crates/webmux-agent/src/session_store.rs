use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::OpenFlags;
use serde::Deserialize;

use webmux_shared::{ImportableSessionSummary, RunTool};

const MAX_IMPORTABLE_SESSIONS: usize = 30;
const CODEX_DB_PREFIX: &str = "state_";
const CODEX_DB_SUFFIX: &str = ".sqlite";

#[derive(Debug, Clone)]
struct SessionStoreRoots {
    codex_root: PathBuf,
    claude_root: PathBuf,
}

impl SessionStoreRoots {
    fn from_home(home: &Path) -> Self {
        Self {
            codex_root: home.join(".codex"),
            claude_root: home.join(".claude"),
        }
    }
}

#[derive(Debug)]
struct CodexSessionRow {
    id: String,
    cwd: String,
    title: String,
    first_user_message: String,
    updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionsIndex {
    entries: Vec<ClaudeSessionIndexEntry>,
    original_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionIndexEntry {
    session_id: String,
    file_mtime: Option<i64>,
    first_prompt: Option<String>,
    summary: Option<String>,
    project_path: Option<String>,
    is_sidechain: Option<bool>,
}

pub fn list_importable_sessions(
    tool: &RunTool,
    repo_path: &str,
) -> Result<Vec<ImportableSessionSummary>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    let roots = SessionStoreRoots::from_home(&home);
    list_importable_sessions_with_roots(tool, repo_path, &roots)
}

fn list_importable_sessions_with_roots(
    tool: &RunTool,
    repo_path: &str,
    roots: &SessionStoreRoots,
) -> Result<Vec<ImportableSessionSummary>, String> {
    let normalized_repo_path = normalize_path(repo_path);
    match tool {
        RunTool::Codex => list_codex_sessions(&normalized_repo_path, &roots.codex_root),
        RunTool::Claude => list_claude_sessions(&normalized_repo_path, &roots.claude_root),
    }
}

fn list_codex_sessions(
    normalized_repo_path: &Path,
    codex_root: &Path,
) -> Result<Vec<ImportableSessionSummary>, String> {
    let Some(db_path) = find_latest_codex_state_db(codex_root) else {
        return Ok(Vec::new());
    };

    let conn = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open Codex session database: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, cwd, title, first_user_message, updated_at
             FROM threads
             WHERE archived = 0
             ORDER BY updated_at DESC
             LIMIT 200",
        )
        .map_err(|e| format!("Failed to read Codex sessions: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CodexSessionRow {
                id: row.get("id")?,
                cwd: row.get("cwd")?,
                title: row.get("title")?,
                first_user_message: row.get("first_user_message")?,
                updated_at: row.get("updated_at")?,
            })
        })
        .map_err(|e| format!("Failed to query Codex sessions: {e}"))?;

    let mut sessions = Vec::new();
    for row in rows {
        let row = row.map_err(|e| format!("Failed to decode Codex session: {e}"))?;
        let normalized_cwd = normalize_path(&row.cwd);
        if normalized_cwd != normalized_repo_path {
            continue;
        }

        let title = choose_display_title(&row.title, &row.first_user_message, &row.id);
        let subtitle = choose_subtitle(Some(&row.first_user_message), &title);

        sessions.push(ImportableSessionSummary {
            id: row.id,
            title,
            subtitle,
            repo_path: row.cwd,
            updated_at: normalize_unix_timestamp(row.updated_at) as f64,
        });
    }

    sessions.sort_by(|left, right| {
        right
            .updated_at
            .partial_cmp(&left.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sessions.truncate(MAX_IMPORTABLE_SESSIONS);
    Ok(sessions)
}

fn list_claude_sessions(
    normalized_repo_path: &Path,
    claude_root: &Path,
) -> Result<Vec<ImportableSessionSummary>, String> {
    let projects_root = claude_root.join("projects");
    if !projects_root.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    let entries = fs::read_dir(&projects_root)
        .map_err(|e| format!("Failed to read Claude projects directory: {e}"))?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let index_path = entry.path().join("sessions-index.json");
        if !index_path.is_file() {
            continue;
        }

        let raw = match fs::read_to_string(&index_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let index: ClaudeSessionsIndex = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for item in index.entries {
            if item.is_sidechain.unwrap_or(false) {
                continue;
            }

            let project_path = item
                .project_path
                .clone()
                .or_else(|| index.original_path.clone())
                .unwrap_or_default();
            if project_path.is_empty() || normalize_path(&project_path) != normalized_repo_path {
                continue;
            }

            let first_prompt = item.first_prompt.unwrap_or_default();
            let title = choose_display_title(
                item.summary.as_deref().unwrap_or_default(),
                &first_prompt,
                &item.session_id,
            );
            let subtitle = choose_subtitle(Some(&first_prompt), &title);

            sessions.push(ImportableSessionSummary {
                id: item.session_id,
                title,
                subtitle,
                repo_path: project_path,
                updated_at: item.file_mtime.unwrap_or_default() as f64,
            });
        }
    }

    sessions.sort_by(|left, right| {
        right
            .updated_at
            .partial_cmp(&left.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sessions.truncate(MAX_IMPORTABLE_SESSIONS);
    Ok(sessions)
}

fn choose_display_title(primary: &str, secondary: &str, fallback: &str) -> String {
    let primary = primary.trim();
    if !primary.is_empty() && !primary.eq_ignore_ascii_case("No prompt") {
        return primary.to_string();
    }

    let secondary = secondary.trim();
    if !secondary.is_empty() && !secondary.eq_ignore_ascii_case("No prompt") {
        return secondary.to_string();
    }

    fallback.to_string()
}

fn choose_subtitle(candidate: Option<&str>, title: &str) -> Option<String> {
    let text = candidate.unwrap_or_default().trim();
    if text.is_empty() || text.eq_ignore_ascii_case("No prompt") || text == title {
        return None;
    }
    Some(text.to_string())
}

fn normalize_path(path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if let Ok(value) = candidate.canonicalize() {
        return value;
    }
    candidate
}

fn normalize_unix_timestamp(value: i64) -> i64 {
    if value > 0 && value < 10_000_000_000 {
        value * 1000
    } else {
        value
    }
}

fn find_latest_codex_state_db(codex_root: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let entries = fs::read_dir(codex_root).ok()?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !path.is_file()
            || !file_name.starts_with(CODEX_DB_PREFIX)
            || !file_name.ends_with(CODEX_DB_SUFFIX)
        {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        match &best {
            Some((current_modified, _)) if &modified <= current_modified => {}
            _ => best = Some((modified, path)),
        }
    }

    best.map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    #[test]
    fn lists_codex_sessions_for_selected_repo() {
        let temp = tempdir().unwrap();
        let codex_root = temp.path().join(".codex");
        fs::create_dir_all(&codex_root).unwrap();
        let db_path = codex_root.join("state_5.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                first_user_message TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, cwd, title, first_user_message, updated_at, archived)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![
                "thread-1",
                "/repo/one",
                "Fix import flow",
                "Continue the previous session",
                1_764_215_046_i64,
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, cwd, title, first_user_message, updated_at, archived)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![
                "thread-2",
                "/repo/two",
                "Other repo",
                "Ignore me",
                1_764_215_050_i64,
            ],
        )
        .unwrap();

        let roots = SessionStoreRoots {
            codex_root,
            claude_root: temp.path().join(".claude"),
        };

        let sessions =
            list_importable_sessions_with_roots(&RunTool::Codex, "/repo/one", &roots).unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "thread-1");
        assert_eq!(sessions[0].title, "Fix import flow");
        assert_eq!(
            sessions[0].subtitle.as_deref(),
            Some("Continue the previous session")
        );
        assert_eq!(sessions[0].updated_at as i64, 1_764_215_046_000);
    }

    #[test]
    fn lists_claude_sessions_from_index() {
        let temp = tempdir().unwrap();
        let project_root = temp.path().join(".claude").join("projects").join("encoded-project");
        fs::create_dir_all(&project_root).unwrap();
        fs::write(
            project_root.join("sessions-index.json"),
            r#"{
              "version": 1,
              "originalPath": "/repo/one",
              "entries": [
                {
                  "sessionId": "claude-1",
                  "fileMtime": 1764215046000,
                  "firstPrompt": "Investigate the flaky release build",
                  "summary": "Release build triage",
                  "projectPath": "/repo/one",
                  "isSidechain": false
                },
                {
                  "sessionId": "claude-2",
                  "fileMtime": 1764215047000,
                  "firstPrompt": "Ignore this",
                  "summary": "Wrong repo",
                  "projectPath": "/repo/two",
                  "isSidechain": false
                }
              ]
            }"#,
        )
        .unwrap();

        let roots = SessionStoreRoots {
            codex_root: temp.path().join(".codex"),
            claude_root: temp.path().join(".claude"),
        };

        let sessions =
            list_importable_sessions_with_roots(&RunTool::Claude, "/repo/one", &roots).unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "claude-1");
        assert_eq!(sessions[0].title, "Release build triage");
        assert_eq!(
            sessions[0].subtitle.as_deref(),
            Some("Investigate the flaky release build")
        );
    }
}
