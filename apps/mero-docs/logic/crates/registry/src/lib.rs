//! Registry service - the per-namespace source of truth for folder
//! *presentation* metadata that admin-API does not own.
//!
//! ## What lives here (and why)
//!
//! Admin API is authoritative for group shape, membership, and aliases.
//! Anything admin-API doesn't have a concept for - color,
//! folder→context binding, sort order under a parent - lives in this
//! registry. The namespace holds one Registry context whose state is this
//! struct, replicated across every member of the root group.
//!
//! `parent_id` is stored here too, as an **index** - admin-API remains
//! authoritative for the tree shape, because it does not return a subgroup's
//! parent. The client writes both sides in the same operation and rolls back
//! on failure; there is no cross-system transaction and no repair pass, so a
//! double failure (write and rollback) can leave an orphaned group.
//!
//! ## Merge semantics
//!
//! Every mutable field on a `FolderRecord` is an `LwwRegister<_>`. Concurrent
//! edits (two nodes recoloring the same folder simultaneously) resolve via
//! HLC timestamp + node-id tie-break deterministically across replicas.
//!
//! ## ABI boundary types
//!
//! `FolderId` / `ContextId` are local copies of the `mero_docs_types`
//! definitions (same shape, same bytes; keep them in sync). The ABI is now
//! derived from the type system, so they could be unified with the shared
//! crate; they stay local to keep this crate's ABI unchanged. `DriveError`
//! is imported from the shared crate and converted at the boundary.
//!
//! ## Subgroup visibility
//!
//! Open-vs-Restricted is **not** stored here anymore. Calimero core owns
//! it (`GroupInfo.subgroup_visibility`, `setSubgroupVisibility`) and uses
//! it to drive parent-walk membership inheritance. The frontend reads it
//! via the admin API and writes it via `mero.admin.setSubgroupVisibility`.

use std::collections::BTreeSet;

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Frozen, LwwRegister, Mergeable, Moderated, SharedStorage, SortedMap, UnorderedMap, WriteOnce,
};
use mero_docs_types::DriveError;

pub mod events;
pub mod permissions;
use events::Event;

// ---------------------------------------------------------------------------
// ABI-boundary types (local copies of mero_docs_types; keep in sync).
// ---------------------------------------------------------------------------

/// Wrapper around a folder / group id string. Newtype so the generated TS
/// client surfaces `FolderId` instead of a bare `string`.
#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderId(pub String);

/// Wrapper around a Calimero context id. Same rationale as `FolderId`.
#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextId(pub String);

/// Per-folder cascade flag. `Inherit` = namespace-member cascade descends
/// through this folder (Open subgroup); `Restricted` = explicit-invite wall,
/// cascade stops here. Mirrors the admin-API subgroup_visibility concept but
/// is stored in the registry so clients can read it without a per-folder
/// admin-API call.
#[derive(
    Debug,
    Clone,
    Default,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Visibility {
    /// Namespace members inherit access to the folder.
    #[default]
    Inherit,
    /// Members must be added to the folder explicitly.
    Restricted,
}

/// Per-folder collaborator role. Local copy of `mero_docs_types::Role`
/// (same variants, same bytes); keep the two definitions in sync.
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
    AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Role {
    /// Read only in the web app; enforced only by the member's `ReadOnly` role in the folder's group.
    Viewer,
    /// Reads and edits documents; the role of a member with no explicit row.
    #[default]
    Editor,
    /// Edits, and manages the folder's members.
    Manager,
}

/// One explicit per-member role row for a folder (what `list_folder_roles`
/// returns). Members not present have the implicit `Editor` role.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderRoleEntry {
    /// The member's account id as 64 hex characters.
    pub member: String,
    /// The member's role on the folder.
    pub role: Role,
}

// ---------------------------------------------------------------------------
// Stored model
// ---------------------------------------------------------------------------

