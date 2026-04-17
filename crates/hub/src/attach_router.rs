use bytes::Bytes;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

/// Sink for bytes destined for one attached browser WebSocket.
///
/// Held inside the `HubRouter`; the per-WS task on the other end of this
/// channel is the only place that writes to the actual axum WebSocket sink.
#[derive(Clone)]
pub struct WsSender(pub mpsc::Sender<Bytes>);

/// Hub-side routing for per-attach traffic.
///
/// The hub is byte-stateless under the new architecture: it does not buffer
/// terminal output, does not track output sequence numbers, and does not run
/// a broadcast channel. Every attach is end-to-end an independent pipe;
/// this router is the only per-attach state the hub holds.
pub struct HubRouter {
    inner: Arc<Mutex<HubRouterInner>>,
}

#[derive(Default)]
struct HubRouterInner {
    senders: HashMap<String, WsSender>,
    /// attach_id -> (machine_id, terminal_id), so we can drop entries when
    /// a machine disconnects without scanning every attach.
    attach_to_terminal: HashMap<String, (String, String)>,
}

impl HubRouter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HubRouterInner::default())),
        }
    }

    pub async fn register(
        &self,
        attach_id: String,
        machine_id: String,
        terminal_id: String,
        sender: WsSender,
    ) {
        let mut inner = self.inner.lock().await;
        inner.senders.insert(attach_id.clone(), sender);
        inner
            .attach_to_terminal
            .insert(attach_id, (machine_id, terminal_id));
    }

    pub async fn lookup_sender(&self, attach_id: &str) -> Option<WsSender> {
        self.inner.lock().await.senders.get(attach_id).cloned()
    }

    pub async fn lookup_terminal(&self, attach_id: &str) -> Option<(String, String)> {
        self.inner
            .lock()
            .await
            .attach_to_terminal
            .get(attach_id)
            .cloned()
    }

    pub async fn unregister(&self, attach_id: &str) {
        let mut inner = self.inner.lock().await;
        inner.senders.remove(attach_id);
        inner.attach_to_terminal.remove(attach_id);
    }

    /// Drop every attach belonging to a machine. Used when the machine
    /// disconnects so we don't leak orphan routing entries.
    pub async fn drop_machine(&self, machine_id: &str) -> Vec<String> {
        let mut inner = self.inner.lock().await;
        let dropped: Vec<String> = inner
            .attach_to_terminal
            .iter()
            .filter(|(_, (m, _))| m == machine_id)
            .map(|(a, _)| a.clone())
            .collect();
        for attach in &dropped {
            inner.senders.remove(attach);
            inner.attach_to_terminal.remove(attach);
        }
        dropped
    }
}

impl Default for HubRouter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws_sender() -> (WsSender, mpsc::Receiver<Bytes>) {
        let (tx, rx) = mpsc::channel::<Bytes>(8);
        (WsSender(tx), rx)
    }

    #[tokio::test]
    async fn register_then_lookup_returns_the_same_sender() {
        let router = HubRouter::new();
        let (sender, mut rx) = ws_sender();
        router
            .register("a1".into(), "m".into(), "t".into(), sender)
            .await;
        let found = router.lookup_sender("a1").await.expect("registered");
        found.0.send(Bytes::from_static(b"hi")).await.unwrap();
        assert_eq!(rx.recv().await.unwrap().as_ref(), b"hi");
    }

    #[tokio::test]
    async fn unregister_removes_both_maps() {
        let router = HubRouter::new();
        let (sender, _rx) = ws_sender();
        router
            .register("a1".into(), "m".into(), "t".into(), sender)
            .await;
        router.unregister("a1").await;
        assert!(router.lookup_sender("a1").await.is_none());
        assert!(router.lookup_terminal("a1").await.is_none());
    }

    #[tokio::test]
    async fn drop_machine_drops_only_that_machines_attaches() {
        let router = HubRouter::new();
        let (s1, _r1) = ws_sender();
        let (s2, _r2) = ws_sender();
        let (s3, _r3) = ws_sender();
        router
            .register("a1".into(), "m1".into(), "t1".into(), s1)
            .await;
        router
            .register("a2".into(), "m1".into(), "t2".into(), s2)
            .await;
        router
            .register("a3".into(), "m2".into(), "t3".into(), s3)
            .await;
        let dropped = router.drop_machine("m1").await;
        assert_eq!(dropped.len(), 2);
        assert!(router.lookup_sender("a1").await.is_none());
        assert!(router.lookup_sender("a2").await.is_none());
        assert!(router.lookup_sender("a3").await.is_some());
    }
}
