use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::CliError;

/// Send text as one input frame; appends `\r` unless --no-enter.
/// Sending input claims control (last-writer-wins).
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    text: Vec<String>,
    no_enter: bool,
) -> Result<(), CliError> {
    let terminal = super::resolve_terminal(client, term_query).await?;

    let mut data = text.join(" ");
    if !no_enter {
        data.push('\r');
    }

    let device_id = format!("cli-send-{}", std::process::id());
    attach::send_inputs(
        config,
        &terminal.machine_id,
        &terminal.id,
        &device_id,
        &[data],
    )
    .await
}
