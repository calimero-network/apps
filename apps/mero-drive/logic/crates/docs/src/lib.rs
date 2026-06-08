//! Docs service — per-folder document storage. One WASM instance of this
//! runs per folder context, isolating each folder's docs into its own
//! replicated state so access control reduces to "are you a member of the
//! folder's group?".
//!
//! ## CRDT shape
//!
//! Each doc uses CRDT fields so concurrent edits merge deterministically:
//!
//! - `title`   — `LwwRegister<String>` (simple overwrite with HLC tie-break)
//! - `content` — `ReplicatedGrowableArray` (char-level RGA for collaborative text)
//! - `tags`    — `UnorderedSet<String>` (grow-only set)
//! - `archived` / `updated_at` — `LwwRegister<_>`
//! - `created_at` — plain `u64`, written once at create time; manual
//!   `Mergeable` impl treats it as immutable (writes are idempotent since
//!   creates of the same id are rejected).
//!
//! ## Scope (v1)
//!
//! No cross-service calls into the registry. The docs service knows nothing
//! about the folder tree, color, or visibility — those live in the registry
//! context, which the client queries separately and joins on the folder id.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{AuthoredMap, Counter, LwwRegister, Mergeable, UnorderedMap};
use calimero_storage::env as storage_env;
use mero_drive_types::DriveError;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Stored model
// ---------------------------------------------------------------------------

/// Per-document record. Every field is an `LwwRegister` per the v1
/// design: *"each doc is LwwRegister per-field; last-write-wins on
/// content"*. Real-time collaborative editing and fine-grained concurrent
/// tag editing are explicitly out of scope. Earlier drafts used
/// `ReplicatedGrowableArray` for content and `UnorderedSet` for tags —
/// both had dynamic-per-doc field names that diverged under cross-node
/// sync. LWW-everywhere is both simpler and what the spec pins.
///
/// `Mergeable` is hand-written (not derived) to avoid the inherent-vs-trait
/// `merge` ambiguity `LwwRegister` causes in the derive macro — same
/// workaround the registry uses on `FolderRecord`.
#[derive(Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DocRecord {
    pub title: LwwRegister<String>,
    pub content: LwwRegister<String>,
    /// Tags as an LWW-replaced list. `add_tag` / `remove_tag` read-modify-
    /// write the whole vec; concurrent tag edits on different nodes settle
    /// by HLC (one side's full tag set wins). For v1 this matches spec.
    pub tags: LwwRegister<Vec<String>>,
    pub archived: LwwRegister<bool>,
    /// Immutable after create — not wrapped in a CRDT because writes of the
    /// same value are idempotent, and `create_doc` rejects id collisions.
    pub created_at: u64,
    pub updated_at: LwwRegister<u64>,
}

impl Mergeable for DocRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <LwwRegister<String> as Mergeable>::merge(&mut self.title, &other.title)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.content, &other.content)?;
        <LwwRegister<Vec<String>> as Mergeable>::merge(&mut self.tags, &other.tags)?;
        <LwwRegister<bool> as Mergeable>::merge(&mut self.archived, &other.archived)?;
        // created_at is effectively immutable — identical across replicas.
        <LwwRegister<u64> as Mergeable>::merge(&mut self.updated_at, &other.updated_at)?;
        Ok(())
    }
}

/// Flat projection of a `DocRecord` for list / get APIs.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocDto {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub archived: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

fn project(id: &str, rec: &DocRecord) -> Result<DocDto, DriveError> {
    Ok(DocDto {
        id: id.to_string(),
        title: rec.title.get().clone(),
        content: rec.content.get().clone(),
        tags: rec.tags.get().clone(),
        archived: *rec.archived.get(),
        created_at: rec.created_at,
        updated_at: *rec.updated_at.get(),
    })
}

// ---------------------------------------------------------------------------
// Comments — authored (identity-gated) annotations on a doc
// ---------------------------------------------------------------------------

