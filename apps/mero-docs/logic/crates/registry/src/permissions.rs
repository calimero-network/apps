//! Permissions layer for the registry service: owner / managers bootstrap and
//! per-(folder, member) `Role` storage. The public `#[app::logic]` wrappers
//! that call these live in `lib.rs`; the gating, key encoding, and `_inner`
//! mutators live here.

use std::collections::BTreeSet;

use calimero_sdk::AccountId;
use calimero_storage::collections::{LwwRegister, Op, StoreError, UnorderedMap};
use mero_docs_types::DriveError;

use crate::{FolderRoleEntry, RegistryState, Role};

/// Composite key for the per-(folder, member) role map. U+001F (ASCII Unit
/// Separator) cannot appear in a hex string or a Calimero group id, so it
/// is a safe, collision-free delimiter.
pub(crate) fn role_key(folder_id: &str, member_hex: &str) -> String {
    format!("{folder_id}\u{1f}{member_hex}")
}

/// Prefix matching every role row for one folder.
pub(crate) fn role_key_prefix(folder_id: &str) -> String {
    format!("{folder_id}\u{1f}")
}

/// The caller's ACCOUNT — who is calling as a person, not which machine
/// they are calling from.
///
/// ⚠️ THIS WAS `device_id()`, AND THAT MADE EVERY GRANT IN THIS FILE A NO-OP.
///
/// Ownership, the manager list and the per-(folder, member) role map are all
/// PER-PERSON state, and the SDK is explicit that per-person state is keyed by
/// the account: `device_id` is "distinct per machine even for one person,
/// which is what makes it right for per-writer state and wrong for per-person
/// state."
///
/// The practical failure was total and silent, because every id involved is 32
/// bytes of hex and nothing can tell them apart:
///
///   * `add_manager` / `set_folder_role` take a member key from the client,
///     and the only member list a client has is `listGroupMembers`, whose rows
///     are ACCOUNTS. So a manager row was filed under an account, while
///     `is_admin` looked the caller up by DEVICE — the row could never match,
///     and a promoted manager stayed `Forbidden` on everything.
///   * The frontend's "am I the owner" check compares `get_owner()` against
///     the account it holds, so the owner is recorded as an account too.
///
/// mero-js documents `GroupMember.identity` as "The member's ACCOUNT: 64
/// hex", and `useNodeIdentity().identity.accountId` is the same value for
/// oneself. So this keys on the account, and every id that crosses the wire in
/// either direction is the same kind of id — the same one the writer sets
/// below are checked against.
pub(crate) fn caller_account() -> AccountId {
    AccountId::from(calimero_sdk::env::account_id())
}

/// [`caller_account`], hex-encoded.
pub(crate) fn caller_account_hex() -> Result<String, DriveError> {
    Ok(hex::encode(caller_account().as_bytes()))
}

/// Validate & normalise an incoming hex 32-byte ACCOUNT id — the same
/// principal `caller_account_hex` produces, and the same one
/// `listGroupMembers` rows are keyed by. Re-encoding lower-cases it, so the
/// stored form is canonical regardless of input case.
///
/// Note this cannot verify WHICH kind of 32-byte id it was handed: an account,
/// a device id and a signing key are all 32 bytes. The only defence is that
/// both ends of every path in this file now name the account, so there is one
/// kind of id in play rather than two.
pub(crate) fn validate_member_key(s: &str) -> Result<String, DriveError> {
    let decoded = hex::decode(s).map_err(|e| DriveError::Invalid(format!("bad hex key: {e}")))?;
    if decoded.len() != 32 {
        return Err(DriveError::Invalid("member key length".into()));
    }
    Ok(hex::encode(&decoded))
}

/// The account a validated hex key names.
fn account_of(member_hex: &str) -> Result<AccountId, DriveError> {
    let bytes: [u8; 32] = hex::decode(member_hex)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| DriveError::Invalid(format!("bad account: {member_hex}")))?;
    Ok(AccountId::from(bytes))
}

fn storage_err(what: &str) -> impl Fn(StoreError) -> DriveError + '_ {
    move |e| DriveError::Invalid(format!("{what}: {e}"))
}

