use std::collections::HashMap;
use std::time::Duration;

use futures::StreamExt;
use serde_json::{json, Value};
use tc_protocol::{MachineInfo, TerminalInfo};

use super::read::ReadOptions;
use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::resolve::{resolve_prefix, short_id};
use crate::CliError;

/// What happened to one terminal in the batch.
#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    /// Screen captured and trimmed.
    Screen(String),
    /// Reachable but the capture failed (WS close, hub error frame).
    Error(String),
    /// Machine offline — never attached.
    Unreachable,
}

/// One row of the batch result: the listing entry plus its outcome.
/// `group` is the workspace group name as derived by `ls` (None when the
/// terminal is not grouped).
struct BatchEntry {
    terminal: TerminalInfo,
    group: Option<String>,
    outcome: Outcome,
}

/// Capture every terminal (optionally filtered to one machine) and print all
/// screens in REST listing order. Per-terminal failures are data, not errors:
/// only systemic failures (auth, REST down) make the batch itself fail.
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    options: ReadOptions,
) -> Result<(), CliError> {
    let mut terminals = client.terminals().await?;
    if let Some(query) = &options.machine {
        let machines = client.machines().await?;
        retain_machine(&mut terminals, &machines, query)?;
    }
    let group_names = super::fetch_group_names(client, &terminals).await?;

    let quiet = Duration::from_millis(options.quiet_ms);
    let timeout = (options.timeout_secs > 0).then(|| Duration::from_secs(options.timeout_secs));
    let concurrency = options.concurrency.max(1);

    // Attach to reachable terminals with bounded concurrency; results come
    // back unordered, so index them and re-emit in listing order.
    let mut captures: HashMap<usize, Outcome> = futures::stream::iter(
        terminals
            .iter()
            .enumerate()
            .filter(|(_, terminal)| terminal.reachable),
    )
    .map(|(index, terminal)| async move {
        let outcome = match capture_screen(config, terminal, quiet, timeout).await {
            Ok(screen) => Outcome::Screen(screen),
            Err(error) => Outcome::Error(error.to_string()),
        };
        (index, outcome)
    })
    .buffer_unordered(concurrency)
    .collect()
    .await;

    let entries: Vec<BatchEntry> = terminals
        .into_iter()
        .enumerate()
        .map(|(index, terminal)| {
            let group = super::group_label(&terminal, &group_names);
            BatchEntry {
                // Only reachable terminals were attached; a missing capture
                // outcome means the terminal was skipped as unreachable.
                outcome: captures.remove(&index).unwrap_or(Outcome::Unreachable),
                terminal,
                group,
            }
        })
        .collect();
    let skipped = entries
        .iter()
        .filter(|entry| entry.outcome == Outcome::Unreachable)
        .count();

    if options.json {
        let output = json!({ "terminals": entries.iter().map(entry_json).collect::<Vec<_>>() });
        println!("{}", super::json_pretty(&output)?);
    } else {
        let text = render_text(&entries, options.lines);
        if !text.is_empty() {
            println!("{text}");
        }
    }
    if skipped > 0 {
        eprintln!("skipped {skipped} unreachable terminals");
    }
    Ok(())
}

/// Keep only terminals on the machine resolved from `query` (id or prefix).
fn retain_machine(
    terminals: &mut Vec<TerminalInfo>,
    machines: &[MachineInfo],
    query: &str,
) -> Result<(), CliError> {
    let resolved = resolve_prefix(query, machines, |machine| machine.id.as_str())?;
    terminals.retain(|terminal| terminal.machine_id == resolved.id);
    Ok(())
}

/// Capture one reachable terminal's screen, trimmed. Reuses `attach::capture`
/// unchanged: per-terminal quiet/timeout semantics as-is.
async fn capture_screen(
    config: &ResolvedConfig,
    terminal: &TerminalInfo,
    quiet: Duration,
    timeout: Option<Duration>,
) -> Result<String, CliError> {
    let (cols, rows) = super::terminal_dimensions(terminal);
    let target = attach::Target {
        config,
        machine_id: &terminal.machine_id,
        terminal_id: &terminal.id,
        device_id: format!("cli-read-{}-{}", std::process::id(), short_id(&terminal.id)),
        cols,
        rows,
    };
    let screen = attach::capture(&target, quiet, timeout).await?;
    Ok(attach::trim_trailing_blank_lines(&screen.contents()))
}

/// `shortid · [group · ] cwd` — the shared label for text-mode rows.
fn label(entry: &BatchEntry) -> String {
    let mut parts = vec![short_id(&entry.terminal.id).to_string()];
    if let Some(group) = &entry.group {
        parts.push(group.clone());
    }
    parts.push(entry.terminal.cwd.clone());
    parts.join(" · ")
}

/// Text mode: one `== header ==` section per captured terminal and one-line
/// `-- row --` for skipped/failed ones, sections separated by a blank line.
fn render_text(entries: &[BatchEntry], lines: Option<usize>) -> String {
    let mut sections = Vec::new();
    for entry in entries {
        let section = match &entry.outcome {
            Outcome::Screen(screen) => {
                let (cols, rows) = super::terminal_dimensions(&entry.terminal);
                let body = match lines {
                    Some(count) => attach::last_n_lines(screen, count),
                    None => screen.clone(),
                };
                format!("== {} · {cols}x{rows} ==\n{body}", label(entry))
            }
            Outcome::Error(message) => {
                format!(
                    "-- {} · error: {} --",
                    label(entry),
                    message.replace('\n', " ")
                )
            }
            Outcome::Unreachable => format!("-- {} · skipped (unreachable) --", label(entry)),
        };
        sections.push(section);
    }
    sections.join("\n\n")
}