/// A per-document comment, owned by its author. Stored in an `AuthoredMap`, so
/// the runtime stamps the writer's identity and a per-entry schema version on
/// insert; only the owner can re-sign it (the basis of the migration banner).
///
/// The value type is intentionally STABLE across schema versions — the v1→v2
/// migration bumps the *state* schema and adds a top-level marker, never a
/// field inside `Comment` (changing an authored value type is a content
/// rewrite, a different and harder migration class).
#[derive(Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Comment {
    /// Which doc this annotates. Immutable after create.
    pub doc_id: String,
    pub body: LwwRegister<String>,
    /// Immutable after create.
    pub created_at: u64,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // doc_id / created_at are immutable and identical across replicas.
        <LwwRegister<String> as Mergeable>::merge(&mut self.body, &other.body)?;
        Ok(())
    }
}

/// Flat projection of a `Comment` for list / get APIs.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentDto {
    pub id: String,
    pub doc_id: String,
    pub body: String,
    pub created_at: u64,
}

fn project_comment(id: &str, c: &Comment) -> CommentDto {
    CommentDto {
        id: id.to_string(),
        doc_id: c.doc_id.clone(),
        body: c.body.get().clone(),
        created_at: c.created_at,
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// v1 schema (default build). `docs` + authored `comments`.
#[cfg(not(feature = "schema_v2"))]
#[app::state(version = 1, emits = for<'a> Event<'a>)]
pub struct DocsState {
    /// doc_id → record. The id is `doc-<counter>` and assigned by `create_doc`.
    docs: UnorderedMap<String, DocRecord>,
    /// Monotonic id allocator. G-Counter semantics: every create increments,
    /// concurrent creates produce distinct ids across replicas.
    next_id: Counter,
    /// comment_id → authored comment. Identity-gated: each entry is owned by
    /// its writer and carries a per-entry schema version.
    comments: AuthoredMap<String, Comment>,
    /// Monotonic comment-id allocator (`cmt-<n>`).
    next_comment_id: Counter,
}

/// v2 schema (feature `schema_v2`), raised to `version = 2`. Two migrations
/// ride the one derive-carry:
///   1. a real top-level additive field — `default_sort_order` (a new docs
///      setting, defaulted via `#[migrate(new = ...)]`) — exercising the engine
///      migrating existing committed state;
///   2. the authored `comments` map, carried byte-for-byte so each entry keeps
///      its owner stamp at schema 1 until the owner re-signs (the banner path).
/// The derive-carry is required for (2): a manual read_raw rebuild would re-sign
/// comments as the migrating identity and lose their owner stamps.
#[cfg(feature = "schema_v2")]
#[app::state(version = 2, emits = for<'a> Event<'a>)]
#[derive(app::Migrate)]
#[migrate(
    from = DocsStateV1,
    method = migrate_v1_to_v2,
    emit = Event::Migrated { from_version: "1.0.0", to_version: "2.0.0" }
)]
pub struct DocsState {
    docs: UnorderedMap<String, DocRecord>,
    next_id: Counter,
    comments: AuthoredMap<String, Comment>,
    next_comment_id: Counter,
    #[migrate(new = LwwRegister::new("created".to_owned()))]
    default_sort_order: LwwRegister<String>,
}

/// v1 reader for the v2 migrate — field order must match the v1 state exactly.
#[cfg(feature = "schema_v2")]
#[derive(BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct DocsStateV1 {
    docs: UnorderedMap<String, DocRecord>,
    next_id: Counter,
    comments: AuthoredMap<String, Comment>,
    next_comment_id: Counter,
}

#[app::logic]
impl DocsState {
    #[app::init]
    pub fn init() -> DocsState {
        DocsState {
            docs: UnorderedMap::new_with_field_name("docs:docs"),
            next_id: Counter::new_with_field_name("docs:next_id"),
            comments: AuthoredMap::new_with_field_name("docs:comments"),
            next_comment_id: Counter::new_with_field_name("docs:next_comment_id"),
            // v2 adds a top-level setting (cfg'd field init is stripped
            // correctly at compile time, unlike a cfg'd whole-fn).
            #[cfg(feature = "schema_v2")]
            default_sort_order: LwwRegister::new("created".to_owned()),
        }
    }

    // ---- CRUD ------------------------------------------------------------

