//! Registry service — the per-namespace source of truth for folder
//! *presentation* metadata that admin-API does not own.
//!
//! ## What lives here (and why)
//!
//! Admin API is authoritative for group shape, membership, and aliases.
//! Anything admin-API doesn't have a concept for — color,
//! folder→context binding, sort order under a parent — lives in this
//! registry. The namespace holds one Registry context whose state is this
//! struct, replicated across every member of the root group.
//!
//! `parent_id` is stored here too, as an **index** — admin-API remains
//! authoritative for the tree shape. The client reconciles drift from admin
//! onto this registry on load (leaf-first unregister, root-first register,
//! parent-fix moves), so any divergence resolves idempotently without a
//! cross-system transaction.
//!
//! ## Merge semantics
//!
//! Every mutable field on a `FolderRecord` is an `LwwRegister<_>`. Concurrent
//! edits (two nodes recoloring the same folder simultaneously) resolve via
//! HLC timestamp + node-id tie-break deterministically across replicas.
//!
//! ## ABI boundary types
//!
//! The `calimero-wasm-abi` emitter only parses `lib.rs` + `events.rs` when
//! generating the client SDK, so every type used in a public method
//! signature must be declared here — we cannot reach into a shared
//! `mero-drive-types` crate for them. `FolderId` and `ContextId` are
//! therefore re-declared locally. `DriveError` stays internal-only
//! (converted to `AppError` at the boundary), so it can still live in
//! the shared types crate and be imported.
//!
//! ## Subgroup visibility
//!
//! Open-vs-Restricted is **not** stored here anymore. Calimero core owns
//! it (`GroupInfo.subgroup_visibility`, `setSubgroupVisibility`) and uses
//! it to drive parent-walk membership inheritance. The frontend reads it
//! via the admin API and writes it via `mero.admin.setSubgroupVisibility`.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{FrozenValue, LwwRegister, Mergeable, UnorderedMap};
use mero_drive_types::DriveError;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// ABI-boundary types (must live in lib.rs/events.rs to be picked up by the
// calimero-wasm-abi emitter).
// ---------------------------------------------------------------------------

/// Wrapper around a folder / group id string. Newtype so the generated TS
/// client surfaces `FolderId` instead of a bare `string`.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderId(pub String);

/// Wrapper around a Calimero context id. Same rationale as `FolderId`.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextId(pub String);

// ---------------------------------------------------------------------------
// Stored model
// ---------------------------------------------------------------------------

/// Per-folder record inside the registry map. All fields are LWW so
/// concurrent updates resolve deterministically.
///
/// `Mergeable` is implemented by hand rather than `#[derive(Mergeable)]`
/// because `LwwRegister<T>` has both an inherent `merge(...) -> ()` and a
/// trait `Mergeable::merge(...) -> Result<(), MergeError>`. Rust's method
/// resolution picks the inherent one from the derive expansion, which then
/// fails the macro's `?` — same workaround battleships uses on
/// `MatchSummary`.
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FolderRecord {
    /// Parent folder id, or None for top-level folders. Stored as an
    /// LWW index; admin-API remains the source of truth for the tree.
    pub parent_id: LwwRegister<Option<String>>,
    /// `#rrggbb` color, or empty string for "no color".
    pub color: LwwRegister<String>,
    /// Display name. Mirrored from admin-API's group alias so namespace
    /// members who can't read the subgroup yet (Restricted folder before
    /// invite) can still see folder names. Empty string means "no
    /// registry-side alias — fall back to the admin-API alias or a
    /// truncated id stub on the client".
    pub alias: LwwRegister<String>,
}

impl Mergeable for FolderRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <LwwRegister<Option<String>> as Mergeable>::merge(&mut self.parent_id, &other.parent_id)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.color, &other.color)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.alias, &other.alias)?;
        Ok(())
    }
}

impl FolderRecord {
    pub(crate) fn new(
        parent_id: Option<String>,
        color: Option<String>,
        alias: Option<String>,
    ) -> Self {
        FolderRecord {
            parent_id: LwwRegister::new(parent_id),
            color: LwwRegister::new(color.unwrap_or_default()),
            alias: LwwRegister::new(alias.unwrap_or_default()),
        }
    }
}

