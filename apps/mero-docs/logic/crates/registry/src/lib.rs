//! Registry service - the per-namespace store for WORKSPACE-LEVEL data only:
//! the registry owner, its managers, the workspace tags and the saved views.
//!
//! ## What does NOT live here (and why)
//!
//! The namespace holds one Registry context whose state is this struct, and
//! every member of the workspace replicates it. Anything stored here therefore
//! reaches every member, including members who cannot open a Restricted folder.
//! So folders are not here at all: a folder is a core subgroup, its name and
//! colour are that subgroup's metadata, its docs context is the one context in
//! the subgroup, and its per-member roles are core roles and capabilities. Core
//! only shows a subgroup to those allowed to see it.
//!
//! ## Merge semantics
//!
//! Tag fields are `LwwRegister<_>`s merged per field, with the tombstone merged
//! by OR; a saved view merges whole. Concurrent edits resolve by HLC timestamp
//! with a node-id tie-break, deterministically across replicas.
//!
//! `DriveError` is imported from the shared crate and converted at the
//! boundary.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, Frozen, LwwRegister, Mergeable, UnorderedMap, WriteOnce,
};
use mero_docs_types::DriveError;

pub mod events;
pub mod permissions;
use events::Event;

const MAX_TAG_NAME_LEN: usize = 32; // Unicode scalar values, as the web app counts them

/// `#rrggbb`: `#` followed by exactly six hex digits.
fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

// ---------------------------------------------------------------------------
// Tags and saved views
// ---------------------------------------------------------------------------

/// Workspace-wide tag: a stable key mapped to a display name and colour.
/// `deleted` tombstones the row rather than removing it - see `delete_tag`.
/// It merges by OR, so a delete on any replica is permanent.
#[app::mergeable(id = "mero_drive_registry::TagRecord")]
#[derive(Clone, Default, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct TagRecord {
    /// The display name.
    pub name: LwwRegister<String>,
    /// The colour as `#rrggbb`.
    pub color: LwwRegister<String>,
    /// Set for good once the tag is deleted.
    pub deleted: bool,
}

impl Mergeable for TagRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <LwwRegister<String> as Mergeable>::merge(&mut self.name, &other.name)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.color, &other.color)?;
        self.deleted |= other.deleted;
        Ok(())
    }
}

impl TagRecord {
    #[cfg(test)]
    fn new(name: String, color: String) -> Self {
        TagRecord {
            name: LwwRegister::new(name),
            color: LwwRegister::new(color),
            deleted: false,
        }
    }

    fn edit(&mut self, name: String, color: String) {
        self.name.set(name);
        self.color.set(color);
    }
}

/// Flat projection of a `TagRecord`. Deleted rows are included so clients
/// can tell a tombstoned key apart from one that was never used.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct TagDto {
    /// The tag's stable key, which documents carry.
    pub key: String,
    /// The display name.
    pub name: String,
    /// The colour as `#rrggbb`.
    pub color: String,
    /// Whether the tag was deleted.
    pub deleted: bool,
}

fn project_tag(key: &str, rec: &TagRecord) -> TagDto {
    TagDto {
        key: key.to_string(),
        name: rec.name.get().clone(),
        color: rec.color.get().clone(),
        deleted: rec.deleted,
    }
}

/// A workspace-wide saved search. Its creator is not stored here but in
/// `view_origins`, where nobody can rewrite it.
// Derived: every save writes both fields, so the later save winning whole is the merge.
#[derive(Clone, Default, BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ViewRecord {
    /// The display name.
    pub name: LwwRegister<String>,
    /// The saved search text.
    pub query: LwwRegister<String>,
}

/// Flat projection of a `ViewRecord`.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ViewDto {
    /// The view's id.
    pub id: String,
    /// The display name.
    pub name: String,
    /// The saved search text.
    pub query: String,
    /// Hex account of whoever created the view, from `view_origins`' owner stamp.
    pub created_by: String,
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct RegistryState {
    /// Hex account of the registry owner: whoever created the registry
    /// context (a namespace admin). Frozen at `init`; nobody can change it.
    owner: Frozen<String>,
    /// The registry's managers, as holders of the `MANAGER` role. The owner is
    /// its only admin, so only the owner grants or revokes it, on every node.
    access: AccessControl,
    /// tag key → TagRecord. Public: any member may name, recolour or delete
    /// a tag; which roles may is the app's to gate.
    tags: UnorderedMap<String, TagRecord>,
    /// saved-view id → ViewRecord. Public for the same reason as `tags`.
    views: UnorderedMap<String, ViewRecord>,
    /// saved-view id → created_at, written once by the view's creator. Its
    /// owner stamp is who created the view, and nobody can rewrite either.
    view_origins: WriteOnce<UnorderedMap<String, u64>>,
}