    pub fn create_doc(&mut self, title: String, content: String) -> app::Result<String> {
        let id = self
            .create_doc_inner(title, content)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocCreated { id: &id });
        Ok(id)
    }

    pub(crate) fn create_doc_inner(
        &mut self,
        title: String,
        content: String,
    ) -> Result<String, DriveError> {
        self.next_id
            .increment()
            .map_err(|e| DriveError::Invalid(format!("next_id.increment: {e}")))?;
        let n = self
            .next_id
            .value()
            .map_err(|e| DriveError::Invalid(format!("next_id.value: {e}")))?;
        let id = format!("doc-{}", n);

        let now = storage_env::time_now();
        let rec = DocRecord {
            title: LwwRegister::new(title),
            content: LwwRegister::new(content),
            tags: LwwRegister::new(Vec::new()),
            archived: LwwRegister::new(false),
            created_at: now,
            updated_at: LwwRegister::new(now),
        };
        self.docs
            .insert(id.clone(), rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(id)
    }

    pub fn get_doc(&self, id: String) -> app::Result<DocDto> {
        let rec = self
            .docs
            .get(&id)
            .map_err(|e| AppError::msg(format!("docs.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id)))?;
        project(&id, &rec).map_err(|e| AppError::msg(e.to_string()))
    }

    pub fn list_docs(&self, include_archived: bool) -> app::Result<Vec<DocDto>> {
        let entries = self
            .docs
            .entries()
            .map_err(|e| AppError::msg(format!("docs.entries: {e}")))?;
        let mut out = Vec::new();
        for (id, rec) in entries {
            if !include_archived && *rec.archived.get() {
                continue;
            }
            out.push(project(&id, &rec).map_err(|e| AppError::msg(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn edit_doc(
        &mut self,
        id: String,
        title: Option<String>,
        content: Option<String>,
    ) -> app::Result<()> {
        let id_for_event = id.clone();
        self.edit_doc_inner(id, title, content)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocEdited { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn edit_doc_inner(
        &mut self,
        id: String,
        title: Option<String>,
        content: Option<String>,
    ) -> Result<(), DriveError> {
        let mut rec = self
            .docs
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get: {e}")))?
            // `get` returns a read-only ValueRef guard; clone out an owned
            // record to mutate and re-insert.
            .map(|v| v.clone())
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        if let Some(t) = title {
            rec.title.set(t);
        }
        if let Some(c) = content {
            rec.content.set(c);
        }
        rec.updated_at.set(storage_env::time_now());
        self.docs
            .insert(id, rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(())
    }

    pub fn archive_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.set_archived_inner(id, true)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocArchived { id: &id_for_event });
        Ok(())
    }

    pub fn unarchive_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.set_archived_inner(id, false)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocUnarchived { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn set_archived_inner(
        &mut self,
        id: String,
        archived: bool,
    ) -> Result<(), DriveError> {
        let mut rec = self
            .docs
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get: {e}")))?
            // `get` returns a read-only ValueRef guard; clone out an owned
            // record to mutate and re-insert.
            .map(|v| v.clone())
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        rec.archived.set(archived);
        rec.updated_at.set(storage_env::time_now());
        self.docs
            .insert(id, rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(())
    }

    pub fn delete_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.delete_doc_inner(id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocDeleted { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn delete_doc_inner(&mut self, id: String) -> Result<(), DriveError> {
        let existed = self
            .docs
            .remove(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.remove: {e}")))?;
        if existed.is_none() {
            return Err(DriveError::NotFound(id));
        }
        Ok(())
    }

    // ---- tags ------------------------------------------------------------

    pub fn add_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.add_tag_inner(id, tag)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocTagsChanged { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn add_tag_inner(&mut self, id: String, tag: String) -> Result<(), DriveError> {
        if tag.is_empty() {
            return Err(DriveError::Invalid("empty tag".into()));
        }
        let mut rec = self
            .docs
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get: {e}")))?
            // `get` returns a read-only ValueRef guard; clone out an owned
            // record to mutate and re-insert.
            .map(|v| v.clone())
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        // Read-modify-write over the whole tag list (LWW-replaced on merge).
        // De-duplicate inline so `add_tag(x)` twice is idempotent.
        let mut tags = rec.tags.get().clone();
        if !tags.iter().any(|t| t == &tag) {
            tags.push(tag);
            rec.tags.set(tags);
        }
        self.docs
            .insert(id, rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(())
    }

    pub fn remove_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.remove_tag_inner(id, tag)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocTagsChanged { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn remove_tag_inner(&mut self, id: String, tag: String) -> Result<(), DriveError> {
        let mut rec = self
            .docs
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get: {e}")))?
            // `get` returns a read-only ValueRef guard; clone out an owned
            // record to mutate and re-insert.
            .map(|v| v.clone())
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        let mut tags = rec.tags.get().clone();
        tags.retain(|t| t != &tag);
        rec.tags.set(tags);
        self.docs
            .insert(id, rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(())
    }

    // ---- comments (authored / identity-gated) ----------------------------

    pub fn add_comment(&mut self, doc_id: String, body: String) -> app::Result<String> {
        let id = self
            .add_comment_inner(doc_id, body)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::CommentAdded { id: &id });
        Ok(id)
    }

    pub(crate) fn add_comment_inner(
        &mut self,
        doc_id: String,
        body: String,
    ) -> Result<String, DriveError> {
        self.next_comment_id
            .increment()
            .map_err(|e| DriveError::Invalid(format!("next_comment_id.increment: {e}")))?;
        let n = self
            .next_comment_id
            .value()
            .map_err(|e| DriveError::Invalid(format!("next_comment_id.value: {e}")))?;
        let id = format!("cmt-{}", n);

        let comment = Comment {
            doc_id,
            body: LwwRegister::new(body),
            created_at: storage_env::time_now(),
        };
        // `insert` stamps the caller as owner + the current schema version.
        self.comments
            .insert(id.clone(), comment)
            .map_err(|e| DriveError::Invalid(format!("comments.insert: {e}")))?;
        Ok(id)
    }

    pub fn list_comments(&self, doc_id: String) -> app::Result<Vec<CommentDto>> {
        let entries = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries: {e}")))?;
        let mut out = Vec::new();
        for (id, c) in entries {
            if c.doc_id == doc_id {
                out.push(project_comment(&id, &c));
            }
        }
        Ok(out)
    }

    pub fn get_comment(&self, id: String) -> app::Result<CommentDto> {
        let c = self
            .comments
            .get(&id)
            .map_err(|e| AppError::msg(format!("comments.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id)))?;
        Ok(project_comment(&id, &c))
    }

    pub fn comment_count(&self) -> app::Result<u64> {
        Ok(self
            .comments
            .len()
            .map_err(|e| AppError::msg(format!("comments.len: {e}")))? as u64)
    }

    /// The comment's stored per-entry `schema_version` — `Some(1)` before
    /// convert, `Some(2)` after the owner re-signs. Lets the e2e assert that a
    /// one-tap `migrate_my_entries` actually re-stamped it.
    pub fn comment_schema_version(&self, id: String) -> app::Result<Option<u32>> {
        self.comments
            .entry_schema_version(&id)
            .map_err(|e| AppError::msg(format!("comments.entry_schema_version: {e}")))
    }

    pub fn edit_comment(&mut self, id: String, body: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.edit_comment_inner(id, body)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::CommentEdited { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn edit_comment_inner(
        &mut self,
        id: String,
        body: String,
    ) -> Result<(), DriveError> {
        let mut c = self
            .comments
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("comments.get: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        c.body.set(body);
        // `update` re-signs as the caller (owner-gated by the authored map).
        self.comments
            .update(&id, c)
            .map_err(|e| DriveError::Invalid(format!("comments.update: {e}")))?;
        Ok(())
    }

    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.delete_comment_inner(id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::CommentDeleted { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn delete_comment_inner(&mut self, id: String) -> Result<(), DriveError> {
        let existed = self
            .comments
            .remove(&id)
            .map_err(|e| DriveError::Invalid(format!("comments.remove: {e}")))?;
        if existed.is_none() {
            return Err(DriveError::NotFound(id));
        }
        Ok(())
    }

    /// The top-level setting added by the v2 migration. Present in both builds
    /// (a `#[cfg]` on the whole method confuses `#[app::logic]`'s export
    /// codegen); only the field access is cfg'd. v1 has no such field, so it
    /// returns empty there — the e2e calls this post-cascade (v2) and asserts it
    /// reads back its migrate default, proving the engine migrated the existing
    /// non-authored state.
    pub fn default_sort_order(&self) -> app::Result<String> {
        #[cfg(feature = "schema_v2")]
        {
            Ok(self.default_sort_order.get().clone())
        }
        #[cfg(not(feature = "schema_v2"))]
        {
            Ok(String::new())
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests (drive `*_inner` helpers so event emits are skipped — the
// merobox workflow exercises the emit path on a real node).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_doc_assigns_id_and_returns_it() {
        let mut app = DocsState::init();
        let id = app
            .create_doc_inner("hello".into(), "world".into())
            .unwrap();
        assert!(id.starts_with("doc-"));
        let d = app.get_doc(id.clone()).unwrap();
        assert_eq!(d.id, id);
        assert_eq!(d.title, "hello");
        assert_eq!(d.content, "world");
        assert!(!d.archived);
        assert_eq!(d.tags, Vec::<String>::new());
    }

    #[test]
    fn create_doc_increments_id() {
        let mut app = DocsState::init();
        let a = app.create_doc_inner("a".into(), "".into()).unwrap();
        let b = app.create_doc_inner("b".into(), "".into()).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn create_doc_accepts_empty_content() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        assert_eq!(app.get_doc(id).unwrap().content, "");
    }

    #[test]
    fn list_docs_returns_created_docs() {
        let mut app = DocsState::init();
        app.create_doc_inner("a".into(), "".into()).unwrap();
        app.create_doc_inner("b".into(), "".into()).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 2);
    }

    #[test]
    fn get_doc_missing_is_error() {
        let app = DocsState::init();
        assert!(app.get_doc("ghost".into()).is_err());
    }

    #[test]
    fn edit_doc_updates_title_and_content() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("old".into(), "body".into()).unwrap();
        app.edit_doc_inner(id.clone(), Some("new".into()), Some("newbody".into()))
            .unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.title, "new");
        assert_eq!(d.content, "newbody");
    }

    #[test]
    fn edit_doc_partial_keeps_untouched_fields() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("old".into(), "body".into()).unwrap();
        app.edit_doc_inner(id.clone(), Some("new".into()), None)
            .unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.title, "new");
        assert_eq!(d.content, "body");
    }

    #[test]
    fn edit_doc_clears_content_when_empty_string() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "body".into()).unwrap();
        app.edit_doc_inner(id.clone(), None, Some("".into()))
            .unwrap();
        assert_eq!(app.get_doc(id).unwrap().content, "");
    }

    #[test]
    fn edit_doc_unknown_is_not_found() {
        let mut app = DocsState::init();
        let err = app
            .edit_doc_inner("ghost".into(), Some("t".into()), None)
            .unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn archive_hides_from_list_by_default() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.set_archived_inner(id.clone(), true).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 0);
        assert_eq!(app.list_docs(true).unwrap().len(), 1);
        assert!(app.get_doc(id).unwrap().archived);
    }

    #[test]
    fn unarchive_restores_in_default_list() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.set_archived_inner(id.clone(), true).unwrap();
        app.set_archived_inner(id.clone(), false).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 1);
        assert!(!app.get_doc(id).unwrap().archived);
    }

    #[test]
    fn archive_unknown_is_not_found() {
        let mut app = DocsState::init();
        let err = app.set_archived_inner("ghost".into(), true).unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn delete_doc_removes_from_map() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.delete_doc_inner(id.clone()).unwrap();
        assert!(app.get_doc(id).is_err());
        assert_eq!(app.list_docs(true).unwrap().len(), 0);
    }

    #[test]
    fn delete_doc_unknown_is_not_found() {
        let mut app = DocsState::init();
        let err = app.delete_doc_inner("ghost".into()).unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn add_tag_inserts_and_is_set_no_dup() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.tags.len(), 1);
        assert_eq!(d.tags[0], "todo");
    }

    #[test]
    fn add_tag_rejects_empty() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        let err = app.add_tag_inner(id, "".into()).unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn add_tag_unknown_doc_is_not_found() {
        let mut app = DocsState::init();
        let err = app.add_tag_inner("ghost".into(), "t".into()).unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn remove_tag_deletes_it() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        app.remove_tag_inner(id.clone(), "todo".into()).unwrap();
        assert_eq!(app.get_doc(id).unwrap().tags.len(), 0);
    }

    #[test]
    fn remove_tag_unknown_doc_is_not_found() {
        let mut app = DocsState::init();
        let err = app
            .remove_tag_inner("ghost".into(), "t".into())
            .unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn full_lifecycle_create_edit_archive_tag_delete() {
        let mut app = DocsState::init();
        let id = app
            .create_doc_inner("draft".into(), "hello".into())
            .unwrap();
        app.edit_doc_inner(id.clone(), Some("final".into()), Some("world".into()))
            .unwrap();
        app.add_tag_inner(id.clone(), "review".into()).unwrap();
        app.add_tag_inner(id.clone(), "urgent".into()).unwrap();
        app.remove_tag_inner(id.clone(), "urgent".into()).unwrap();
        app.set_archived_inner(id.clone(), true).unwrap();
        let d = app.get_doc(id.clone()).unwrap();
        assert_eq!(d.title, "final");
        assert_eq!(d.content, "world");
        assert_eq!(d.tags, vec!["review".to_string()]);
        assert!(d.archived);
        app.delete_doc_inner(id.clone()).unwrap();
        assert!(app.get_doc(id).is_err());
    }

    // ---- edit_doc must advance updated_at (spec calls this out) ----

    #[test]
    fn edit_doc_advances_updated_at() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        let before = app.get_doc(id.clone()).unwrap().updated_at;
        // Force a small HLC advance so the LWW timestamp on updated_at
        // definitely ticks forward (same-ns collisions would be a flake).
        std::thread::sleep(std::time::Duration::from_millis(2));
        app.edit_doc_inner(id.clone(), Some("new".into()), None)
            .unwrap();
        let after = app.get_doc(id).unwrap().updated_at;
        assert!(
            after > before,
            "updated_at should advance on edit (before={before}, after={after})",
        );
    }

    #[test]
    fn archive_advances_updated_at() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        let before = app.get_doc(id.clone()).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        app.set_archived_inner(id.clone(), true).unwrap();
        let after = app.get_doc(id).unwrap().updated_at;
        assert!(after > before);
    }

    // ---- edit_doc must NOT clobber other fields ----

    #[test]
    fn edit_doc_preserves_tags_and_archived() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "c".into()).unwrap();
        app.add_tag_inner(id.clone(), "urgent".into()).unwrap();
        app.set_archived_inner(id.clone(), true).unwrap();
        app.edit_doc_inner(id.clone(), Some("new".into()), None)
            .unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.tags, vec!["urgent".to_string()]);
        assert!(d.archived);
    }

    #[test]
    fn add_tag_does_not_touch_content_or_title() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "hello".into()).unwrap();
        app.add_tag_inner(id.clone(), "x".into()).unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.title, "t");
        assert_eq!(d.content, "hello");
    }

    // ---- struct-level DocRecord::merge ----
    //
    // Same rationale as FolderRecord::merge tests: pin the manual
    // Mergeable impl so a future refactor doesn't silently break sync
    // for a specific field. Uses explicit zero-HLC baselines on `a` so
    // `b`'s real-clock writes deterministically win the LWW tie-break
    // regardless of test-parallelism HLC collisions.

    use calimero_storage::collections::LwwRegister;
    use calimero_storage::logical_clock::HybridTimestamp;

    fn zero_lww<T>(v: T) -> LwwRegister<T> {
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero(), [0u8; 32])
    }

    fn stub_record() -> DocRecord {
        DocRecord {
            title: zero_lww("old".into()),
            content: zero_lww("old".into()),
            tags: zero_lww(Vec::new()),
            archived: zero_lww(false),
            created_at: 0,
            updated_at: zero_lww(0),
        }
    }

    #[test]
    fn doc_record_merge_lww_title_content() {
        let mut a = stub_record();
        let mut b = stub_record();
        // overwrite with real-clock HLCs so these win the merge
        b.title = LwwRegister::new("new_title".into());
        b.content = LwwRegister::new("new_content".into());
        <DocRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.title.get(), "new_title");
        assert_eq!(a.content.get(), "new_content");
    }

    #[test]
    fn doc_record_merge_archived_flip() {
        let mut a = stub_record();
        let mut b = stub_record();
        b.archived = LwwRegister::new(true);
        <DocRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert!(*a.archived.get());
    }

    #[test]
    fn doc_record_merge_is_idempotent() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "c".into()).unwrap();
        let snapshot = app.docs.get(&id).unwrap().unwrap().clone();
        let mut working = app.docs.get(&id).unwrap().unwrap().clone();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        assert_eq!(working.title.get(), snapshot.title.get());
        assert_eq!(working.content.get(), snapshot.content.get());
        assert_eq!(*working.archived.get(), *snapshot.archived.get());
    }
}
