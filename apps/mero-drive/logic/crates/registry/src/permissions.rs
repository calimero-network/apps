//! Permissions layer for the registry service: owner / managers bootstrap and
//! per-(folder, member) `Role` storage. The public `#[app::logic]` wrappers
//! that call these live in `lib.rs` (ABI-emitter constraint); the gating,
//! key encoding, and `_inner` mutators live here.

use calimero_storage::collections::LwwRegister;
use mero_drive_types::DriveError;

use crate::{FolderRoleEntry, RegistryState, Role};

/// Composite key for the per-(folder, member) role map. U+001F (ASCII Unit
/// Separator) cannot appear in a base58 string or a Calimero group id, so it
/// is a safe, collision-free delimiter.
pub(crate) fn role_key(folder_id: &str, member_b58: &str) -> String {
    format!("{folder_id}\u{1f}{member_b58}")
}

/// Prefix matching every role row for one folder.
pub(crate) fn role_key_prefix(folder_id: &str) -> String {
    format!("{folder_id}\u{1f}")
}

/// base58 public key of the caller (the context executor).
pub(crate) fn caller_b58() -> Result<String, DriveError> {
    let id = calimero_sdk::env::executor_id();
    if id.len() != 32 {
        return Err(DriveError::Invalid("executor id length".into()));
    }
    Ok(bs58::encode(&id).into_string())
}

/// Validate & normalise an incoming base58 32-byte public key.
pub(crate) fn validate_member_key(s: &str) -> Result<String, DriveError> {
    let decoded = bs58::decode(s)
        .into_vec()
        .map_err(|e| DriveError::Invalid(format!("bad base58 key: {e}")))?;
    if decoded.len() != 32 {
        return Err(DriveError::Invalid("member key length".into()));
    }
    Ok(bs58::encode(&decoded).into_string())
}

