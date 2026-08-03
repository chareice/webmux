use crate::CliError;

pub const VALID_FORMS: &str = "Enter, Esc, Tab, BTab, Space, Up, Down, Left, Right, Home, End, \
                               PgUp, PgDn, Del, Backspace, F1-F12, C-<letter>, C-[";

/// Map a keyspec (case-insensitive) to the byte sequence the PTY expects.
/// Unknown keyspecs are a usage error listing the valid forms.
pub fn parse_keyspec(spec: &str) -> Result<Vec<u8>, CliError> {
    let lower = spec.to_lowercase();
    let bytes: &[u8] = match lower.as_str() {
        "enter" => b"\r",
        "esc" => b"\x1b",
        "tab" => b"\t",
        "btab" => b"\x1b[Z",
        "space" => b" ",
        "up" => b"\x1b[A",
        "down" => b"\x1b[B",
        "right" => b"\x1b[C",
        "left" => b"\x1b[D",
        "home" => b"\x1b[H",
        "end" => b"\x1b[F",
        "pgup" => b"\x1b[5~",
        "pgdn" => b"\x1b[6~",
        "del" => b"\x1b[3~",
        "backspace" => b"\x7f",
        "f1" => b"\x1bOP",
        "f2" => b"\x1bOQ",
        "f3" => b"\x1bOR",
        "f4" => b"\x1bOS",
        "f5" => b"\x1b[15~",
        "f6" => b"\x1b[17~",
        "f7" => b"\x1b[18~",
        "f8" => b"\x1b[19~",
        "f9" => b"\x1b[20~",
        "f10" => b"\x1b[21~",
        "f11" => b"\x1b[23~",
        "f12" => b"\x1b[24~",
        "c-[" => b"\x1b",
        _ => return parse_control_key(&lower),
    };
    Ok(bytes.to_vec())
}

/// C-<letter> control bytes: C-a = 0x01 .. C-z = 0x1a.
fn parse_control_key(lower: &str) -> Result<Vec<u8>, CliError> {
    if let Some(letter) = lower.strip_prefix("c-") {
        let bytes = letter.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_lowercase() {
            return Ok(vec![bytes[0] - b'a' + 1]);
        }
    }
    Err(unknown_keyspec(lower))
}

fn unknown_keyspec(spec: &str) -> CliError {
    CliError::Usage(format!(
        "unknown keyspec '{spec}' — valid forms: {VALID_FORMS}"
    ))
}

#[cfg(test)]
mod tests {
    use super::parse_keyspec;

    #[test]
    fn parses_named_keys() {
        assert_eq!(parse_keyspec("Enter").unwrap(), b"\r");
        assert_eq!(parse_keyspec("esc").unwrap(), b"\x1b");
        assert_eq!(parse_keyspec("Tab").unwrap(), b"\t");
        assert_eq!(parse_keyspec("BTab").unwrap(), b"\x1b[Z");
        assert_eq!(parse_keyspec("Space").unwrap(), b" ");
        assert_eq!(parse_keyspec("Up").unwrap(), b"\x1b[A");
        assert_eq!(parse_keyspec("Down").unwrap(), b"\x1b[B");
        assert_eq!(parse_keyspec("Right").unwrap(), b"\x1b[C");
        assert_eq!(parse_keyspec("Left").unwrap(), b"\x1b[D");
        assert_eq!(parse_keyspec("Home").unwrap(), b"\x1b[H");
        assert_eq!(parse_keyspec("End").unwrap(), b"\x1b[F");
        assert_eq!(parse_keyspec("PgUp").unwrap(), b"\x1b[5~");
        assert_eq!(parse_keyspec("PgDn").unwrap(), b"\x1b[6~");
        assert_eq!(parse_keyspec("Del").unwrap(), b"\x1b[3~");
        assert_eq!(parse_keyspec("Backspace").unwrap(), b"\x7f");
    }

    #[test]
    fn parses_function_keys() {
        assert_eq!(parse_keyspec("F1").unwrap(), b"\x1bOP");
        assert_eq!(parse_keyspec("f2").unwrap(), b"\x1bOQ");
        assert_eq!(parse_keyspec("F3").unwrap(), b"\x1bOR");
        assert_eq!(parse_keyspec("F4").unwrap(), b"\x1bOS");
        assert_eq!(parse_keyspec("F5").unwrap(), b"\x1b[15~");
        assert_eq!(parse_keyspec("F6").unwrap(), b"\x1b[17~");
        assert_eq!(parse_keyspec("F7").unwrap(), b"\x1b[18~");
        assert_eq!(parse_keyspec("F8").unwrap(), b"\x1b[19~");
        assert_eq!(parse_keyspec("F9").unwrap(), b"\x1b[20~");
        assert_eq!(parse_keyspec("F10").unwrap(), b"\x1b[21~");
        assert_eq!(parse_keyspec("F11").unwrap(), b"\x1b[23~");
        assert_eq!(parse_keyspec("F12").unwrap(), b"\x1b[24~");
    }

    #[test]
    fn parses_control_keys() {
        assert_eq!(parse_keyspec("C-c").unwrap(), vec![0x03]);
        assert_eq!(parse_keyspec("c-a").unwrap(), vec![0x01]);
        assert_eq!(parse_keyspec("C-Z").unwrap(), vec![0x1a]);
        assert_eq!(parse_keyspec("C-[").unwrap(), vec![0x1b]);
    }

    #[test]
    fn rejects_unknown_keyspecs_with_valid_forms() {
        for bad in ["foo", "F13", "C-1", "C-", "c-cc", ""] {
            let error = parse_keyspec(bad).unwrap_err();
            let message = error.to_string();
            assert!(message.contains("unknown keyspec"), "{bad}: {message}");
            assert!(message.contains("Enter"), "{bad}: {message}");
        }
    }
}