#[app::logic]
impl RegistryState {
    #[app::init]
    pub fn init() -> RegistryState {
        let me = permissions::caller_account();
        RegistryState {
            owner: Frozen::new(hex::encode(me.as_bytes())),
            access: AccessControl::new(me),
            tags: UnorderedMap::new_with_field_name("registry:tags"),
            views: UnorderedMap::new_with_field_name("registry:views"),
            view_origins: WriteOnce::new_with_field_name("registry:view_origins"),
        }
    }

    // ---- permissions: owner / managers ----------------------------------

    /// Returns the registry owner: the account of the member who created the registry context.
    /// The owner is fixed when the registry is created.
    ///
    /// # Returns
    ///
    /// The owner's account id as 64 hex characters.
    #[app::view]
    pub fn get_owner(&self) -> app::Result<String> {
        Ok(self.owner_hex())
    }

    /// Makes a member a registry manager. The registry gates none of its own methods on the role; the app reads `list_managers` to decide who may administer the workspace.
    /// Only the registry owner may do this.
    ///
    /// # Arguments
    ///
    /// * `member` - The member's account id as 64 hex characters, as listed by `list_group_members`.
    pub fn add_manager(&mut self, member: String) -> app::Result<()> {
        let caller = permissions::caller_account_hex().map_err(DriveError::into_app)?;
        self.add_manager_inner(&caller, &member)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::ManagerAdded { member: &member });
        Ok(())
    }

    /// Takes manager rights away from a member.
    /// Only the registry owner may do this; fails when the member is not a manager.
    ///
    /// # Arguments
    ///
    /// * `member` - The member's account id as 64 hex characters.
    #[app::destructive]
    pub fn remove_manager(&mut self, member: String) -> app::Result<()> {
        let caller = permissions::caller_account_hex().map_err(DriveError::into_app)?;
        self.remove_manager_inner(&caller, &member)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::ManagerRemoved { member: &member });
        Ok(())
    }

    /// Lists the registry managers.
    /// The owner is an admin implicitly and is not listed.
    ///
    /// # Returns
    ///
    /// The managers' account ids as 64 hex characters.
    #[app::view]
    pub fn list_managers(&self) -> app::Result<Vec<String>> {
        self.list_managers_inner().map_err(DriveError::into_app)
    }

    // ---- tags -------------------------------------------------------------

    /// Creates a workspace tag or changes an existing tag's name and colour.
    /// Documents carry a tag by its key, added with the docs service's `add_tag`.
    /// Fails for a key that was deleted; deleted keys cannot be reused.
    ///
    /// # Arguments
    ///
    /// * `key` - The tag's stable id: 1 to 64 characters of lowercase ASCII letters, digits and `-`.
    /// * `name` - The display name, 1 to 32 characters after trimming.
    /// * `color` - Colour as `#rrggbb`.
    pub fn set_tag(&mut self, key: String, name: String, color: String) -> app::Result<()> {
        self.set_tag_inner(&key, name, color)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::TagChanged { key: &key });
        Ok(())
    }

    /// Deletes a workspace tag for good; the key stays in `list_tags` marked `deleted` and can never be used again.
    /// Documents that carry the key keep it but the workspace no longer shows it.
    ///
    /// # Arguments
    ///
    /// * `key` - The tag's key.
    #[app::destructive]
    pub fn delete_tag(&mut self, key: String) -> app::Result<()> {
        self.delete_tag_inner(&key).map_err(DriveError::into_app)?;
        app::emit!(Event::TagChanged { key: &key });
        Ok(())
    }

    /// Lists the workspace tags, including deleted ones so a deleted key can be told from one never used.
    ///
    /// # Returns
    ///
    /// One row per tag key.
    #[app::view]
    pub fn list_tags(&self) -> app::Result<Vec<TagDto>> {
        let entries = self
            .tags
            .entries()
            .map_err(|e| DriveError::Internal(format!("tags.entries: {e}")).into_app())?;
        Ok(entries
            .into_iter()
            .map(|(key, rec)| project_tag(&key, &rec))
            .collect())
    }

    pub(crate) fn set_tag_inner(
        &mut self,
        key: &str,
        name: String,
        color: String,
    ) -> Result<(), DriveError> {
        if !mero_docs_types::is_valid_tag_key(key) {
            return Err(DriveError::Invalid(format!("invalid tag key: {key}")));
        }
        let name = name.trim().to_string();
        if !(1..=MAX_TAG_NAME_LEN).contains(&name.chars().count()) {
            return Err(DriveError::Invalid("invalid tag name".into()));
        }
        if !is_hex_color(&color) {
            return Err(DriveError::Invalid(format!("invalid color: {color}")));
        }
        let mut rec = self
            .tags
            .get(&key.to_string())
            .map_err(|e| DriveError::Invalid(format!("tags.get: {e}")))?
            .map(|v| v.clone())
            .unwrap_or_default();
        if rec.deleted {
            return Err(DriveError::Invalid("tag deleted".into()));
        }
        rec.edit(name, color);
        self.tags
            .insert(key.to_string(), rec)
            .map_err(|e| DriveError::Invalid(format!("tags.insert: {e}")))?;
        Ok(())
    }

    pub(crate) fn delete_tag_inner(&mut self, key: &str) -> Result<(), DriveError> {
        let mut rec = self
            .tags
            .get(&key.to_string())
            .map_err(|e| DriveError::Invalid(format!("tags.get: {e}")))?
            .map(|v| v.clone())
            .ok_or_else(|| DriveError::NotFound(key.to_string()))?;
        rec.deleted = true;
        self.tags
            .insert(key.to_string(), rec)
            .map_err(|e| DriveError::Invalid(format!("tags.insert: {e}")))?;
        Ok(())
    }

    // ---- saved views --------------------------------------------------------

    /// Saves a search under a name for the whole workspace, or renames or rewrites an existing one.
    /// The first save records the creator.
    ///
    /// # Arguments
    ///
    /// * `id` - The view's id: 1 to 64 characters of ASCII letters, digits and `-`.
    /// * `name` - The display name, 1 to 60 bytes after trimming.
    /// * `query` - The search text, at most 1000 bytes.
    pub fn save_view(&mut self, id: String, name: String, query: String) -> app::Result<()> {
        self.save_view_inner(&id, name, query)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::ViewChanged { id: &id });
        Ok(())
    }

    /// Deletes a saved view.
    /// Fails when the view does not exist.
    ///
    /// # Arguments
    ///
    /// * `id` - The view's id.
    #[app::destructive]
    pub fn delete_view(&mut self, id: String) -> app::Result<()> {
        self.delete_view_inner(&id).map_err(DriveError::into_app)?;
        app::emit!(Event::ViewChanged { id: &id });
        Ok(())
    }

    /// Lists the workspace's saved views.
    ///
    /// # Returns
    ///
    /// One row per view, including its creator's account id.
    #[app::view]
    pub fn list_views(&self) -> app::Result<Vec<ViewDto>> {
        let entries = self
            .views
            .entries()
            .map_err(|e| DriveError::Internal(format!("views.entries: {e}")).into_app())?;
        let mut out = Vec::new();
        for (id, rec) in entries {
            let created_by = self
                .view_creator(&id)
                .map_err(DriveError::into_app)?
                .map(|owner| hex::encode(owner.as_bytes()))
                .unwrap_or_default();
            out.push(ViewDto {
                id,
                name: rec.name.get().clone(),
                query: rec.query.get().clone(),
                created_by,
            });
        }
        Ok(out)
    }

    /// Any member may save or rename a view; the first save records its creator.
    pub(crate) fn save_view_inner(
        &mut self,
        id: &str,
        name: String,
        query: String,
    ) -> Result<(), DriveError> {
        let valid_id = (1..=64).contains(&id.len())
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if !valid_id {
            return Err(DriveError::Invalid(format!("invalid view id: {id}")));
        }
        let name = name.trim().to_string();
        if !(1..=60).contains(&name.len()) {
            return Err(DriveError::Invalid("invalid view name".into()));
        }
        if query.len() > 1000 {
            return Err(DriveError::Invalid("query too long".into()));
        }
        let mut rec = self
            .views
            .get(&id.to_string())
            .map_err(|e| DriveError::Invalid(format!("views.get: {e}")))?
            .map(|v| v.clone())
            .unwrap_or_default();
        // Any account's origin, not just the caller's: keys are per owner, so a
        // key-only `contains` would let every later editor file one of their own.
        let first_save = self
            .view_origins
            .entries_at(&id.to_string())
            .map_err(|e| DriveError::Invalid(format!("view_origins.entries_at: {e}")))?
            .is_empty();
        if first_save {
            self.view_origins
                .insert(id.to_string(), calimero_storage::env::time_now())
                .map_err(|e| DriveError::Conflict(format!("view_origins.insert: {e}")))?;
        }
        rec.name.set(name);
        rec.query.set(query);
        self.views
            .insert(id.to_string(), rec)
            .map_err(|e| DriveError::Invalid(format!("views.insert: {e}")))?;
        Ok(())
    }

    /// A view's creator: the one account holding an origin at `id`. Keys are
    /// per owner, so a patched node can file its own; with several, the
    /// creator is unknown rather than one a claimant chose.
    fn view_creator(&self, id: &String) -> Result<Option<calimero_sdk::AccountId>, DriveError> {
        let holders = self
            .view_origins
            .entries_at(id)
            .map_err(|e| DriveError::Invalid(format!("view_origins.entries_at: {e}")))?;
        Ok(match holders.as_slice() {
            [(owner, _)] => Some(*owner),
            _ => None,
        })
    }

    pub(crate) fn delete_view_inner(&mut self, id: &str) -> Result<(), DriveError> {
        let existed = self
            .views
            .remove(&id.to_string())
            .map_err(|e| DriveError::Invalid(format!("views.remove: {e}")))?;
        if existed.is_none() {
            return Err(DriveError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

// Inline tests drive the `_inner` helpers so `app::emit!` (which panics in
// a non-runtime context) is never reached. The public wrappers are trivial
// "call inner + emit + Ok" adapters; the merobox e2e workflow covers the
// real emit path on a live node.
#[cfg(test)]
mod tests {
    use super::*;

    // ---- which principal gates this service ----
    //
    // The regression these pin down was invisible to every test above, because
    // they all pass `caller` in by hand: the bug lived entirely in how the
    // caller string is DERIVED. Ownership and managers are
    // per-person state, and the client can only ever name a person by the
    // ACCOUNT that `listGroupMembers` returns - so a contract deriving its
    // caller from `device_id` filed every grant under an id no caller could
    // ever present. Nothing failed; the grants simply authorised nobody.
    //
    // Account and device are both 32 bytes, so these set them to DIFFERENT
    // values: an assertion against a host where they coincide would pass for
    // either implementation and prove nothing.

    fn probe_ids() -> ([u8; 32], [u8; 32]) {
        ([0xA1; 32], [0xD2; 32])
    }

    #[test]
    fn caller_is_derived_from_the_account_not_the_device() {
        let (account, device) = probe_ids();
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);
        host.set_account(account);
        host.set_device(device);

        let caller = permissions::caller_account_hex().unwrap();
        assert_eq!(caller, hex::encode(account));
        assert_ne!(caller, hex::encode(device));
    }

    #[test]
    fn a_grant_written_for_an_account_authorises_that_caller() {
        let (account, device) = probe_ids();
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);

        // What a client can actually pass: the member's ACCOUNT, because that
        // is the only id `listGroupMembers` gives it.
        host.call(|s| s.add_manager(hex::encode(account))).unwrap();

        // And the caller the contract derives for that same person.
        host.set_account(account);
        host.set_device(device);
        let caller = permissions::caller_account_hex().unwrap();
        assert!(
            host.view(|s| s.is_admin(&caller)).unwrap(),
            "a manager row written under the account a client can name must \
             authorise the caller the contract derives for that person",
        );
    }

    #[test]
    fn a_grant_written_for_a_device_authorises_nobody() {
        // The shape of the old bug, kept as an executable description of it:
        // a row filed under any id the caller is not derived from is inert.
        let (account, device) = probe_ids();
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);
        host.call(|s| s.add_manager(hex::encode(device))).unwrap();

        host.set_account(account);
        host.set_device(device);
        let caller = permissions::caller_account_hex().unwrap();
        assert!(!host.view(|s| s.is_admin(&caller)).unwrap());
    }

    #[test]
    fn a_rejected_colour_reaches_the_client_as_kind_invalid() {
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);
        let err = host
            .call(|s| s.set_tag("launch".into(), "Launch".into(), "red".into()))
            .unwrap_err();
        let wire = calimero_sdk::serde_json::to_value(&err).unwrap();
        assert_eq!(wire["kind"], "Invalid");
    }

    // ---- LWW helpers for the record-merge tests ----
    //
    // Tests build `a` with an explicit `HybridTimestamp::zero()` for each
    // LWW field and `b` with the real-clock default from `LwwRegister::new`.
    // That guarantees b's timestamp > a's regardless of HLC tick resolution,
    // avoiding flake when `cargo test` runs tests in parallel and two
    // near-instantaneous `set` calls collide on the same nanosecond + tied
    // default node-id (merge would then be a no-op by LWW tie-break).

    use calimero_storage::collections::LwwRegister;
    use calimero_storage::logical_clock::HybridTimestamp;

    fn zero_lww<T>(v: T) -> LwwRegister<T> {
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero())
    }

    // ---- tags ----

    #[test]
    fn set_tag_creates_and_list_tags_shows_it() {
        let mut app = RegistryState::init();
        app.set_tag_inner("launch", "Launch".into(), "#ff0000".into())
            .unwrap();
        let tags = app.list_tags().unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].key, "launch");
        assert_eq!(tags[0].name, "Launch");
        assert_eq!(tags[0].color, "#ff0000");
        assert!(!tags[0].deleted);
    }

    #[test]
    fn set_tag_rejects_invalid_key() {
        let mut app = RegistryState::init();
        let err = app
            .set_tag_inner("Launch", "Launch".into(), "#ff0000".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn set_tag_rejects_bad_name_length() {
        let mut app = RegistryState::init();
        let err = app
            .set_tag_inner("launch", "".into(), "#ff0000".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
        let err = app
            .set_tag_inner("launch", "a".repeat(33), "#ff0000".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn set_tag_counts_the_name_in_characters() {
        let mut app = RegistryState::init();
        let at_cap = "\u{e9}".repeat(MAX_TAG_NAME_LEN);
        app.set_tag_inner("launch", at_cap, "#ff0000".into())
            .unwrap();
        let err = app
            .set_tag_inner(
                "launch",
                "\u{e9}".repeat(MAX_TAG_NAME_LEN + 1),
                "#ff0000".into(),
            )
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn set_tag_trims_name() {
        let mut app = RegistryState::init();
        app.set_tag_inner("launch", "  Launch  ".into(), "#ff0000".into())
            .unwrap();
        assert_eq!(app.list_tags().unwrap()[0].name, "Launch");
    }

    #[test]
    fn set_tag_rejects_bad_color() {
        let mut app = RegistryState::init();
        let err = app
            .set_tag_inner("launch", "Launch".into(), "red".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn delete_tag_sets_deleted_and_keeps_row() {
        let mut app = RegistryState::init();
        app.set_tag_inner("launch", "Launch".into(), "#ff0000".into())
            .unwrap();
        app.delete_tag_inner("launch").unwrap();
        let tags = app.list_tags().unwrap();
        assert_eq!(tags.len(), 1);
        assert!(tags[0].deleted);
    }

    #[test]
    fn delete_tag_unknown_is_not_found() {
        let mut app = RegistryState::init();
        let err = app.delete_tag_inner("ghost").unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn set_tag_after_delete_is_rejected() {
        let mut app = RegistryState::init();
        app.set_tag_inner("launch", "Launch".into(), "#ff0000".into())
            .unwrap();
        app.delete_tag_inner("launch").unwrap();
        let err = app
            .set_tag_inner("launch", "Launch v2".into(), "#00ff00".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(ref m) if m == "tag deleted"));
        let tags = app.list_tags().unwrap();
        assert_eq!(tags[0].name, "Launch");
        assert!(tags[0].deleted);
    }

    fn zero_tag() -> TagRecord {
        TagRecord {
            name: zero_lww("Launch".to_string()),
            color: zero_lww("#ff0000".to_string()),
            deleted: false,
        }
    }

    /// Merges each side into a copy of the other and asserts both land on `want`.
    fn assert_merges_both_ways(a: &TagRecord, b: &TagRecord, want: (&str, &str, bool)) {
        for (x, y) in [(a, b), (b, a)] {
            let mut m = x.clone();
            <TagRecord as Mergeable>::merge(&mut m, y).unwrap();
            <TagRecord as Mergeable>::merge(&mut m, y).unwrap();
            let t = project_tag("launch", &m);
            assert_eq!((t.name.as_str(), t.color.as_str(), t.deleted), want);
        }
    }

    #[test]
    fn tag_record_merge_rename_racing_delete_stays_deleted() {
        let mut b = zero_tag();
        b.deleted = true; // delete on B
        let mut a = zero_tag();
        a.edit("Launch v2".into(), "#ff0000".into()); // later rename on A
        assert_merges_both_ways(&a, &b, ("Launch v2", "#ff0000", true));
    }

    #[test]
    fn tag_record_merge_unsynced_recreate_stays_deleted() {
        let mut b = zero_tag();
        b.deleted = true; // delete on B
        let a = TagRecord::new("Launch 2".into(), "#00ff00".into()); // A never saw it
        assert_merges_both_ways(&a, &b, ("Launch 2", "#00ff00", true));
    }

    #[test]
    fn tag_record_merge_is_per_field_lww_both_edits_hold() {
        let mut a = TagRecord {
            name: zero_lww("Launch".to_string()),
            color: zero_lww("#ff0000".to_string()),
            deleted: false,
        };
        let mut b = TagRecord {
            name: zero_lww("Launch".to_string()),
            color: zero_lww("#ff0000".to_string()),
            deleted: false,
        };
        a.name.set("Launch v2".into()); // rename on A
        b.color.set("#00ff00".into()); // recolour on B
        <TagRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.name.get(), "Launch v2");
        assert_eq!(a.color.get(), "#00ff00");
    }

    // ---- saved views ----

    #[test]
    fn save_view_creates_and_list_views_shows_it() {
        let mut app = RegistryState::init();
        app.save_view_inner("recent-docs", "Recent docs".into(), "q".into())
            .unwrap();
        let views = app.list_views().unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, "recent-docs");
        assert_eq!(views[0].name, "Recent docs");
        assert_eq!(views[0].query, "q");
    }

    #[test]
    fn save_view_rejects_empty_id() {
        let mut app = RegistryState::init();
        let err = app
            .save_view_inner("", "Name".into(), "q".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn save_view_rejects_invalid_id() {
        let mut app = RegistryState::init();
        let err = app
            .save_view_inner("bad id!", "Name".into(), "q".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn save_view_rejects_bad_name_length() {
        let mut app = RegistryState::init();
        let err = app
            .save_view_inner("v1", "".into(), "q".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
        let err = app
            .save_view_inner("v1", "a".repeat(61), "q".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn save_view_rejects_query_too_long() {
        let mut app = RegistryState::init();
        let err = app
            .save_view_inner("v1", "Name".into(), "a".repeat(1001))
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn a_views_creator_is_its_origin_stamp_and_is_fixed() {
        const ALICE: [u8; 32] = [0xA1; 32];
        const BOB: [u8; 32] = [0xB0; 32];
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);
        host.call_as_account(ALICE, ALICE, |s| {
            s.save_view("v1".into(), "Name".into(), "q1".into())
        })
        .unwrap();
        host.call_as_account(BOB, BOB, |s| {
            s.save_view("v1".into(), "Renamed".into(), "q2".into())
        })
        .unwrap();
        let view = host.view(|s| s.list_views()).unwrap().remove(0);
        assert_eq!(view.created_by, hex::encode(ALICE));
        assert_eq!((view.name.as_str(), view.query.as_str()), ("Renamed", "q2"));

        // Keys are per owner: Bob's write lands as his own entry at the id.
        // Two holders make the creator unknown, never the claimant.
        host.call_as_account(BOB, BOB, |s| s.view_origins.insert("v1".into(), 1))
            .unwrap();
        for who in [ALICE, BOB] {
            let seen = host.call_as_account(who, who, |s| s.list_views()).unwrap();
            assert_eq!(seen[0].created_by, "", "as {}", hex::encode(who));
        }
    }

    #[test]
    fn a_views_creator_reads_the_same_for_every_caller() {
        const ALICE: [u8; 32] = [0xA1; 32];
        const BOB: [u8; 32] = [0xB0; 32];
        let mut host = calimero_sdk::testing::TestHost::new(RegistryState::init);
        host.call_as_account(ALICE, ALICE, |s| {
            s.save_view("v1".into(), "Name".into(), "q1".into())
        })
        .unwrap();
        host.call_as_account(BOB, BOB, |s| {
            s.save_view("v1".into(), "Renamed".into(), "q2".into())
        })
        .unwrap();
        for who in [ALICE, BOB, [0xC3; 32]] {
            let seen = host.call_as_account(who, who, |s| s.list_views()).unwrap();
            assert_eq!(
                seen[0].created_by,
                hex::encode(ALICE),
                "as {}",
                hex::encode(who)
            );
        }
    }

    #[test]
    fn delete_view_removes_it() {
        let mut app = RegistryState::init();
        app.save_view_inner("v1", "Name".into(), "q".into())
            .unwrap();
        app.delete_view_inner("v1").unwrap();
        assert_eq!(app.list_views().unwrap().len(), 0);
    }

    #[test]
    fn delete_view_unknown_is_not_found() {
        let mut app = RegistryState::init();
        let err = app.delete_view_inner("ghost").unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    // ---- record merges, as nodes apply them ----

    /// A script whose record merges are registered, as loading the
    /// wasm module registers them on a node.
    fn registry_script() -> calimero_storage::testing::Script<RegistryState> {
        let script = calimero_storage::testing::Script::new(RegistryState::init);
        RegistryState::__calimero_register_rekey();
        script
    }

    /// Every save writes the whole view, so concurrent saves settle on one of
    /// them whole, never a name from one and a query from the other.
    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn concurrent_saves_of_one_view_settle_on_one_whole_save() {
        let mut script = registry_script();
        let (alice, bob) = (script.member(), script.member());
        let created = script
            .run(alice, |s| {
                s.save_view_inner("v1", "A".into(), "qa".into()).unwrap()
            })
            .unwrap();
        assert_eq!(script.deliver(bob, created), 0);
        let renamed = script
            .run(alice, |s| {
                s.save_view_inner("v1", "A2".into(), "qa".into()).unwrap()
            })
            .unwrap();
        let rewritten = script
            .run(bob, |s| {
                s.save_view_inner("v1", "B".into(), "qb".into()).unwrap()
            })
            .unwrap();
        assert_eq!(script.deliver(alice, rewritten), 0);
        assert_eq!(script.deliver(bob, renamed), 0);
        let one_save = |s: &RegistryState| {
            let v = s.list_views().unwrap().remove(0);
            matches!(
                (v.name.as_str(), v.query.as_str()),
                ("A2", "qa") | ("B", "qb")
            )
        };
        let seen: Vec<_> = [alice, bob]
            .map(|r| script.view(r, |s| s.list_views().unwrap().remove(0).name))
            .into();
        assert_eq!(seen[0], seen[1]);
        script.assert_every_order_converges(one_save);
    }

    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn a_tag_deleted_while_renamed_elsewhere_stays_deleted() {
        let mut script = registry_script();
        let (alice, bob) = (script.member(), script.member());
        let created = script
            .run(alice, |s| {
                s.set_tag_inner("t", "T".into(), "#ff0000".into()).unwrap()
            })
            .unwrap();
        assert_eq!(script.deliver(bob, created), 0);
        let deleted = script
            .run(alice, |s| s.delete_tag_inner("t").unwrap())
            .unwrap();
        let renamed = script
            .run(bob, |s| {
                s.set_tag_inner("t", "T2".into(), "#00ff00".into()).unwrap()
            })
            .unwrap();
        assert_eq!(script.deliver(alice, renamed), 0);
        assert_eq!(script.deliver(bob, deleted), 0);
        let gone = |s: &RegistryState| s.list_tags().unwrap()[0].deleted;
        for member in [alice, bob] {
            assert!(script.view(member, gone));
        }
        script.assert_every_order_converges(gone);
    }
}
