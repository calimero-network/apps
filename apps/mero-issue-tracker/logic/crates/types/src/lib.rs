//! Shared, domain-neutral helpers for foundation services.
//!
//! A generic `Error` enum, a hex `PublicKey`, an id generator, and a small
//! label validator. No app-specific (chat / item / …) variants live here — a
//! service crate adds its own domain errors on top of this generic set.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Generic service error. Services return these (or wrap them in
/// `calimero_sdk::types::Error`) so the frontend gets a stable, typed shape.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum Error {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
}

/// A 32-byte Ed25519 public key with hex encoding.
///
/// Hex, not base58: core 0.11.0-rc.27 removed base58 and renders every id as
/// 64 hex characters, so the encoded form has to match what the node and
/// frontend now speak.
///
/// Note: `from_executor_id()` lives in each service crate (it needs
/// `calimero-sdk`, which this crate deliberately does not depend on).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicKey(pub [u8; 32]);

impl PublicKey {
    pub fn from_raw_bytes(v: &[u8]) -> Result<PublicKey, Error> {
        if v.len() != 32 {
            return Err(Error::Invalid("key length".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(v);
        Ok(PublicKey(arr))
    }

    pub fn from_hex(encoded: &str) -> Result<PublicKey, Error> {
        let decoded =
            hex::decode(encoded).map_err(|e| Error::Invalid(format!("bad hex key: {e}")))?;
        if decoded.len() != 32 {
            return Err(Error::Invalid("key length".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&decoded);
        Ok(PublicKey(arr))
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

/// Maximum length (Unicode scalar values) of a user-supplied label/name.
pub const MAX_LABEL_LEN: usize = 64;

/// Validate a short, user-supplied label (item name, title, …). `field` names
/// the value in the error message (e.g. `"title"`, `"label"`) so callers that
/// reuse this for different fields don't misattribute the error. Pure (no
/// host calls) so it is unit-testable on the host and reusable across
/// services.
pub fn validate_label(field: &str, label: &str) -> Result<(), Error> {
    if label.trim().is_empty() {
        return Err(Error::Invalid(format!("{field} must not be empty")));
    }
    if label.chars().count() > MAX_LABEL_LEN {
        return Err(Error::Invalid(format!(
            "{field} must be at most {MAX_LABEL_LEN} characters"
        )));
    }
    Ok(())
}

/// Generate an id from a prefix, timestamp, and 4 random bytes.
/// Format: `{prefix}-{timestamp}-{hex}`.
pub fn generate_id(prefix: &str, timestamp: u64, nonce: &[u8; 4]) -> String {
    let hex = nonce.iter().fold(String::with_capacity(8), |mut acc, b| {
        acc.push_str(&format!("{b:02x}"));
        acc
    });
    format!("{prefix}-{timestamp}-{hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_hex_roundtrip() {
        let key = PublicKey([42u8; 32]);
        let decoded = PublicKey::from_hex(&key.to_hex()).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn public_key_bad_hex_fails() {
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
    fn error_display_includes_detail() {
        assert!(Error::NotFound("widget-1".into())
            .to_string()
            .contains("widget-1"));
    }

    #[test]
    fn validate_label_accepts_normal() {
        assert!(validate_label("title", "My Widget").is_ok());
    }

    #[test]
    fn validate_label_rejects_empty_and_long() {
        let empty_err = validate_label("title", "   ").unwrap_err();
        assert!(empty_err.to_string().contains("title"));

        let long_err = validate_label("label", &"a".repeat(MAX_LABEL_LEN + 1)).unwrap_err();
        assert!(long_err.to_string().contains("label"));
    }

    #[test]
    fn generate_id_has_expected_shape() {
        let id = generate_id("item", 1700000000000, &[0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(id, "item-1700000000000-deadbeef");
    }
}
