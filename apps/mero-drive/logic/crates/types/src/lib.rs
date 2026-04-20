//! Shared types for the mero-drive multi-service bundle.
//!
//! `FolderId` / `ContextId` wrap raw string ids so that the public ABI keeps
//! its domain meaning (a function taking `FolderId` cannot be confused with
//! one taking an arbitrary opaque string).
//!
//! `Visibility` is the registry's per-folder inheritance flag:
//! - `Inherit`  — cascade parent members down (with `DEFAULT_CHILD_CAP_MASK`)
//! - `Restricted` — subtree is opaque; cascades stop at the boundary
//!
//! `DriveError` is the *internal* error type used inside each service's
//! helper functions. Public `#[app::logic]` methods return `app::Result<T>`
//! and convert `DriveError` via `AppError::msg(e.to_string())`, so the ABI
//! surface exposes a single uniform error variant per service.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// READ | WRITE | CREATE_GROUP — what a new child folder inherits at most
/// from its parent when visibility is `Inherit`. Admin-role bits (MANAGE_*)
/// are stripped intentionally so that a parent-admin becomes a child-member,
/// not a child-admin.
pub const DEFAULT_CHILD_CAP_MASK: u32 = 1 | 2 | 4;

/// Client-side cap on nesting depth. Registry does not enforce — the UI does.
pub const MAX_FOLDER_DEPTH: u8 = 8;

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
pub struct FolderId(pub String);

impl From<String> for FolderId {
    fn from(s: String) -> Self {
        FolderId(s)
    }
}

impl From<&str> for FolderId {
    fn from(s: &str) -> Self {
        FolderId(s.to_string())
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
pub struct ContextId(pub String);

impl From<String> for ContextId {
    fn from(s: String) -> Self {
        ContextId(s)
    }
}

impl From<&str> for ContextId {
    fn from(s: &str) -> Self {
        ContextId(s.to_string())
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
pub enum Visibility {
    Inherit,
    Restricted,
}

impl Default for Visibility {
    fn default() -> Self {
        Visibility::Inherit
    }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visibility_default_is_inherit() {
        assert_eq!(Visibility::default(), Visibility::Inherit);
    }

    #[test]
    fn default_child_mask_bits() {
        // 1 (READ) | 2 (WRITE) | 4 (CREATE_GROUP)
        assert_eq!(DEFAULT_CHILD_CAP_MASK, 7);
    }

    #[test]
    fn folder_id_borsh_roundtrip() {
        let id = FolderId("abc".into());
        let bytes = borsh::to_vec(&id).unwrap();
        let back: FolderId = borsh::from_slice(&bytes).unwrap();
        assert_eq!(id, back);
    }

    #[test]
    fn visibility_borsh_roundtrip() {
        for v in [Visibility::Inherit, Visibility::Restricted] {
            let bytes = borsh::to_vec(&v).unwrap();
            let back: Visibility = borsh::from_slice(&bytes).unwrap();
            assert_eq!(v, back);
        }
    }

    #[test]
    fn drive_error_messages_roundtrip() {
        let err = DriveError::NotFound("x".into());
        assert!(err.to_string().contains("not found"));
        assert!(err.to_string().contains('x'));
    }

    #[test]
    fn folder_id_from_str_and_string() {
        let a: FolderId = "abc".into();
        let b: FolderId = String::from("abc").into();
        assert_eq!(a, b);
    }
}