/// Per-folder record inside the registry map. All fields are LWW so
/// concurrent updates resolve deterministically.
// Dispatched rather than derived: each field has its own setter, and an entry
// merged without its own rule resolves whole, dropping one of two concurrent edits.
#[app::mergeable(id = "mero_drive_registry::FolderRecord")]
#[derive(Clone, BorshSerialize, BorshDeserialize, AbiType)]
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
    /// registry-side alias - fall back to the admin-API alias or a
    /// truncated id stub on the client".
    pub alias: LwwRegister<String>,
    /// Inherit = namespace-member cascade descends through this folder.
    /// Restricted = explicit-invite wall; cascade stops here.
    pub visibility: LwwRegister<Visibility>,
}

impl Mergeable for FolderRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <LwwRegister<Option<String>> as Mergeable>::merge(&mut self.parent_id, &other.parent_id)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.color, &other.color)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.alias, &other.alias)?;
        <LwwRegister<Visibility> as Mergeable>::merge(&mut self.visibility, &other.visibility)?;
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
            visibility: LwwRegister::new(Visibility::default()),
        }
    }
}

/// Flat, serde-friendly projection of a `FolderRecord` for list/get APIs.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderDto {
    /// The folder's group id.
    pub id: FolderId,
    /// The parent folder's group id; `None` for a top-level folder.
    pub parent_id: Option<FolderId>,
    /// `None` when color is unset / empty.
    pub color: Option<String>,
    /// `None` when no Docs context has been bound to this folder yet.
    pub context_id: Option<ContextId>,
    /// `None` when no registry-side alias is stored (older folders,
    /// or folders created before the alias field existed). Clients
    /// fall back to the admin-API alias or a truncated id stub.
    pub alias: Option<String>,
    /// A registry-side flag the app no longer writes, so it reads `Inherit`; the folder group's visibility decides who can join.
    pub visibility: Visibility,
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
        visibility: rec.visibility.get().clone(),
    }
}

