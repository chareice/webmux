use futures::{SinkExt, StreamExt};
use regex::Regex;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::config::{ws_terminal_url, ResolvedConfig};
use crate::CliError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Grace period after sending input so the frame reaches the hub before close.
const SEND_GRACE: Duration = Duration::from_millis(200);

pub type TerminalSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Connect to the terminal WebSocket as a watcher or controller.
/// Everything needed to attach to one terminal over the hub websocket.
pub struct Target<'a> {
    pub config: &'a ResolvedConfig,
    pub machine_id: &'a str,
    pub terminal_id: &'a str,
    pub device_id: String,
    pub cols: u16,
    pub rows: u16,
}

impl Target<'_> {
    async fn connect(&self) -> Result<TerminalSocket, CliError> {
        connect(
            self.config,
            self.machine_id,
            self.terminal_id,
            &self.device_id,
        )
        .await
    }
}

/// 401 on upgrade -> bad token, 404 on upgrade -> terminal not accessible.
pub async fn connect(
    config: &ResolvedConfig,
    machine_id: &str,
    terminal_id: &str,
    device_id: &str,
) -> Result<TerminalSocket, CliError> {
    let url = ws_terminal_url(
        &config.url,
        machine_id,
        terminal_id,
        &config.token,
        device_id,
    )?;
    tracing::debug!(%url, "connecting terminal websocket");
    match tokio::time::timeout(CONNECT_TIMEOUT, connect_async(&url)).await {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(WsError::Http(response))) => Err(match response.status().as_u16() {
            401 => CliError::Config(
                "token invalid/expired — create a new API token in the web UI".to_string(),
            ),
            404 => CliError::Protocol("terminal not found".to_string()),
            code => CliError::Protocol(format!("hub refused WebSocket upgrade (HTTP {code})")),
        }),
        Ok(Err(error)) => Err(CliError::Network(format!(
            "websocket connect failed: {error}"
        ))),
        Err(_) => Err(CliError::Network(
            "websocket connect timed out after 10s".to_string(),
        )),
    }
}

/// Client-side screen reconstructed from the raw PTY byte stream.
pub struct Screen {
    parser: vt100::Parser,
}

impl Screen {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn contents(&self) -> String {
        self.parser.screen().contents()
    }
}

/// Drop trailing lines that are empty or whitespace-only.
pub fn trim_trailing_blank_lines(contents: &str) -> String {
    let lines: Vec<&str> = contents.lines().collect();
    let mut end = lines.len();
    while end > 0 && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    lines[..end].join("\n")
}

/// Keep only the last `count` lines.
pub fn last_n_lines(contents: &str, count: usize) -> String {
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

/// Strip control bytes that would corrupt JSON pipelines or the consumer's
/// terminal: every char < 0x20 except `\n` and `\t`, plus 0x7f. CJK, emoji
/// and other wide chars pass through untouched. Apply to every user-facing
/// string that comes from terminal content or machine data.
pub fn sanitize_screen(text: &str) -> String {
    text.chars()
        .filter(|c| match c {
            '\u{0}'..='\u{1f}' => *c == '\n' || *c == '\t',
            '\u{7f}' => false,
            _ => true,
        })
        .collect()
}

/// Apply `--lines` to an already blank-trimmed screen. Returns the (possibly
/// sliced) screen, the line count before slicing, and whether slicing
/// removed anything. Shared by text and JSON output so `--lines N` means
/// "the last N rendered lines" in both.
pub fn apply_lines(trimmed: &str, lines: Option<usize>) -> (String, usize, bool) {
    let lines_total = trimmed.lines().count();
    match lines {
        Some(count) => (
            last_n_lines(trimmed, count),
            lines_total,
            lines_total > count,
        ),
        None => (trimmed.to_string(), lines_total, false),
    }
}

/// Parse a read timeout: plain seconds with an optional trailing `s` ("10", "10s").
pub fn parse_secs(text: &str) -> Result<u64, String> {
    let digits = text.strip_suffix('s').unwrap_or(text);
    digits
        .parse::<u64>()
        .map_err(|_| format!("invalid duration '{text}' (use seconds, e.g. 10 or 10s)"))
}

/// Sleep until `deadline` if set, otherwise never resolve.
async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline.into()).await,
        None => std::future::pending().await,
    }
}

/// What one incoming websocket message means for the read/wait loops.
enum Inbound {
    /// Raw PTY output bytes.
    Bytes(Vec<u8>),
    /// The hub closed the connection (or it dropped).
    Closed,
    /// Ping/pong/pong-ish frames we do not care about.
    Ignore,
}

