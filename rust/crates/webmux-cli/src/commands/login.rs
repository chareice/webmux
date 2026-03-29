use crate::client::WebmuxClient;
use crate::config::{self, Config};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    display_name: String,
}

pub async fn cmd_login(server: &str, token: &str) -> anyhow::Result<()> {
    // Build a temporary config to validate credentials
    let config = Config {
        server_url: server.to_string(),
        api_token: token.to_string(),
    };

    let client = WebmuxClient::new(&config);

    match client.get::<MeResponse>("/api/auth/me").await {
        Ok(me) => {
            config::save_config(&config)?;
            println!("Logged in as {}", me.display_name);
        }
        Err(e) => {
            eprintln!("Error: failed to authenticate: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}