/// `#rrggbb`: `#` followed by exactly six hex digits.
fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Empty means "no color"; anything else must be `#rrggbb`.
fn check_color(c: &str) -> Result<(), DriveError> {
    if !c.is_empty() && !is_hex_color(c) {
        return Err(DriveError::Invalid(format!("invalid color: {c}")));
    }
    Ok(())
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

/// Sort-order parent key. Empty string = "top-level" (root-group children).
/// Stays a `String` to match `UnorderedMap`'s `AsRef<[u8]>` key requirement
/// without bolting an extra impl onto `FolderId`.
const ROOT_SORT_KEY: &str = "";

#[app::state(emits = for<'a> Event<'a>)]
pub struct RegistryState {
    /// folder_id (string) → FolderRecord. Owned by whoever registered the
    /// folder, who alone edits it; the registry admins (owner and managers)
    /// are its moderators and may also remove it. Every node enforces both.
    ///
    /// Keys are per owner (core rc.57): two accounts registering one id hold
    /// two entries, and a key-only `get`/`contains`/`owner_of` answers for the
    /// CALLER only. Every read by id goes through `folder_holder`, which takes
    /// the entry of the lowest account holding the id, the same pick on every
    /// node; `register_folder` refuses an id any account is known to hold.
    folders: Moderated<UnorderedMap<String, FolderRecord>>,
    /// folder_id (string) → Docs context id bound to that folder. Written
    /// once, by the folder's registrant; nobody can rebind or remove it, so a
    /// folder cannot be pointed at someone else's context after the fact.
    /// A binding counts only while its writer owns the folder (see
    /// `binding_of`).
    folder_contexts: WriteOnce<UnorderedMap<String, ContextId>>,
    /// parent_id-or-empty → LWW list of child folder ids in display order.
    /// Deliberately public: display order is collaborative, and a bad order
    /// is corrected by the next reorder.
    sort_order: UnorderedMap<String, LwwRegister<Vec<String>>>,
    /// Hex account of the registry owner: whoever created the registry
    /// context (a namespace admin). Frozen at `init`; nobody can change it.
    owner: Frozen<String>,
    /// Hex accounts granted manager rights over the whole registry (may set/
    /// clear any folder role). Writable by the owner only. The owner is
    /// implicitly a manager and is NOT stored here. Value `true` = is a
    /// manager, `false` = removed (kept around so the key is never
    /// CRDT-tombstoned - a `remove` would silently swallow a later re-add).
    managers: SharedStorage<UnorderedMap<String, LwwRegister<bool>>>,
    /// `role_key(folder_id, member_hex)` → role. Absent ⇒ `Role::Editor`.
    /// Writable by the registry admins only (see `sync_admins`).
    folder_roles: SharedStorage<SortedMap<String, LwwRegister<Role>>>,
    /// tag key → TagRecord. Public, like `sort_order`: any member may name,
    /// recolour or delete a tag; which roles may is the app's to gate.
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
            folders: Moderated::new_with_field_name("registry:folders"),
            folder_contexts: WriteOnce::new_with_field_name("registry:folder_contexts"),
            sort_order: UnorderedMap::new_with_field_name("registry:sort_order"),
            owner: Frozen::new(hex::encode(me.as_bytes())),
            managers: SharedStorage::new_with_field_name(
                "registry:managers",
                BTreeSet::from([me]),
                false,
            ),
            folder_roles: SharedStorage::new_with_field_name(
                "registry:folder_roles",
                BTreeSet::from([me]),
                false,
            ),
            tags: UnorderedMap::new_with_field_name("registry:tags"),
            views: UnorderedMap::new_with_field_name("registry:views"),
            view_origins: WriteOnce::new_with_field_name("registry:view_origins"),
        }
    }

    // ---- folder lifecycle ------------------------------------------------

    /// Adds a folder to the workspace registry so the workspace lists it, and makes the caller its registrant.
    /// Only the registrant can later change or bind the folder; a registry admin can also remove it.
    /// Create the folder's group first and pass its group id as `id`.
    /// Not idempotent: a retry after a lost response fails because the id is already taken, so check `get_folder` before repeating.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    /// * `parent_id` - The parent folder's group id; `null` for a top-level folder, whose group sits directly under the namespace.
    /// * `color` - Accent colour as `#rrggbb`; `null` or an empty string for none.
    /// * `alias` - The folder's display name; `null` for none.
    pub fn register_folder(
        &mut self,
        id: FolderId,
        parent_id: Option<FolderId>,
        color: Option<String>,
        alias: Option<String>,
    ) -> app::Result<()> {
        let id_for_event = id.0.clone();
        self.register_folder_inner(id, parent_id, color, alias)
            .map_err(DriveError::into_app)?;
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
        // Any account's folder, not just the caller's: keys are per owner, so
        // a key-only `contains` would let a second account register the id.
        let already = self.folder_holder(&id.0)?.is_some();
        if already {
            return Err(DriveError::AlreadyExists(id.0));
        }
        if let Some(c) = &color {
            check_color(c)?;
        }
        let parent_str = parent_id.map(|p| p.0);
        let rec = FolderRecord::new(parent_str, color, alias);
        self.folders
            .insert(id.0, rec)
            .map_err(|e| DriveError::Invalid(format!("folders.insert: {e}")))?;
        Ok(())
    }

    /// Removes a folder from the registry, together with its per-member role rows when the caller is a registry admin.
    /// The folder's group, its docs context and its documents are not touched; delete the context and group separately.
    /// Only the folder's registrant or a registry admin may do this. A registry admin is the registry owner or a manager.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    #[app::destructive]
    pub fn unregister_folder(&mut self, id: FolderId) -> app::Result<()> {
        let id_for_event = id.0.clone();
        self.unregister_folder_inner(id)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderUnregistered { id: &id_for_event });
        Ok(())
    }

    /// The folder's registrant, or a registry admin, may unregister it.
    ///
    /// The registrant removes their own entry. Anyone else removes every
    /// holder's entry at the id by name (`remove_by`), which storage allows a
    /// moderator only: a key-only `remove` acts on the caller's own entry.
    pub(crate) fn unregister_folder_inner(&mut self, id: FolderId) -> Result<(), DriveError> {
        let holders = self
            .folders
            .entries_at(&id.0)
            .map_err(|e| DriveError::Invalid(format!("folders.entries_at: {e}")))?;
        if holders.is_empty() {
            return Err(DriveError::NotFound(id.0));
        }
        let forbidden = |_| {
            DriveError::Forbidden(format!(
                "only the folder's creator or a registry admin may remove {}",
                id.0
            ))
        };
        let me = calimero_sdk::AccountId::from(calimero_sdk::env::account_id());
        if holders.iter().any(|(owner, _)| *owner == me) {
            let _ = self.folders.remove(&id.0).map_err(forbidden)?;
        } else {
            for (owner, _) in holders {
                let _ = self.folders.remove_by(&owner, &id.0).map_err(forbidden)?;
            }
        }
        // The context binding is written once and stays; it stops counting
        // with the folder (see `binding_of`). Drop any per-member role rows
        // for this folder when the caller may write them. These ARE
        // CRDT-tombstoned (unlike the live clear_folder_role path), which is
        // correct here: the folder id is tombstoned in `folders` alongside
        // them. Rows a non-admin cannot purge are unreachable once the folder
        // is gone, since folder ids are never reused.
        let caller = permissions::caller_account_hex()?;
        if self.is_admin(&caller)? {
            self.purge_folder_roles(&id.0)?;
        }
        Ok(())
    }

    /// The folder at `id` of the lowest account holding one, with that
    /// account.
    fn folder_holder(
        &self,
        id: &String,
    ) -> Result<Option<(calimero_sdk::AccountId, FolderRecord)>, DriveError> {
        Ok(self
            .folders
            .entries_at(id)
            .map_err(|e| DriveError::Invalid(format!("folders.entries_at: {e}")))?
            .into_iter()
            .min_by_key(|(owner, _)| *owner))
    }

    /// The context bound to `folder`, if its folder exists and the binding
    /// was written by the folder's registrant. A patched node could bind a
    /// folder it does not own; that binding is its own entry, never read.
    fn binding_of(&self, folder: &String) -> Result<Option<ContextId>, DriveError> {
        let Some((owner, _)) = self.folder_holder(folder)? else {
            return Ok(None);
        };
        self.binding_by(&owner, folder)
    }

    /// `owner`'s own binding of `folder`, read by name.
    fn binding_by(
        &self,
        owner: &calimero_sdk::AccountId,
        folder: &String,
    ) -> Result<Option<ContextId>, DriveError> {
        self.folder_contexts
            .get_by(owner, folder)
            .map_err(|e| DriveError::Invalid(format!("folder_contexts: {e}")))
    }

    /// Returns one folder's registry record, including the docs context bound to it.
    /// Fails when the folder is not registered.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    ///
    /// # Returns
    ///
    /// The folder row.
    #[app::view]
    pub fn get_folder(&self, id: FolderId) -> app::Result<FolderDto> {
        let (owner, rec) = self
            .folder_holder(&id.0)
            .map_err(DriveError::into_app)?
            .ok_or_else(|| DriveError::NotFound(id.0.clone()).into_app())?;
        let ctx = self
            .binding_by(&owner, &id.0)
            .map_err(DriveError::into_app)?;
        Ok(project(&id.0, &rec, ctx.as_ref()))
    }

    /// Lists every folder registered in the workspace, one row per folder, in no guaranteed order.
    /// The list is not filtered by access: a restricted folder the caller cannot open is still listed, with its docs context id.
    ///
    /// # Returns
    ///
    /// The folder rows; `parent_id` gives the tree and `context_id` the docs context of each folder.
    #[app::view]
    pub fn get_folders(&self) -> app::Result<Vec<FolderDto>> {
        // One row per folder id: `entries()` lists an id once per account
        // holding it, and every read by id takes the lowest holder's.
        let ids: BTreeSet<String> = self
            .folders
            .entries()
            .map_err(|e| DriveError::Internal(format!("folders.entries: {e}")).into_app())?
            .map(|(id, _)| id)
            .collect();
        let mut out = Vec::new();
        for id in ids {
            let Some((owner, rec)) = self.folder_holder(&id).map_err(DriveError::into_app)? else {
                continue;
            };
            let ctx = self.binding_by(&owner, &id).map_err(DriveError::into_app)?;
            out.push(project(&id, &rec, ctx.as_ref()));
        }
        Ok(out)
    }

    // ---- context binding -------------------------------------------------

    /// Attaches a folder's docs context to its registry record.
    /// Allowed once per folder and only for the folder's registrant; the binding can never be changed or removed.
    /// Not idempotent: a retry after a lost response fails as already bound, so check `get_folder_context` before repeating.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    /// * `context_id` - The id of the context created with service `docs` inside the folder's group.
    pub fn bind_folder_context(
        &mut self,
        folder_id: FolderId,
        context_id: ContextId,
    ) -> app::Result<()> {
        let fid = folder_id.0.clone();
        let cid = context_id.0.clone();
        self.bind_folder_context_inner(folder_id, context_id)
            .map_err(DriveError::into_app)?;
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
        let known = self.folder_holder(&folder_id.0)?.is_some();
        if !known {
            return Err(DriveError::NotFound(folder_id.0));
        }
        let mine = self
            .folders
            .owned_by_me(&folder_id.0)
            .map_err(|e| DriveError::Invalid(format!("folders.owned_by_me: {e}")))?;
        if !mine {
            return Err(DriveError::Forbidden(format!(
                "only the folder's creator may bind {}",
                folder_id.0
            )));
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
            .insert(folder_id.0, context_id)
            .map_err(|e| DriveError::Invalid(format!("folder_contexts.insert: {e}")))?;
        Ok(())
    }

    /// Returns the docs context bound to a folder.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    ///
    /// # Returns
    ///
    /// The context id, or `null` when the folder is unknown or no context is bound yet.
    #[app::view]
    pub fn get_folder_context(&self, folder_id: FolderId) -> app::Result<Option<ContextId>> {
        self.binding_of(&folder_id.0).map_err(DriveError::into_app)
    }

    // ---- color / move ---------------------------------------------------

    /// Sets a folder's accent colour.
    /// Only the folder's registrant may do this.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    /// * `color` - Accent colour as `#rrggbb`; an empty string clears it.
    pub fn set_color(&mut self, id: FolderId, color: String) -> app::Result<()> {
        // Treat empty color as "clear" - matches how `get_folder` projects
        // empty-string back to `None` on read.
        self.set_color_inner(&id.0, color)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderColorChanged { id: &id.0 });
        Ok(())
    }

    /// Sets the display name the registry holds for a folder.
    /// The registry copy lets members who cannot read a restricted folder's group still see its name, so keep it equal to the group's name (`set_group_metadata`).
    /// Only the folder's registrant may do this.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    /// * `alias` - The display name; an empty string clears it.
    pub fn set_folder_alias(&mut self, id: FolderId, alias: String) -> app::Result<()> {
        self.set_folder_alias_inner(&id.0, alias)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderAliasChanged { id: &id.0 });
        Ok(())
    }

    /// Records a visibility flag on the folder's registry record.
    /// The Mero Docs app does not write or read this flag; who can join a folder is decided by the group's visibility, set with `set_group_visibility`.
    /// Only the folder's registrant may do this.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    /// * `visibility` - `Inherit` or `Restricted`.
    pub fn set_visibility(&mut self, id: FolderId, visibility: Visibility) -> app::Result<()> {
        self.set_visibility_inner(&id.0, visibility)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderVisibilityChanged { id: &id.0 });
        Ok(())
    }

    /// Changes the parent recorded in the registry.
    /// It does not move the folder's group in the namespace's group tree, and the Mero Docs app never calls it.
    /// Only the folder's registrant may do this.
    ///
    /// # Arguments
    ///
    /// * `id` - The folder's group id.
    /// * `new_parent` - The new parent folder's group id; `null` for top level.
    pub fn move_folder(&mut self, id: FolderId, new_parent: Option<FolderId>) -> app::Result<()> {
        self.move_folder_inner(&id.0, new_parent.map(|p| p.0))
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderParentChanged { id: &id.0 });
        Ok(())
    }

    pub(crate) fn set_color_inner(&mut self, id: &str, color: String) -> Result<(), DriveError> {
        check_color(&color)?;
        self.mutate_folder(id, |rec| rec.color.set(color))
    }

    pub(crate) fn set_folder_alias_inner(
        &mut self,
        id: &str,
        alias: String,
    ) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.alias.set(alias))
    }

    pub(crate) fn set_visibility_inner(
        &mut self,
        id: &str,
        visibility: Visibility,
    ) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.visibility.set(visibility))
    }

    pub(crate) fn move_folder_inner(
        &mut self,
        id: &str,
        new_parent: Option<String>,
    ) -> Result<(), DriveError> {
        self.mutate_folder(id, |rec| rec.parent_id.set(new_parent))
    }

    /// Only the folder's registrant may edit its record; storage refuses
    /// anyone else on every node.
    fn mutate_folder<F>(&mut self, id: &str, edit: F) -> Result<(), DriveError>
    where
        F: FnOnce(&mut FolderRecord),
    {
        let id = id.to_string();
        if self.folder_holder(&id)?.is_none() {
            return Err(DriveError::NotFound(id));
        }
        self.folders.modify(&id, edit).map_err(|_| {
            DriveError::Forbidden(format!("only the folder's creator may change {id}"))
        })
    }

    // ---- sort order ------------------------------------------------------

    /// Stores the display order of one parent's child folders.
    /// Every id must be a registered folder whose recorded parent is `parent_id`.
    /// Any member may reorder; the last write wins.
    ///
    /// # Arguments
    ///
    /// * `parent_id` - The parent folder's group id; `null` for the top level.
    /// * `folder_ids` - The child folders' group ids in the order to show them.
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
            .map_err(DriveError::into_app)?;
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
            let (_, rec) = self
                .folder_holder(&fid.0)?
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

    /// Returns the stored display order of one parent's child folders.
    ///
    /// # Arguments
    ///
    /// * `parent_id` - The parent folder's group id; `null` for the top level.
    ///
    /// # Returns
    ///
    /// The child folder ids in display order; empty when no order was stored.
    #[app::view]
    pub fn get_sort_order(&self, parent_id: Option<FolderId>) -> app::Result<Vec<FolderId>> {
        let key = parent_id
            .map(|p| p.0)
            .unwrap_or_else(|| ROOT_SORT_KEY.to_string());
        let reg = self
            .sort_order
            .get(&key)
            .map_err(|e| DriveError::Internal(format!("sort_order.get: {e}")).into_app())?;
        Ok(match reg {
            Some(r) => r.get().iter().cloned().map(FolderId).collect(),
            None => Vec::new(),
        })
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

    /// Makes a member a registry manager, which lets them set folder roles and remove any folder from the registry.
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

    // ---- permissions: per-folder roles ----------------------------------

    /// Sets a member's role on a folder: `Viewer`, `Editor` (the default) or `Manager`.
    /// Only a registry admin may do this. A registry admin is the registry owner or a manager.
    /// This records the role only: core refuses a member's writes when they hold `ReadOnly` in the folder's group, so pair `Viewer` with that group role.
    /// The web app sets both, on the folder and on every Open sub-folder reached through it.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    /// * `member` - The member's account id as 64 hex characters.
    /// * `role` - The role to set.
    pub fn set_folder_role(
        &mut self,
        folder_id: FolderId,
        member: String,
        role: Role,
    ) -> app::Result<()> {
        let caller = permissions::caller_account_hex().map_err(DriveError::into_app)?;
        self.set_folder_role_inner(&caller, &folder_id.0, &member, role)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderRoleChanged {
            folder_id: &folder_id.0,
            member: &member,
        });
        Ok(())
    }

    /// Resets a member's role on a folder to the default `Editor`.
    /// Only a registry admin may do this; clearing a member who has no role row is not an error.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    /// * `member` - The member's account id as 64 hex characters.
    #[app::destructive]
    pub fn clear_folder_role(&mut self, folder_id: FolderId, member: String) -> app::Result<()> {
        let caller = permissions::caller_account_hex().map_err(DriveError::into_app)?;
        self.clear_folder_role_inner(&caller, &folder_id.0, &member)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::FolderRoleChanged {
            folder_id: &folder_id.0,
            member: &member,
        });
        Ok(())
    }

    /// Returns a member's role on a folder, `Editor` when none was set.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    /// * `member` - The member's account id as 64 hex characters.
    ///
    /// # Returns
    ///
    /// The member's role.
    #[app::view]
    pub fn get_folder_role(&self, folder_id: FolderId, member: String) -> app::Result<Role> {
        self.get_folder_role_inner(&folder_id.0, &member)
            .map_err(DriveError::into_app)
    }

    /// Lists the members who have an explicit role on a folder; everyone else is an `Editor`.
    ///
    /// # Arguments
    ///
    /// * `folder_id` - The folder's group id.
    ///
    /// # Returns
    ///
    /// One row per member with a role.
    #[app::view]
    pub fn list_folder_roles(&self, folder_id: FolderId) -> app::Result<Vec<FolderRoleEntry>> {
        self.list_folder_roles_inner(&folder_id.0)
            .map_err(DriveError::into_app)
    }

    // ---- tags -------------------------------------------------------------

    /// Creates a workspace tag or changes an existing tag's name and colour.
    /// Documents carry a tag by its key, added with the docs service's `add_tag`.
    /// Fails for a key that was deleted; deleted keys cannot be reused.
    ///
    /// # Arguments
    ///
    /// * `key` - The tag's stable id: 1 to 64 characters of lowercase ASCII letters, digits and `-`.
    /// * `name` - The display name, 1 to 32 bytes after trimming.
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
        if !(1..=32).contains(&name.len()) {
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

    fn fid(s: &str) -> FolderId {
        FolderId(s.to_string())
    }

    // ---- which principal gates this service ----
    //
    // The regression these pin down was invisible to every test above, because
    // they all pass `caller` in by hand: the bug lived entirely in how the
    // caller string is DERIVED. Ownership, managers and folder roles are
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
        let err = app.get_folder(fid("ghost")).unwrap_err();
        assert_eq!(
            calimero_sdk::serde_json::to_value(&err).unwrap(),
            calimero_sdk::serde_json::json!({"kind": "NotFound", "data": "ghost"})
        );
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
    fn a_rejected_colour_reaches_the_client_as_kind_invalid() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        let err = app.set_color(fid("f1"), "red".into()).unwrap_err();
        let wire = calimero_sdk::serde_json::to_value(&err).unwrap();
        assert_eq!(wire["kind"], "Invalid");
    }

    #[test]
    fn set_color_rejects_non_hex_color() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        for bad in ["red", "#0f0"] {
            let err = app.set_color_inner("f1", bad.into()).unwrap_err();
            assert!(matches!(err, DriveError::Invalid(_)), "{bad:?}");
        }
    }

    #[test]
    fn register_folder_rejects_non_hex_color() {
        let mut app = RegistryState::init();
        for bad in ["red", "#0f0"] {
            let err = app
                .register_folder_inner(fid("f1"), None, Some(bad.into()), None)
                .unwrap_err();
            assert!(matches!(err, DriveError::Invalid(_)), "{bad:?}");
        }
    }

    #[test]
    fn register_folder_allows_no_color() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None)
            .unwrap();
        app.register_folder_inner(fid("f2"), None, Some("".into()), None)
            .unwrap();
        app.register_folder_inner(fid("f3"), None, Some("#3b82f6".into()), None)
            .unwrap();
        assert_eq!(app.get_folder(fid("f1")).unwrap().color, None);
        assert_eq!(app.get_folder(fid("f2")).unwrap().color, None);
        assert_eq!(
            app.get_folder(fid("f3")).unwrap().color.as_deref(),
            Some("#3b82f6")
        );
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
        app.register_folder_inner(fid("a"), None, Some("#ff0000".into()), None)
            .unwrap();
        app.register_folder_inner(fid("b"), None, None, None)
            .unwrap();
        app.bind_folder_context_inner(fid("a"), cid("ctx-a"))
            .unwrap();
        app.set_color_inner("a", "#00ff00".into()).unwrap();
        app.reorder_inner(None, vec![fid("b"), fid("a")]).unwrap();

        let a = app.get_folder(fid("a")).unwrap();
        assert_eq!(a.context_id, Some(cid("ctx-a")));
        assert_eq!(a.color.as_deref(), Some("#00ff00"));
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
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero())
    }

    #[test]
    fn folder_record_merge_lww_picks_later_color() {
        let mut a = FolderRecord {
            parent_id: zero_lww(None),
            color: zero_lww("#ff0000".into()),
            alias: zero_lww(String::new()),
            visibility: zero_lww(Visibility::default()),
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
            visibility: zero_lww(Visibility::default()),
        };
        let mut b = FolderRecord::new(None, None, None);
        b.parent_id.set(Some("new-parent".into()));
        <FolderRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.parent_id.get(), &Some("new-parent".to_string()));
    }

    // ---- tombstone behaviour - documents the CRDT invariant ----
    //
    // `UnorderedMap::remove` tombstones the entry for CRDT safety, but as
    // of core 0.11.0-rc.10 (core#3123, "D1") a strictly-newer insert LIFTS
    // the tombstone: unregister → register under the same id revives the
    // entry. (Before rc.10 the tombstone won forever and the re-insert was
    // silently swallowed - this test used to pin that older semantic.)
    //
    // In production this never matters because admin-API allocates a fresh
    // random group_id for every new folder - no `FolderId` ever recycles.
    // This test pins down the current semantic so a future core change in
    // either direction fails obviously.

    #[test]
    fn reregister_after_unregister_revives_entry() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f"), None, None, None)
            .unwrap();
        app.unregister_folder_inner(fid("f")).unwrap();
        app.register_folder_inner(fid("f"), None, None, None)
            .unwrap();
        assert!(
            app.get_folder(fid("f")).is_ok(),
            "rc.10 lifts the tombstone: re-registering a FolderId revives the entry",
        );
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

    /// Two devices of the folder's creator, each editing a different field
    /// before seeing the other's edit.
    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn concurrent_edits_of_different_folder_fields_both_hold() {
        let mut script = registry_script();
        let (laptop, phone) = (script.founder(), script.founder());
        let registered = script
            .run(laptop, |s| {
                s.register_folder_inner(fid("f1"), None, None, None)
                    .unwrap();
            })
            .unwrap();
        assert_eq!(script.deliver(phone, registered), 0);
        let coloured = script
            .run(laptop, |s| {
                s.set_color_inner("f1", "#ff0000".into()).unwrap()
            })
            .unwrap();
        let named = script
            .run(phone, |s| {
                s.set_folder_alias_inner("f1", "Shared".into()).unwrap()
            })
            .unwrap();
        assert_eq!(script.deliver(laptop, named), 0);
        assert_eq!(script.deliver(phone, coloured), 0);
        let both = |s: &RegistryState| {
            let f = s.get_folder(fid("f1")).unwrap();
            f.color.as_deref() == Some("#ff0000") && f.alias.as_deref() == Some("Shared")
        };
        for device in [laptop, phone] {
            assert!(script.view(device, both));
        }
        script.assert_every_order_converges(both);
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
