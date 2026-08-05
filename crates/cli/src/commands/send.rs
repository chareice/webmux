use crate::attach;
use crate::client::HubClient;
use crate::config::ResolvedConfig;
use crate::CliError;

/// Send text as a paste plus a delayed standalone Enter (see
/// `attach::plan_send_frames`); `--no-enter` sends the text frame only.
/// Sending input claims control (last-writer-wins).
pub async fn run(
    client: &HubClient,
    config: &ResolvedConfig,
    term_query: &str,
    text: Vec<String>,
    no_enter: bool,
) -> Result<(), CliError> {
    let terminal = super::resolve_terminal(client, term_query).await?;

    let data = text.join(" ");
    let frames = attach::plan_send_frames(&data, !no_enter);

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
