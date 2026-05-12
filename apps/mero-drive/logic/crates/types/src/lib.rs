//! Shared types for the mero-drive multi-service bundle.
//!
//! `FolderId` / `ContextId` wrap raw string ids so that the public ABI keeps
//! its domain meaning (a function taking `FolderId` cannot be confused with
//! one taking an arbitrary opaque string).
//!
//! `Visibility` is the registry's per-folder inheritance flag:
//! - `Inherit`  — cascade parent members down from the parent folder
//! - `Restricted` — subtree is opaque; cascades stop at the boundary
//!
//! `DriveError` is the *internal* error type used inside each service's
//! helper functions. Public `#[app::logic]` methods return `app::Result<T>`
//! and convert `DriveError` via `AppError::msg(e.to_string())`, so the ABI
//! surface exposes a single uniform error variant per service.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

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
    Debug,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
)]
pub enum Visibility {
    #[default]
    Inherit,
    Restricted,
}

/// Per-folder collaborator role — the *application* permission for what a
/// member may do inside a folder, distinct from core's namespace-level
/// `MemberCapabilities` bitmask (core gates *joining* a subgroup; this gates
/// what you do once you are in it).
///
/// A member with no explicit role row is treated as `Editor`. `Viewer` is
/// read-only; `Manager` may additionally set other members' folder roles.
///
/// Phase-2 (per-document ACLs, share links, approval workflows) will layer
/// finer-grained grants on top of this in the `docs` service; this enum is
/// the coarse folder-level baseline.
#[derive(
    Debug,
    Default,
    Clone,
    Copy,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
)]
pub enum Role {
    Viewer,
    #[default]
    Editor,
    Manager,
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

    #[test]
    fn role_default_is_editor() {
        assert_eq!(Role::default(), Role::Editor);
    }

    #[test]
    fn role_borsh_roundtrip() {
        for r in [Role::Viewer, Role::Editor, Role::Manager] {
            let bytes = borsh::to_vec(&r).unwrap();
            let back: Role = borsh::from_slice(&bytes).unwrap();
            assert_eq!(r, back);
        }
    }
}
