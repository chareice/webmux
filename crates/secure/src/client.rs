//! Native client. Decrypted messages are delivered only to the bundled App's
//! IPC bridge; no remote JavaScript receives keys or raw credentials.
use crate::{
    messages::{Authenticate, AuthenticationResult, Request, Response},
    pairing::Endpoint,
    Channel, Identity, MAX_RECORD,
};
use futures::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};

type Pending = oneshot::Sender<Result<Response, String>>;
struct Inner {
    outbound: mpsc::Sender<Request>,
    pending: Mutex<HashMap<String, Pending>>,
    sockets: Mutex<HashMap<String, mpsc::Sender<Response>>>,
    stop: watch::Sender<bool>,
    closed: AtomicBool,
}
#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}

impl Client {
    pub async fn connect(
        endpoint: &Endpoint,
        identity: &Identity,
        authenticate: Authenticate,
    ) -> Result<(Self, String), String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let url = endpoint.websocket_url()?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_RECORD))
            .max_frame_size(Some(MAX_RECORD));
        let (mut socket, _) = tokio::time::timeout(
            Duration::from_secs(15),
            tokio_tungstenite::connect_async_with_config(url, Some(config), false),
        )
        .await
        .map_err(|_| "Could not reach the Hub")?
        .map_err(|_| "Could not open the encrypted connection")?;
        let mut handshake = identity
            .initiator(&endpoint.key()?)
            .map_err(|e| e.to_string())?;
        let mut wire = vec![0; MAX_RECORD];
        let n = handshake
            .write_message(&[], &mut wire)
            .map_err(|e| e.to_string())?;
        wire.truncate(n);
        socket
            .send(Message::Binary(wire.into()))
            .await
            .map_err(|_| "Connection interrupted")?;
        let hello = tokio::time::timeout(Duration::from_secs(15), socket.next())
            .await
            .map_err(|_| "Hub handshake timed out")?;
        let Some(Ok(Message::Binary(hello))) = hello else {
            return Err("Hub identity could not be verified".into());
        };
        let n = handshake
            .read_message(&hello, &mut [0; MAX_RECORD])
            .map_err(|_| {
                "Hub identity changed or could not be verified. Re-pair from the Hub's own screen."
            })?;
        if n != 0 {
            return Err("Unsupported handshake payload".into());
        }
        let mut channel = Channel::new(handshake.into_transport_mode().map_err(|e| e.to_string())?);
        let bytes = serde_json::to_vec(&authenticate).map_err(|e| e.to_string())?;
        if bytes.len() > 3000 {
            return Err("Invalid authentication request".into());
        }
        for record in channel.encode(&bytes).map_err(|e| e.to_string())? {
            socket
                .send(Message::Binary(record.into()))
                .await
                .map_err(|_| "Connection interrupted")?;
        }
        let answer = tokio::time::timeout(Duration::from_secs(15), socket.next())
            .await
            .map_err(|_| "Hub authentication timed out")?;
        let Some(Ok(Message::Binary(answer))) = answer else {
            return Err("Hub authentication failed".into());
        };
        let messages = channel.decode(&answer).map_err(|e| e.to_string())?;
        if messages.len() != 1 {
            return Err("Invalid Hub authentication response".into());
        }
        let device_id = match serde_json::from_slice::<AuthenticationResult>(&messages[0])
            .map_err(|_| "Invalid authentication response")?
        {
            AuthenticationResult::Ready { device_id } => device_id,
            AuthenticationResult::Rejected { message } => return Err(message),
        };
        let (outbound, mut outgoing) = mpsc::channel::<Request>(64);
        let (stop, mut write_stop) = watch::channel(false);
        let inner = Arc::new(Inner {
            outbound,
            pending: Mutex::new(HashMap::new()),
            sockets: Mutex::new(HashMap::new()),
            stop,
            closed: AtomicBool::new(false),
        });
        let client = Self {
            inner: inner.clone(),
        };
        let (mut writer, mut reader) = socket.split();
        let channel = Arc::new(Mutex::new(channel));
        let write_channel = channel.clone();
        let write_inner = inner.clone();
        tokio::spawn(async move {
            loop {
                if write_inner.closed.load(Ordering::SeqCst) {
                    break;
                }
                let request = tokio::select! {
                    _ = write_stop.changed() => break,
                    request = outgoing.recv() => match request { Some(request) => request, None => break },
                };
                let bytes = match serde_json::to_vec(&request) {
                    Ok(bytes) => bytes,
                    Err(_) => break,
                };
                let records = match write_channel.lock().await.encode(&bytes) {
                    Ok(records) => records,
                    Err(_) => break,
                };
                let mut failed = false;
                for record in records {
                    let result = tokio::select! {
                        _ = write_stop.changed() => { failed = true; break; },
                        result = writer.send(Message::Binary(record.into())) => result,
                    };
                    if result.is_err() {
                        failed = true;
                        break;
                    }
                }
                if failed {
                    break;
                }
            }
            fail(&write_inner).await;
        });
        let mut read_stop = inner.stop.subscribe();
        tokio::spawn(async move {
            loop {
                if inner.closed.load(Ordering::SeqCst) {
                    break;
                }
                let incoming = tokio::select! {
                    _ = read_stop.changed() => break,
                    incoming = reader.next() => incoming,
                };
                let record = match incoming {
                    Some(Ok(Message::Binary(record))) => record,
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => continue,
                    _ => break,
                };
                let messages = match channel.lock().await.decode(&record) {
                    Ok(messages) => messages,
                    Err(_) => break,
                };
                let mut failed = false;
                for bytes in messages {
                    let response: Response = match serde_json::from_slice(&bytes) {
                        Ok(response) => response,
                        Err(_) => {
                            failed = true;
                            break;
                        }
                    };
                    let id = response.id().to_string();
                    let pending = inner.pending.lock().await.remove(&id);
                    if let Some(pending) = pending {
                        let _ = pending.send(Ok(response));
                    } else {
                        let terminal = inner.sockets.lock().await.get(&id).cloned();
                        if let Some(terminal) = terminal {
                            let closes = matches!(
                                response,
                                Response::Closed { .. } | Response::Error { .. }
                            );
                            // Backpressure reaches the socket and relay instead
                            // of silently dropping terminal/compression bytes.
                            let delivered = tokio::select! {
                                _ = read_stop.changed() => { failed = true; break; },
                                result = terminal.send(response) => result.is_ok(),
                            };
                            if closes || !delivered {
                                inner.sockets.lock().await.remove(&id);
                            }
                        }
                    }
                }
                if failed {
                    break;
                }
            }
            fail(&inner).await;
        });
        Ok((client, device_id))
    }
    pub fn is_closed(&self) -> bool {
        self.inner.closed.load(Ordering::SeqCst)
    }
    pub fn close(&self) {
        self.inner.closed.store(true, Ordering::SeqCst);
        let _ = self.inner.stop.send(true);
    }
    async fn send(&self, request: Request) -> Result<(), String> {
        if self.is_closed() {
            return Err("Encrypted connection is closed".into());
        }
        self.inner
            .outbound
            .send(request)
            .await
            .map_err(|_| "Encrypted connection is closed".into())
    }
    pub async fn request(
        &self,
        method: String,
        path: String,
        body: Option<String>,
    ) -> Result<Response, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id.clone(), tx);
        if let Err(error) = self
            .send(Request::Http {
                id: id.clone(),
                method,
                path,
                body,
            })
            .await
        {
            self.inner.pending.lock().await.remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(Duration::from_secs(40), rx).await;
        self.inner.pending.lock().await.remove(&id);
        match result {
            Ok(Ok(result)) => match result? {
                Response::Error { message, .. } => Err(message),
                response => Ok(response),
            },
            _ => Err("Encrypted request timed out or was interrupted".into()),
        }
    }
    pub async fn open_socket(
        &self,
        id: String,
        path: String,
    ) -> Result<mpsc::Receiver<Response>, String> {
        let (tx, rx) = mpsc::channel(32);
        let mut sockets = self.inner.sockets.lock().await;
        if sockets.contains_key(&id) || sockets.len() >= 32 {
            return Err("Invalid or duplicate socket".into());
        }
        sockets.insert(id.clone(), tx);
        drop(sockets);
        if let Err(error) = self
            .send(Request::Open {
                id: id.clone(),
                path,
            })
            .await
        {
            self.inner.sockets.lock().await.remove(&id);
            return Err(error);
        }
        Ok(rx)
    }
    pub async fn socket_text(&self, id: String, data: String) -> Result<(), String> {
        self.send(Request::Text { id, data }).await
    }
    pub async fn socket_binary(&self, id: String, data: String) -> Result<(), String> {
        self.send(Request::Binary { id, data }).await
    }
    pub async fn close_socket(&self, id: String) -> Result<(), String> {
        self.inner.sockets.lock().await.remove(&id);
        self.send(Request::Close { id }).await
    }
}
async fn fail(inner: &Arc<Inner>) {
    inner.closed.store(true, Ordering::SeqCst);
    let _ = inner.stop.send(true);
    for (_, pending) in inner.pending.lock().await.drain() {
        let _ = pending.send(Err("Encrypted connection interrupted".into()));
    }
    inner.sockets.lock().await.clear();
}
