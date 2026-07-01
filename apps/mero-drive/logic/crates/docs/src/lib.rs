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
//! - `content` — `LwwRegister<String>` (legacy whole-snapshot body, last-write-
//!   wins; the default non-collaborative path)
//! - `content_updates` — `UnorderedSet<Vec<u8>>`, an add-only, idempotent log
//!   of opaque **Yjs binary update blobs**. The collaborative editing path: Yjs
//!   at the client owns the ProseMirror/BlockNote tree CRDT, and the WASM is a
//!   replicated, convergent append-log of its updates. Add-wins set-union merge
//!   (reused from core, content-addressed) makes concurrent edits MERGE rather
//!   than LWW-clobber, and sidesteps core's RGA bugs (no flat char-RGA here).
//! - `tags`    — `LwwRegister<Vec<String>>` (LWW-replaced list)
//! - `archived` / `updated_at` — `LwwRegister<_>`
//! - `created_at` — plain `u64`, written once at create time; treated as
//!   immutable (writes are idempotent since creates of the same id are rejected).
//!
//! The nested `content_updates` set requires `DocRecord` to be a registered
//! `RekeyTarget` so its storage id is deterministic across replicas — see the
//! `DocRecord` doc comment for why this is the load-bearing correctness piece.
//!
//! ## Scope (v1)
//!
//! No cross-service calls into the registry. The docs service knows nothing
//! about the folder tree, color, or visibility — those live in the registry
//! context, which the client queries separately and joins on the folder id.

use calimero_sdk::app;
use calimero_sdk::borsh::io::{Error as BorshIoError, ErrorKind as BorshErrorKind, Read};
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AuthoredMap, Counter, LwwRegister, Mergeable, UnorderedMap, UnorderedSet,
};
use calimero_storage::env as storage_env;
use mero_drive_types::DriveError;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Stored model
// ---------------------------------------------------------------------------

/// Per-document record.
///
/// ## Content: LWW snapshot + collaborative CRDT update log
///
/// Two representations of the body coexist, by design:
///
/// - `content: LwwRegister<String>` — the legacy whole-snapshot field the
///   non-collaborative (default) client path reads/writes via `edit_doc`.
///   Last-write-wins on the full HTML/JSON snapshot. Kept for backward
///   compatibility and as the fallback when the collab feature flag is off.
/// - `content_updates: UnorderedSet<Vec<u8>>` — an add-only, idempotent log
///   of opaque **Yjs binary update blobs**. Yjs at the client produces these;
///   the WASM never parses them. The set reuses core's already-correct
///   **add-wins set-union** merge: re-delivering a blob is a no-op (content-
///   addressed entity id), and two replicas that each append distinct updates
///   converge to the union. This sidesteps the known core RGA bugs entirely —
///   the CRDT structure lives in Yjs at the client; the WASM is just a
///   replicated, convergent append-log.
///
/// ## Why a hand-written `RekeyTarget` — the #1 correctness requirement
///
/// A nested collection (`content_updates`) stored under a value type whose
/// nested ids are NOT deterministically re-keyed keeps a per-replica RANDOM
/// internal storage id and therefore NEVER converges across nodes (the
/// historical #2577 / per-doc divergence class). The fix is for `DocRecord`
/// to be a registered
/// [`RekeyTarget`](calimero_storage::collections::rekey::RekeyTarget): when a
/// record is inserted into the `docs` map under a deterministic entry id,
/// `rekey_relative_to` re-keys `content_updates` to a deterministic id derived
/// from that parent, so every node computes the same set id and the blobs
/// converge as entities (add-wins set-union), not as a last-writer-wins blob.
///
/// We keep the hand-written `Mergeable` (the original `created_at: u64` field
/// is immutable plain data, which `#[derive(Mergeable)]` cannot field-merge)
/// and additionally hand-write `RekeyTarget` + `register_nested_value_types`,
/// mirroring core's own `rekey_record` test precedent. The root
/// `#[app::state]` scan names `DocRecord` (it is the `docs` map value type) and
/// registers its thunk; `register_nested_value_types` then cascades the
/// registration into `UnorderedSet<Vec<u8>>`, so the set's re-key thunk is
/// present before any insert.
///
/// `BorshDeserialize` is hand-written for forward compatibility: pre-collab
/// records were serialized WITHOUT `content_updates`, so the derived decoder
/// would hit EOF and fail. The manual impl reads the original fields, then
/// tolerates a clean EOF on the trailing field by seeding a fresh empty set —
/// existing docs open with an empty update log, and the first
/// `append_doc_update` re-inserts (and thus deterministically re-keys) the
/// record. `BorshSerialize` stays derived (always writes the field), so
/// newly-written records round-trip exactly.
/// NOTE: `DocRecord` is intentionally NOT `Clone` — `UnorderedSet` (a storage
/// collection) is not `Clone`, since cloning a live collection handle would
/// alias one storage entity behind two records. Mutators therefore edit the
/// record in place through `docs.get_mut(...)` (write-back-on-drop) rather than
/// the old clone-mutate-reinsert pattern (which the LWW-only `FolderRecord`
/// still uses, as it has no nested collection).
#[derive(BorshSerialize)]
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
    /// Add-only log of opaque Yjs update blobs (see the type-level doc).
    pub content_updates: UnorderedSet<Vec<u8>>,
}