/// Classify one incoming websocket message.
/// The hub sends {"type":"error","message":...} as a text frame on failures.
fn inbound(message: Option<Result<Message, WsError>>) -> Result<Inbound, CliError> {
    match message {
        Some(Ok(Message::Binary(bytes))) => Ok(Inbound::Bytes(bytes.to_vec())),
        Some(Ok(Message::Text(text))) => Err(CliError::Protocol(format!(
            "hub sent an error over the websocket: {text}"
        ))),
        Some(Ok(Message::Close(_))) | None => Ok(Inbound::Closed),
        Some(Err(error)) => Err(CliError::Network(format!("websocket error: {error}"))),
        Some(Ok(_)) => Ok(Inbound::Ignore),
    }
}

/// Why a screen capture ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    /// The quiet timer fired: bytes arrived, then stopped.
    Quiet,
    /// The overall timeout elapsed.
    Timeout,
    /// The hub closed the websocket (or it dropped).
    Closed,
}

/// What one capture produced: the reconstructed screen plus the timing data
/// needed to classify the terminal's activity.
pub struct CaptureReport {
    pub screen: Screen,
    pub end_reason: EndReason,
    /// Milliseconds between the last received byte and capture end; `None`
    /// when no bytes arrived at all.
    pub last_byte_age_ms: Option<u64>,
}

/// Classify a terminal's activity from its capture report. Observed during
/// the capture window only:
/// - `"idle"`: no bytes arrived at all during the capture
/// - `"active"`: capture hit the overall timeout with bytes arriving within
///   the last quiet window (something is streaming)
/// - `"quiet"`: bytes arrived, then stopped
pub fn classify_activity(
    end_reason: EndReason,
    last_byte_age_ms: Option<u64>,
    quiet: Duration,
) -> &'static str {
    match (end_reason, last_byte_age_ms) {
        (_, None) => "idle",
        (EndReason::Timeout, Some(age_ms)) if age_ms < quiet.as_millis() as u64 => "active",
        _ => "quiet",
    }
}

/// Attach as a read-only watcher and capture the screen until it goes quiet
/// for `quiet` after the first byte, `timeout` elapses, or the WS closes.
/// Never sends input or resize frames.
pub async fn capture(
    target: &Target<'_>,
    quiet: Duration,
    timeout: Option<Duration>,
) -> Result<CaptureReport, CliError> {
    let mut socket = target.connect().await?;
    let mut screen = Screen::new(target.cols, target.rows);
    let start = Instant::now();
    let overall_deadline = timeout.map(|duration| start + duration);
    let mut last_byte: Option<Instant> = None;

    let end_reason = loop {
        let quiet_deadline = last_byte.map(|instant| instant + quiet);
        tokio::select! {
            message = socket.next() => {
                match inbound(message)? {
                    Inbound::Bytes(bytes) => {
                        tracing::debug!(len = bytes.len(), "read: received output");
                        screen.feed(&bytes);
                        last_byte = Some(Instant::now());
                    }
                    Inbound::Closed => break EndReason::Closed,
                    Inbound::Ignore => {}
                }
            }
            _ = sleep_until(quiet_deadline) => break EndReason::Quiet,
            _ = sleep_until(overall_deadline) => break EndReason::Timeout,
        }
    };
    Ok(CaptureReport {
        screen,
        end_reason,
        last_byte_age_ms: last_byte.map(|instant| instant.elapsed().as_millis() as u64),
    })
}

/// Why `wait_screen` finished successfully.
pub enum WaitOutcome {
    PatternMatched,
    SilenceReached,
}