impl RegistryState {
    /// True if `caller` is the owner or a manager.
    pub(crate) fn is_admin(&self, caller: &str) -> Result<bool, DriveError> {
        if self.owner_hex() == caller {
            return Ok(true);
        }
        let reg = self
            .managers
            .get()
            .map_err(storage_err("managers.get"))?
            .get(&caller.to_string())
            .map_err(storage_err("managers.get"))?;
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

    /// The registry's owner, frozen at `init`.
    pub(crate) fn owner_hex(&self) -> String {
        self.owner.get().cloned().unwrap_or_default()
    }

    /// Confirms `caller` owns the registry. The owner is whoever created it,
    /// fixed at `init`, so there is nothing left to claim: this succeeds for
    /// the owner and is `Forbidden` for everyone else. It used to set the
    /// owner first-come-first-served, which let any member take a registry
    /// that had not been claimed yet — and let a patched node overwrite the
    /// owner of one that had.
    pub(crate) fn claim_owner_inner(&self, caller: &str) -> Result<(), DriveError> {
        let cur = self.owner_hex();
        if cur == caller {
            Ok(())
        } else {
            Err(DriveError::Forbidden(format!(
                "registry already owned by {cur}"
            )))
        }
    }

    /// Owner-only. Validates `member` as hex. Re-adding / re-granting an
    /// existing or previously-removed manager succeeds (a fresh `LwwRegister`
    /// with the current HLC always wins — the key is never tombstoned).
    pub(crate) fn add_manager_inner(
        &mut self,
        caller: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        let owner = self.owner_hex();
        if owner != caller {
            return Err(DriveError::Forbidden(
                "only the registry owner may add managers".into(),
            ));
        }
        let member = validate_member_key(member)?;
        if member == owner {
            return Err(DriveError::Invalid("owner is implicitly a manager".into()));
        }
        self.write_managers()?
            .insert(member, LwwRegister::new(true))
            .map_err(storage_err("managers.insert"))?;
        self.sync_admins()
    }

    /// Owner-only. `NotFound` if `member` is not currently a manager. Does
    /// not `remove` the key — it sets the value to `false` so a later
    /// `add_manager` of the same key isn't swallowed by a tombstone.
    pub(crate) fn remove_manager_inner(
        &mut self,
        caller: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        let owner = self.owner_hex();
        if owner != caller {
            return Err(DriveError::Forbidden(
                "only the registry owner may remove managers".into(),
            ));
        }
        let member = validate_member_key(member)?;
        let is_manager = self
            .managers
            .get()
            .map_err(storage_err("managers.get"))?
            .get(&member)
            .map_err(storage_err("managers.get"))?
            .is_some_and(|reg| *reg.get());
        if !is_manager {
            return Err(DriveError::NotFound(member));
        }
        self.write_managers()?
            .insert(member, LwwRegister::new(false))
            .map_err(storage_err("managers.insert"))?;
        self.sync_admins()
    }

    pub(crate) fn list_managers_inner(&self) -> Result<Vec<String>, DriveError> {
        let entries = self
            .managers
            .get()
            .map_err(storage_err("managers.get"))?
            .entries()
            .map_err(storage_err("managers.entries"))?;
        Ok(entries
            .filter(|(_, reg)| *reg.get())
            .map(|(k, _)| k)
            .collect())
    }

    /// The manager map, for its only writer: the owner. Every node refuses a
    /// manager row written by anyone else; this refuses it here as well.
    fn write_managers(
        &mut self,
    ) -> Result<&mut UnorderedMap<String, LwwRegister<bool>>, DriveError> {
        if !self.managers.can(&caller_account(), Op::Write) {
            return Err(DriveError::Forbidden(
                "only the registry owner may change managers".into(),
            ));
        }
        self.managers.get_mut().map_err(storage_err("managers"))
    }

    /// The role map, for its writers: the registry admins.
    fn write_roles(&mut self) -> Result<&mut UnorderedMap<String, LwwRegister<Role>>, DriveError> {
        if !self.folder_roles.can(&caller_account(), Op::Write) {
            return Err(DriveError::Forbidden(
                "only a registry admin may change folder roles".into(),
            ));
        }
        self.folder_roles
            .get_mut()
            .map_err(storage_err("folder_roles"))
    }

    /// Bring the writer sets that follow the admins (owner and managers) in
    /// line after a manager change: the role map's writers and the folders'
    /// moderators. Each is verified by every node, so they are rotated here by
    /// the owner, who is in both.
    fn sync_admins(&mut self) -> Result<(), DriveError> {
        let mut admins = BTreeSet::from([account_of(&self.owner_hex())?]);
        for manager in self.list_managers_inner()? {
            let _ = admins.insert(account_of(&manager)?);
        }
        if self.folder_roles.writers() != admins {
            self.folder_roles
                .rotate_writers(admins.clone())
                .map_err(storage_err("folder_roles.rotate_writers"))?;
        }
        if self.folders.moderators() != admins {
            self.folders
                .set_moderators(admins)
                .map_err(storage_err("folders.set_moderators"))?;
        }
        Ok(())
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
        // Any account's folder: keys are per owner, so a key-only `contains`
        // would ask about the admin's own entry only.
        let known = !self
            .folders
            .entries_at(&folder_id.to_string())
            .map_err(storage_err("folders.entries_at"))?
            .is_empty();
        if !known {
            return Err(DriveError::NotFound(folder_id.to_string()));
        }
        let member = validate_member_key(member)?;
        self.write_roles()?
            .insert(role_key(folder_id, &member), LwwRegister::new(role))
            .map_err(storage_err("folder_roles.insert"))?;
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
        self.write_roles()?
            .insert(role_key(folder_id, &member), LwwRegister::new(Role::Editor))
            .map_err(storage_err("folder_roles.insert"))?;
        Ok(())
    }

    /// Read — no caller gating. Validates `member` as a hex account; returns
    /// the stored role or `Role::Editor` if none.
    ///
    /// A role is what the app shows and gates in its own UI. Nothing below
    /// the app enforces it: the docs service does not consult the registry,
    /// and core admits every member of a folder's group to write its docs,
    /// so a `Viewer` running a modified client can still edit.
    pub(crate) fn get_folder_role_inner(
        &self,
        folder_id: &str,
        member: &str,
    ) -> Result<Role, DriveError> {
        let member = validate_member_key(member)?;
        let reg = self
            .folder_roles
            .get()
            .map_err(storage_err("folder_roles.get"))?
            .get(&role_key(folder_id, &member))
            .map_err(storage_err("folder_roles.get"))?;
        Ok(reg.map(|r| *r.get()).unwrap_or(Role::Editor))
    }

    pub(crate) fn list_folder_roles_inner(
        &self,
        folder_id: &str,
    ) -> Result<Vec<FolderRoleEntry>, DriveError> {
        let prefix = role_key_prefix(folder_id);
        let entries = self
            .folder_roles
            .get()
            .map_err(storage_err("folder_roles.get"))?
            .entries()
            .map_err(storage_err("folder_roles.entries"))?;
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
    /// is tombstoned in `folders` alongside these rows. Since core rc.10 a
    /// strictly-newer register can revive the folder id; the revived folder
    /// then starts with default roles, so purging here stays correct.
    pub(crate) fn purge_folder_roles(&mut self, folder_id: &str) -> Result<(), DriveError> {
        let prefix = role_key_prefix(folder_id);
        let stale: Vec<String> = self
            .folder_roles
            .get()
            .map_err(storage_err("folder_roles.get"))?
            .entries()
            .map_err(storage_err("folder_roles.entries"))?
            .map(|(k, _)| k)
            .filter(|k| k.starts_with(&prefix))
            .collect();
        let roles = self.write_roles()?;
        for k in stale {
            roles
                .remove(&k)
                .map_err(storage_err("folder_roles.remove"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;
    use calimero_storage::collections::Op;
    use mero_docs_types::DriveError;

    use crate::{FolderId, RegistryState, Role};

    const MANAGER: [u8; 32] = [0xA1; 32];
    const MEMBER: [u8; 32] = [0xB2; 32];
    const OTHER: [u8; 32] = [0xC3; 32];

    fn key(account: [u8; 32]) -> String {
        hex::encode(account)
    }
    fn owner() -> [u8; 32] {
        calimero_sdk::env::account_id()
    }
    fn fid(s: &str) -> FolderId {
        FolderId(s.to_string())
    }

    /// A registry created by `owner()`, with folder "f1" registered by them.
    ///
    /// `TestHost::new` does not align the storage layer's account with the
    /// SDK's while `init` runs; a node does, so align them here.
    fn registry() -> TestHost<RegistryState> {
        let mut host =
            TestHost::new(|| calimero_storage::env::with_account_id(owner(), RegistryState::init));
        host.call(|s| s.register_folder(fid("f1"), None, None, None))
            .unwrap();
        host
    }

    fn as_account<R>(
        host: &mut TestHost<RegistryState>,
        who: [u8; 32],
        f: impl FnOnce(&mut RegistryState) -> R,
    ) -> R {
        host.call_as_account(who, who, f)
    }

    fn inner_err<T: std::fmt::Debug>(r: Result<T, DriveError>) -> DriveError {
        r.unwrap_err()
    }

    // ---- owner ----

    #[test]
    fn the_owner_is_whoever_created_the_registry_and_is_fixed() {
        let mut host = registry();
        assert_eq!(host.view(|s| s.get_owner()).unwrap(), key(owner()));
        // Claiming confirms the owner, and nobody else can claim it.
        host.call(|s| s.claim_owner()).unwrap();
        assert!(as_account(&mut host, OTHER, |s| s.claim_owner()).is_err());
        assert_eq!(host.view(|s| s.get_owner()).unwrap(), key(owner()));
    }

    // ---- managers ----

    #[test]
    fn only_the_owner_adds_or_removes_managers() {
        let mut host = registry();
        assert!(as_account(&mut host, OTHER, |s| s.add_manager(key(OTHER))).is_err());
        // What every node checks on a patched node's direct write: only the
        // owner writes the manager map.
        assert!(!host.view(|s| s.managers.can(&OTHER.into(), Op::Write)));
        assert!(host.view(|s| s.managers.can(&owner().into(), Op::Write)));

        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        assert!(as_account(&mut host, MANAGER, |s| s.add_manager(key(OTHER))).is_err());
        assert!(as_account(&mut host, MANAGER, |s| s.remove_manager(key(MANAGER))).is_err());
        assert_eq!(
            host.view(|s| s.list_managers()).unwrap(),
            vec![key(MANAGER)]
        );
    }

    #[test]
    fn add_manager_rejects_owner_as_member_and_bad_key() {
        let mut host = registry();
        let o = key(owner());
        assert!(matches!(
            inner_err(host.call(|s| s.add_manager_inner(&o, &o))),
            DriveError::Invalid(_)
        ));
        assert!(matches!(
            inner_err(host.call(|s| s.add_manager_inner(&o, "not-hex!!"))),
            DriveError::Invalid(_)
        ));
        assert!(matches!(
            inner_err(host.call(|s| s.add_manager_inner(&o, &hex::encode([0u8; 16])))),
            DriveError::Invalid(_)
        ));
    }

    #[test]
    fn a_manager_can_be_removed_and_re_added() {
        // Regression: remove then re-add of the same key must not be
        // swallowed by a CRDT tombstone (the bug Fix 1a addresses).
        let mut host = registry();
        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        host.call(|s| s.add_manager(key(MANAGER))).unwrap(); // re-add: ok
        host.call(|s| s.remove_manager(key(MANAGER))).unwrap();
        assert!(host.view(|s| s.list_managers()).unwrap().is_empty());
        assert!(!host.view(|s| s.is_admin(&key(MANAGER))).unwrap());
        // A second remove of the same key is NotFound, not a no-op success.
        let o = key(owner());
        assert!(matches!(
            inner_err(host.call(|s| s.remove_manager_inner(&o, &key(MANAGER)))),
            DriveError::NotFound(_)
        ));
        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        assert!(host.view(|s| s.is_admin(&key(MANAGER))).unwrap());
    }

    #[test]
    fn managers_become_writers_of_roles_and_moderators_of_folders() {
        let mut host = registry();
        let manager = MANAGER.into();
        assert!(!host.view(|s| s.folder_roles.can(&manager, Op::Write)));
        assert!(!host.view(|s| s.folders.is_moderator(&manager)));

        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        assert!(host.view(|s| s.folder_roles.can(&manager, Op::Write)));
        assert!(host.view(|s| s.folders.is_moderator(&manager)));

        host.call(|s| s.remove_manager(key(MANAGER))).unwrap();
        assert!(!host.view(|s| s.folder_roles.can(&manager, Op::Write)));
        assert!(!host.view(|s| s.folders.is_moderator(&manager)));
    }

    // ---- folder roles ----

    #[test]
    fn a_folder_role_defaults_to_editor() {
        let host = registry();
        assert_eq!(
            host.view(|s| s.get_folder_role(fid("f1"), key(MEMBER)))
                .unwrap(),
            Role::Editor
        );
        // even for an unknown folder:
        assert_eq!(
            host.view(|s| s.get_folder_role(fid("ghost"), key(MEMBER)))
                .unwrap(),
            Role::Editor
        );
    }

    #[test]
    fn only_registry_admins_set_or_clear_folder_roles() {
        let mut host = registry();
        let role_of = |host: &TestHost<RegistryState>| {
            host.view(|s| s.get_folder_role(fid("f1"), key(MEMBER)))
                .unwrap()
        };

        // A member cannot make themselves a manager of the folder…
        assert!(as_account(&mut host, MEMBER, |s| {
            s.set_folder_role(fid("f1"), key(MEMBER), Role::Manager)
        })
        .is_err());
        // …and could not write the row directly either: every node refuses it.
        assert!(!host.view(|s| s.folder_roles.can(&MEMBER.into(), Op::Write)));

        host.call(|s| s.set_folder_role(fid("f1"), key(MEMBER), Role::Viewer))
            .unwrap();
        assert_eq!(role_of(&host), Role::Viewer);
        assert!(as_account(&mut host, OTHER, |s| {
            s.clear_folder_role(fid("f1"), key(MEMBER))
        })
        .is_err());

        // A manager can.
        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        as_account(&mut host, MANAGER, |s| {
            s.set_folder_role(fid("f1"), key(MEMBER), Role::Manager)
        })
        .unwrap();
        assert_eq!(role_of(&host), Role::Manager);
        as_account(&mut host, MANAGER, |s| {
            s.clear_folder_role(fid("f1"), key(MEMBER))
        })
        .unwrap();
        assert_eq!(role_of(&host), Role::Editor);
    }

    #[test]
    fn set_folder_role_after_clear_works() {
        // Regression: set → clear → set must not be swallowed by a tombstone
        // (the bug Fix 1b addresses).
        let mut host = registry();
        host.call(|s| s.set_folder_role(fid("f1"), key(MEMBER), Role::Viewer))
            .unwrap();
        host.call(|s| s.clear_folder_role(fid("f1"), key(MEMBER)))
            .unwrap();
        host.call(|s| s.clear_folder_role(fid("f1"), key(MEMBER)))
            .unwrap(); // idempotent
        host.call(|s| s.set_folder_role(fid("f1"), key(MEMBER), Role::Manager))
            .unwrap();
        assert_eq!(
            host.view(|s| s.get_folder_role(fid("f1"), key(MEMBER)))
                .unwrap(),
            Role::Manager
        );
    }

    #[test]
    fn set_folder_role_rejects_unknown_folder_and_bad_key() {
        let mut host = registry();
        let o = key(owner());
        assert!(matches!(
            inner_err(host.call(|s| s.set_folder_role_inner(
                &o,
                "ghost",
                &key(MEMBER),
                Role::Viewer
            ))),
            DriveError::NotFound(_)
        ));
        assert!(matches!(
            inner_err(host.call(|s| s.set_folder_role_inner(&o, "f1", "bad!!", Role::Viewer))),
            DriveError::Invalid(_)
        ));
    }

    #[test]
    fn list_folder_roles_only_returns_rows_for_that_folder() {
        let mut host = registry();
        host.call(|s| s.register_folder(fid("f2"), None, None, None))
            .unwrap();
        for (folder, member, role) in [
            ("f1", MEMBER, Role::Viewer),
            ("f1", OTHER, Role::Manager),
            ("f2", MEMBER, Role::Viewer),
        ] {
            host.call(|s| s.set_folder_role(fid(folder), key(member), role))
                .unwrap();
        }
        let rows = host.view(|s| s.list_folder_roles(fid("f1"))).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|r| r.member == key(MEMBER) && r.role == Role::Viewer));
        assert!(rows
            .iter()
            .any(|r| r.member == key(OTHER) && r.role == Role::Manager));
        assert_eq!(
            host.view(|s| s.list_folder_roles(fid("f2"))).unwrap().len(),
            1
        );
    }

    #[test]
    fn unregister_folder_purges_its_roles() {
        let mut host = registry();
        host.call(|s| s.set_folder_role(fid("f1"), key(MEMBER), Role::Viewer))
            .unwrap();
        host.call(|s| s.unregister_folder(fid("f1"))).unwrap();
        assert!(host
            .view(|s| s.list_folder_roles(fid("f1")))
            .unwrap()
            .is_empty());
    }

    // ---- folders ----

    #[test]
    fn only_a_folders_creator_edits_it_and_admins_may_remove_it() {
        let mut host = registry();
        as_account(&mut host, MEMBER, |s| {
            s.register_folder(fid("m1"), None, None, None)
        })
        .unwrap();

        assert!(as_account(&mut host, OTHER, |s| s
            .set_color(fid("m1"), "#ff0000".into()))
        .is_err());
        assert!(as_account(&mut host, OTHER, |s| s
            .move_folder(fid("m1"), Some(fid("f1"))))
        .is_err());
        assert!(as_account(&mut host, OTHER, |s| s.unregister_folder(fid("m1"))).is_err());
        as_account(&mut host, MEMBER, |s| {
            s.set_color(fid("m1"), "#00ff00".into())
        })
        .unwrap();
        assert_eq!(
            host.view(|s| s.get_folder(fid("m1")))
                .unwrap()
                .color
                .as_deref(),
            Some("#00ff00")
        );

        // The owner moderates: they remove a member's folder, not edit it.
        assert!(host
            .call(|s| s.set_color(fid("m1"), "#000000".into()))
            .is_err());
        host.call(|s| s.unregister_folder(fid("m1"))).unwrap();
        assert!(host.view(|s| s.get_folder(fid("m1"))).is_err());
    }

    #[test]
    fn only_a_folders_creator_binds_it_and_the_binding_is_fixed() {
        let mut host = registry();
        let ctx = crate::ContextId("ctx-1".into());
        assert!(as_account(&mut host, OTHER, |s| {
            s.bind_folder_context(fid("f1"), crate::ContextId("evil".into()))
        })
        .is_err());
        host.call(|s| s.bind_folder_context(fid("f1"), ctx.clone()))
            .unwrap();
        assert!(host
            .call(|s| s.bind_folder_context(fid("f1"), crate::ContextId("ctx-2".into())))
            .is_err());
        // Write-once: `WriteOnce` has no update or remove for anyone, its
        // writer included, and every node refuses one a patched node sends.
        assert_eq!(
            host.view(|s| s.get_folder_context(fid("f1"))).unwrap(),
            Some(ctx)
        );
    }

    #[test]
    fn a_binding_by_someone_other_than_the_folders_creator_is_ignored() {
        let mut host = registry();
        // A patched node binds the owner's folder first, straight into storage.
        as_account(&mut host, OTHER, |s| {
            s.folder_contexts
                .insert("f1".to_owned(), crate::ContextId("evil".into()))
        })
        .unwrap();
        assert_eq!(
            host.view(|s| s.get_folder_context(fid("f1"))).unwrap(),
            None
        );
        assert_eq!(
            host.view(|s| s.get_folder(fid("f1"))).unwrap().context_id,
            None
        );
    }

    #[test]
    fn role_key_uses_unit_separator_and_is_unambiguous() {
        // "a" + member vs "a\u{1f}..." prefix must not collide with "a\u{1f}b" + member
        let k1 = super::role_key("a", &key(MEMBER));
        let k2 = super::role_key("a\u{1f}b", &key(MEMBER));
        assert_ne!(k1, k2);
        assert!(k1.starts_with(&super::role_key_prefix("a")));
        assert!(!k1.starts_with(&super::role_key_prefix("a\u{1f}b")));
    }
}