/// JSON entry: full screen data on success, an `error` field otherwise.
fn entry_json(entry: &BatchEntry) -> Value {
    let terminal = &entry.terminal;
    let mut value = json!({
        "id": terminal.id,
        "short_id": short_id(&terminal.id),
        "machine_id": terminal.machine_id,
        "title": terminal.title,
        "group": entry.group,
        "cwd": terminal.cwd,
    });
    match &entry.outcome {
        Outcome::Screen(screen) => {
            let (cols, rows) = super::terminal_dimensions(terminal);
            value["cols"] = json!(cols);
            value["rows"] = json!(rows);
            value["screen"] = json!(screen);
        }
        Outcome::Error(message) => value["error"] = json!(message),
        Outcome::Unreachable => value["error"] = json!("unreachable"),
    }
    value
}

#[cfg(test)]
mod tests {
    use super::{entry_json, render_text, retain_machine, BatchEntry, Outcome};
    use serde_json::json;
    use tc_protocol::{MachineInfo, TerminalInfo};

    fn terminal(id: &str, machine_id: &str, cwd: &str) -> TerminalInfo {
        TerminalInfo {
            id: id.to_string(),
            machine_id: machine_id.to_string(),
            title: format!("title-{id}"),
            cwd: cwd.to_string(),
            workspace_group_id: None,
            cols: 107,
            rows: 59,
            reachable: true,
        }
    }

    fn entry(id: &str, group: Option<&str>, outcome: Outcome) -> BatchEntry {
        BatchEntry {
            terminal: terminal(&format!("{id}-rest-of-id"), "machine-1", "/home/user"),
            group: group.map(str::to_string),
            outcome,
        }
    }

    #[test]
    fn text_renders_captured_grouped_and_skipped_rows() {
        let entries = vec![
            entry(
                "54eb98a5",
                Some("tab 3"),
                Outcome::Screen("screen one".to_string()),
            ),
            entry("3c361a41", None, Outcome::Screen("screen two".to_string())),
            entry("2bf50be0", None, Outcome::Unreachable),
        ];
        let text = render_text(&entries, None);
        assert_eq!(
            text,
            "== 54eb98a5 · tab 3 · /home/user · 107x59 ==\nscreen one\n\n\
             == 3c361a41 · /home/user · 107x59 ==\nscreen two\n\n\
             -- 2bf50be0 · /home/user · skipped (unreachable) --"
        );
    }

    #[test]
    fn text_renders_mid_capture_errors_as_one_line_rows() {
        let entries = vec![entry(
            "54eb98a5",
            None,
            Outcome::Error("websocket closed\nmid-capture".to_string()),
        )];
        let text = render_text(&entries, None);
        assert_eq!(
            text,
            "-- 54eb98a5 · /home/user · error: websocket closed mid-capture --"
        );
    }

    #[test]
    fn text_lines_slices_each_screen_after_trimming() {
        let entries = vec![
            entry("54eb98a5", None, Outcome::Screen("a\nb\nc".to_string())),
            entry("3c361a41", None, Outcome::Unreachable),
        ];
        let text = render_text(&entries, Some(2));
        assert_eq!(
            text,
            "== 54eb98a5 · /home/user · 107x59 ==\nb\nc\n\n\
             -- 3c361a41 · /home/user · skipped (unreachable) --"
        );
    }

    #[test]
    fn json_entries_carry_screen_or_error() {
        let captured = entry_json(&entry(
            "54eb98a5",
            Some("tab 3"),
            Outcome::Screen("hello".to_string()),
        ));
        assert_eq!(
            captured,
            json!({
                "id": "54eb98a5-rest-of-id",
                "short_id": "54eb98a5",
                "machine_id": "machine-1",
                "title": "title-54eb98a5-rest-of-id",
                "group": "tab 3",
                "cwd": "/home/user",
                "cols": 107,
                "rows": 59,
                "screen": "hello",
            })
        );

        let skipped = entry_json(&entry("2bf50be0", None, Outcome::Unreachable));
        assert_eq!(skipped["error"], json!("unreachable"));
        assert!(skipped.get("screen").is_none());
        assert!(skipped.get("cols").is_none());
        assert_eq!(skipped["group"], json!(null));

        let failed = entry_json(&entry("3c361a41", None, Outcome::Error("boom".to_string())));
        assert_eq!(failed["error"], json!("boom"));
        assert!(failed.get("screen").is_none());
    }

    fn machine(id: &str) -> MachineInfo {
        MachineInfo {
            id: id.to_string(),
            name: id.to_string(),
            os: "linux".to_string(),
            home_dir: "/home/user".to_string(),
        }
    }

    #[test]
    fn machine_filter_keeps_only_the_resolved_machine() {
        let machines = vec![machine("aaaa1111-machine"), machine("bbbb2222-machine")];
        let mut terminals = vec![
            terminal("t-1", "aaaa1111-machine", "/a"),
            terminal("t-2", "bbbb2222-machine", "/b"),
            terminal("t-3", "aaaa1111-machine", "/c"),
        ];
        retain_machine(&mut terminals, &machines, "aaaa").unwrap();
        let ids: Vec<&str> = terminals.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["t-1", "t-3"]);
    }

    #[test]
    fn machine_filter_rejects_unknown_and_ambiguous_prefixes() {
        let machines = vec![machine("aaaa1111-machine"), machine("aaaa2222-machine")];
        let mut terminals = vec![terminal("t-1", "aaaa1111-machine", "/a")];
        assert!(retain_machine(&mut terminals, &machines, "zzzz").is_err());
        assert!(retain_machine(&mut terminals, &machines, "aaaa").is_err());
        // Failed filters leave the listing untouched.
        assert_eq!(terminals.len(), 1);
    }
}
