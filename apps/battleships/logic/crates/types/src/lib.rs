use borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::abi::AbiType;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(AbiType, Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum GameError {
    #[error("not found: {0}")]
    NotFound(String),
    // String (not &'static str) so call sites can format the underlying
    // error into the message instead of discarding it. The vast majority
    // of call sites used to be `.map_err(|_| Invalid("foo failed"))`,
    // which threw away every storage / parse / IO error in the codebase.
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("already finished")]
    Finished,
    #[error("match id already exists")]
    MatchIdCollision,
    #[error("board commitment already set")]
    AlreadyCommitted,
    #[error("commitment hash does not match revealed board")]
    CommitmentMismatch,
    #[error("audit failed: {reason}")]
    AuditFailed { reason: String },
    #[error("private board not found for this match")]
    BoardNotFound,
}

/// Player public key — 32-byte Ed25519 key with base58 encoding.
///
/// Note: `from_executor_id()` lives in each service crate (requires calimero-sdk).
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq,
)]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    /// Parse an id as core renders it: 64 HEX characters.
    ///
    /// Was base58. core 0.11.0-rc.27 removed base58 from ids entirely, so every
    /// identity this app receives — `memberPublicKey` from a context join, an
    /// account from the node, a player id typed into the UI — is hex. The
    /// contract kept decoding base58, so `create_match` rejected a perfectly
    /// good opponent with "player2 is not a valid base58 public key" and the
    /// game could not be started at all on rc.28.
    pub fn from_hex(encoded: &str) -> Result<PublicKey, GameError> {
        let decoded =
            hex::decode(encoded).map_err(|e| GameError::Invalid(format!("bad hex key: {e}")))?;
        if decoded.len() != 32 {
            return Err(GameError::Invalid("key length".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&decoded);
        Ok(PublicKey(arr))
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_base58_roundtrip() {
        let key = PublicKey([42u8; 32]);
        let encoded = key.to_hex();
        let decoded = PublicKey::from_hex(&encoded).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn public_key_bad_base58_fails() {
        assert!(PublicKey::from_hex("!!!invalid!!!").is_err());
    }

    #[test]
    fn public_key_wrong_length_fails() {
        let short = hex::encode([1u8; 16]);
        assert!(PublicKey::from_hex(&short).is_err());
    }

    #[test]
    fn public_key_borsh_roundtrip() {
        let key = PublicKey([7u8; 32]);
        let bytes = borsh::to_vec(&key).unwrap();
        let decoded: PublicKey = borsh::from_slice(&bytes).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn game_error_display() {
        let err = GameError::NotFound("test".into());
        assert!(err.to_string().contains("test"));
        assert!(GameError::Finished.to_string().contains("finished"));
    }

    #[test]
    fn error_variants_exist() {
        let _ = GameError::MatchIdCollision;
        let _ = GameError::AlreadyCommitted;
        let _ = GameError::CommitmentMismatch;
        let _ = GameError::AuditFailed { reason: "x".into() };
        let _ = GameError::BoardNotFound;
    }
}