impl RegistryState {
    /// True if `caller` is the owner or a manager. Fail-closed: if no owner
    /// has been claimed yet, nobody is an admin.
    pub(crate) fn is_admin(&self, caller: &str) -> Result<bool, DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() {
            return Ok(false);
        }
        if owner == caller {
            return Ok(true);
        }
        let reg = self
            .managers
            .get(&caller.to_string())
            .map_err(|e| DriveError::Invalid(format!("managers.get: {e}")))?;
        Ok(matches!(reg.as_ref().map(|r| *r.get()), Some(true)))
    }

    pub(crate) fn require_admin(&self, caller: &str) -> Result<(), DriveError> {
        if self.is_admin(caller)? {
            Ok(())
        } else {
            Err(DriveError::Forbidden(format!(
                "not a registry admin: {caller}"
            )))
        }
    }

    pub(crate) fn owner_b58(&self) -> String {
        self.owner.get().clone()
    }

    /// Claim ownership of the registry. Idempotent for the current owner;
    /// `Forbidden` if a different key already owns it.
    pub(crate) fn claim_owner_inner(&mut self, caller: &str) -> Result<(), DriveError> {
        let cur = self.owner_b58();
        if cur.is_empty() {
            self.owner.set(caller.to_string());
            Ok(())
        } else if cur == caller {
            Ok(())
        } else {
            Err(DriveError::Forbidden(format!(
                "registry already owned by {cur}"
            )))
        }
    }

    /// Owner-only. Validates `member` as base58. Re-adding / re-granting an
    /// existing or previously-removed manager succeeds (a fresh `LwwRegister`
    /// with the current HLC always wins — the key is never tombstoned).
    pub(crate) fn add_manager_inner(
        &mut self,
        caller: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() || owner != caller {
            return Err(DriveError::Forbidden(
                "only the registry owner may add managers".into(),
            ));
        }
        let member = validate_member_key(member)?;
        if member == owner {
            return Err(DriveError::Invalid("owner is implicitly a manager".into()));
        }
        self.managers
            .insert(member, LwwRegister::new(true))
            .map_err(|e| DriveError::Invalid(format!("managers.insert: {e}")))?;
        Ok(())
    }

    /// Owner-only. `NotFound` if `member` is not currently a manager. Does
    /// not `remove` the key — it sets the value to `false` so a later
    /// `add_manager` of the same key isn't swallowed by a tombstone.
    pub(crate) fn remove_manager_inner(
        &mut self,
        caller: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() || owner != caller {
            return Err(DriveError::Forbidden(
                "only the registry owner may remove managers".into(),
            ));
        }
        let member = validate_member_key(member)?;
        let reg = self
            .managers
            .get(&member)
            .map_err(|e| DriveError::Invalid(format!("managers.get: {e}")))?;
        match reg {
            Some(mut reg) if *reg.get() => {
                reg.set(false);
                self.managers
                    .insert(member, reg)
                    .map_err(|e| DriveError::Invalid(format!("managers.insert: {e}")))?;
                Ok(())
            }
            _ => Err(DriveError::NotFound(member)),
        }
    }

    pub(crate) fn list_managers_inner(&self) -> Result<Vec<String>, DriveError> {
        let entries = self
            .managers
            .entries()
            .map_err(|e| DriveError::Invalid(format!("managers.entries: {e}")))?;
        Ok(entries
            .filter(|(_, reg)| *reg.get())
            .map(|(k, _)| k)
            .collect())
    }

    /// Admin-gated (owner or manager). Folder must exist. Validates `member`.
    pub(crate) fn set_folder_role_inner(
        &mut self,
        caller: &str,
        folder_id: &str,
        member: &str,
        role: Role,
    ) -> Result<(), DriveError> {
        self.require_admin(caller)?;
        let known = self
            .folders
            .contains(&folder_id.to_string())
            .map_err(|e| DriveError::Invalid(format!("folders.contains: {e}")))?;
        if !known {
            return Err(DriveError::NotFound(folder_id.to_string()));
        }
        let member = validate_member_key(member)?;
        self.folder_roles
            .insert(role_key(folder_id, &member), LwwRegister::new(role))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.insert: {e}")))?;
        Ok(())
    }

    /// Admin-gated. Resets the member to the implicit `Editor` role;
    /// idempotent (clearing an already-default/absent member is a harmless
    /// no-op success). Does not `remove` the row — it overwrites it with
    /// `Editor` so the key is never tombstoned (a later `set_folder_role`
    /// of the same folder+member would otherwise be swallowed).
    pub(crate) fn clear_folder_role_inner(
        &mut self,
        caller: &str,
        folder_id: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        self.require_admin(caller)?;
        let member = validate_member_key(member)?;
        self.folder_roles
            .insert(role_key(folder_id, &member), LwwRegister::new(Role::Editor))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.insert: {e}")))?;
        Ok(())
    }

    /// Read — no caller gating. Validates `member` as base58; returns the
    /// stored role or `Role::Editor` if none.
    pub(crate) fn get_folder_role_inner(
        &self,
        folder_id: &str,
        member: &str,
    ) -> Result<Role, DriveError> {
        let member = validate_member_key(member)?;
        let reg = self
            .folder_roles
            .get(&role_key(folder_id, &member))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.get: {e}")))?;
        Ok(reg.map(|r| *r.get()).unwrap_or(Role::Editor))
    }

    pub(crate) fn list_folder_roles_inner(
        &self,
        folder_id: &str,
    ) -> Result<Vec<FolderRoleEntry>, DriveError> {
        let prefix = role_key_prefix(folder_id);
        let entries = self
            .folder_roles
            .entries()
            .map_err(|e| DriveError::Invalid(format!("folder_roles.entries: {e}")))?;
        let mut out = Vec::new();
        for (k, reg) in entries {
            if let Some(member) = k.strip_prefix(&prefix) {
                out.push(FolderRoleEntry {
                    member: member.to_string(),
                    role: *reg.get(),
                });
            }
        }
        Ok(out)
    }

    /// Drop every per-member role row for a folder (called from
    /// `unregister_folder_inner`). Uses `remove` deliberately — the folder id
    /// is tombstoned in `folders` and can never be re-registered, so
    /// tombstoning its role rows too is correct and consistent.
    pub(crate) fn purge_folder_roles(&mut self, folder_id: &str) -> Result<(), DriveError> {
        let prefix = role_key_prefix(folder_id);
        let stale: Vec<String> = self
            .folder_roles
            .entries()
            .map_err(|e| DriveError::Invalid(format!("folder_roles.entries: {e}")))?
            .map(|(k, _)| k)
            .filter(|k| k.starts_with(&prefix))
            .collect();
        for k in stale {
            self.folder_roles
                .remove(&k)
                .map_err(|e| DriveError::Invalid(format!("folder_roles.remove: {e}")))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{RegistryState, Role};
    use mero_drive_types::DriveError;

    fn key(byte: u8) -> String {
        bs58::encode([byte; 32]).into_string()
    }
    fn fid(s: &str) -> crate::FolderId {
        crate::FolderId(s.to_string())
    }

    // Convenience: a state with a folder "f1" registered and `owner` claimed.
    fn with_owner_and_folder(owner: &str) -> RegistryState {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.claim_owner_inner(owner).unwrap();
        app
    }

    // ---- claim_owner ----
    #[test]
    fn claim_owner_sets_owner_when_unclaimed() {
        let mut app = RegistryState::init();
        assert_eq!(app.owner_b58(), "");
        app.claim_owner_inner(&key(1)).unwrap();
        assert_eq!(app.owner_b58(), key(1));
    }
    #[test]
    fn claim_owner_is_idempotent_for_owner() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.claim_owner_inner(&key(1)).unwrap(); // no error
        assert_eq!(app.owner_b58(), key(1));
    }
    #[test]
    fn claim_owner_rejects_second_claimer() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        let err = app.claim_owner_inner(&key(2)).unwrap_err();
        assert!(matches!(err, DriveError::Forbidden(_)));
        assert_eq!(app.owner_b58(), key(1));
    }

    // ---- is_admin / require_admin ----
    #[test]
    fn is_admin_false_before_owner_claimed() {
        let app = RegistryState::init();
        assert!(!app.is_admin(&key(1)).unwrap());
    }
    #[test]
    fn owner_is_admin_managers_are_admin_others_are_not() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        assert!(app.is_admin(&key(1)).unwrap());
        assert!(app.is_admin(&key(2)).unwrap());
        assert!(!app.is_admin(&key(3)).unwrap());
        assert!(app.require_admin(&key(3)).is_err());
    }

    // ---- managers ----
    #[test]
    fn add_manager_requires_owner() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        // a non-owner (even though there are no managers yet) cannot add
        let err = app.add_manager_inner(&key(2), &key(3)).unwrap_err();
        assert!(matches!(err, DriveError::Forbidden(_)));
    }
    #[test]
    fn add_manager_rejects_owner_as_member_and_bad_key() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        assert!(matches!(
            app.add_manager_inner(&key(1), &key(1)).unwrap_err(),
            DriveError::Invalid(_)
        ));
        assert!(matches!(
            app.add_manager_inner(&key(1), "not-base58!!").unwrap_err(),
            DriveError::Invalid(_)
        ));
        assert!(matches!(
            app.add_manager_inner(&key(1), &bs58::encode([0u8; 16]).into_string())
                .unwrap_err(),
            DriveError::Invalid(_)
        ));
    }
    #[test]
    fn add_then_remove_manager_roundtrips_and_is_listed() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap(); // re-add: ok
        assert_eq!(app.list_managers_inner().unwrap(), vec![key(2)]);
        app.remove_manager_inner(&key(1), &key(2)).unwrap();
        assert!(app.list_managers_inner().unwrap().is_empty());
        assert!(!app.is_admin(&key(2)).unwrap());
    }
    #[test]
    fn re_add_removed_manager_works() {
        // Regression: remove then re-add of the same key must not be
        // swallowed by a CRDT tombstone (the bug Fix 1a addresses).
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.remove_manager_inner(&key(1), &key(2)).unwrap();
        assert!(!app.is_admin(&key(2)).unwrap());
        assert!(app.list_managers_inner().unwrap().is_empty());
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        assert!(app.is_admin(&key(2)).unwrap());
        assert_eq!(app.list_managers_inner().unwrap(), vec![key(2)]);
    }
    #[test]
    fn remove_unknown_manager_is_not_found() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        assert!(matches!(
            app.remove_manager_inner(&key(1), &key(9)).unwrap_err(),
            DriveError::NotFound(_)
        ));
        // After add + remove, the value is `false` — a second remove of the
        // same key is also NotFound (not a no-op success).
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.remove_manager_inner(&key(1), &key(2)).unwrap();
        assert!(matches!(
            app.remove_manager_inner(&key(1), &key(2)).unwrap_err(),
            DriveError::NotFound(_)
        ));
    }

    // ---- folder roles ----
    #[test]
    fn get_folder_role_defaults_to_editor() {
        let app = with_owner_and_folder(&key(1));
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Editor
        );
        // even for an unknown folder:
        assert_eq!(
            app.get_folder_role_inner("ghost", &key(7)).unwrap(),
            Role::Editor
        );
    }
    #[test]
    fn set_folder_role_then_get_returns_it() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer)
            .unwrap();
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Viewer
        );
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Manager)
            .unwrap(); // LWW overwrite
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Manager
        );
    }
    #[test]
    fn set_folder_role_requires_admin() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(
            app.set_folder_role_inner(&key(2), "f1", &key(7), Role::Viewer)
                .unwrap_err(),
            DriveError::Forbidden(_)
        ));
        // a manager can:
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.set_folder_role_inner(&key(2), "f1", &key(7), Role::Viewer)
            .unwrap();
    }
    #[test]
    fn set_folder_role_unknown_folder_is_not_found() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(
            app.set_folder_role_inner(&key(1), "ghost", &key(7), Role::Viewer)
                .unwrap_err(),
            DriveError::NotFound(_)
        ));
    }
    #[test]
    fn set_folder_role_rejects_bad_member_key() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(
            app.set_folder_role_inner(&key(1), "f1", "bad!!", Role::Viewer)
                .unwrap_err(),
            DriveError::Invalid(_)
        ));
    }
    #[test]
    fn clear_folder_role_removes_row_and_falls_back_to_editor() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer)
            .unwrap();
        app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap();
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Editor
        );
    }
    #[test]
    fn clear_folder_role_is_idempotent_and_sets_editor() {
        let mut app = with_owner_and_folder(&key(1));
        // Clearing a never-set member is a no-op success.
        app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap();
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Editor
        );
        // ...and calling it again is still Ok.
        app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap();
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Editor
        );
    }
    #[test]
    fn set_folder_role_after_clear_works() {
        // Regression: set → clear → set must not be swallowed by a tombstone
        // (the bug Fix 1b addresses).
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer)
            .unwrap();
        app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap();
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Manager)
            .unwrap();
        assert_eq!(
            app.get_folder_role_inner("f1", &key(7)).unwrap(),
            Role::Manager
        );
    }
    #[test]
    fn clear_folder_role_requires_admin() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer)
            .unwrap();
        assert!(matches!(
            app.clear_folder_role_inner(&key(2), "f1", &key(7))
                .unwrap_err(),
            DriveError::Forbidden(_)
        ));
    }
    #[test]
    fn list_folder_roles_only_returns_rows_for_that_folder() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("f2"), None, None, None)
            .unwrap();
        app.claim_owner_inner(&key(1)).unwrap();
        app.set_folder_role_inner(&key(1), "f1", &key(2), Role::Viewer)
            .unwrap();
        app.set_folder_role_inner(&key(1), "f1", &key(3), Role::Manager)
            .unwrap();
        app.set_folder_role_inner(&key(1), "f2", &key(2), Role::Viewer)
            .unwrap();
        let mut rows = app.list_folder_roles_inner("f1").unwrap();
        rows.sort_by(|a, b| a.member.cmp(&b.member));
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|r| r.member == key(2) && r.role == Role::Viewer));
        assert!(rows
            .iter()
            .any(|r| r.member == key(3) && r.role == Role::Manager));
        assert_eq!(app.list_folder_roles_inner("f2").unwrap().len(), 1);
    }
    #[test]
    fn unregister_folder_purges_its_roles() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(2), Role::Viewer)
            .unwrap();
        app.unregister_folder_inner(fid("f1")).unwrap();
        assert!(app.list_folder_roles_inner("f1").unwrap().is_empty());
        // and a fresh, distinct folder id has no inherited rows:
        app.register_folder_inner(fid("f2"), None, None, None)
            .unwrap();
        assert_eq!(
            app.get_folder_role_inner("f2", &key(2)).unwrap(),
            Role::Editor
        );
    }
    #[test]
    fn role_key_uses_unit_separator_and_is_unambiguous() {
        // "a" + member vs "a\u{1f}..." prefix must not collide with "a\u{1f}b" + member
        let k1 = super::role_key("a", &key(1));
        let k2 = super::role_key("a\u{1f}b", &key(1));
        assert_ne!(k1, k2);
        assert!(k1.starts_with(&super::role_key_prefix("a")));
        assert!(!k1.starts_with(&super::role_key_prefix("a\u{1f}b")));
    }
}
