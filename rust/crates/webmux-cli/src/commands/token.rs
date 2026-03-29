use crate::client::WebmuxClient;
use crate::config::Config;
use webmux_shared::{ApiTokenListResponse, CreateApiTokenRequest, CreateApiTokenResponse};

fn relative_time(timestamp_ms: f64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let diff_secs = ((now - timestamp_ms) / 1000.0) as u64;
    if diff_secs < 60 {
        format!("{}s ago", diff_secs)
    } else if diff_secs < 3600 {
        format!("{}m ago", diff_secs / 60)
    } else if diff_secs < 86400 {
        format!("{}h ago", diff_secs / 3600)
    } else {
        format!("{}d ago", diff_secs / 86400)
    }
}

fn format_timestamp(timestamp_ms: f64) -> String {
    relative_time(timestamp_ms)
}

pub async fn cmd_token_create(
    config: &Config,
    name: &str,
    expires_in_days: Option<i64>,
) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    let body = CreateApiTokenRequest {
        name: name.to_string(),
        expires_in_days,
    };

    let resp = match client
        .post::<_, CreateApiTokenResponse>("/api/auth/api-tokens", &body)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    println!("Token created successfully!");
    println!();
    println!("  Name:  {}", resp.name);
    println!("  ID:    {}", resp.id);
    println!("  Token: {}", resp.token);
    println!();
    println!("Warning: save this token now — it will not be shown again.");

    Ok(())
}

pub async fn cmd_token_list(config: &Config) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    let resp = match client
        .get::<ApiTokenListResponse>("/api/auth/api-tokens")
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    if resp.tokens.is_empty() {
        println!("No API tokens found.");
        return Ok(());
    }

    // Calculate column widths
    let id_w = resp
        .tokens
        .iter()
        .map(|t| t.id.len())
        .max()
        .unwrap_or(2)
        .max(2);
    let name_w = resp
        .tokens
        .iter()
        .map(|t| t.name.len())
        .max()
        .unwrap_or(4)
        .max(4);

    println!(
        "{:<id_w$}  {:<name_w$}  {:<12}  {:<12}  {}",
        "ID",
        "NAME",
        "CREATED",
        "LAST USED",
        "EXPIRES",
        id_w = id_w,
        name_w = name_w,
    );

    for token in &resp.tokens {
        let created = format_timestamp(token.created_at);
        let last_used = token
            .last_used_at
            .map(format_timestamp)
            .unwrap_or_else(|| "never".to_string());
        let expires = token
            .expires_at
            .map(format_timestamp)
            .unwrap_or_else(|| "never".to_string());

        println!(
            "{:<id_w$}  {:<name_w$}  {:<12}  {:<12}  {}",
            token.id,
            token.name,
            created,
            last_used,
            expires,
            id_w = id_w,
            name_w = name_w,
        );
    }

    Ok(())
}

pub async fn cmd_token_revoke(config: &Config, id: &str) -> anyhow::Result<()> {
    let client = WebmuxClient::new(config);

    let path = format!("/api/auth/api-tokens/{}", id);
    match client.delete(&path).await {
        Ok(()) => {
            println!("Token {} revoked.", id);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}