/// Attach as a read-only watcher and wait for a screen pattern and/or silence.
/// WS close or error is exit 2; timeout is exit 1 (CliError::WaitTimeout).
pub async fn wait_screen(
    target: &Target<'_>,
    pattern: Option<Regex>,
    silence: Option<Duration>,
    timeout: Option<Duration>,
) -> Result<WaitOutcome, CliError> {
    let mut socket = target.connect().await?;
    let mut screen = Screen::new(target.cols, target.rows);
    let start = Instant::now();
    let overall_deadline = timeout.map(|duration| start + duration);
    let mut last_byte: Option<Instant> = None;

    loop {
        let silence_deadline = match (silence, last_byte) {
            (Some(silence), Some(instant)) => Some(instant + silence),
            _ => None,
        };
        tokio::select! {
            message = socket.next() => {
                match inbound(message)? {
                    Inbound::Bytes(bytes) => {
                        tracing::debug!(len = bytes.len(), "wait: received output");
                        screen.feed(&bytes);
                        last_byte = Some(Instant::now());
                        if let Some(pattern) = &pattern {
                            if pattern.is_match(&screen.contents()) {
                                return Ok(WaitOutcome::PatternMatched);
                            }
                        }
                    }
                    Inbound::Closed => {
                        return Err(CliError::Protocol(
                            "websocket closed while waiting on the terminal".to_string(),
                        ));
                    }
                    Inbound::Ignore => {}
                }
            }
            _ = sleep_until(silence_deadline) => return Ok(WaitOutcome::SilenceReached),
            _ = sleep_until(overall_deadline) => return Err(CliError::WaitTimeout),
        }
    }
}

/// Plan the input frames for `send`: always the text as-is first, then —
/// when `enter` — a delayed standalone `"\r"`. TUIs like Claude Code treat a
/// multi-line burst as a paste and swallow a trailing `\r` into it, so Enter
/// goes out on its own frame after a delay scaled by newline count
/// (`min(150ms + 60ms × newlines, 800ms)`) to let the paste digest.
/// Each entry is `(frame, delay before sending it)`.
pub fn plan_send_frames(text: &str, enter: bool) -> Vec<(String, Duration)> {
    let mut frames = vec![(text.to_string(), Duration::ZERO)];
    if enter {
        let newlines = text.matches('\n').count() as u64;
        let delay = Duration::from_millis(150 + 60 * newlines).min(Duration::from_millis(800));
        frames.push(("\r".to_string(), delay));
    }
    frames
}

