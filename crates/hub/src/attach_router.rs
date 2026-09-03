use bytes::Bytes;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

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
///
/// The maps sit behind a synchronous `RwLock`, not an async mutex: the
/// machine recv loop takes the read lock once per output frame, and the
/// critical sections are a HashMap probe — never held across an await.
pub struct HubRouter {
    inner: Arc<RwLock<HubRouterInner>>,
}

#[derive(Default)]
struct HubRouterInner {
    senders: HashMap<String, WsSender>,
    /// Attaches whose bytes are one deflate stream with context takeover.
    /// A frame of such a stream can never be dropped: the browser inflates
    /// every later frame against a window the missing one should have
    /// filled, and the screen turns to a soup of half-recognisable text
    /// that no redraw can fix. The only recovery is a new stream.
    compressed: std::collections::HashSet<String>,
    /// attach_id -> (machine_id, terminal_id), so we can drop entries when
    /// a machine disconnects without scanning every attach.
    attach_to_terminal: HashMap<String, (String, String)>,
}

impl HubRouter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HubRouterInner::default())),
        }
    }

    pub fn register(
        &self,
        attach_id: String,
        machine_id: String,
        terminal_id: String,
        sender: WsSender,
    ) {
        self.register_with_compression(attach_id, machine_id, terminal_id, sender, false);
    }

    pub fn register_with_compression(
        &self,
        attach_id: String,
        machine_id: String,
        terminal_id: String,
        sender: WsSender,
        compressed: bool,
    ) {
        let mut inner = self.inner.write().unwrap();
        inner.senders.insert(attach_id.clone(), sender);
        if compressed {
            inner.compressed.insert(attach_id.clone());
        }
        inner
            .attach_to_terminal
            .insert(attach_id, (machine_id, terminal_id));
    }

    /// Whether this attach's bytes are a compressed stream — one that must
    /// be reset rather than thinned when the browser falls behind.
    pub fn is_compressed(&self, attach_id: &str) -> bool {
        self.inner.read().unwrap().compressed.contains(attach_id)
    }

    pub fn lookup_sender(&self, attach_id: &str) -> Option<WsSender> {
        self.inner.read().unwrap().senders.get(attach_id).cloned()
    }

    pub fn lookup_terminal(&self, attach_id: &str) -> Option<(String, String)> {
        self.inner
            .read()
            .unwrap()
            .attach_to_terminal
            .get(attach_id)
            .cloned()
    }

    pub fn unregister(&self, attach_id: &str) {
        let mut inner = self.inner.write().unwrap();
        inner.senders.remove(attach_id);
        inner.compressed.remove(attach_id);
        inner.attach_to_terminal.remove(attach_id);
    }

    /// Drop every attach belonging to a machine. Used when the machine
    /// disconnects so we don't leak orphan routing entries.
    pub fn drop_machine(&self, machine_id: &str) -> Vec<String> {
        let mut inner = self.inner.write().unwrap();
        let dropped: Vec<String> = inner
            .attach_to_terminal
            .iter()
            .filter(|(_, (m, _))| m == machine_id)
            .map(|(a, _)| a.clone())
            .collect();
        for attach in &dropped {
            inner.compressed.remove(attach);
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
    async fn a_compressed_attach_is_known_as_such_until_it_is_unregistered() {
        let router = HubRouter::new();
        let (tx, _rx) = mpsc::channel::<Bytes>(8);
        router.register_with_compression(
            "a1".into(),
            "m1".into(),
            "t1".into(),
            WsSender(tx.clone()),
            true,
        );
        router.register("a2".into(), "m1".into(), "t1".into(), WsSender(tx));
        assert!(router.is_compressed("a1"));
        assert!(!router.is_compressed("a2"));
        assert!(!router.is_compressed("nope"));

        router.unregister("a1");
        assert!(!router.is_compressed("a1"));
        assert!(router.lookup_sender("a1").is_none());
    }

    #[tokio::test]
    async fn dropping_a_machine_forgets_its_compressed_attaches_too() {
        let router = HubRouter::new();
        let (tx, _rx) = mpsc::channel::<Bytes>(8);
        router.register_with_compression("a1".into(), "m1".into(), "t1".into(), WsSender(tx), true);
        let dropped = router.drop_machine("m1");
        assert_eq!(dropped, vec!["a1".to_string()]);
        assert!(!router.is_compressed("a1"));
    }

    #[tokio::test]
    async fn register_then_lookup_returns_the_same_sender() {
        let router = HubRouter::new();
        let (sender, mut rx) = ws_sender();
        router.register("a1".into(), "m".into(), "t".into(), sender);
        let found = router.lookup_sender("a1").expect("registered");
        found.0.send(Bytes::from_static(b"hi")).await.unwrap();
        assert_eq!(rx.recv().await.unwrap().as_ref(), b"hi");
    }

    #[test]
    fn unregister_removes_both_maps() {
        let router = HubRouter::new();
        let (sender, _rx) = ws_sender();
        router.register("a1".into(), "m".into(), "t".into(), sender);
        router.unregister("a1");
        assert!(router.lookup_sender("a1").is_none());
        assert!(router.lookup_terminal("a1").is_none());
    }

    #[test]
    fn drop_machine_drops_only_that_machines_attaches() {
        let router = HubRouter::new();
        let (s1, _r1) = ws_sender();
        let (s2, _r2) = ws_sender();
        let (s3, _r3) = ws_sender();
        router.register("a1".into(), "m1".into(), "t1".into(), s1);
        router.register("a2".into(), "m1".into(), "t2".into(), s2);
        router.register("a3".into(), "m2".into(), "t3".into(), s3);
        let dropped = router.drop_machine("m1");
        assert_eq!(dropped.len(), 2);
        assert!(router.lookup_sender("a1").is_none());
        assert!(router.lookup_sender("a2").is_none());
        assert!(router.lookup_sender("a3").is_some());
    }
}
