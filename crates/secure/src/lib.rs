//! App ↔ Hub encryption, independent of terminal input mode and relay provider.
//!
//! Cryptography and nonce handling belong to Snow's standard Noise IK pattern.
//! The QR-pinned Hub key authenticates the server; the client's encrypted static
//! key identifies its revocable device. No application data enters handshake
//! payloads: authentication/pairing happens in the transport phase.
use snow::{Builder, HandshakeState, TransportState};
use zeroize::Zeroizing;

pub mod client;
pub mod messages;
pub mod pairing;

pub const NOISE_PATTERN: &str = "Noise_IK_25519_ChaChaPoly_SHA256";
pub const PROLOGUE: &[u8] = b"offdesk-secure-v1";
pub const MAX_RECORD: usize = 65_535;
pub const MAX_PLAINTEXT_RECORD: usize = MAX_RECORD - 16;
pub const MAX_MESSAGE: usize = 32 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Secure handshake or authentication failed")]
    Noise(#[from] snow::Error),
    #[error("Encrypted message is too large")]
    TooLarge,
    #[error("Malformed encrypted message")]
    InvalidMessage,
    #[error("Secure channel has failed; reconnect before sending")]
    Closed,
}

/// Intentionally not Debug or Serialize: private keys must never enter logs.
pub struct Identity {
    private: Zeroizing<Vec<u8>>,
    public: [u8; 32],
}
impl Identity {
    pub fn generate() -> Result<Self, Error> {
        let pair = builder().generate_keypair()?;
        Ok(Self {
            private: Zeroizing::new(pair.private),
            public: pair.public.try_into().map_err(|_| Error::InvalidMessage)?,
        })
    }
    pub fn from_private(private: &[u8]) -> Result<Self, Error> {
        // Recover the public key through the same primitive used by Snow.
        // A temporary NN handshake's ephemeral key is not a static key, so
        // never substitute handshake output for the public-key derivation.
        if private.len() != 32 {
            return Err(Error::InvalidMessage);
        }
        let mut dh = snow::resolvers::DefaultResolver::default()
            .resolve_dh(&snow::params::DHChoice::Curve25519)
            .ok_or(Error::InvalidMessage)?;
        dh.set(private);
        let public = dh.pubkey().try_into().map_err(|_| Error::InvalidMessage)?;
        Ok(Self {
            private: Zeroizing::new(private.to_vec()),
            public,
        })
    }
    pub fn public(&self) -> &[u8; 32] {
        &self.public
    }
    /// Only for the native credential store / Hub's protected key file.
    pub fn private_for_storage(&self) -> &[u8] {
        &self.private
    }
    pub fn initiator(&self, pinned_hub: &[u8; 32]) -> Result<HandshakeState, Error> {
        Ok(builder()
            .local_private_key(&self.private)?
            .remote_public_key(pinned_hub)?
            .prologue(PROLOGUE)?
            .build_initiator()?)
    }
    pub fn responder(&self) -> Result<HandshakeState, Error> {
        Ok(builder()
            .local_private_key(&self.private)?
            .prologue(PROLOGUE)?
            .build_responder()?)
    }
}
use snow::resolvers::CryptoResolver;
fn builder<'a>() -> Builder<'a> {
    Builder::new(NOISE_PATTERN.parse().expect("fixed Noise pattern"))
}