/// A `Read` that yields one buffered byte first, then delegates to an inner
/// reader. Used by the forward-compat decoder to "un-read" the single probe
/// byte it consumed to distinguish a clean EOF from field data (see below).
struct PrefixByteReader<'a, R: Read> {
    prefix: Option<u8>,
    inner: &'a mut R,
}

impl<R: Read> Read for PrefixByteReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> Result<usize, BorshIoError> {
        if buf.is_empty() {
            return Ok(0);
        }
        if let Some(b) = self.prefix.take() {
            buf[0] = b;
            // Fill the rest (if any) from the inner reader in the same call so
            // a `read_exact` of N>1 bytes still makes progress; partial is fine
            // (Read may return fewer bytes — callers loop).
            if buf.len() > 1 {
                let n = self.inner.read(&mut buf[1..])?;
                return Ok(1 + n);
            }
            return Ok(1);
        }
        self.inner.read(buf)
    }
}

/// Manual, forward-compatible decoder — see the `DocRecord` doc comment.
/// Reads the original (pre-collab) field set, then handles the trailing
/// `content_updates` field with a strict clean-EOF-vs-corruption distinction:
///
///   - **Clean EOF** (ZERO bytes remain where the field would start, detected
///     by a `read_exact` of one byte returning `UnexpectedEof`) → an old,
///     pre-collab record that never wrote the field → seed a fresh empty set.
///   - **Any bytes present** → a record that DOES carry the field → decode it
///     fully and propagate ANY error, including a mid-field `UnexpectedEof`,
///     which now means genuine corruption (a partial write/read), NOT an old
///     record. Previously a `UnexpectedEof` anywhere inside the field was
///     swallowed into an empty set, silently discarding a corrupt-but-nonempty
///     update log; this probe-byte approach only treats a *boundary* EOF as the
///     old-record case. Using `read_exact` (rather than inspecting a `read`
///     return count) makes that boundary distinction independent of any
///     short-read policy.
impl BorshDeserialize for DocRecord {
    fn deserialize_reader<R: Read>(reader: &mut R) -> Result<Self, BorshIoError> {
        let title = LwwRegister::<String>::deserialize_reader(reader)?;
        let content = LwwRegister::<String>::deserialize_reader(reader)?;
        let tags = LwwRegister::<Vec<String>>::deserialize_reader(reader)?;
        let archived = LwwRegister::<bool>::deserialize_reader(reader)?;
        let created_at = u64::deserialize_reader(reader)?;
        let updated_at = LwwRegister::<u64>::deserialize_reader(reader)?;

        // Probe a single byte to tell a clean field-boundary EOF (old record)
        // apart from corruption. Use `read_exact` (not `read`) for GUARANTEED
        // semantics: it returns `Err(UnexpectedEof)` iff zero bytes remained —
        // a clean field boundary — and `Ok(())` iff a byte was read. This
        // removes any dependence on a particular `Read::read` short-read policy
        // (an in-memory slice reader never short-reads, but `read_exact`'s
        // contract makes the clean-EOF distinction airtight regardless).
        let mut probe = [0u8; 1];
        let content_updates = match reader.read_exact(&mut probe) {
            Err(e) if e.kind() == BorshErrorKind::UnexpectedEof => {
                // Clean EOF: pre-collab record, no field bytes were ever
                // written. A fresh set carries a random id, re-keyed
                // deterministically on the first `append_doc_update` re-insert.
                // Empty until then.
                UnorderedSet::new()
            }
            // Any other read error is genuine I/O failure, not a record boundary.
            Err(e) => return Err(e),
            Ok(()) => {
                // Field data present: decode the full field, un-reading the
                // probe byte. A mid-field EOF here is genuine corruption and
                // propagates.
                let mut chained = PrefixByteReader {
                    prefix: Some(probe[0]),
                    inner: reader,
                };
                UnorderedSet::<Vec<u8>>::deserialize_reader(&mut chained)?
            }
        };

        Ok(DocRecord {
            title,
            content,
            tags,
            archived,
            created_at,
            updated_at,
            content_updates,
        })
    }
}

