use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::keys::parse_keyspec;
use crate::CliError;

/// Send each keyspec as its own input frame, in order.
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    keys: Vec<String>,
) -> Result<(), CliError> {
    let frames = keys
        .iter()
        .map(|spec| parse_keyspec(spec))
        .collect::<Result<Vec<Vec<u8>>, CliError>>()?;
    let terminal = super::resolve_terminal(client, term_query).await?;

    // All keyspecs map to ASCII, so the byte sequences are valid UTF-8.
    let frames: Vec<String> = frames
        .into_iter()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .collect();
    let device_id = format!("cli-send-{}", std::process::id());
    attach::send_inputs(
        config,
        &terminal.machine_id,
        &terminal.id,
        &device_id,
        &frames,
    )
    .await
}