/// Attach and send each frame as its own `{"type":"input","data":...}` text
/// message, in order, sleeping the frame's planned delay before sending it,
/// then close after a short grace period.
/// Sending input claims control (last-writer-wins).
pub async fn send_inputs(
    config: &ResolvedConfig,
    machine_id: &str,
    terminal_id: &str,
    device_id: &str,
    frames: &[(String, Duration)],
) -> Result<(), CliError> {
    let mut socket = connect(config, machine_id, terminal_id, device_id).await?;
    for (data, delay) in frames {
        if !delay.is_zero() {
            tokio::time::sleep(*delay).await;
        }
        let payload = serde_json::json!({ "type": "input", "data": data }).to_string();
        tracing::debug!(len = data.len(), "sending input frame");
        socket
            .send(Message::Text(payload.into()))
            .await
            .map_err(|error| CliError::Network(format!("failed to send input: {error}")))?;
    }
    socket
        .flush()
        .await
        .map_err(|error| CliError::Network(format!("failed to flush input: {error}")))?;
    tokio::time::sleep(SEND_GRACE).await;
    let _ = socket.close(None).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_lines, classify_activity, last_n_lines, parse_secs, plan_send_frames,
        sanitize_screen, trim_trailing_blank_lines, EndReason,
    };
    use std::time::Duration;

    #[test]
    fn sanitize_drops_control_bytes_keeps_layout_and_unicode() {
        // NUL, BEL, ESC + an OSC sequence, DEL, \r all vanish.
        let dirty = "foo\0\x07\x1b]0;title\x07bar\r\nbaz\x7f";
        assert_eq!(sanitize_screen(dirty), "foo]0;titlebar\nbaz");
        // \t and \n survive; CJK, emoji and wide chars pass through.
        let unicode = "タブ\t絵文字🎉\n宽字符";
        assert_eq!(sanitize_screen(unicode), unicode);
        assert_eq!(sanitize_screen(""), "");
    }

    #[test]
    fn apply_lines_reports_total_and_truncated() {
        let (screen, total, truncated) = apply_lines("a\nb\nc", Some(2));
        assert_eq!(screen, "b\nc");
        assert_eq!(total, 3);
        assert!(truncated);

        let (screen, total, truncated) = apply_lines("a\nb", Some(5));
        assert_eq!(screen, "a\nb");
        assert_eq!(total, 2);
        assert!(!truncated);

        // No --lines: full screen, never truncated.
        let (screen, total, truncated) = apply_lines("a\nb", None);
        assert_eq!(screen, "a\nb");
        assert_eq!(total, 2);
        assert!(!truncated);
    }

    #[test]
    fn apply_lines_parity_between_modes() {
        // Same input, same slice: text and JSON paths must agree.
        let trimmed = trim_trailing_blank_lines("one\ntwo\nthree\n\n\n");
        let (sliced, _, _) = apply_lines(&trimmed, Some(2));
        assert_eq!(sliced, last_n_lines(&trimmed, 2));
    }

    #[test]
    fn send_plan_single_line_gets_short_enter_delay() {
        let frames = plan_send_frames("hello", true);
        assert_eq!(
            frames,
            vec![
                ("hello".to_string(), Duration::ZERO),
                ("\r".to_string(), Duration::from_millis(150)),
            ]
        );
    }

    #[test]
    fn send_plan_scales_with_newlines_and_caps_at_800ms() {
        let frames = plan_send_frames("a\nb\nc", true);
        assert_eq!(
            frames[1],
            ("\r".to_string(), Duration::from_millis(150 + 120))
        );

        let many = "x\n".repeat(20);
        let frames = plan_send_frames(&many, true);
        assert_eq!(frames[1], ("\r".to_string(), Duration::from_millis(800)));
    }

    #[test]
    fn send_plan_no_enter_is_a_pure_paste() {
        let frames = plan_send_frames("a\nb", false);
        assert_eq!(frames, vec![("a\nb".to_string(), Duration::ZERO)]);
    }

    #[test]
    fn send_plan_empty_text_still_sends_enter() {
        let frames = plan_send_frames("", true);
        assert_eq!(
            frames,
            vec![
                ("".to_string(), Duration::ZERO),
                ("\r".to_string(), Duration::from_millis(150)),
            ]
        );
    }

    #[test]
    fn activity_classification() {
        let quiet = Duration::from_millis(500);
        // No bytes ever -> idle, regardless of how the capture ended.
        assert_eq!(classify_activity(EndReason::Quiet, None, quiet), "idle");
        assert_eq!(classify_activity(EndReason::Timeout, None, quiet), "idle");
        assert_eq!(classify_activity(EndReason::Closed, None, quiet), "idle");
        // Quiet timer fired -> bytes arrived, then stopped.
        assert_eq!(
            classify_activity(EndReason::Quiet, Some(500), quiet),
            "quiet"
        );
        // Timeout with bytes inside the last quiet window -> still streaming.
        assert_eq!(
            classify_activity(EndReason::Timeout, Some(120), quiet),
            "active"
        );
        // Timeout but the last byte is older than the quiet window -> stopped.
        assert_eq!(
            classify_activity(EndReason::Timeout, Some(900), quiet),
            "quiet"
        );
        // WS closed after output counts as quiet (bytes arrived, then stopped).
        assert_eq!(
            classify_activity(EndReason::Closed, Some(10), quiet),
            "quiet"
        );
    }

    #[test]
    fn trims_trailing_blank_lines() {
        assert_eq!(trim_trailing_blank_lines("a\nb\n\n  \n\n"), "a\nb");
        assert_eq!(trim_trailing_blank_lines("a"), "a");
        assert_eq!(trim_trailing_blank_lines(""), "");
        assert_eq!(trim_trailing_blank_lines("\n\n\n"), "");
    }

    #[test]
    fn keeps_interior_blank_lines() {
        assert_eq!(trim_trailing_blank_lines("a\n\nb\n\n"), "a\n\nb");
    }

    #[test]
    fn last_n_lines_slices_from_the_end() {
        assert_eq!(last_n_lines("a\nb\nc", 2), "b\nc");
        assert_eq!(last_n_lines("a\nb\nc", 1), "c");
        assert_eq!(last_n_lines("a\nb\nc", 10), "a\nb\nc");
        assert_eq!(last_n_lines("a\nb\nc", 0), "");
    }

    #[test]
    fn trim_then_slice_composes() {
        let trimmed = trim_trailing_blank_lines("a\nb\nc\n\n\n");
        assert_eq!(last_n_lines(&trimmed, 2), "b\nc");
    }

    #[test]
    fn parse_secs_accepts_optional_s_suffix() {
        assert_eq!(parse_secs("10s").unwrap(), 10);
        assert_eq!(parse_secs("10").unwrap(), 10);
        assert_eq!(parse_secs("0").unwrap(), 0);
    }

    #[test]
    fn parse_secs_rejects_garbage() {
        assert!(parse_secs("abc").is_err());
        assert!(parse_secs("10m").is_err());
        assert!(parse_secs("").is_err());
        assert!(parse_secs("-5").is_err());
    }
}
