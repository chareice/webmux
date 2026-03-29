use crate::config::Config;
use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fmt;

/// Errors from the HTTP client.
#[derive(Debug)]
pub enum ClientError {
    /// HTTP error with status code and response body.
    Http(StatusCode, String),
    /// Network / connection error.
    Network(reqwest::Error),
    /// Response body could not be parsed.
    Parse(String),
}

impl fmt::Display for ClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClientError::Http(status, body) => {
                write!(f, "HTTP {}: {}", status, body)
            }
            ClientError::Network(err) => {
                write!(f, "Network error: {}", err)
            }
            ClientError::Parse(msg) => {
                write!(f, "Parse error: {}", msg)
            }
        }
    }
}

impl std::error::Error for ClientError {}

/// HTTP client wrapper for the Webmux API.
pub struct WebmuxClient {
    client: Client,
    base_url: String,
    token: String,
}

impl WebmuxClient {
    /// Creates a new client from the given config.
    pub fn new(config: &Config) -> Self {
        Self {
            client: Client::new(),
            base_url: config.server_url.trim_end_matches('/').to_string(),
            token: config.api_token.clone(),
        }
    }

    /// Returns the base URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Returns the API token.
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Sends a GET request and deserializes the response.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ClientError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .get(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(ClientError::Network)?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClientError::Http(status, body));
        }

        resp.json::<T>()
            .await
            .map_err(|e| ClientError::Parse(e.to_string()))
    }

    /// Sends a POST request with a JSON body and deserializes the response.
    pub async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ClientError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .map_err(ClientError::Network)?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClientError::Http(status, body));
        }

        resp.json::<T>()
            .await
            .map_err(|e| ClientError::Parse(e.to_string()))
    }

    /// Sends a DELETE request.
    pub async fn delete(&self, path: &str) -> Result<(), ClientError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .delete(&url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(ClientError::Network)?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClientError::Http(status, body));
        }

        Ok(())
    }
}