/// Noise protects ordered records. An authenticated length prefix bounds each
/// application message before allocation, including large composer attachments.
/// Any decoding/authentication failure poisons the channel; callers must close
/// it rather than attempting to resynchronize counters after a bad record.
pub struct Channel {
    noise: TransportState,
    pending: Vec<u8>,
    expected: Option<usize>,
    failed: bool,
}
impl Channel {
    pub fn new(noise: TransportState) -> Self {
        Self {
            noise,
            pending: Vec::new(),
            expected: None,
            failed: false,
        }
    }
    pub fn encode(&mut self, message: &[u8]) -> Result<Vec<Vec<u8>>, Error> {
        if self.failed {
            return Err(Error::Closed);
        }
        if message.is_empty() || message.len() > MAX_MESSAGE {
            return Err(Error::TooLarge);
        }
        let mut framed = Vec::with_capacity(message.len() + 4);
        framed.extend_from_slice(&(message.len() as u32).to_be_bytes());
        framed.extend_from_slice(message);
        let mut records = Vec::new();
        for chunk in framed.chunks(MAX_PLAINTEXT_RECORD) {
            let mut record = vec![0; chunk.len() + 16];
            match self.noise.write_message(chunk, &mut record) {
                Ok(n) => {
                    record.truncate(n);
                    records.push(record);
                }
                Err(error) => {
                    self.failed = true;
                    return Err(error.into());
                }
            }
        }
        Ok(records)
    }
    pub fn decode(&mut self, record: &[u8]) -> Result<Vec<Vec<u8>>, Error> {
        if self.failed {
            return Err(Error::Closed);
        }
        let result = self.decode_inner(record);
        if result.is_err() {
            self.failed = true;
            self.pending.clear();
        }
        result
    }
    fn decode_inner(&mut self, record: &[u8]) -> Result<Vec<Vec<u8>>, Error> {
        if !(16..=MAX_RECORD).contains(&record.len()) {
            return Err(Error::InvalidMessage);
        }
        let mut plaintext = vec![0; record.len()];
        let n = self.noise.read_message(record, &mut plaintext)?;
        let mut remaining = &plaintext[..n];
        let mut messages = Vec::new();
        while !remaining.is_empty() {
            let target = self.expected.unwrap_or(4);
            let take = remaining.len().min(target - self.pending.len());
            self.pending.extend_from_slice(&remaining[..take]);
            remaining = &remaining[take..];
            if self.pending.len() != target {
                continue;
            }
            if self.expected.is_none() {
                let size = u32::from_be_bytes(self.pending[..4].try_into().unwrap()) as usize;
                if size == 0 || size > MAX_MESSAGE {
                    return Err(Error::TooLarge);
                }
                self.pending.clear();
                self.expected = Some(size);
            } else {
                messages.push(std::mem::take(&mut self.pending));
                self.expected = None;
            }
        }
        Ok(messages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn handshake() -> (Channel, Channel) {
        let client = Identity::generate().unwrap();
        let hub = Identity::generate().unwrap();
        let mut a = client.initiator(hub.public()).unwrap();
        let mut b = hub.responder().unwrap();
        let mut wire = [0; MAX_RECORD];
        let mut plain = [0; MAX_RECORD];
        let n = a.write_message(&[], &mut wire).unwrap();
        assert_eq!(b.read_message(&wire[..n], &mut plain).unwrap(), 0);
        let n = b.write_message(&[], &mut wire).unwrap();
        assert_eq!(a.read_message(&wire[..n], &mut plain).unwrap(), 0);
        assert_eq!(b.get_remote_static().unwrap(), client.public());
        assert_eq!(a.get_handshake_hash(), b.get_handshake_hash());
        (
            Channel::new(a.into_transport_mode().unwrap()),
            Channel::new(b.into_transport_mode().unwrap()),
        )
    }
    #[test]
    fn identity_restores_the_same_public_key() {
        let identity = Identity::generate().unwrap();
        let restored = Identity::from_private(identity.private_for_storage()).unwrap();
        assert_eq!(identity.public(), restored.public());
    }
    #[test]
    fn messages_round_trip_with_fragmented_images_and_directional_keys() {
        let (mut a, mut b) = handshake();
        let message = vec![123; 20 * 1024 * 1024];
        let mut received = Vec::new();
        for record in a.encode(&message).unwrap() {
            assert!(record.len() <= MAX_RECORD);
            received.extend(b.decode(&record).unwrap());
        }
        assert_eq!(received, vec![message]);
        let reply = b.encode(b"acknowledgement").unwrap();
        assert_eq!(
            a.decode(&reply[0]).unwrap(),
            vec![b"acknowledgement".to_vec()]
        );
    }
    #[test]
    fn tampering_and_replay_poison_the_channel() {
        let (mut a, mut b) = handshake();
        let mut record = a.encode(b"a terminal command").unwrap().remove(0);
        assert_eq!(b.decode(&record).unwrap().len(), 1);
        assert!(b.decode(&record).is_err());
        assert!(matches!(b.decode(&record), Err(Error::Closed)));
        let (mut a, mut b) = handshake();
        record = a.encode(b"another command").unwrap().remove(0);
        record[3] ^= 1;
        assert!(b.decode(&record).is_err());
    }
    #[test]
    fn a_relay_cannot_substitute_another_hub_key() {
        let client = Identity::generate().unwrap();
        let hub = Identity::generate().unwrap();
        let attacker = Identity::generate().unwrap();
        let mut initiator = client.initiator(hub.public()).unwrap();
        let mut impostor = attacker.responder().unwrap();
        let mut wire = [0; MAX_RECORD];
        let n = initiator.write_message(&[], &mut wire).unwrap();
        assert!(impostor
            .read_message(&wire[..n], &mut [0; MAX_RECORD])
            .is_err());
    }
    #[test]
    fn records_cannot_be_reordered_or_moved_to_another_connection() {
        let (mut a, mut b) = handshake();
        let first = a.encode(b"one").unwrap().remove(0);
        let second = a.encode(b"two").unwrap().remove(0);
        assert!(b.decode(&second).is_err());
        let (_, mut other) = handshake();
        assert!(other.decode(&first).is_err());
    }
}