impl Mergeable for DocRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <LwwRegister<String> as Mergeable>::merge(&mut self.title, &other.title)?;
        <LwwRegister<String> as Mergeable>::merge(&mut self.content, &other.content)?;
        <LwwRegister<Vec<String>> as Mergeable>::merge(&mut self.tags, &other.tags)?;
        <LwwRegister<bool> as Mergeable>::merge(&mut self.archived, &other.archived)?;
        // created_at is effectively immutable — identical across replicas.
        <LwwRegister<u64> as Mergeable>::merge(&mut self.updated_at, &other.updated_at)?;
        // Yjs update log: add-wins union. Content-addressed entity ids make
        // re-delivery idempotent; distinct updates from both replicas survive.
        <UnorderedSet<Vec<u8>> as Mergeable>::merge(
            &mut self.content_updates,
            &other.content_updates,
        )?;
        Ok(())
    }
}

// Deterministic re-keying of the nested `content_updates` set relative to the
// record's storage parent. THIS is what makes two independently-created
// replicas of the same doc converge their update logs instead of keeping
// per-replica-random set ids that never merge. See the `DocRecord` doc.
impl calimero_storage::collections::rekey::RekeyTarget for DocRecord {
    fn rekey_relative_to(&mut self, parent_id: calimero_storage::address::Id) {
        calimero_storage::rekey_field_if_supported!(
            &mut self.content_updates,
            calimero_storage::collections::rekey::field_child_id(parent_id, "content_updates")
        );
    }

