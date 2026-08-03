use crate::CliError;

/// Resolve a user-supplied id or id prefix against a live list.
/// Exact match wins; otherwise the prefix must match exactly one entry.
pub fn resolve_prefix<'a, T, F>(query: &str, items: &'a [T], id_of: F) -> Result<&'a T, CliError>
where
    F: Fn(&T) -> &str,
{
    if let Some(exact) = items.iter().find(|item| id_of(item) == query) {
        return Ok(exact);
    }
    let matches: Vec<&T> = items
        .iter()
        .filter(|item| id_of(item).starts_with(query))
        .collect();
    match matches.len() {
        0 => Err(CliError::Usage(format!("no id matching '{query}'"))),
        1 => Ok(matches[0]),
        _ => {
            let candidates = matches
                .iter()
                .map(|item| format!("  {}", id_of(item)))
                .collect::<Vec<_>>()
                .join("\n");
            Err(CliError::Usage(format!(
                "'{query}' is ambiguous — candidates:\n{candidates}"
            )))
        }
    }
}

/// First-8 short form used in table output.
pub fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

#[cfg(test)]
mod tests {
    use super::{resolve_prefix, short_id};

    fn ids() -> Vec<String> {
        vec![
            "a1b2c3d4-0000".to_string(),
            "a1b2c3d4-1111".to_string(),
            "e5f6a7b8-2222".to_string(),
        ]
    }

    #[test]
    fn exact_match_wins_even_when_it_is_a_prefix_of_another() {
        let items = vec!["abc".to_string(), "abcdef".to_string()];
        let resolved = resolve_prefix("abc", &items, |id| id.as_str()).unwrap();
        assert_eq!(resolved, "abc");
    }

    #[test]
    fn unique_prefix_resolves() {
        let items = ids();
        let resolved = resolve_prefix("e5f6", &items, |id| id.as_str()).unwrap();
        assert_eq!(resolved, "e5f6a7b8-2222");
    }

    #[test]
    fn full_id_resolves() {
        let items = ids();
        let resolved = resolve_prefix("a1b2c3d4-0000", &items, |id| id.as_str()).unwrap();
        assert_eq!(resolved, "a1b2c3d4-0000");
    }

    #[test]
    fn ambiguous_prefix_lists_candidates() {
        let error = resolve_prefix("a1b2", &ids(), |id| id.as_str()).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("ambiguous"), "{message}");
        assert!(message.contains("a1b2c3d4-0000"), "{message}");
        assert!(message.contains("a1b2c3d4-1111"), "{message}");
        assert!(!message.contains("e5f6a7b8-2222"), "{message}");
    }

    #[test]
    fn no_match_is_an_error() {
        let error = resolve_prefix("zzzz", &ids(), |id| id.as_str()).unwrap_err();
        assert!(error.to_string().contains("no id matching 'zzzz'"));
    }

    #[test]
    fn short_id_takes_first_eight_chars() {
        assert_eq!(short_id("a1b2c3d4-0000"), "a1b2c3d4");
        assert_eq!(short_id("short"), "short");
    }
}
