use crate::client::WebmuxClient;
use crate::config::Config;
use serde::Deserialize;

#[derive(Deserialize)]
struct MeResponse {
    user: UserInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserInfo {
    display_name: String,
}

pub async fn cmd_status(config: &Config) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    println!("Server: {}", config.server_url);

    match client.get::<MeResponse>("/api/auth/me").await {
        Ok(me) => {
            println!("User:   {}", me.user.display_name);
            println!("Token:  valid");
        }
        Err(_) => {
            println!("User:   unknown");
            println!("Token:  expired or invalid");
        }
    }

    Ok(())
}