    // Register the value types THIS record nests so their re-key thunks are
    // present when a record is stored as a map value. Only `content_updates`
    // (an `UnorderedSet<Vec<u8>>`) carries a nested collection id; the
    // `LwwRegister` / `u64` fields are leaves (no-op via autoref dispatch).
    fn register_nested_value_types() {
        calimero_storage::register_rekey_if_supported!(UnorderedSet<Vec<u8>>);
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

// `Mergeable`'s `RekeyTarget` supertrait (core 0.11.0-rc.8+). `Comment` nests no
// collections — `body` is an `LwwRegister` leaf, `doc_id`/`created_at` are plain
// immutable fields — so re-keying is a no-op. See `DocRecord` for the case that
// actually re-keys a nested set.
impl calimero_storage::collections::rekey::RekeyTarget for Comment {
    fn rekey_relative_to(&mut self, _parent_id: calimero_storage::address::Id) {}
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
            // Fresh empty update log. The set is created with a random id here;
            // `docs.insert` re-keys it deterministically relative to the doc's
            // map-entry id (via `DocRecord`'s `RekeyTarget` impl), so every
            // replica that creates "doc-N" derives the same set id and their
            // logs converge.
            content_updates: UnorderedSet::new(),
        };
        self.docs
            .insert(id.clone(), rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(id)
    }

    #[app::view]
    pub fn get_doc(&self, id: String) -> app::Result<DocDto> {
        let rec = self
            .docs
            .get(&id)
            .map_err(|e| AppError::msg(format!("docs.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id)))?;
        project(&id, &rec).map_err(|e| AppError::msg(e.to_string()))
    }

    #[app::view]
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
        // Mutate in place via a write-back guard. `DocRecord` is no longer
        // `Clone` (its `content_updates` set is a non-`Clone` collection), and
        // an in-place edit preserves the record's already-deterministic entity
        // id so no re-key is needed.
        let mut rec = self
            .docs
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        if let Some(t) = title {
            rec.title.set(t);
        }
        if let Some(c) = content {
            rec.content.set(c);
        }
        rec.updated_at.set(storage_env::time_now());
        Ok(())
    }

    // ---- collaborative content (Yjs update log) -------------------------

    /// Append an opaque Yjs update blob to a doc's add-only content log.
    /// Idempotent: the set is content-addressed, so re-appending the same
    /// blob (e.g. SSE re-delivery) is a no-op. This is the write side of the
    /// client-side Yjs collaboration path; the WASM never parses the blob.
    pub fn append_doc_update(&mut self, id: String, update: Vec<u8>) -> app::Result<()> {
        let id_for_event = id.clone();
        let changed = self
            .append_doc_update_inner(id, update)
            .map_err(|e| AppError::msg(e.to_string()))?;
        // Only emit when the set ACTUALLY grew. The content log is content-
        // addressed and re-delivery is common (SSE re-fires, reconnect
        // refetch-then-reappend), so a duplicate append is a no-op — emitting
        // DocEded for it would spam every peer into a redundant
        // `get_doc_updates` + apply pass. Reuse DocEdited so the existing
        // SSE-driven refresh wiring picks up genuine appends.
        if changed {
            app::emit!(Event::DocEdited { id: &id_for_event });
        }
        Ok(())
    }

    /// Returns `true` if the blob was NEW (the set grew), `false` if it was
    /// already present (idempotent re-delivery).
    pub(crate) fn append_doc_update_inner(
        &mut self,
        id: String,
        update: Vec<u8>,
    ) -> Result<bool, DriveError> {
        if update.is_empty() {
            return Err(DriveError::Invalid("empty update".into()));
        }
        let mut rec = self
            .docs
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        let inserted = rec
            .content_updates
            .insert(update)
            .map_err(|e| DriveError::Invalid(format!("content_updates.insert: {e}")))?;
        // Only bump updated_at on a real change so a duplicate re-delivery is a
        // true no-op (it would otherwise advance the LWW clock and re-trigger
        // sibling list re-sorts for nothing).
        if inserted {
            rec.updated_at.set(storage_env::time_now());
        }
        Ok(inserted)
    }

    /// Read the full set of Yjs update blobs for a doc. Order is unspecified
    /// (a set) — Yjs update application is order-independent and idempotent, so
    /// the client folds them in any order. The client dedupes already-applied
    /// blobs by content hash.
    #[app::view]
    pub fn get_doc_updates(&self, id: String) -> app::Result<Vec<Vec<u8>>> {
        let rec = self
            .docs
            .get(&id)
            .map_err(|e| AppError::msg(format!("docs.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id)))?;
        let updates: Vec<Vec<u8>> = rec
            .content_updates
            .iter()
            .map_err(|e| AppError::msg(format!("content_updates.iter: {e}")))?
            .collect();
        Ok(updates)
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
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        rec.archived.set(archived);
        rec.updated_at.set(storage_env::time_now());
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
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        // Read-modify-write over the whole tag list (LWW-replaced on merge).
        // De-duplicate inline so `add_tag(x)` twice is idempotent.
        let mut tags = rec.tags.get().clone();
        if !tags.iter().any(|t| t == &tag) {
            tags.push(tag);
            rec.tags.set(tags);
        }
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
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        let mut tags = rec.tags.get().clone();
        tags.retain(|t| t != &tag);
        rec.tags.set(tags);
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

    #[app::view]
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

    #[app::view]
    pub fn get_comment(&self, id: String) -> app::Result<CommentDto> {
        let c = self
            .comments
            .get(&id)
            .map_err(|e| AppError::msg(format!("comments.get: {e}")))?
            .ok_or_else(|| AppError::msg(format!("not found: {}", id)))?;
        Ok(project_comment(&id, &c))
    }

    #[app::view]
    pub fn comment_count(&self) -> app::Result<u64> {
        Ok(self
            .comments
            .len()
            .map_err(|e| AppError::msg(format!("comments.len: {e}")))? as u64)
    }

    /// The comment's stored per-entry `schema_version` — `Some(1)` before
    /// convert, `Some(2)` after the owner re-signs. Lets the e2e assert that a
    /// one-tap `migrate_my_entries` actually re-stamped it.
    #[app::view]
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
    #[app::view]
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
            content_updates: UnorderedSet::new(),
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
        // `DocRecord` is no longer `Clone` (its nested `content_updates` set is
        // a non-`Clone` collection), so build two stubs with the same logical
        // content instead of cloning a stored record. Merging twice must not
        // change the converged value.
        let mut working = stub_record();
        working.title = LwwRegister::new("t".into());
        working.content = LwwRegister::new("c".into());
        let mut snapshot = stub_record();
        snapshot.title = LwwRegister::new("t".into());
        snapshot.content = LwwRegister::new("c".into());
        let title_after = working.title.get().clone();
        let content_after = working.content.get().clone();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        assert_eq!(working.title.get(), &title_after);
        assert_eq!(working.content.get(), &content_after);
        assert!(!*working.archived.get());
    }

    // ---- Yjs content-update log (op-log) ----

    #[test]
    fn append_doc_update_stores_blob() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.append_doc_update_inner(id.clone(), vec![1, 2, 3])
            .unwrap();
        let updates = app.get_doc_updates(id).unwrap();
        assert_eq!(updates, vec![vec![1, 2, 3]]);
    }

    #[test]
    fn append_doc_update_is_idempotent() {
        // Content-addressed set: appending the same blob twice yields one entry.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.append_doc_update_inner(id.clone(), vec![9, 9]).unwrap();
        app.append_doc_update_inner(id.clone(), vec![9, 9]).unwrap();
        assert_eq!(app.get_doc_updates(id).unwrap().len(), 1);
    }

    #[test]
    fn append_doc_update_reports_new_vs_duplicate() {
        // `append_doc_update_inner` returns true only when the set actually
        // grew. The event emit in `append_doc_update` keys on this so an
        // idempotent re-delivery doesn't spam DocEdited.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        // First append of a blob is new.
        assert!(app.append_doc_update_inner(id.clone(), vec![5, 5]).unwrap());
        // Re-delivery of the SAME blob does not change the set.
        assert!(!app.append_doc_update_inner(id.clone(), vec![5, 5]).unwrap());
        // A distinct blob is new again.
        assert!(app.append_doc_update_inner(id.clone(), vec![6]).unwrap());
        assert!(!app.append_doc_update_inner(id, vec![6]).unwrap());
    }

    #[test]
    fn duplicate_append_does_not_advance_updated_at() {
        // A no-op re-delivery must not tick the LWW clock — otherwise every
        // SSE re-fire would re-sort sibling lists for nothing.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.append_doc_update_inner(id.clone(), vec![1, 2]).unwrap();
        let after_first = app.get_doc(id.clone()).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        // Same blob again — set unchanged, clock must not advance.
        assert!(!app.append_doc_update_inner(id.clone(), vec![1, 2]).unwrap());
        let after_dup = app.get_doc(id).unwrap().updated_at;
        assert_eq!(after_first, after_dup);
    }

    #[test]
    fn append_doc_update_accumulates_distinct_blobs() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.append_doc_update_inner(id.clone(), vec![1]).unwrap();
        app.append_doc_update_inner(id.clone(), vec![2]).unwrap();
        app.append_doc_update_inner(id.clone(), vec![3]).unwrap();
        let mut updates = app.get_doc_updates(id).unwrap();
        updates.sort();
        assert_eq!(updates, vec![vec![1], vec![2], vec![3]]);
    }

    #[test]
    fn append_doc_update_rejects_empty() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        let err = app.append_doc_update_inner(id, Vec::new()).unwrap_err();
        assert!(matches!(err, DriveError::Invalid(_)));
    }

    #[test]
    fn append_doc_update_unknown_doc_is_not_found() {
        let mut app = DocsState::init();
        let err = app
            .append_doc_update_inner("ghost".into(), vec![1])
            .unwrap_err();
        assert!(matches!(err, DriveError::NotFound(_)));
    }

    #[test]
    fn append_doc_update_advances_updated_at() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        let before = app.get_doc(id.clone()).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        app.append_doc_update_inner(id.clone(), vec![7]).unwrap();
        let after = app.get_doc(id).unwrap().updated_at;
        assert!(after > before);
    }

    // ---- DocRecord BorshDeserialize forward-compat (clean EOF vs corruption) ----

    use calimero_sdk::borsh::{self, BorshSerialize};

    /// Serialize just the six pre-collab fields (the layout an OLD record was
    /// written with, before `content_updates` existed). Mirrors `DocRecord`'s
    /// derived `BorshSerialize` field order exactly, minus the trailing set.
    fn serialize_pre_collab_prefix(rec: &DocRecord) -> Vec<u8> {
        let mut bytes = Vec::new();
        BorshSerialize::serialize(&rec.title, &mut bytes).unwrap();
        BorshSerialize::serialize(&rec.content, &mut bytes).unwrap();
        BorshSerialize::serialize(&rec.tags, &mut bytes).unwrap();
        BorshSerialize::serialize(&rec.archived, &mut bytes).unwrap();
        BorshSerialize::serialize(&rec.created_at, &mut bytes).unwrap();
        BorshSerialize::serialize(&rec.updated_at, &mut bytes).unwrap();
        bytes
    }

    #[test]
    fn doc_record_roundtrips_with_content_updates_field() {
        // A NEW record (field present) must round-trip byte-for-byte through
        // borsh: serialize → deserialize → identical projected fields.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "body".into()).unwrap();
        let rec = app.docs.get(&id).unwrap().unwrap();
        let bytes = borsh::to_vec(&*rec).unwrap();
        let back: DocRecord = borsh::from_slice(&bytes).unwrap();
        assert_eq!(back.title.get(), "t");
        assert_eq!(back.content.get(), "body");
    }

    #[test]
    fn doc_record_deserialize_old_record_seeds_empty_set_on_clean_eof() {
        // An OLD record was serialized WITHOUT `content_updates`. Decoding it
        // must hit a CLEAN field-boundary EOF and seed a fresh empty set rather
        // than erroring.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("legacy".into(), "old".into()).unwrap();
        let rec = app.docs.get(&id).unwrap().unwrap();
        let old_bytes = serialize_pre_collab_prefix(&rec);

        let back: DocRecord = borsh::from_slice(&old_bytes).unwrap();
        assert_eq!(back.title.get(), "legacy");
        assert_eq!(back.content.get(), "old");
        // No field bytes → empty update log.
        assert_eq!(back.content_updates.iter().unwrap().count(), 0);
    }

    #[test]
    fn doc_record_deserialize_partial_field_is_corruption_not_empty() {
        // A record WITH a (partially-written / truncated) `content_updates`
        // field is genuine corruption: the decoder must propagate the error,
        // NOT swallow it into an empty set. Construct prefix + a single stray
        // field byte so the probe reads data (Ok(1)) and the full field decode
        // then hits a mid-field EOF.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "body".into()).unwrap();
        let rec = app.docs.get(&id).unwrap().unwrap();
        let mut corrupt = serialize_pre_collab_prefix(&rec);
        // One leftover byte where the field starts: not a clean boundary EOF,
        // but too short to decode the field → must error.
        corrupt.push(0x01);

        let result: Result<DocRecord, _> = borsh::from_slice(&corrupt);
        assert!(
            result.is_err(),
            "a partial content_updates field must error, not seed an empty set",
        );
    }

    #[test]
    fn doc_record_deserialize_trailing_garbage_after_field_is_rejected() {
        // borsh's `from_slice` rejects trailing bytes — proving the field
        // boundary is exact and the probe-byte chaining doesn't lose track of
        // where the field ends.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "body".into()).unwrap();
        let rec = app.docs.get(&id).unwrap().unwrap();
        let mut bytes = borsh::to_vec(&*rec).unwrap();
        bytes.push(0xFF); // extra trailing byte
        let result: Result<DocRecord, _> = borsh::from_slice(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn edit_doc_preserves_content_updates() {
        // The legacy LWW snapshot path (edit_doc) and the Yjs op-log coexist;
        // editing the snapshot must not drop accumulated updates.
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into(), "".into()).unwrap();
        app.append_doc_update_inner(id.clone(), vec![1, 1]).unwrap();
        app.edit_doc_inner(id.clone(), Some("new".into()), Some("snap".into()))
            .unwrap();
        assert_eq!(app.get_doc_updates(id.clone()).unwrap(), vec![vec![1, 1]]);
        assert_eq!(app.get_doc(id).unwrap().content, "snap");
    }
}
