//! These values only travel inside authenticated Noise transport records.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Authenticate {
    Pair { code: String, device_name: String },
    Resume,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthenticationResult {
    Ready { device_id: String },
    Rejected { message: String },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    Ping {
        id: String,
    },
    Http {
        id: String,
        method: String,
        path: String,
        body: Option<String>,
    },
    Open {
        id: String,
        path: String,
    },
    Text {
        id: String,
        data: String,
    },
    Binary {
        id: String,
        data: String,
    },
    Close {
        id: String,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    Pong {
        id: String,
    },
    Http {
        id: String,
        status: u16,
        body: String,
    },
    Opened {
        id: String,
    },
    Text {
        id: String,
        data: String,
    },
    Binary {
        id: String,
        data: String,
    },
    Closed {
        id: String,
    },
    Error {
        id: String,
        message: String,
    },
}
impl Response {
    pub fn id(&self) -> &str {
        match self {
            Self::Pong { id }
            | Self::Http { id, .. }
            | Self::Opened { id }
            | Self::Text { id, .. }
            | Self::Binary { id, .. }
            | Self::Closed { id }
            | Self::Error { id, .. } => id,
        }
    }
}
