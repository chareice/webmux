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

/// Attach as a read-only watcher and capture the screen until it goes quiet
/// for `quiet` after the first byte, `timeout` elapses, or the WS closes.
/// Never sends input or resize frames.
pub async fn capture(
    target: &Target<'_>,
    quiet: Duration,
    timeout: Option<Duration>,
) -> Result<Screen, CliError> {
    let mut socket = target.connect().await?;
    let mut screen = Screen::new(target.cols, target.rows);
    let start = Instant::now();
    let overall_deadline = timeout.map(|duration| start + duration);
    let mut last_byte: Option<Instant> = None;

    loop {
        let quiet_deadline = last_byte.map(|instant| instant + quiet);
        tokio::select! {
            message = socket.next() => {
                match inbound(message)? {
                    Inbound::Bytes(bytes) => {
                        tracing::debug!(len = bytes.len(), "read: received output");
                        screen.feed(&bytes);
                        last_byte = Some(Instant::now());
                    }
                    Inbound::Closed => break,
                    Inbound::Ignore => {}
                }
            }
            _ = sleep_until(quiet_deadline) => break,
            _ = sleep_until(overall_deadline) => break,
        }
    }
    Ok(screen)
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

/// Attach and send each frame as its own `{"type":"input","data":...}` text
/// message, in order, then close after a short grace period.
/// Sending input claims control (last-writer-wins).
pub async fn send_inputs(
    config: &ResolvedConfig,
    machine_id: &str,
    terminal_id: &str,
    device_id: &str,
    frames: &[String],
) -> Result<(), CliError> {
    let mut socket = connect(config, machine_id, terminal_id, device_id).await?;
    for data in frames {
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
    use super::{last_n_lines, parse_secs, trim_trailing_blank_lines};

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
