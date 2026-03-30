use std::collections::HashMap;
use tokio::sync::mpsc;

/// In-memory registry mapping QR session IDs to their WebSocket senders.
pub struct QrSessionHub {
    senders: HashMap<String, mpsc::UnboundedSender<String>>,
}

impl QrSessionHub {
    pub fn new() -> Self {
        Self {
            senders: HashMap::new(),
        }
    }

    /// Register a WebSocket sender for a QR session.
    /// Returns false if a sender already exists for this session.
    pub fn register(&mut self, session_id: String, tx: mpsc::UnboundedSender<String>) -> bool {
        if self.senders.contains_key(&session_id) {
            return false;
        }
        self.senders.insert(session_id, tx);
        true
    }

    /// Send a message to the WebSocket client waiting on this session.
    pub fn send(&self, session_id: &str, message: String) -> bool {
        if let Some(tx) = self.senders.get(session_id) {
            tx.send(message).is_ok()
        } else {
            false
        }
    }

    /// Remove a session's sender.
    pub fn remove(&mut self, session_id: &str) {
        self.senders.remove(session_id);
    }
}