/// Flat, serde-friendly projection of a `FolderRecord` for list/get APIs.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderDto {
    pub id: FolderId,
    pub parent_id: Option<FolderId>,
    /// `None` when color is unset / empty.
    pub color: Option<String>,
    /// `None` when no Docs context has been bound to this folder yet.
    pub context_id: Option<ContextId>,
    /// `None` when no registry-side alias is stored (older folders,
    /// or folders created before the alias field existed). Clients
    /// fall back to the admin-API alias or a truncated id stub.
    pub alias: Option<String>,
}

fn project(id: &str, rec: &FolderRecord, ctx: Option<&ContextId>) -> FolderDto {
    let color_raw = rec.color.get();
    let color = if color_raw.is_empty() {
        None
    } else {
        Some(color_raw.clone())
    };
    let alias_raw = rec.alias.get();
    let alias = if alias_raw.is_empty() {
        None
    } else {
        Some(alias_raw.clone())
    };
    FolderDto {
        id: FolderId(id.to_string()),
        parent_id: rec.parent_id.get().clone().map(FolderId),
        color,
        context_id: ctx.cloned(),
        alias,
    }
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

/// Sort-order parent key. Empty string = "top-level" (root-group children).
/// Stays a `String` to match `UnorderedMap`'s `AsRef<[u8]>` key requirement
/// without bolting an extra impl onto `FolderId`.
const ROOT_SORT_KEY: &str = "";

#[app::state(emits = for<'a> Event<'a>)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct RegistryState {
    /// folder_id (string) → FolderRecord
    folders: UnorderedMap<String, FolderRecord>,
    /// folder_id (string) → Docs context id bound to that folder.
    /// Once bound, the value never changes — `FrozenValue` supplies the
    /// no-op `Mergeable` impl required by `UnorderedMap` values.
    folder_contexts: UnorderedMap<String, FrozenValue<ContextId>>,
    /// parent_id-or-empty → LWW list of child folder ids in display order
    sort_order: UnorderedMap<String, LwwRegister<Vec<String>>>,
}

#[app::logic]
impl RegistryState {
    #[app::init]
    pub fn init() -> RegistryState {
        RegistryState {
            folders: UnorderedMap::new_with_field_name("registry:folders"),
            folder_contexts: UnorderedMap::new_with_field_name("registry:folder_contexts"),
            sort_order: UnorderedMap::new_with_field_name("registry:sort_order"),
        }
    }

    // ---- folder lifecycle ------------------------------------------------

