//! Permissions layer for the registry service: the owner and the managers.
//! The public `#[app::logic]` wrappers that call these live in `lib.rs`; the
//! gating and `_inner` mutators live here.

use calimero_sdk::AccountId;
use calimero_storage::collections::StoreError;
use mero_docs_types::DriveError;

use crate::RegistryState;

const MANAGER: &str = "manager"; // the `AccessControl` role a registry manager holds

/// The caller's ACCOUNT - who is calling as a person, not which machine
/// they are calling from.
///
/// ⚠️ THIS WAS `device_id()`, AND THAT MADE EVERY GRANT IN THIS FILE A NO-OP.
///
/// Ownership and the manager list are PER-PERSON state, and the SDK is
/// explicit that per-person state is keyed by the account: `device_id` is "distinct per machine even for one person,
/// which is what makes it right for per-writer state and wrong for per-person
/// state."
///
/// The practical failure was total and silent, because every id involved is 32
/// bytes of hex and nothing can tell them apart:
///
///   * `add_manager` takes a member key from the client,
///     and the only member list a client has is `listGroupMembers`, whose rows
///     are ACCOUNTS. So a manager row was filed under an account, while
///     `is_admin` looked the caller up by DEVICE - the row could never match,
///     and a promoted manager stayed `Forbidden` on everything.
///   * The frontend's "am I the owner" check compares `get_owner()` against
///     the account it holds, so the owner is recorded as an account too.
///
/// mero-js documents `GroupMember.identity` as "The member's ACCOUNT: 64
/// hex", and `useNodeIdentity().identity.accountId` is the same value for
/// oneself. So this keys on the account, and every id that crosses the wire in
/// either direction is the same kind of id.
pub(crate) fn caller_account() -> AccountId {
    AccountId::from(calimero_sdk::env::account_id())
}

/// [`caller_account`], hex-encoded.
pub(crate) fn caller_account_hex() -> Result<String, DriveError> {
    Ok(hex::encode(caller_account().as_bytes()))
}

/// Validate & normalise an incoming hex 32-byte ACCOUNT id - the same
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
    #[cfg(test)]
    pub(crate) fn is_admin(&self, caller: &str) -> Result<bool, DriveError> {
        Ok(self.owner_hex() == caller || self.is_manager(caller)?)
    }

    fn is_manager(&self, member_hex: &str) -> Result<bool, DriveError> {
        self.access
            .has_role(MANAGER, &account_of(member_hex)?)
            .map_err(storage_err("access.has_role"))
    }

    /// The registry's owner, frozen at `init`.
    pub(crate) fn owner_hex(&self) -> String {
        self.owner.get().cloned().unwrap_or_default()
    }

    /// Owner-only. Validates `member` as hex. Re-adding an existing or
    /// previously-removed manager succeeds.
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
        self.access
            .grant(MANAGER, account_of(&member)?)
            .map_err(storage_err("access.grant"))?;
        Ok(())
    }

    /// Owner-only. `NotFound` if `member` is not currently a manager.
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
        if !self.is_manager(&member)? {
            return Err(DriveError::NotFound(member));
        }
        self.access
            .revoke(MANAGER, &account_of(&member)?)
            .map_err(storage_err("access.revoke"))?;
        Ok(())
    }

    pub(crate) fn list_managers_inner(&self) -> Result<Vec<String>, DriveError> {
        Ok(self
            .access
            .members_of(MANAGER)
            .map_err(storage_err("access.members_of"))?
            .iter()
            .map(|m| hex::encode(m.as_bytes()))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;
    use mero_docs_types::DriveError;

    use crate::RegistryState;

    const MANAGER: [u8; 32] = [0xA1; 32];
    const MEMBER: [u8; 32] = [0xB2; 32];
    const OTHER: [u8; 32] = [0xC3; 32];

    fn key(account: [u8; 32]) -> String {
        hex::encode(account)
    }
    fn owner() -> [u8; 32] {
        calimero_sdk::env::account_id()
    }

    /// A registry created by `owner()`.
    fn registry() -> TestHost<RegistryState> {
        TestHost::new(RegistryState::init)
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
    fn the_owner_is_whoever_created_the_registry() {
        let host = registry();
        assert_eq!(host.view(|s| s.get_owner()).unwrap(), key(owner()));
    }

    // ---- managers ----

    #[test]
    fn only_the_owner_adds_or_removes_managers() {
        let mut host = registry();
        assert!(as_account(&mut host, OTHER, |s| s.add_manager(key(OTHER))).is_err());
        // What every node checks on a patched node's direct grant: only the
        // owner administers the manager role, and a manager does not.
        assert!(!host.view(|s| s.access.is_admin(&OTHER.into())));
        assert!(host.view(|s| s.access.is_admin(&owner().into())));

        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        assert!(!host.view(|s| s.access.is_admin(&MANAGER.into())));
        assert!(as_account(&mut host, MANAGER, |s| s.add_manager(key(OTHER))).is_err());
        assert!(as_account(&mut host, MANAGER, |s| s.remove_manager(key(MANAGER))).is_err());
        assert_eq!(
            host.view(|s| s.list_managers()).unwrap(),
            vec![key(MANAGER)]
        );
    }

    #[test]
    fn every_refusal_is_forbidden() {
        let mut host = registry();
        host.call(|s| s.add_manager(key(MANAGER))).unwrap();
        let (manager, other, member) = (key(MANAGER), key(OTHER), key(MEMBER));
        let refusals = host.call(|s| {
            [
                s.add_manager_inner(&other, &member),
                s.add_manager_inner(&manager, &member),
                s.remove_manager_inner(&other, &manager),
                s.remove_manager_inner(&manager, &manager),
            ]
        });
        for refusal in refusals {
            assert!(
                matches!(refusal, Err(DriveError::Forbidden(_))),
                "{refusal:?}"
            );
        }
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
}
