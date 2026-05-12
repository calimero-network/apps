//! Permissions layer for the registry service: owner / managers bootstrap and
//! per-(folder, member) `Role` storage. The public `#[app::logic]` wrappers
//! that call these live in `lib.rs` (ABI-emitter constraint); the gating,
//! key encoding, and `_inner` mutators live here.

use calimero_storage::collections::{FrozenValue, LwwRegister};
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
        self.managers
            .contains(&caller.to_string())
            .map_err(|e| DriveError::Invalid(format!("managers.contains: {e}")))
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

    /// Owner-only. Validates `member` as base58. Re-adding an existing
    /// manager is a no-op success.
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
            return Err(DriveError::Invalid(
                "owner is implicitly a manager".into(),
            ));
        }
        self.managers
            .insert(member, FrozenValue::from(()))
            .map_err(|e| DriveError::Invalid(format!("managers.insert: {e}")))?;
        Ok(())
    }

    /// Owner-only. `NotFound` if `member` is not currently a manager.
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
        let removed = self
            .managers
            .remove(&member)
            .map_err(|e| DriveError::Invalid(format!("managers.remove: {e}")))?;
        if removed.is_none() {
            return Err(DriveError::NotFound(member));
        }
        Ok(())
    }

    pub(crate) fn list_managers_inner(&self) -> Result<Vec<String>, DriveError> {
        let entries = self
            .managers
            .entries()
            .map_err(|e| DriveError::Invalid(format!("managers.entries: {e}")))?;
        Ok(entries.map(|(k, _)| k).collect())
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

    /// Admin-gated. Removes the explicit row (member falls back to `Editor`).
    /// `NotFound` if there was no row.
    pub(crate) fn clear_folder_role_inner(
        &mut self,
        caller: &str,
        folder_id: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        self.require_admin(caller)?;
        let member = validate_member_key(member)?;
        let removed = self
            .folder_roles
            .remove(&role_key(folder_id, &member))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.remove: {e}")))?;
        if removed.is_none() {
            return Err(DriveError::NotFound(format!("{folder_id}/{member}")));
        }
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
    /// `unregister_folder_inner`).
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
mod tests {}