    pub fn register_folder(
        &mut self,
        id: FolderId,
        parent_id: Option<FolderId>,
        color: Option<String>,
        alias: Option<String>,
    ) -> app::Result<()> {
        let id_for_event = id.0.clone();
        self.register_folder_inner(id, parent_id, color, alias)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderRegistered { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn register_folder_inner(
        &mut self,
        id: FolderId,
        parent_id: Option<FolderId>,
        color: Option<String>,
        alias: Option<String>,
    ) -> Result<(), DriveError> {
        if id.0.is_empty() {
            return Err(DriveError::Invalid("empty folder id".into()));
        }
        let already = self
            .folders
            .contains(&id.0)
            .map_err(|e| DriveError::Invalid(format!("folders.contains: {e}")))?;
        if already {
            return Err(DriveError::AlreadyExists(id.0));
        }
        let parent_str = parent_id.map(|p| p.0);
        let rec = FolderRecord::new(parent_str, color, alias);
        self.folders
            .insert(id.0, rec)
            .map_err(|e| DriveError::Invalid(format!("folders.insert: {e}")))?;
        Ok(())
    }

    pub fn unregister_folder(&mut self, id: FolderId) -> app::Result<()> {
        let id_for_event = id.0.clone();
        self.unregister_folder_inner(id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderUnregistered { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn unregister_folder_inner(&mut self, id: FolderId) -> Result<(), DriveError> {
        let existed = self
            .folders
            .remove(&id.0)
            .map_err(|e| DriveError::Invalid(format!("folders.remove: {e}")))?;
        if existed.is_none() {
            return Err(DriveError::NotFound(id.0));
        }
        // Removing the folder also clears any context binding.
        let _ = self.folder_contexts.remove(&id.0);
        Ok(())
    }

    pub fn get_folder(&self, id: FolderId) -> app::Result<FolderDto> {
        let rec = self
            .folders
            .get(&id.0)
            .map_err(|e| AppError::msg(format!("folders.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id.0)))?;
        let ctx = self
            .folder_contexts
            .get(&id.0)
            .map_err(|e| AppError::msg(format!("folder_contexts.get: {e}")))?;
        Ok(project(&id.0, &rec, ctx.as_ref().map(|f| &f.0)))
    }

    pub fn get_folders(&self) -> app::Result<Vec<FolderDto>> {
        let entries = self
            .folders
            .entries()
            .map_err(|e| AppError::msg(format!("folders.entries: {e}")))?;
        let mut out = Vec::new();
        for (id, rec) in entries {
            let ctx = self
                .folder_contexts
                .get(&id)
                .map_err(|e| AppError::msg(format!("folder_contexts.get: {e}")))?;
            out.push(project(&id, &rec, ctx.as_ref().map(|f| &f.0)));
        }
        Ok(out)
    }

    // ---- context binding -------------------------------------------------

    pub fn bind_folder_context(
        &mut self,
        folder_id: FolderId,
        context_id: ContextId,
    ) -> app::Result<()> {
        let fid = folder_id.0.clone();
        let cid = context_id.0.clone();
        self.bind_folder_context_inner(folder_id, context_id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderContextBound {
            folder_id: &fid,
            context_id: &cid,
        });
        Ok(())
    }

    pub(crate) fn bind_folder_context_inner(
        &mut self,
        folder_id: FolderId,
        context_id: ContextId,
    ) -> Result<(), DriveError> {
        let known = self
            .folders
            .contains(&folder_id.0)
            .map_err(|e| DriveError::Invalid(format!("folders.contains: {e}")))?;
        if !known {
            return Err(DriveError::NotFound(folder_id.0));
        }
        let bound = self
            .folder_contexts
            .contains(&folder_id.0)
            .map_err(|e| DriveError::Invalid(format!("folder_contexts.contains: {e}")))?;
        if bound {
            return Err(DriveError::Conflict(format!(
                "already bound: {}",
                folder_id.0
            )));
        }
        self.folder_contexts
            .insert(folder_id.0, FrozenValue::from(context_id))
            .map_err(|e| DriveError::Invalid(format!("folder_contexts.insert: {e}")))?;
        Ok(())
    }

    pub fn get_folder_context(&self, folder_id: FolderId) -> app::Result<Option<ContextId>> {
        let frozen = self
            .folder_contexts
            .get(&folder_id.0)
            .map_err(|e| AppError::msg(format!("folder_contexts.get: {e}")))?;
        Ok(frozen.map(|f| f.0))
    }

    // ---- color / move ---------------------------------------------------

    pub fn set_color(&mut self, id: FolderId, color: String) -> app::Result<()> {
        // Treat empty color as "clear" — matches how `get_folder` projects
        // empty-string back to `None` on read.
        self.set_color_inner(&id.0, color)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderColorChanged { id: &id.0 });
        Ok(())
    }

    /// Update the registry-side alias for a folder. Callers should mirror
    /// admin-API's `setGroupAlias` with a call here so namespace members
    /// who aren't subgroup members can still see the new name. Empty
    /// string clears the registry alias and falls back to whatever the
    /// client surfaces (admin API alias if visible, otherwise id stub).
    pub fn set_folder_alias(&mut self, id: FolderId, alias: String) -> app::Result<()> {
        self.set_folder_alias_inner(&id.0, alias)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderAliasChanged { id: &id.0 });
        Ok(())
    }

    pub fn move_folder(&mut self, id: FolderId, new_parent: Option<FolderId>) -> app::Result<()> {
        self.move_folder_inner(&id.0, new_parent.map(|p| p.0))
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderParentChanged { id: &id.0 });
        Ok(())
    }

    pub(crate) fn set_color_inner(&mut self, id: &str, color: String) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.color.set(color))
    }

    pub(crate) fn set_folder_alias_inner(
        &mut self,
        id: &str,
        alias: String,
    ) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.alias.set(alias))
    }

    pub(crate) fn move_folder_inner(
        &mut self,
        id: &str,
        new_parent: Option<String>,
    ) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.parent_id.set(new_parent))
    }

    fn mutate_folder<F>(&mut self, id: &str, edit: F) -> Result<(), DriveError>
    where
        F: FnOnce(&mut FolderRecord),
    {
        let mut rec = self
            .folders
            .get(&id.to_string())
            .map_err(|e| DriveError::Invalid(format!("folders.get: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.to_string()))?;
        edit(&mut rec);
        self.folders
            .insert(id.to_string(), rec)
            .map_err(|e| DriveError::Invalid(format!("folders.insert: {e}")))?;
        Ok(())
    }

    // ---- sort order ------------------------------------------------------

    pub fn reorder(
        &mut self,
        parent_id: Option<FolderId>,
        folder_ids: Vec<FolderId>,
    ) -> app::Result<()> {
        let key = parent_id
            .as_ref()
            .map(|p| p.0.clone())
            .unwrap_or_else(|| ROOT_SORT_KEY.to_string());
        self.reorder_inner(parent_id, folder_ids)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderSortOrderChanged { parent_id: &key });
        Ok(())
    }

    pub(crate) fn reorder_inner(
        &mut self,
        parent_id: Option<FolderId>,
        folder_ids: Vec<FolderId>,
    ) -> Result<(), DriveError> {
        let parent_str = parent_id.as_ref().map(|p| p.0.clone());
        // Every id in the list must exist AND be parented under `parent_str`.
        for fid in &folder_ids {
            let rec = self
                .folders
                .get(&fid.0)
                .map_err(|e| DriveError::Invalid(format!("folders.get: {e}")))?
                .ok_or_else(|| DriveError::NotFound(fid.0.clone()))?;
            if rec.parent_id.get() != &parent_str {
                return Err(DriveError::Invalid(format!(
                    "{} not under requested parent",
                    fid.0
                )));
            }
        }
        let key = parent_str.unwrap_or_else(|| ROOT_SORT_KEY.to_string());
        let ordered: Vec<String> = folder_ids.iter().map(|f| f.0.clone()).collect();
        self.sort_order
            .insert(key, LwwRegister::new(ordered))
            .map_err(|e| DriveError::Invalid(format!("sort_order.insert: {e}")))?;
        Ok(())
    }

    pub fn get_sort_order(&self, parent_id: Option<FolderId>) -> app::Result<Vec<FolderId>> {
        let key = parent_id
            .map(|p| p.0)
            .unwrap_or_else(|| ROOT_SORT_KEY.to_string());
        let reg = self
            .sort_order
            .get(&key)
            .map_err(|e| AppError::msg(format!("sort_order.get: {e}")))?;
        Ok(match reg {
            Some(r) => r.get().iter().cloned().map(FolderId).collect(),
            None => Vec::new(),
        })
    }
}

// Inline tests drive the `_inner` helpers so `app::emit!` (which panics in
// a non-runtime context) is never reached. The public wrappers are trivial
// "call inner + emit + Ok" adapters; the merobox e2e workflow covers the
// real emit path on a live node.
#[cfg(test)]
mod tests {
    use super::*;

    fn fid(s: &str) -> FolderId {
        FolderId(s.to_string())
    }
    fn cid(s: &str) -> ContextId {
        ContextId(s.to_string())
    }

    // ---- folder lifecycle ----

    #[test]
    fn register_folder_appears_in_get_folders() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, Some("#123456".into()), None)
            .unwrap();
        let all = app.get_folders().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, fid("f1"));
        assert_eq!(all[0].parent_id, None);
        assert_eq!(all[0].color.as_deref(), Some("#123456"));
        assert_eq!(all[0].context_id, None);
        assert_eq!(all[0].alias, None);
    }

    #[test]
    fn register_folder_stores_alias() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, Some("Projects".into()))
            .unwrap();
        let f = app.get_folder(fid("f1")).unwrap();
        assert_eq!(f.alias.as_deref(), Some("Projects"));
    }

    #[test]
    fn set_folder_alias_updates_on_read() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.set_folder_alias_inner("f1", "First pass".into())
            .unwrap();
        assert_eq!(
            app.get_folder(fid("f1")).unwrap().alias.as_deref(),
            Some("First pass"),
        );
        app.set_folder_alias_inner("f1", "Second pass".into())
            .unwrap();
        assert_eq!(
            app.get_folder(fid("f1")).unwrap().alias.as_deref(),
            Some("Second pass"),
        );
    }

    #[test]
    fn set_folder_alias_empty_clears() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, Some("Start".into()))
            .unwrap();
        app.set_folder_alias_inner("f1", "".into()).unwrap();
        assert_eq!(app.get_folder(fid("f1")).unwrap().alias, None);
    }

    #[test]
    fn set_folder_alias_unknown_folder_errors() {
        let mut app = RegistryState::init();
        let err = app.set_folder_alias_inner("ghost", "x".into()).unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn register_folder_rejects_empty_id() {
        let mut app = RegistryState::init();
        let err = app
            .register_folder_inner(fid(""), None, None, None)
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn register_duplicate_fails_with_already_exists() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        let err = app
            .register_folder_inner(fid("f1"), None, None, None)
            .unwrap_err();
        assert!(matches!(err, DriveError::AlreadyExists(_)));
    }

    #[test]
    fn register_folder_stores_parent_id() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("p"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("c"), Some(fid("p")), None, None)
            .unwrap();
        let child = app.get_folder(fid("c")).unwrap();
        assert_eq!(child.parent_id, Some(fid("p")));
    }

    #[test]
    fn unregister_removes_folder_and_clears_binding() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.bind_folder_context_inner(fid("f1"), cid("ctx-1"))
            .unwrap();
        app.unregister_folder_inner(fid("f1")).unwrap();
        assert_eq!(app.get_folders().unwrap().len(), 0);
        assert_eq!(app.get_folder_context(fid("f1")).unwrap(), None);
    }

    #[test]
    fn unregister_unknown_is_not_found() {
        let mut app = RegistryState::init();
        let err = app.unregister_folder_inner(fid("ghost")).unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn get_folder_missing_returns_error() {
        let app = RegistryState::init();
        assert!(app.get_folder(fid("ghost")).is_err());
    }

    // ---- context binding ----

    #[test]
    fn bind_folder_context_stores_binding() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.bind_folder_context_inner(fid("f1"), cid("ctx-1"))
            .unwrap();
        assert_eq!(
            app.get_folder_context(fid("f1")).unwrap(),
            Some(cid("ctx-1"))
        );
        assert_eq!(
            app.get_folder(fid("f1")).unwrap().context_id,
            Some(cid("ctx-1"))
        );
    }

    #[test]
    fn bind_folder_context_rejects_unknown_folder() {
        let mut app = RegistryState::init();
        let err = app
            .bind_folder_context_inner(fid("ghost"), cid("ctx-1"))
            .unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn bind_folder_context_rejects_reassignment() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.bind_folder_context_inner(fid("f1"), cid("ctx-1"))
            .unwrap();
        let err = app
            .bind_folder_context_inner(fid("f1"), cid("ctx-2"))
            .unwrap_err();
        assert!(matches!(err, DriveError::Conflict(_)));
    }

    // ---- color / move ----

    #[test]
    fn set_color_is_last_write_wins() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.set_color_inner("f1", "#ff0000".into()).unwrap();
        app.set_color_inner("f1", "#00ff00".into()).unwrap();
        assert_eq!(
            app.get_folder(fid("f1")).unwrap().color.as_deref(),
            Some("#00ff00")
        );
    }

    #[test]
    fn set_color_empty_clears() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, Some("#ff0000".into()), None)
            .unwrap();
        app.set_color_inner("f1", "".into()).unwrap();
        assert_eq!(app.get_folder(fid("f1")).unwrap().color, None);
    }

    #[test]
    fn move_folder_updates_parent_id() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("p1"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("p2"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("c"), Some(fid("p1")), None, None)
            .unwrap();
        app.move_folder_inner("c", Some("p2".into())).unwrap();
        assert_eq!(app.get_folder(fid("c")).unwrap().parent_id, Some(fid("p2")));
        app.move_folder_inner("c", None).unwrap();
        assert_eq!(app.get_folder(fid("c")).unwrap().parent_id, None);
    }

    // ---- sort order ----

    #[test]
    fn reorder_stores_and_reads_back() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("a"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("b"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("c"), None, None, None)
            .unwrap();
        app.reorder_inner(None, vec![fid("b"), fid("c"), fid("a")])
            .unwrap();
        assert_eq!(
            app.get_sort_order(None).unwrap(),
            vec![fid("b"), fid("c"), fid("a")]
        );
    }

    #[test]
    fn reorder_rejects_ids_not_in_parent() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("a"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("b"), Some(fid("a")), None, None)
            .unwrap();
        let err = app
            .reorder_inner(None, vec![fid("a"), fid("b")])
            .unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn reorder_rejects_unknown_id() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("a"), None, None, None)
            .unwrap();
        let err = app
            .reorder_inner(None, vec![fid("a"), fid("ghost")])
            .unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn reorder_is_lww_overwrite() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("a"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("b"), None, None, None)
            .unwrap();
        app.reorder_inner(None, vec![fid("a"), fid("b")]).unwrap();
        app.reorder_inner(None, vec![fid("b"), fid("a")]).unwrap();
        assert_eq!(app.get_sort_order(None).unwrap(), vec![fid("b"), fid("a")]);
    }

    #[test]
    fn get_sort_order_unset_returns_empty() {
        let app = RegistryState::init();
        assert_eq!(app.get_sort_order(None).unwrap(), Vec::<FolderId>::new());
        assert_eq!(
            app.get_sort_order(Some(fid("nope"))).unwrap(),
            Vec::<FolderId>::new()
        );
    }

    // ---- cross-method integration ----

    #[test]
    fn full_lifecycle_register_bind_recolor_reorder_unregister() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("a"), None, Some("#f00".into()), None)
            .unwrap();
        app.register_folder_inner(fid("b"), None, None, None)
            .unwrap();
        app.bind_folder_context_inner(fid("a"), cid("ctx-a"))
            .unwrap();
        app.set_color_inner("a", "#0f0".into()).unwrap();
        app.reorder_inner(None, vec![fid("b"), fid("a")]).unwrap();

        let a = app.get_folder(fid("a")).unwrap();
        assert_eq!(a.context_id, Some(cid("ctx-a")));
        assert_eq!(a.color.as_deref(), Some("#0f0"));
        assert_eq!(app.get_sort_order(None).unwrap(), vec![fid("b"), fid("a")]);

        app.unregister_folder_inner(fid("a")).unwrap();
        app.unregister_folder_inner(fid("b")).unwrap();
        assert_eq!(app.get_folders().unwrap().len(), 0);
    }

    #[test]
    fn folder_record_default_fields_are_empty() {
        let rec = FolderRecord::new(None, None, None);
        assert_eq!(rec.color.get(), "");
        assert_eq!(rec.parent_id.get(), &None);
        assert_eq!(rec.alias.get(), "");
    }

    // ---- struct-level merge (pin down the manual Mergeable impl) ----
    //
    // The e2e workflow proves sync converges end-to-end, but that alone
    // would not tell us *which* piece broke if merge ever regressed. These
    // direct struct-merge tests pin the invariant down: each LWW field
    // should pick the later write, and merge should be idempotent.
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
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero(), [0u8; 32])
    }

    #[test]
    fn folder_record_merge_lww_picks_later_color() {
        let mut a = FolderRecord {
            parent_id: zero_lww(None),
            color: zero_lww("#ff0000".into()),
            alias: zero_lww(String::new()),
        };
        let b = FolderRecord::new(None, Some("#00ff00".into()), None);
        <FolderRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.color.get(), "#00ff00");
    }

    #[test]
    fn folder_record_merge_is_idempotent() {
        let mut a = FolderRecord::new(Some("p1".into()), Some("#aaa".into()), None);
        let b = FolderRecord::new(Some("p1".into()), Some("#aaa".into()), None);
        <FolderRecord as Mergeable>::merge(&mut a, &b).unwrap();
        <FolderRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.parent_id.get(), &Some("p1".to_string()));
        assert_eq!(a.color.get(), "#aaa");
    }

    #[test]
    fn folder_record_merge_parent_id_lww() {
        let mut a = FolderRecord {
            parent_id: zero_lww(None),
            color: zero_lww(String::new()),
            alias: zero_lww(String::new()),
        };
        let mut b = FolderRecord::new(None, None, None);
        b.parent_id.set(Some("new-parent".into()));
        <FolderRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.parent_id.get(), &Some("new-parent".to_string()));
    }

    // ---- tombstone behaviour — documents the CRDT invariant ----
    //
    // `UnorderedMap::remove` tombstones the entry for CRDT safety
    // (so a concurrent remove+re-insert on two replicas resolves
    // deterministically instead of diverging). Once a `FolderId` is
    // unregistered, re-registering under the same id does NOT revive the
    // entry — the tombstone wins. This is intentional, not a bug.
    //
    // In production this never matters because admin-API allocates a fresh
    // random group_id for every new folder — no `FolderId` ever recycles.
    // This test pins down the semantic so a future refactor that "fixes"
    // the tombstone (thinking it's a bug) would fail obviously.

    #[test]
    fn tombstone_persists_after_unregister() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f"), None, None, None)
            .unwrap();
        app.unregister_folder_inner(fid("f")).unwrap();
        // The inner insert path doesn't error, but the record is not revived:
        // `get_folder` still reports NotFound.
        let _ = app.register_folder_inner(fid("f"), None, None, None);
        assert!(
            app.get_folder(fid("f")).is_err(),
            "re-registering a tombstoned FolderId must NOT revive the entry",
        );
    }
}
