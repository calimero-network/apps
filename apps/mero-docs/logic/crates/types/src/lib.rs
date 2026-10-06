//! Shared types for the mero-docs multi-service bundle.
//!
//! Folder types (ids, visibility, roles) are not here: folders are core
//! subgroups, so neither service stores or exchanges them.
//!
//! `DriveError` is the error type used inside each service's helper
//! functions. Public `#[app::logic]` methods return `app::Result<T>` and
//! convert it with `DriveError::into_app`, so a client receives the tagged
//! `{ kind, data }` value rather than prose.

use serde::Serialize;
use thiserror::Error;

pub const TAG_KEY_MAX: usize = 64; // tag keys are ids the registry maps to a name

/// A tag key is a stable id, not the tag's display name: lowercase ASCII
/// letters, digits and `-`, 1 to `TAG_KEY_MAX` characters.
pub fn is_valid_tag_key(key: &str) -> bool {
    (1..=TAG_KEY_MAX).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum DriveError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl DriveError {
    /// The contract error a client receives: `{ "kind": <variant>, "data": <detail> }`.
    pub fn into_app(self) -> calimero_sdk::types::Error {
        calimero_sdk::app::err!(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_error_messages_roundtrip() {
        let err = DriveError::NotFound("x".into());
        assert!(err.to_string().contains("not found"));
        assert!(err.to_string().contains('x'));
    }

    #[test]
    fn a_tag_key_is_lowercase_letters_digits_and_dashes() {
        assert!(is_valid_tag_key("launch-2"));
        assert!(is_valid_tag_key(&"a".repeat(TAG_KEY_MAX)));
        for bad in ["", "Launch", "a b", "a_b", "caf\u{e9}"] {
            assert!(!is_valid_tag_key(bad), "{bad:?}");
        }
        assert!(!is_valid_tag_key(&"a".repeat(TAG_KEY_MAX + 1)));
    }
}
