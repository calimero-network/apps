//! Shared, domain-neutral helpers for foundation services.
//!
//! A generic `Error` enum, a base58 `PublicKey`, an id generator, and a small
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

/// A 32-byte Ed25519 public key with base58 encoding.
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

    pub fn from_base58(encoded: &str) -> Result<PublicKey, Error> {
        let decoded = bs58::decode(encoded)
            .into_vec()
            .map_err(|e| Error::Invalid(format!("bad base58 key: {e}")))?;
        if decoded.len() != 32 {
            return Err(Error::Invalid("key length".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&decoded);
        Ok(PublicKey(arr))
    }

    pub fn to_base58(&self) -> String {
        bs58::encode(&self.0).into_string()
    }
}

/// Maximum length (Unicode scalar values) of a user-supplied label/name.
pub const MAX_LABEL_LEN: usize = 64;

/// Validate a short, user-supplied label (item name, title, …). Pure (no host
/// calls) so it is unit-testable on the host and reusable across services.
pub fn validate_label(label: &str) -> Result<(), Error> {
    if label.trim().is_empty() {
        return Err(Error::Invalid("label must not be empty".into()));
    }
    if label.chars().count() > MAX_LABEL_LEN {
        return Err(Error::Invalid(format!(
            "label must be at most {MAX_LABEL_LEN} characters"
        )));
    }
    Ok(())
}

/// Validate a sheet name: the `validate_label` rules plus a character
/// restriction so a name can never collide with the canonical `[id]!` reference
/// qualifier (and stays parseable when typed). Forbids `[ ] ! : ' "` and control
/// characters (mirrors Excel's forbidden set plus our delimiters).
pub fn validate_sheet_name(name: &str) -> Result<(), Error> {
    validate_label(name)?;
    const FORBIDDEN: &[char] = &['[', ']', '!', ':', '\'', '"'];
    if name.chars().any(|c| FORBIDDEN.contains(&c) || c.is_control()) {
        return Err(Error::Invalid(
            "sheet name may not contain [ ] ! : ' \" or control characters".into(),
        ));
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
    fn public_key_base58_roundtrip() {
        let key = PublicKey([42u8; 32]);
        let decoded = PublicKey::from_base58(&key.to_base58()).unwrap();
        assert_eq!(key, decoded);
    }

    #[test]
    fn public_key_bad_base58_fails() {
        assert!(PublicKey::from_base58("!!!invalid!!!").is_err());
    }

    #[test]
    fn public_key_wrong_length_fails() {
        let short = bs58::encode([1u8; 16]).into_string();
        assert!(PublicKey::from_base58(&short).is_err());
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
        assert!(Error::NotFound("widget-1".into()).to_string().contains("widget-1"));
    }

    #[test]
    fn validate_label_accepts_normal() {
        assert!(validate_label("My Widget").is_ok());
    }

    #[test]
    fn validate_label_rejects_empty_and_long() {
        assert!(validate_label("   ").is_err());
        assert!(validate_label(&"a".repeat(MAX_LABEL_LEN + 1)).is_err());
    }

    #[test]
    fn generate_id_has_expected_shape() {
        let id = generate_id("item", 1700000000000, &[0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(id, "item-1700000000000-deadbeef");
    }

    #[test]
    fn validate_sheet_name_accepts_normal() {
        assert!(validate_sheet_name("Q3 Budget").is_ok());
        assert!(validate_sheet_name("Sheet 1 (2)").is_ok());
    }

    #[test]
    fn validate_sheet_name_rejects_delimiter_chars() {
        for bad in ["a!b", "a[b", "a]b", "a:b", "a'b", "a\"b"] {
            assert!(validate_sheet_name(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn validate_sheet_name_rejects_empty() {
        assert!(validate_sheet_name("   ").is_err());
    }
}
