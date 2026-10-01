//! Docs service - per-folder document storage. One WASM instance of this
//! runs per folder context, isolating each folder's docs into its own
//! replicated state so access control reduces to "are you a member of the
//! folder's group?".
//!
//! ## CRDT shape
//!
//! Every `position`, `start`, `end` and `at` on this surface indexes Unicode
//! scalar values, not bytes and not UTF-16 code units. Block, mark and anchor
//! identities cross JSON-RPC as bs58-encoded borsh, so a client passes them
//! back verbatim and never parses them.
//!
//! - `title` - `FugueText`, plain text that merges character by character
//! - `body` - `RichDocument<DriveMarks>`, an ordered list of blocks each with
//!   its own text, formatting and structure
//! - `tags` - `UnorderedSet<String>`, so concurrent tag edits all survive
//! - `archived` / `updated_at` - `LwwRegister<_>`
//! - `updated_by` - `LwwRegister<String>`, hex account of the last editor
//!
//! Documents are PUBLIC on purpose: every member of the folder edits them
//! together, and every node accepts any member's write to them. Owning a doc's
//! entry would hand its nested title and body to its creator alone. What is
//! not collaborative is held to its writer by storage instead: who created a
//! doc and when (`headers`, which lists the doc and which only its creator or
//! a moderator removes) and each comment (`comments`, owned by its author and
//! removable by the folder's moderators).
//!
//! ## Scope
//!
//! No cross-service calls into the registry. The docs service knows nothing
//! about the folder tree, color, or visibility - those live in the registry
//! context, which the client queries separately and joins on the folder id.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::DerefMut;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::search::{Query, SearchCollection};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::fugue_text::{Anchor, Bias, IdRange, TextOp, Undo};
use calimero_storage::collections::rich_text::{Attrs, DeltaOp, DeltaUndo};
use calimero_storage::collections::{
    BlockId, BlockView, Expand, FugueText, IndexedMap, LwwRegister, MarkId, MarkSchema, Mergeable,
    Moderated, RichDocument, Span, UnorderedMap, UnorderedSet, ValueRef,
};
use calimero_storage::constants::DRIFT_TOLERANCE_NANOS;
use calimero_storage::env as storage_env;
use mero_docs_types::{is_valid_tag_key, DriveError};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Mark schema
// ---------------------------------------------------------------------------

/// The boundary policy every mero-docs document is written with.
///
/// Permanent once documents exist: a bias is chosen when a mark is written and
/// never revisited, so changing an entry here re-renders nothing and only
/// splits new writes from old ones. An undeclared key is rejected at write time.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DriveMarks;

impl MarkSchema for DriveMarks {
    fn expand(prefix: &str) -> Option<Expand> {
        Some(match prefix {
            "bold" | "italic" | "underline" | "strike" | "textColor" | "backgroundColor" => {
                Expand::After
            }
            "link" | "code" | "comment" => Expand::None,
            _ => return None,
        })
    }
}

/// One document's body. Block `kind` and `attrs` are BlockNote's own strings,
/// stored opaquely and never validated here.
type Body = RichDocument<DriveMarks>;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// One rendered block, mirroring `BlockView` so its id is the same bs58 token
/// every other method takes and returns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Block {
    /// The block id every method takes as `block`. Opaque; pass it back unchanged.
    pub id: String,
    /// The block type, as stored by `insert_block` or `set_kind`.
    pub kind: String,
    /// Nesting depth, 0 for top level.
    pub depth: u8,
    /// The block's attributes, such as `level` on a heading.
    pub attrs: BTreeMap<String, String>,
    /// The block's text as runs of equally formatted characters, in order.
    pub spans: Vec<Span>,
    /// The id of each character of `spans`, in order.
    pub ids: Vec<Run>,
}

impl Block {
    fn new(view: BlockView, body: &Body) -> app::Result<Self> {
        Ok(Self {
            id: encode_token(&view.id)?,
            ids: runs(body.block_body(view.id)?.visible_ids()?),
            kind: view.kind,
            depth: view.depth,
            attrs: view.attrs,
            spans: view.spans,
        })
    }
}

/// A run of character ids, mirroring `IdRange`, which has no `AbiType`.
/// `replica` is decimal text because a full `u64` loses its top bits as a JSON number in a browser.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Run {
    /// The replica that wrote the run's first character.
    pub replica: String,
    /// That replica's counter for the run's first character.
    pub counter: u32,
    /// How many consecutive characters the run covers.
    pub len: u32,
}

fn runs(ranges: Vec<IdRange>) -> Vec<Run> {
    ranges
        .into_iter()
        .map(|range| Run {
            replica: range.start.0.to_string(),
            counter: range.start.1,
            len: range.len,
        })
        .collect()
}

/// The title with the id of each of its characters, in order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TitleState {
    /// The title text.
    pub text: String,
    /// The id of each character of `text`, in order.
    pub ids: Vec<Run>,
}

/// What `apply_delta_on` did. The block's spans come back either way, so a
/// refused write hands the client exactly the state it has to rebase onto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Applied {
    /// `true` when the steps were written, `false` when the write was refused.
    pub applied: bool,
    /// The undo token for `undo`; `null` on a refusal.
    pub token: Option<String>,
    /// The block's spans after the write, or the current ones on a refusal.
    pub spans: Vec<Span>,
    /// The gap after this write's last change, or on a refusal the anchor sent.
    pub anchor: Option<String>,
    /// Where `anchor` sits in `spans`.
    pub anchor_pos: Option<usize>,
    /// The id of each character of `spans`, so a refused write rebases by identity.
    pub ids: Vec<Run>,
}

/// What `title_apply_delta_on` did; the title comes back either way.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TitleApplied {
    /// `true` when the steps were written, `false` when the write was refused.
    pub applied: bool,
    /// The undo token for `title_undo`; `null` on a refusal.
    pub token: Option<String>,
    /// The title after the write, or the current title on a refusal.
    pub text: String,
    /// The gap after this write's last change, or on a refusal the anchor sent.
    pub anchor: Option<String>,
    /// Where `anchor` sits in `text`.
    pub anchor_pos: Option<usize>,
    /// The id of each character of `text`.
    pub ids: Vec<Run>,
}

/// One step of a text change, in Quill's delta shape: `{"retain": 6}`, `{"insert": "text"}` or `{"delete": 2}`.
/// A `retain` or `insert` step also carries `attributes`: an object of formatting, or `null` for none.
// Mirrors `DeltaOp`, which has no `AbiType`. Untagged so the JSON stays Quill's.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde", untagged)]
pub enum Change {
    /// Keeps `retain` characters, optionally changing their formatting.
    Retain {
        /// How many characters to keep.
        retain: usize,
        /// Formatting to set on the kept characters; `null` leaves it as is.
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    /// Inserts text at the current position.
    Insert {
        /// The text to insert.
        insert: String,
        /// Formatting of the inserted text.
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    /// Removes characters at the current position.
    Delete {
        /// How many characters to remove.
        delete: usize,
    },
}

impl From<Change> for DeltaOp {
    fn from(change: Change) -> Self {
        match change {
            Change::Retain { retain, attributes } => Self::Retain { retain, attributes },
            Change::Insert { insert, attributes } => Self::Insert { insert, attributes },
            Change::Delete { delete } => Self::Delete { delete },
        }
    }
}

impl Change {
    /// The plain-text op this change is, for the title. The title carries no
    /// formatting, so an op with attributes has no meaning there.
    fn into_text_op(self) -> app::Result<TextOp> {
        Ok(match self {
            Self::Retain {
                retain,
                attributes: None,
            } => TextOp::Retain(retain),
            Self::Insert {
                insert,
                attributes: None,
            } => TextOp::Insert(insert),
            Self::Delete { delete } => TextOp::Delete(delete),
            _ => {
                return Err(app::err!(
                    "the title carries no formatting: drop `attributes`"
                ))
            }
        })
    }
}

/// The gap right after an edit's last change, counted in the text it produces.
fn edit_end(ops: &[Change]) -> usize {
    ops.iter()
        .map(|op| match op {
            Change::Retain { retain, .. } => *retain,
            Change::Insert { insert, .. } => insert.chars().count(),
            Change::Delete { .. } => 0,
        })
        .sum()
}

/// Whether an anchored write is an insert right where its anchor sits. A client's
/// position for its anchor can drift across identical characters; the node's cannot.
fn at_anchor(anchored: bool, anchor_pos: Option<usize>, ops: &[Change]) -> bool {
    if !anchored {
        return true;
    }
    let (start, inserts) = match ops.split_first() {
        Some((
            Change::Retain {
                retain,
                attributes: None,
            },
            rest,
        )) => (*retain, rest),
        _ => (0, ops),
    };
    !inserts.is_empty()
        && inserts.iter().all(|op| matches!(op, Change::Insert { .. }))
        && anchor_pos == Some(start)
}

/// Opaque identities cross JSON-RPC as one string, so a client never parses them.
fn encode_token<T: calimero_sdk::borsh::BorshSerialize>(value: &T) -> app::Result<String> {
    Ok(bs58::encode(calimero_sdk::borsh::to_vec(value)?).into_string())
}

fn decode_token<T: calimero_sdk::borsh::BorshDeserialize>(token: &str) -> app::Result<T> {
    let bytes = bs58::decode(token).into_vec()?;
    Ok(calimero_sdk::borsh::from_slice(&bytes)?)
}

/// One block as a line of the document digest.
fn digest_block(view: &BlockView, out: &mut String) {
    out.push_str(&view.kind);
    out.push('/');
    out.push_str(&view.depth.to_string());
    for (key, value) in &view.attrs {
        out.push_str(&format!("[{key}={value}]"));
    }
    for span in &view.spans {
        let attrs: Vec<String> = span
            .attributes
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect();
        out.push_str(&format!("{{{}:{}}}", attrs.join(","), span.text));
    }
    out.push(';');
}

// ---------------------------------------------------------------------------
// Stored model
// ---------------------------------------------------------------------------

/// Per-document record.
///
/// The derive supplies the deterministic re-key cascade `title`, `body` and
/// `tags` need: a nested collection stored under a value type that is not a
/// registered `RekeyTarget` keeps a per-replica random storage id and never
/// converges.
///
/// `Searchable`: the node's full-text index holds each doc's title (weighted
/// double) and body text, formatting left out; `search_docs` queries it.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable, app::Searchable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DocRecord {
    /// The title, plain text.
    #[search(text, weight = 200)]
    pub title: FugueText,
    /// The ordered blocks of the document.
    #[search(text)]
    pub body: Body,
    /// The document's tags. A set, so two members tagging the same doc at once both keep their tag.
    pub tags: UnorderedSet<String>,
    /// Whether the document is hidden from the default list.
    pub archived: LwwRegister<bool>,
    /// When the document last changed, in nanoseconds since the Unix epoch.
    pub updated_at: LwwRegister<u64>,
    /// Hex account id of the last editor, advanced with `updated_at`.
    pub updated_by: LwwRegister<String>,
}

/// Flat projection of a `DocRecord` for list / get APIs. The body is read
/// through `get_document` / `get_block_delta`, never flattened into a string.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocDto {
    /// The document id.
    pub id: String,
    /// The title text.
    pub title: String,
    /// Keys only, sorted; the registry maps each to a name and colour.
    pub tags: Vec<String>,
    /// Whether the document is archived.
    pub archived: bool,
    /// When the document was created, in nanoseconds since the Unix epoch; 0 when the creator cannot be determined.
    pub created_at: u64,
    /// When the document last changed, in nanoseconds since the Unix epoch.
    pub updated_at: u64,
    /// Hex account of whoever created the doc, from its header's owner stamp.
    pub created_by: String,
    /// Hex account of whoever last changed the document.
    pub updated_by: String,
    /// Whether the caller may delete it: the same rule `delete_doc` enforces.
    pub can_delete: bool,
}

fn has_tag(rec: &DocRecord, tag: &str) -> Result<bool, DriveError> {
    rec.tags
        .contains(tag)
        .map_err(|e| DriveError::Invalid(format!("tags.contains: {e}")))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The same hex account id the registry keys members by, so the client can name it.
fn caller_account_hex() -> String {
    hex(&calimero_sdk::env::account_id())
}

/// `<kind>-<nonce>-<account hex>-<device tag>`, from nothing another member can write:
/// the full account is checked on read, the random nonce and device keep one account's ids apart.
fn mint_id(kind: &str) -> String {
    let mut nonce = [0u8; 8];
    storage_env::random_bytes(&mut nonce);
    let (account, device) = (storage_env::account_id(), storage_env::device_id());
    format!(
        "{kind}-{}-{}-{}",
        hex(&nonce),
        hex(&account),
        hex(&device[..4])
    )
}

/// The hex account a `mint_id` id names.
fn creator_in(id: &str) -> Option<&str> {
    match id.split('-').collect::<Vec<_>>()[..] {
        [_, _, account, _] => Some(account),
        _ => None,
    }
}

/// `at`, unless it is further ahead of the reader's clock than storage lets a write be.
fn not_ahead(at: u64, now: u64) -> Option<u64> {
    (at <= now.saturating_add(DRIFT_TOLERANCE_NANOS)).then_some(at)
}

/// Whether `id` names `owner`. Anyone may hold an owned entry at any key, so a
/// reader trusts only the entry of the account its id names.
fn id_names(id: &str, owner: &AccountId) -> bool {
    creator_in(id) == Some(hex(owner.as_bytes()).as_str())
}

// ---------------------------------------------------------------------------
// Comments - authored (identity-gated) annotations on a doc
// ---------------------------------------------------------------------------

/// A per-document comment, owned by its author. Stored in an `AuthoredMap`, so
/// the runtime stamps the writer's identity and a per-entry schema version on
/// insert; only the owner can re-sign it (the basis of the migration banner).
///
/// The value type is intentionally STABLE across schema versions - the v1→v2
/// migration bumps the *state* schema and adds a top-level marker, never a
/// field inside `Comment` (changing an authored value type is a content
/// rewrite, a different and harder migration class).
#[app::mergeable(id = "mero_drive::Comment")]
#[derive(Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Comment {
    /// Which doc this annotates. Immutable after create. Indexed, so one doc's
    /// comments are a seek rather than a walk of the folder's.
    #[index]
    pub doc_id: String,
    /// The comment text.
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
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentDto {
    /// The comment id.
    pub id: String,
    /// Hex account of the comment's author, from its owner stamp.
    pub author: String,
    /// The document the comment is on.
    pub doc_id: String,
    /// The comment text.
    pub body: String,
    /// When the comment was added, in nanoseconds since the Unix epoch.
    pub created_at: u64,
}

fn project_comment(id: &str, author: String, c: &Comment) -> CommentDto {
    CommentDto {
        id: id.to_string(),
        author,
        doc_id: c.doc_id.clone(),
        body: c.body.get().clone(),
        created_at: c.created_at,
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// `docs` + their `headers` + moderated `comments`.
#[app::state(version = 1, emits = for<'a> Event<'a>)]
pub struct DocsState {
    /// doc_id → record. Public: collaborative editing. The id is
    /// `doc-<nonce>-<account>-<device tag>` and assigned by `create_doc`.
    docs: UnorderedMap<String, DocRecord>,
    /// doc_id → created_at, filed by the doc's creator, whose owner stamp it
    /// carries. A doc is listed while that entry lives; only its creator or a
    /// moderator (the founder) may remove it, and every node enforces that.
    headers: Moderated<UnorderedMap<String, u64>>,
    /// comment_id → comment. Each is owned by its author, who alone edits it;
    /// the folder's moderators (its founder, who created this context) may
    /// also remove any. Every node enforces both.
    comments: Moderated<IndexedMap<String, Comment>>,
}

// The folder's documents, searchable by title and body.
app::search_indexes!(DocsState {
    "docs" (version = 1) => docs,
});

/// Hits per `search_docs` page unless the caller asks for fewer.
const DEFAULT_DOC_SEARCH_LIMIT: u32 = 20;
/// The longest query `search_docs` takes, in bytes.
const MAX_DOC_SEARCH_QUERY: usize = 256;

/// One document `search_docs` found.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocSearchHit {
    /// The document id.
    pub id: String,
    /// The document title.
    pub title: String,
    /// A fragment of the title or body around the match, the matched words
    /// wrapped in `<b>`; empty when there is none to show.
    pub snippet: String,
    /// How well the document matched; higher is better.
    pub score: f32,
    /// Whether the document is archived.
    pub archived: bool,
}

/// A page of `search_docs`.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocSearchPage {
    /// The hits on this page, best match first.
    pub hits: Vec<DocSearchHit>,
    /// Documents the index matched in all.
    pub total: u64,
    /// Pass back as `cursor` for the next page; `None` on the last.
    pub next_cursor: Option<u32>,
}

#[app::logic]
impl DocsState {
    #[app::init]
    pub fn init() -> DocsState {
        DocsState {
            docs: UnorderedMap::new_with_field_name("docs:docs"),
            headers: Moderated::new_with_field_name("docs:headers"),
            comments: Moderated::new_with_field_name("docs:comments"),
        }
    }

    // ---- CRUD ------------------------------------------------------------

    /// Creates a document with the given title and an empty body, and returns its id.
    /// Add the first block with `insert_block`.
    /// Not idempotent: a retry after a lost response creates a second document, so check `list_docs` before repeating.
    ///
    /// # Arguments
    ///
    /// * `title` - The document title, plain text.
    ///
    /// # Returns
    ///
    /// The new document's id, an opaque string the other methods take as `doc` or `id`.
    pub fn create_doc(&mut self, title: String) -> app::Result<String> {
        let id = self.create_doc_inner(title).map_err(DriveError::into_app)?;
        app::emit!(Event::DocCreated { id: &id });
        Ok(id)
    }

    pub(crate) fn create_doc_inner(&mut self, title: String) -> Result<String, DriveError> {
        let id = mint_id("doc");

        let now = storage_env::time_now();
        let mut title_text = FugueText::new();
        let _minted = title_text
            .insert_str(0, &title)
            .map_err(|e| DriveError::Invalid(format!("title.insert_str: {e}")))?;
        let rec = DocRecord {
            title: title_text,
            body: Body::new(),
            tags: UnorderedSet::new(),
            archived: LwwRegister::new(false),
            updated_at: LwwRegister::new(now),
            updated_by: LwwRegister::new(caller_account_hex()),
        };
        self.headers
            .insert(id.clone(), now)
            .map_err(|e| DriveError::Conflict(format!("headers.insert: {e}")))?;
        self.docs
            .insert(id.clone(), rec)
            .map_err(|e| DriveError::Invalid(format!("docs.insert: {e}")))?;
        Ok(id)
    }

    /// Returns one document's metadata: title, tag keys, archived flag, timestamps, creator, last editor and whether the caller may delete it.
    /// The body is read with `get_document`.
    /// Fails when the document does not exist.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    ///
    /// # Returns
    ///
    /// The document's metadata row.
    #[app::view]
    pub fn get_doc(&self, id: String) -> app::Result<DocDto> {
        let (creator, created_at) = self
            .header_of(&id)
            .map_err(DriveError::into_app)?
            .ok_or_else(|| DriveError::NotFound(id.clone()).into_app())?;
        let rec = self.docs.get(&id)?;
        let now = storage_env::time_now();
        self.project(&id, &creator, created_at, rec.as_deref(), now)
            .map_err(DriveError::into_app)
    }

    /// Lists the documents in this folder's context, in no guaranteed order; sort by `updated_at` for most recent first.
    /// Each row carries metadata only; read a body with `get_document`.
    ///
    /// # Arguments
    ///
    /// * `include_archived` - `true` to include archived documents, `false` to leave them out.
    ///
    /// # Returns
    ///
    /// One metadata row per document.
    #[app::view]
    pub fn list_docs(&self, include_archived: bool) -> app::Result<Vec<DocDto>> {
        let headers = self
            .headers
            .entries_with_owners()
            .map_err(|e| DriveError::Internal(format!("headers.entries: {e}")).into_app())?;
        let now = storage_env::time_now();
        let mut out = Vec::new();
        for (creator, id, created_at) in headers {
            if !id_names(&id, &creator) {
                continue;
            }
            let rec = self.docs.get(&id)?;
            if !include_archived && rec.as_deref().is_some_and(|r| *r.archived.get()) {
                continue;
            }
            out.push(
                self.project(&id, &creator, created_at, rec.as_deref(), now)
                    .map_err(DriveError::into_app)?,
            );
        }
        Ok(out)
    }

    /// Searches this folder's documents by title and body, best match first.
    /// Words match as typed or as a prefix of a longer word, and the title counts double.
    /// Archived documents come back only with `include_archived`; deleted ones never do.
    /// The index lives on each node and lags an edit by up to a second.
    /// On a node running with search off this fails; read the documents with `list_docs` and `get_document` instead.
    ///
    /// # Arguments
    ///
    /// * `query` - The words to find.
    /// * `include_archived` - `true` to include archived documents, `false` to leave them out.
    /// * `cursor` - `next_cursor` from the previous page, or `null` for the first page.
    /// * `limit` - The most hits per page, or `null` for 20; at most 100.
    ///
    /// # Returns
    ///
    /// One page of hits, the total match count, and the cursor for the next page.
    #[app::view]
    pub fn search_docs(
        &self,
        query: String,
        include_archived: bool,
        cursor: Option<u32>,
        limit: Option<u32>,
    ) -> app::Result<DocSearchPage> {
        if query.len() > MAX_DOC_SEARCH_QUERY {
            app::bail!(
                "Search query too long: {} bytes, limit is {MAX_DOC_SEARCH_QUERY}",
                query.len()
            );
        }
        let mut page = DocSearchPage {
            hits: Vec::new(),
            total: 0,
            next_cursor: None,
        };
        if query.trim().is_empty() {
            return Ok(page);
        }
        let query = Query::prefix(query)
            .cursor(cursor.unwrap_or(0))
            .limit(limit.unwrap_or(DEFAULT_DOC_SEARCH_LIMIT));
        let found = self
            .docs
            .search("docs", &query)
            .map_err(|e| app::err!("{e}"))?;
        for hit in found.hits {
            let listed = self
                .header_of(&hit.key)
                .map_err(|e| app::err!("{e}"))?
                .is_some();
            let archived = *hit.value.archived.get();
            if !listed || (archived && !include_archived) {
                continue;
            }
            page.hits.push(DocSearchHit {
                title: hit.value.title.get_text()?,
                id: hit.key,
                snippet: hit.snippet,
                score: hit.score,
                archived,
            });
        }
        page.total = found.total;
        page.next_cursor = found.next_cursor;
        Ok(page)
    }

    /// Renames a document by replacing its whole title.
    /// Character-level title edits go through `title_apply_delta`.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    /// * `title` - The new title, plain text.
    pub fn edit_doc(&mut self, id: String, title: String) -> app::Result<()> {
        let len = self.read(&id)?.title.len()?;
        let ops = vec![
            Change::Delete { delete: len },
            Change::Insert {
                insert: title,
                attributes: None,
            },
        ];
        let _undo = self.title_apply_delta(id.clone(), ops)?;
        app::emit!(Event::DocEdited { id: &id });
        Ok(())
    }

    // ---- title ------------------------------------------------------------

    /// Returns a document's title text.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    ///
    /// # Returns
    ///
    /// The title.
    #[app::view]
    pub fn get_title(&self, doc: String) -> app::Result<String> {
        Ok(self.read(&doc)?.title.get_text()?)
    }

    /// Returns a document's title text together with its character ids, read at the same moment so they line up.
    /// Pass the ids to `title_apply_delta_on` so an edit lands where the caller saw it.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    ///
    /// # Returns
    ///
    /// The title text and the ids of its characters as runs.
    #[app::view]
    pub fn get_title_state(&self, doc: String) -> app::Result<TitleState> {
        let title = &self.read(&doc)?.title;
        Ok(TitleState {
            text: title.get_text()?,
            ids: runs(title.visible_ids()?),
        })
    }

    /// Applies one editing transaction to a document's title and returns a token that `title_undo` takes.
    /// `ops` is a list of steps that walk the text as it was before the change: `{"retain": 3, "attributes": null}` keeps three characters, `{"insert": "text", "attributes": null}` adds text, `{"delete": 2}` removes two.
    /// Text after the last step is kept.
    /// The title carries no formatting, so a step with non-null `attributes` is refused.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `ops` - The steps of the transaction, in order.
    ///
    /// # Returns
    ///
    /// An opaque undo token.
    pub fn title_apply_delta(&mut self, doc: String, ops: Vec<Change>) -> app::Result<String> {
        let ops: Vec<TextOp> = ops
            .into_iter()
            .map(Change::into_text_op)
            .collect::<app::Result<_>>()?;
        let steps = self.write(&doc)?.title.apply_delta(&ops)?;
        app::emit!(Event::TitleChanged { doc: &doc });
        encode_token(&steps)
    }

    /// Like `title_apply_delta`, but only applies when the title is still exactly `base`, because a position counted in any other text names the wrong place.
    /// When `anchor` is given the write must also be an insert right where that anchor sits.
    /// On refusal nothing is written: `applied` is `false` and `text` is the current title to rebase onto.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `base` - The full title text the steps were computed against.
    /// * `ops` - The steps of the transaction, as for `title_apply_delta`.
    /// * `anchor` - Optional cursor token from `title_anchor_at`; `null` for an unanchored write.
    ///
    /// # Returns
    ///
    /// Whether the write applied, the undo token, the resulting title, and an anchor at the end of the edit.
    pub fn title_apply_delta_on(
        &mut self,
        doc: String,
        base: String,
        ops: Vec<Change>,
        anchor: Option<String>,
    ) -> app::Result<TitleApplied> {
        let title = &self.read(&doc)?.title;
        let current = title.get_text()?;
        let anchor_pos = match &anchor {
            Some(token) => title.resolve(&decode_token(token)?).ok(),
            None => None,
        };
        if current != base || !at_anchor(anchor.is_some(), anchor_pos, &ops) {
            return Ok(TitleApplied {
                applied: false,
                token: None,
                text: current,
                anchor: anchor_pos.and(anchor),
                anchor_pos,
                ids: runs(title.visible_ids()?),
            });
        }
        let end = edit_end(&ops);
        let token = self.title_apply_delta(doc.clone(), ops)?;
        let title = &self.read(&doc)?.title;
        Ok(TitleApplied {
            applied: true,
            token: Some(token),
            text: title.get_text()?,
            anchor: Some(encode_token(&title.anchor_at(end, Bias::After)?)?),
            anchor_pos: Some(end),
            ids: runs(title.visible_ids()?),
        })
    }

    /// Takes a whole title transaction back and returns a token that redoes it.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `token` - The token `title_apply_delta` (or a previous undo) returned.
    ///
    /// # Returns
    ///
    /// An opaque token that redoes the transaction.
    pub fn title_undo(&mut self, doc: String, token: String) -> app::Result<String> {
        let steps: Vec<Undo> = decode_token(&token)?;
        let redo = self.write(&doc)?.title.undo(&steps)?;
        app::emit!(Event::TitleChanged { doc: &doc });
        encode_token(&redo)
    }

    /// Returns a cursor for the gap at a title position, as an opaque token that survives concurrent edits and that any member can resolve.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `position` - The gap, counted from 0 at the start of the title.
    /// * `before` - Which side the anchor leans toward when text is inserted exactly at the gap.
    ///
    /// # Returns
    ///
    /// An opaque anchor token.
    #[app::view]
    pub fn title_anchor_at(
        &self,
        doc: String,
        position: usize,
        before: bool,
    ) -> app::Result<String> {
        let bias = if before { Bias::Before } else { Bias::After };
        encode_token(&self.read(&doc)?.title.anchor_at(position, bias)?)
    }

    /// Returns where anchors currently sit in this node's copy of the title.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `anchors` - Tokens from `title_anchor_at`.
    ///
    /// # Returns
    ///
    /// One position per anchor, in order; `null` for an anchor this node cannot place yet.
    // One tree rebuild per anchor; batch if cursor lists grow past a few peers.
    #[app::view]
    pub fn title_resolve(
        &self,
        doc: String,
        anchors: Vec<String>,
    ) -> app::Result<Vec<Option<usize>>> {
        let record = self.read(&doc)?;
        anchors
            .iter()
            .map(|token| Ok(record.title.resolve(&decode_token::<Anchor>(token)?).ok()))
            .collect()
    }

    // ---- body structure ---------------------------------------------------

    /// Inserts an empty block into a document's body and returns its id.
    /// The body is an ordered list of blocks; each has a `kind`, a `depth` and its own text.
    /// Fill the block with `apply_delta`.
    /// Not idempotent: a retry after a lost response adds a second block, so check `list_blocks` before repeating.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `after` - The id of the block to insert after; `null` inserts at the top.
    /// * `kind` - The block type, an opaque string stored as given. The Mero Docs editor uses `paragraph`, `heading`, `bulletListItem` and `image`.
    /// * `depth` - Nesting depth, 0 for top level, 1 for a child of the block above, and so on.
    ///
    /// # Returns
    ///
    /// The new block's id.
    pub fn insert_block(
        &mut self,
        doc: String,
        after: Option<String>,
        kind: String,
        depth: u8,
    ) -> app::Result<String> {
        let after = after.as_deref().map(decode_token).transpose()?;
        let block = self.write(&doc)?.body.insert_block(after, &kind, depth)?;
        let block = encode_token(&block)?;
        app::emit!(Event::BlockInserted {
            doc: &doc,
            block: &block
        });
        Ok(block)
    }

    /// Removes a block from a document's body.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    #[app::destructive]
    pub fn delete_block(&mut self, doc: String, block: String) -> app::Result<()> {
        let id = decode_token(&block)?;
        let _was = self.write(&doc)?.body.delete_block(id)?;
        app::emit!(Event::BlockDeleted {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// Moves a block to just after another block.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block to move.
    /// * `after` - The block to move it after; `null` moves it to the top.
    pub fn move_block(
        &mut self,
        doc: String,
        block: String,
        after: Option<String>,
    ) -> app::Result<()> {
        let id = decode_token(&block)?;
        let after = after.as_deref().map(decode_token).transpose()?;
        self.write(&doc)?.body.move_block(id, after)?;
        app::emit!(Event::BlockMoved {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// Changes a block's type.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `kind` - The new block type, as for `insert_block`.
    pub fn set_kind(&mut self, doc: String, block: String, kind: String) -> app::Result<()> {
        let id = decode_token(&block)?;
        self.write(&doc)?.body.set_kind(id, &kind)?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// Changes a block's nesting depth.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `depth` - The new depth, 0 for top level.
    pub fn set_depth(&mut self, doc: String, block: String, depth: u8) -> app::Result<()> {
        let id = decode_token(&block)?;
        self.write(&doc)?.body.set_depth(id, depth)?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// Sets one attribute on a block, such as `level` on a heading, or removes it.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `key` - The attribute name.
    /// * `value` - The attribute value as a string; `null` removes the attribute.
    pub fn set_attr(
        &mut self,
        doc: String,
        block: String,
        key: String,
        value: Option<String>,
    ) -> app::Result<()> {
        let id = decode_token(&block)?;
        self.write(&doc)?
            .body
            .set_attr(id, &key, value.as_deref())?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// Splits a block in two at a text position and returns the new block, which holds the text after the split and follows the original.
    /// Not idempotent: a retry after a lost response splits again, so read the blocks before repeating.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block to split.
    /// * `at` - The position to split at; the text from here on moves to the new block.
    ///
    /// # Returns
    ///
    /// The new block's id.
    pub fn split_block(&mut self, doc: String, block: String, at: usize) -> app::Result<String> {
        let id = decode_token(&block)?;
        let new = self.write(&doc)?.body.split_block(id, at)?;
        let new = encode_token(&new)?;
        app::emit!(Event::BlockInserted {
            doc: &doc,
            block: &new
        });
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(new)
    }

    /// Appends the text of `second` to `first` and removes `second`.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `first` - The block that keeps its place and receives the text.
    /// * `second` - The block whose text is appended and which is then removed.
    pub fn merge_blocks(&mut self, doc: String, first: String, second: String) -> app::Result<()> {
        let (head, tail) = (decode_token(&first)?, decode_token(&second)?);
        self.write(&doc)?.body.merge_blocks(head, tail)?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &first
        });
        app::emit!(Event::BlockDeleted {
            doc: &doc,
            block: &second
        });
        Ok(())
    }

    // ---- body text --------------------------------------------------------

    /// Applies one editing transaction to a block's text, formatting included, and returns a token that `undo` takes.
    /// `ops` is a list of steps that walk the text as it was before the change: `{"retain": 3, "attributes": null}` keeps three characters, `{"insert": "text", "attributes": null}` adds text, `{"delete": 2}` removes two.
    /// Text after the last step is kept.
    /// A `retain` or `insert` step may carry `attributes` to set formatting, for example `{"insert": "hi", "attributes": {"bold": "true"}}`; to clear formatting from a range use `mark` with a `null` value.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `ops` - The steps of the transaction, in order.
    ///
    /// # Returns
    ///
    /// An opaque undo token.
    pub fn apply_delta(
        &mut self,
        doc: String,
        block: String,
        ops: Vec<Change>,
    ) -> app::Result<String> {
        let ops: Vec<DeltaOp> = ops.into_iter().map(Into::into).collect();
        let id = decode_token(&block)?;
        let undo = self.write(&doc)?.body.apply_delta(id, &ops)?;
        app::emit!(Event::TextChanged {
            doc: &doc,
            block: &block
        });
        encode_token(&undo)
    }

    /// Like `apply_delta`, but only applies when the block's text is still exactly `base`, because a position counted in any other text names the wrong place.
    /// When `anchor` is given the write must also be an insert right where that anchor sits.
    /// On refusal nothing is written: `applied` is `false` and `spans` are the block's current spans to rebase onto.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `base` - The block's full plain text the steps were computed against.
    /// * `ops` - The steps of the transaction, as for `apply_delta`.
    /// * `anchor` - Optional cursor token from `anchor_at`; `null` for an unanchored write.
    ///
    /// # Returns
    ///
    /// Whether the write applied, the undo token, the block's spans afterwards, and an anchor at the end of the edit.
    pub fn apply_delta_on(
        &mut self,
        doc: String,
        block: String,
        base: String,
        ops: Vec<Change>,
        anchor: Option<String>,
    ) -> app::Result<Applied> {
        let id: BlockId = decode_token(&block)?;
        let body = self.read(&doc)?.body.block_body(id)?;
        // The spans are the text as well, so one read serves the guard and a refusal.
        let spans = body.to_delta()?;
        let anchor_pos = match &anchor {
            Some(token) => body.resolve_many(&[decode_token(token)?])?.pop().flatten(),
            None => None,
        };
        let current: String = spans.iter().map(|span| span.text.as_str()).collect();
        if current != base || !at_anchor(anchor.is_some(), anchor_pos, &ops) {
            return Ok(Applied {
                applied: false,
                token: None,
                spans,
                anchor: anchor_pos.and(anchor),
                anchor_pos,
                ids: runs(body.visible_ids()?),
            });
        }
        let end = edit_end(&ops);
        let token = self.apply_delta(doc.clone(), block, ops)?;
        let body = self.read(&doc)?.body.block_body(id)?;
        Ok(Applied {
            applied: true,
            token: Some(token),
            spans: body.to_delta()?,
            anchor: Some(encode_token(&body.anchor_at(end, Bias::After)?)?),
            anchor_pos: Some(end),
            ids: runs(body.visible_ids()?),
        })
    }

    /// Takes a whole text transaction back and returns a token that redoes it.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block the transaction was applied to.
    /// * `token` - The token `apply_delta` (or a previous undo) returned.
    ///
    /// # Returns
    ///
    /// An opaque token that redoes the transaction.
    pub fn undo(&mut self, doc: String, block: String, token: String) -> app::Result<String> {
        let id: BlockId = decode_token(&block)?;
        let undo: DeltaUndo = decode_token(&token)?;
        let redo = self.write(&doc)?.body.apply_undo(id, &undo)?;
        app::emit!(Event::TextChanged {
            doc: &doc,
            block: &block
        });
        encode_token(&redo)
    }

    /// Sets one formatting key over a range of a block's text, or clears it.
    /// Declared keys: `bold`, `italic`, `underline`, `strike`, `code`, `link`, `comment`, `textColor` and `backgroundColor`; any other key is refused.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `start` - First position of the range, inclusive.
    /// * `end` - Position after the range, exclusive.
    /// * `key` - The formatting key.
    /// * `value` - The value, for example `"true"` for `bold` or a URL for `link`; `null` clears the key.
    ///
    /// # Returns
    ///
    /// The id of the new mark, or `null` when the range already had that value and nothing was written.
    pub fn mark(
        &mut self,
        doc: String,
        block: String,
        start: usize,
        end: usize,
        key: String,
        value: Option<String>,
    ) -> app::Result<Option<String>> {
        let id = decode_token(&block)?;
        let minted = self
            .write(&doc)?
            .body
            .mark(id, start, end, &key, value.as_deref())?;
        self.emit_mark(&doc, &block, minted)
    }

    // ---- body reads -------------------------------------------------------

    /// Returns a document's body as an ordered list of blocks, each with its id, kind, depth, attributes and formatted text spans.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    ///
    /// # Returns
    ///
    /// The blocks in document order.
    #[app::view]
    pub fn get_document(&self, doc: String) -> app::Result<Vec<Block>> {
        let body = &self.read(&doc)?.body;
        body.blocks()?
            .into_iter()
            .map(|view| Block::new(view, body))
            .collect()
    }

    /// Returns one block with its kind, depth, attributes and formatted text spans.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    ///
    /// # Returns
    ///
    /// The block, or `null` when there is no such block.
    #[app::view]
    pub fn get_block(&self, doc: String, block: String) -> app::Result<Option<Block>> {
        let body = &self.read(&doc)?.body;
        body.block(decode_token(&block)?)?
            .map(|view| Block::new(view, body))
            .transpose()
    }

    /// Returns one block's text as formatted spans, the read an editor binding does on every keystroke.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    ///
    /// # Returns
    ///
    /// The spans in order; each has `text` and, when formatted, `attributes`.
    #[app::view]
    pub fn get_block_delta(&self, doc: String, block: String) -> app::Result<Vec<Span>> {
        Ok(self.read(&doc)?.body.block_delta(decode_token(&block)?)?)
    }

    /// Returns one block's plain text with formatting stripped.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    ///
    /// # Returns
    ///
    /// The block's text.
    #[app::view]
    pub fn get_text(&self, doc: String, block: String) -> app::Result<String> {
        Ok(self
            .read(&doc)?
            .body
            .block_body(decode_token(&block)?)?
            .get_text()?)
    }

    /// Returns the ids of a document's blocks in document order.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    ///
    /// # Returns
    ///
    /// The block ids.
    #[app::view]
    pub fn list_blocks(&self, doc: String) -> app::Result<Vec<String>> {
        self.read(&doc)?
            .body
            .blocks()?
            .iter()
            .map(|view| encode_token(&view.id))
            .collect()
    }

    /// Returns the whole body as one canonical line, so two replicas can be compared by a single value.
    /// Block ids are left out because they differ between nodes.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    ///
    /// # Returns
    ///
    /// The digest string.
    #[app::view]
    pub fn get_state_digest(&self, doc: String) -> app::Result<String> {
        let mut out = String::new();
        for view in &self.read(&doc)?.body.blocks()? {
            digest_block(view, &mut out);
        }
        Ok(out)
    }

    /// Counts how many times a passage appears contiguously in a block's text.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `needle` - The text to look for.
    ///
    /// # Returns
    ///
    /// The number of occurrences.
    #[app::view]
    pub fn passage_count(&self, doc: String, block: String, needle: String) -> app::Result<usize> {
        let text = self
            .read(&doc)?
            .body
            .block_body(decode_token(&block)?)?
            .get_text()?;
        Ok(text.matches(&needle).count())
    }

    /// Returns a cursor for the gap at a position in a block's text, as an opaque token that survives concurrent edits and that any member can resolve.
    /// Positions count Unicode scalar values, not bytes or UTF-16 units.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `position` - The gap, counted from 0 at the start of the text.
    /// * `before` - Which side the anchor leans toward when text is inserted exactly at the gap.
    ///
    /// # Returns
    ///
    /// An opaque anchor token.
    #[app::view]
    pub fn anchor_at(
        &self,
        doc: String,
        block: String,
        position: usize,
        before: bool,
    ) -> app::Result<String> {
        let bias = if before { Bias::Before } else { Bias::After };
        encode_token(
            &self
                .read(&doc)?
                .body
                .block_body(decode_token(&block)?)?
                .anchor_at(position, bias)?,
        )
    }

    /// Returns where anchors currently sit in this node's copy of a block, in one pass.
    ///
    /// # Arguments
    ///
    /// * `doc` - The document id.
    /// * `block` - The block id.
    /// * `anchors` - Tokens from `anchor_at`.
    ///
    /// # Returns
    ///
    /// One position per anchor, in order; `null` for an anchor this node cannot place yet.
    #[app::view]
    pub fn resolve_ids(
        &self,
        doc: String,
        block: String,
        anchors: Vec<String>,
    ) -> app::Result<Vec<Option<usize>>> {
        let anchors = anchors
            .iter()
            .map(|token| decode_token::<Anchor>(token))
            .collect::<app::Result<Vec<Anchor>>>()?;
        Ok(self
            .read(&doc)?
            .body
            .block_body(decode_token(&block)?)?
            .resolve_many(&anchors)?)
    }

    /// Archives a document, which hides it from `list_docs` unless archived documents are requested.
    /// Nothing is deleted and `unarchive_doc` reverses it.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    pub fn archive_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.set_archived_inner(id, true)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::DocArchived { id: &id_for_event });
        Ok(())
    }

    /// Restores an archived document to the default `list_docs` view.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    pub fn unarchive_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.set_archived_inner(id, false)
            .map_err(DriveError::into_app)?;
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
        rec.updated_by.set(caller_account_hex());
        Ok(())
    }

    /// Deletes a document, its whole body and its comments permanently.
    /// Only the document's creator or a moderator of this folder (the member who created the folder's context) may delete it; `can_delete` on the document's row says whether the caller may.
    /// A moderator removes every comment on it; the creator removes their own, and the rest are no longer listed.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    #[app::destructive]
    pub fn delete_doc(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.delete_doc_inner(id).map_err(DriveError::into_app)?;
        app::emit!(Event::DocDeleted { id: &id_for_event });
        Ok(())
    }

    /// The doc's creator, or a moderator of this folder, may delete it.
    ///
    /// Every node enforces that on the header, which is what lists the doc. The
    /// body is public so every member can co-edit, so a patched node can still
    /// remove it, as any editor can empty it; the doc then stays listed.
    pub(crate) fn delete_doc_inner(&mut self, id: String) -> Result<(), DriveError> {
        let (creator, _) = self
            .header_of(&id)?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        if !self.caller_may_delete(&creator) {
            return Err(DriveError::Forbidden(format!(
                "only the creator of {id} or a moderator may delete it"
            )));
        }
        let _header = self
            .headers
            .remove_by(&creator, &id)
            .map_err(|e| DriveError::Forbidden(format!("headers.remove: {e}")))?;
        self.remove_comments_on(&id)?;
        let _body = self
            .docs
            .remove(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.remove: {e}")))?;
        Ok(())
    }

    // ---- tags ------------------------------------------------------------

    /// Puts a tag on a document.
    /// Adding a tag the document already has changes nothing.
    /// The tag key must be a registered tag's key for the workspace to show it by name; see the registry's `set_tag`.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    /// * `tag` - The tag key: 1 to 64 characters of lowercase ASCII letters, digits and `-`.
    pub fn add_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.add_tag_inner(id, tag).map_err(DriveError::into_app)?;
        app::emit!(Event::DocTagsChanged { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn add_tag_inner(&mut self, id: String, tag: String) -> Result<(), DriveError> {
        if !is_valid_tag_key(&tag) {
            return Err(DriveError::Invalid("invalid tag key".into()));
        }
        let mut rec = self
            .docs
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        // Opening the record for a write re-saves it, so a no-op would still sync a delta.
        if has_tag(&rec, &tag)? {
            return Ok(());
        }
        let _added = rec
            .tags
            .insert(tag)
            .map_err(|e| DriveError::Invalid(format!("tags.insert: {e}")))?;
        Ok(())
    }

    /// Takes a tag off a document.
    /// Removing a tag the document does not have is not an error.
    ///
    /// # Arguments
    ///
    /// * `id` - The document id.
    /// * `tag` - The tag key.
    #[app::destructive]
    pub fn remove_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.remove_tag_inner(id, tag)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::DocTagsChanged { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn remove_tag_inner(&mut self, id: String, tag: String) -> Result<(), DriveError> {
        let mut rec = self
            .docs
            .get_mut(&id)
            .map_err(|e| DriveError::Invalid(format!("docs.get_mut: {e}")))?
            .ok_or_else(|| DriveError::NotFound(id.clone()))?;
        if !has_tag(&rec, &tag)? {
            return Ok(());
        }
        let _was = rec
            .tags
            .remove(&tag)
            .map_err(|e| DriveError::Invalid(format!("tags.remove: {e}")))?;
        Ok(())
    }

    // ---- comments (authored / identity-gated) ----------------------------

    /// Adds a comment to a document, owned by the caller, and returns its id.
    /// Not idempotent: a retry after a lost response adds a second comment, so check `list_comments` before repeating.
    ///
    /// # Arguments
    ///
    /// * `doc_id` - The id of the document to comment on.
    /// * `body` - The comment text.
    ///
    /// # Returns
    ///
    /// The new comment's id.
    pub fn add_comment(&mut self, doc_id: String, body: String) -> app::Result<String> {
        let id = self
            .add_comment_inner(doc_id, body)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::CommentAdded { id: &id });
        Ok(id)
    }

    pub(crate) fn add_comment_inner(
        &mut self,
        doc_id: String,
        body: String,
    ) -> Result<String, DriveError> {
        if self.header_of(&doc_id)?.is_none() {
            return Err(DriveError::NotFound(doc_id));
        }
        let id = mint_id("cmt");

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

    /// Lists one document's comments, in no guaranteed order; sort by `created_at`.
    ///
    /// # Arguments
    ///
    /// * `doc_id` - The document id.
    ///
    /// # Returns
    ///
    /// One row per comment, including its author's account id.
    #[app::view]
    pub fn list_comments(&self, doc_id: String) -> app::Result<Vec<CommentDto>> {
        if self.header_of(&doc_id)?.is_none() {
            return Ok(Vec::new());
        }
        let entries = self
            .comments
            .query("doc_id")
            .eq(doc_id.as_str())
            .entries()
            .map_err(|e| DriveError::Internal(format!("comments.query: {e}")).into_app())?;
        let mut seen = BTreeSet::new();
        let mut out = Vec::with_capacity(entries.len());
        for (id, _) in entries {
            if !seen.insert(id.clone()) {
                continue;
            }
            if let Some((author, c)) = self.named_comment(&id)? {
                if c.doc_id == doc_id {
                    out.push(project_comment(&id, hex(author.as_bytes()), &c));
                }
            }
        }
        Ok(out)
    }

    /// Returns one comment.
    /// Fails when the comment does not exist.
    ///
    /// # Arguments
    ///
    /// * `id` - The comment id.
    ///
    /// # Returns
    ///
    /// The comment row.
    #[app::view]
    pub fn get_comment(&self, id: String) -> app::Result<CommentDto> {
        let (author, c) = self
            .comment_holder(&id)?
            .ok_or_else(|| DriveError::NotFound(id.clone()).into_app())?;
        Ok(project_comment(&id, hex(author.as_bytes()), &c))
    }

    /// Returns how many comments the folder's live documents hold, across all of them.
    /// A comment counts only when it is held by the account its id names.
    ///
    /// # Returns
    ///
    /// The comment count.
    #[app::view]
    pub fn comment_count(&self) -> app::Result<u64> {
        let entries = self
            .comments
            .entries_with_owners()
            .map_err(|e| DriveError::Internal(format!("comments.entries: {e}")).into_app())?;
        let mut live = BTreeMap::new();
        let mut count = 0;
        for (owner, id, c) in entries {
            if !id_names(&id, &owner) {
                continue;
            }
            let doc_live = match live.get(&c.doc_id) {
                Some(known) => *known,
                None => {
                    let found = self.header_of(&c.doc_id)?.is_some();
                    let _previous = live.insert(c.doc_id, found);
                    found
                }
            };
            if !doc_live {
                continue;
            }
            count += 1;
        }
        Ok(count)
    }

    /// Returns the storage schema version stamped on a comment, or `null` when there is no such comment.
    /// A diagnostic for the web app's migration banner; not needed to read or write comments.
    ///
    /// # Arguments
    ///
    /// * `id` - The comment id.
    ///
    /// # Returns
    ///
    /// The schema version number, or `null`.
    // Read by name from the account the comment's id names, so every node answers alike:
    // a key-only `entry_schema_version` reads the caller's own entry only.
    #[app::view]
    pub fn comment_schema_version(&self, id: String) -> app::Result<Option<u32>> {
        let Some((author, _)) = self.comment_holder(&id)? else {
            return Ok(None);
        };
        self.comments
            .entry_schema_version_by(&author, &id)
            .map_err(|e| {
                DriveError::Internal(format!("comments.entry_schema_version: {e}")).into_app()
            })
    }

    /// Replaces a comment's text.
    /// Only the comment's author may edit it.
    ///
    /// # Arguments
    ///
    /// * `id` - The comment id.
    /// * `body` - The new comment text.
    pub fn edit_comment(&mut self, id: String, body: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.edit_comment_inner(id, body)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::CommentEdited { id: &id_for_event });
        Ok(())
    }

    pub(crate) fn edit_comment_inner(
        &mut self,
        id: String,
        body: String,
    ) -> Result<(), DriveError> {
        // The caller's own comment: keys are per owner, and only its author
        // may change a comment.
        let Some(mut c) = self
            .comments
            .get(&id)
            .map_err(|e| DriveError::Invalid(format!("comments.get: {e}")))?
        else {
            let held = !self
                .comments
                .entries_at(&id)
                .map_err(|e| DriveError::Invalid(format!("comments.entries_at: {e}")))?
                .is_empty();
            return Err(if held {
                DriveError::Forbidden(format!("only its author may edit {id}"))
            } else {
                DriveError::NotFound(id)
            });
        };
        c.body.set(body);
        // `update` re-signs as the caller; storage refuses anyone but the
        // comment's author, on every node.
        self.comments
            .update(&id, c)
            .map_err(|e| DriveError::Forbidden(format!("comments.update: {e}")))?;
        Ok(())
    }

    /// Deletes a comment.
    /// Only its author or a moderator of this folder (the member who created the folder's context) may delete it.
    ///
    /// # Arguments
    ///
    /// * `id` - The comment id.
    #[app::destructive]
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        let id_for_event = id.clone();
        self.delete_comment_inner(id)
            .map_err(DriveError::into_app)?;
        app::emit!(Event::CommentDeleted { id: &id_for_event });
        Ok(())
    }

    /// Its author, or a moderator of this folder, may remove a comment.
    ///
    /// Keys are per owner, so a key-only `remove` removes only the CALLER's
    /// own comment. A caller holding none (a moderator) removes every
    /// holder's comment at the id by name, which storage allows a moderator
    /// only.
    pub(crate) fn delete_comment_inner(&mut self, id: String) -> Result<(), DriveError> {
        let holders = self
            .comments
            .entries_at(&id)
            .map_err(|e| DriveError::Invalid(format!("comments.entries_at: {e}")))?;
        if holders.is_empty() {
            return Err(DriveError::NotFound(id));
        }
        let me = AccountId::from(calimero_sdk::env::account_id());
        if holders.iter().any(|(owner, _)| *owner == me) {
            let _ = self
                .comments
                .remove(&id)
                .map_err(|e| DriveError::Forbidden(format!("comments.remove: {e}")))?;
            return Ok(());
        }
        for (owner, _) in holders {
            let _ = self
                .comments
                .remove_by(&owner, &id)
                .map_err(|e| DriveError::Forbidden(format!("comments.remove: {e}")))?;
        }
        Ok(())
    }
}

/// Outside `#[app::logic]`: these are plumbing, not JSON-RPC surface.
impl DocsState {
    /// A doc's creator and creation time: the header at `id` owned by the
    /// account the id names. A key-only `get` would read the caller's own.
    fn header_of(&self, id: &String) -> Result<Option<(AccountId, u64)>, DriveError> {
        Ok(self
            .headers
            .entries_at(id)
            .map_err(|e| DriveError::Invalid(format!("headers: {e}")))?
            .into_iter()
            .find(|(owner, _)| id_names(id, owner)))
    }

    /// The comment at `id` of the account the id names, with that account.
    /// A key-only `get` would read the caller's own.
    fn named_comment(&self, id: &String) -> app::Result<Option<(AccountId, Comment)>> {
        Ok(self
            .comments
            .entries_at(id)?
            .into_iter()
            .find(|(owner, _)| id_names(id, owner)))
    }

    /// `named_comment`, while its doc is listed.
    fn comment_holder(&self, id: &String) -> app::Result<Option<(AccountId, Comment)>> {
        let Some((author, c)) = self.named_comment(id)? else {
            return Ok(None);
        };
        let live = self
            .header_of(&c.doc_id)
            .map_err(DriveError::into_app)?
            .is_some();
        Ok(live.then_some((author, c)))
    }

    /// `rec` is `None` for a doc whose public body a patched node removed. Both
    /// times are writer-chosen, so one claiming the future is not trusted.
    fn project(
        &self,
        id: &str,
        creator: &AccountId,
        created_at: u64,
        rec: Option<&DocRecord>,
        now: u64,
    ) -> Result<DocDto, DriveError> {
        let created_at = not_ahead(created_at, now).unwrap_or_default();
        let title = rec
            .map(|r| r.title.get_text())
            .transpose()
            .map_err(|e| DriveError::Invalid(format!("title.get_text: {e}")))?;
        let mut tags: Vec<String> = match rec {
            Some(r) => r
                .tags
                .iter()
                .map_err(|e| DriveError::Invalid(format!("tags.iter: {e}")))?
                .collect(),
            None => Vec::new(),
        };
        tags.sort();
        Ok(DocDto {
            id: id.to_owned(),
            title: title.unwrap_or_default(),
            tags,
            archived: rec.is_some_and(|r| *r.archived.get()),
            created_at,
            updated_at: rec
                .and_then(|r| not_ahead(*r.updated_at.get(), now))
                .unwrap_or(created_at),
            created_by: hex(creator.as_bytes()),
            updated_by: rec.map(|r| r.updated_by.get().clone()).unwrap_or_default(),
            can_delete: self.caller_may_delete(creator),
        })
    }

    /// Removes the comments on `doc` that storage lets the caller remove: every
    /// author's for a moderator, otherwise the caller's own.
    fn remove_comments_on(&mut self, doc: &str) -> Result<(), DriveError> {
        let me = AccountId::from(calimero_sdk::env::account_id());
        let moderator = self.comments.is_moderator(&me);
        let ids: BTreeSet<String> = self
            .comments
            .query("doc_id")
            .eq(doc)
            .entries()
            .map_err(|e| DriveError::Invalid(format!("comments.query: {e}")))?
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        for id in ids {
            let holders = self
                .comments
                .entries_at(&id)
                .map_err(|e| DriveError::Invalid(format!("comments.entries_at: {e}")))?;
            for (owner, c) in holders {
                if c.doc_id == doc && (moderator || owner == me) {
                    let _ = self
                        .comments
                        .remove_by(&owner, &id)
                        .map_err(|e| DriveError::Forbidden(format!("comments.remove: {e}")))?;
                }
            }
        }
        Ok(())
    }

    /// The one rule `delete_doc` enforces and `DocDto::can_delete` reports.
    fn caller_may_delete(&self, creator: &AccountId) -> bool {
        let me = AccountId::from(calimero_sdk::env::account_id());
        me == *creator || self.headers.is_moderator(&me)
    }

    fn read(&self, doc: &str) -> app::Result<ValueRef<DocRecord>> {
        match self.docs.get(doc)? {
            Some(found) => Ok(found),
            None => Err(app::err!("unknown document '{doc}'")),
        }
    }

    /// Every mutator goes through here, so the list's sort key and last editor
    /// advance in one place rather than at fifteen call sites.
    fn write(&mut self, doc: &str) -> app::Result<impl DerefMut<Target = DocRecord> + '_> {
        match self.docs.get_mut(doc)? {
            Some(mut found) => {
                found.updated_at.set(storage_env::time_now());
                found.updated_by.set(caller_account_hex());
                Ok(found)
            }
            None => Err(app::err!("unknown document '{doc}'")),
        }
    }

    fn emit_mark(
        &self,
        doc: &str,
        block: &str,
        minted: Option<MarkId>,
    ) -> app::Result<Option<String>> {
        let Some(minted) = minted else {
            return Ok(None);
        };
        let mark_id = encode_token(&minted)?;
        app::emit!(Event::MarkApplied {
            doc,
            block,
            mark_id: &mark_id
        });
        Ok(Some(mark_id))
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    std::thread_local! {
        static DOC: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    }

    /// The doc `host` created on this test's thread.
    fn doc() -> String {
        DOC.with_borrow(Clone::clone)
    }

    fn host(title: &str) -> TestHost<DocsState> {
        let mut app = TestHost::new(DocsState::init);
        let id = app.call(|s| s.create_doc(title.to_owned())).unwrap();
        DOC.set(id);
        app
    }

    fn retain(count: usize) -> Change {
        Change::Retain {
            retain: count,
            attributes: None,
        }
    }

    fn insert(text: &str) -> Change {
        Change::Insert {
            insert: text.to_owned(),
            attributes: None,
        }
    }

    fn title(app: &TestHost<DocsState>) -> String {
        app.view(|s| s.get_title(doc())).unwrap()
    }

    fn digest(app: &TestHost<DocsState>) -> String {
        app.view(|s| s.get_state_digest(doc())).unwrap()
    }

    fn add_block(app: &mut TestHost<DocsState>, kind: &str) -> String {
        app.call(|s| s.insert_block(doc(), None, kind.to_owned(), 0))
            .unwrap()
    }

    fn type_text(app: &mut TestHost<DocsState>, block: &str, text: &str) -> String {
        app.call(|s| s.apply_delta(doc(), block.to_owned(), vec![insert(text)]))
            .unwrap()
    }

    // ---- DriveMarks ------------------------------------------------------

    /// The table is permanent once documents exist: a bias is chosen at write
    /// time and never revisited, so a changed entry splits new writes from old.
    #[test]
    fn drive_marks_declares_the_growing_and_non_growing_keys() {
        for key in [
            "bold",
            "italic",
            "underline",
            "strike",
            "textColor",
            "backgroundColor",
        ] {
            assert_eq!(DriveMarks::expand(key), Some(Expand::After), "{key}");
        }
        for key in ["link", "code", "comment"] {
            assert_eq!(DriveMarks::expand(key), Some(Expand::None), "{key}");
        }
    }

    #[test]
    fn drive_marks_rejects_an_undeclared_key() {
        assert_eq!(DriveMarks::expand("highlight"), None);
        assert_eq!(DriveMarks::expand(""), None);

        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello");
        let err = app
            .call(|s| {
                s.mark(
                    doc(),
                    block.clone(),
                    0,
                    5,
                    "highlight".to_owned(),
                    Some("yellow".to_owned()),
                )
            })
            .unwrap_err();
        let err = format!("{err:?}");
        assert!(err.contains("unknown mark key 'highlight'"), "{err}");
    }

    /// One policy covers every suffix of a prefix, which is what makes a
    /// per-thread `comment:<id>` one declaration rather than N.
    #[test]
    fn a_comment_suffix_shares_the_comment_policy() {
        assert_eq!(DriveMarks::expand("comment"), Some(Expand::None));
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let mark = app
            .call(|s| {
                s.mark(
                    doc(),
                    block.clone(),
                    0,
                    5,
                    "comment:alpha".to_owned(),
                    Some("first".to_owned()),
                )
            })
            .unwrap();
        assert!(mark.is_some());
        assert_eq!(
            digest(&app),
            "paragraph/0{comment:alpha=first:hello}{: world};"
        );
    }

    // ---- title -----------------------------------------------------------

    #[test]
    fn create_doc_seeds_the_title() {
        let app = host("Roadmap");
        assert_eq!(title(&app), "Roadmap");
        assert_eq!(app.view(|s| s.get_doc(doc())).unwrap().title, "Roadmap");
        // The body starts empty; a client adds the first block itself.
        assert_eq!(digest(&app), "");
    }

    /// Position 2 is the gap AFTER the astral scalar: a UTF-16 index would land
    /// inside its surrogate pair, a byte index inside its four bytes.
    #[test]
    fn a_title_delta_indexes_unicode_scalar_values() {
        let mut app = host("a\u{1F600}b");
        let _undo = app
            .call(|s| s.title_apply_delta(doc(), vec![retain(2), insert("X")]))
            .unwrap();
        assert_eq!(title(&app), "a\u{1F600}Xb");
    }

    /// A ZWJ family is FIVE scalars, not one grapheme, so every joiner is its
    /// own addressable position.
    #[test]
    fn a_zwj_sequence_is_five_addressable_scalars() {
        const FAMILY: &str = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
        let mut app = host(FAMILY);
        let _undo = app
            .call(|s| s.title_apply_delta(doc(), vec![retain(1), insert("-")]))
            .unwrap();
        assert_eq!(title(&app), "\u{1F468}-\u{200D}\u{1F469}\u{200D}\u{1F467}");

        let anchor = app.view(|s| s.title_anchor_at(doc(), 6, true)).unwrap();
        assert_eq!(
            app.view(|s| s.title_resolve(doc(), vec![anchor])).unwrap(),
            vec![Some(6)]
        );
    }

    #[test]
    fn title_undo_restores_the_previous_text() {
        let mut app = host("Roadmap");
        let undo = app
            .call(|s| {
                s.title_apply_delta(
                    doc(),
                    vec![retain(4), Change::Delete { delete: 3 }, insert("block")],
                )
            })
            .unwrap();
        assert_eq!(title(&app), "Roadblock");

        let redo = app.call(|s| s.title_undo(doc(), undo)).unwrap();
        assert_eq!(title(&app), "Roadmap");
        let _again = app.call(|s| s.title_undo(doc(), redo)).unwrap();
        assert_eq!(title(&app), "Roadblock");
    }

    #[test]
    fn a_title_op_carrying_attributes_is_rejected() {
        let mut app = host("t");
        let err = app
            .call(|s| {
                s.title_apply_delta(
                    doc(),
                    vec![Change::Insert {
                        insert: "x".to_owned(),
                        attributes: Some(Attrs::from([(
                            "bold".to_owned(),
                            Some("true".to_owned()),
                        )])),
                    }],
                )
            })
            .unwrap_err();
        let err = format!("{err:?}");
        assert!(err.contains("the title carries no formatting"), "{err}");
        assert_eq!(title(&app), "t");
    }

    #[test]
    fn edit_doc_replaces_the_whole_title() {
        let mut app = host("old");
        app.call(|s| s.edit_doc(doc(), "new".to_owned())).unwrap();
        assert_eq!(title(&app), "new");
    }

    // ---- body ------------------------------------------------------------

    #[test]
    fn apply_delta_renders_into_the_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        assert_eq!(digest(&app), "paragraph/0{:hello world};");
        assert_eq!(
            app.view(|s| s.get_text(doc(), block.clone())).unwrap(),
            "hello world"
        );
        assert_eq!(app.view(|s| s.list_blocks(doc())).unwrap(), vec![block]);
    }

    #[test]
    fn title_apply_delta_on_applies_onto_the_title_it_was_diffed_against() {
        let mut app = host("core");
        let applied = app
            .call(|s| {
                s.title_apply_delta_on(
                    doc(),
                    "core".to_owned(),
                    vec![retain(4), insert(" team")],
                    None,
                )
            })
            .unwrap();
        assert!(applied.applied);
        assert!(applied.token.is_some());
        assert_eq!(applied.text, "core team");
        assert_eq!(title(&app), "core team");
    }

    #[test]
    fn title_apply_delta_on_refuses_a_stale_base_and_hands_back_the_title() {
        let mut app = host("core");
        let refused = app
            .call(|s| {
                s.title_apply_delta_on(doc(), "cor".to_owned(), vec![retain(3), insert("X")], None)
            })
            .unwrap();
        assert!(!refused.applied);
        assert_eq!(refused.token, None);
        assert_eq!(refused.text, "core");
        assert_eq!(title(&app), "core");
        assert_eq!((refused.anchor, refused.anchor_pos), (None, None));
    }

    /// Appends `text` to the title through the guard.
    fn guarded_title(app: &mut TestHost<DocsState>, text: &str) -> TitleApplied {
        let base = title(app);
        let end = base.chars().count();
        app.call(|s| s.title_apply_delta_on(doc(), base, vec![retain(end), insert(text)], None))
            .unwrap()
    }

    #[test]
    fn title_apply_delta_on_hands_back_an_anchor_after_the_write() {
        let mut app = host("Shared:");
        let applied = guarded_title(&mut app, "a");
        assert_eq!(applied.anchor_pos, Some(8));
        let anchor = applied.anchor.unwrap();
        assert_eq!(
            app.view(|s| s.title_resolve(doc(), vec![anchor])).unwrap(),
            vec![Some(8)]
        );
    }

    #[test]
    fn title_apply_delta_on_places_the_anchor_of_a_refused_write_beside_its_own_letter() {
        let mut app = host("Shared:");
        let anchor = guarded_title(&mut app, "a").anchor;
        // Peers typed on both sides of the writer's `a`, one right in its gap.
        let _left = app
            .call(|s| s.title_apply_delta(doc(), vec![retain(7), insert("b3")]))
            .unwrap();
        let _right = app
            .call(|s| s.title_apply_delta(doc(), vec![retain(10), insert("3c3")]))
            .unwrap();
        let refused = app
            .call(|s| {
                s.title_apply_delta_on(
                    doc(),
                    "Shared:a".to_owned(),
                    vec![retain(8), insert("3")],
                    anchor.clone(),
                )
            })
            .unwrap();
        assert!(!refused.applied);
        assert_eq!(refused.text, "Shared:b3a3c3");
        assert_eq!(refused.anchor, anchor);
        assert_eq!(refused.anchor_pos, Some(10));
    }

    #[test]
    fn apply_delta_on_applies_onto_the_text_it_was_diffed_against() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "The fox.");
        let applied = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    "The fox.".to_owned(),
                    vec![retain(3), insert(" red")],
                    None,
                )
            })
            .unwrap();
        assert!(applied.applied);
        assert!(applied.token.is_some());
        assert_eq!(applied.spans.len(), 1);
        assert_eq!(applied.spans[0].text, "The red fox.");
        assert_eq!(digest(&app), "paragraph/0{:The red fox.};");
    }

    #[test]
    fn apply_delta_on_refuses_a_stale_base_and_hands_back_the_current_text() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "The fox.");
        // The client last saw "The fox"; a peer has since appended the dot.
        let refused = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    "The fox".to_owned(),
                    vec![retain(7), insert("es")],
                    None,
                )
            })
            .unwrap();
        assert!(!refused.applied);
        assert_eq!(refused.token, None);
        assert_eq!(refused.spans[0].text, "The fox.");
        assert_eq!(digest(&app), "paragraph/0{:The fox.};");
        assert_eq!((refused.anchor, refused.anchor_pos), (None, None));
    }

    /// Each run as the character ids it names, in order.
    fn char_ids(runs: &[Run]) -> Vec<(String, u32)> {
        runs.iter()
            .flat_map(|run| (0..run.len).map(move |i| (run.replica.clone(), run.counter + i)))
            .collect()
    }

    #[test]
    fn a_block_read_names_every_character_by_an_id_a_peer_insert_leaves_alone() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let mine = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    String::new(),
                    vec![insert("aa")],
                    None,
                )
            })
            .unwrap();
        let before = char_ids(&mine.ids);
        assert_eq!(before.len(), 2);
        // A peer types an identical `a` between ours; the guard refuses the stale write.
        let _peer = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![retain(1), insert("a")]))
            .unwrap();
        let refused = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    "aa".to_owned(),
                    vec![insert("b")],
                    None,
                )
            })
            .unwrap();
        assert!(!refused.applied);
        let after = char_ids(&refused.ids);
        assert_eq!(after.len(), 3);
        assert_eq!((&after[0], &after[2]), (&before[0], &before[1]));
        assert!(!before.contains(&after[1]));
        let read = app
            .view(|s| s.get_block(doc(), block.clone()))
            .unwrap()
            .unwrap();
        assert_eq!(char_ids(&read.ids), after);
        let whole = app.view(|s| s.get_document(doc())).unwrap();
        assert_eq!(char_ids(&whole[0].ids), after);
    }

    #[test]
    fn a_title_read_names_every_character_by_an_id_a_peer_insert_leaves_alone() {
        let mut app = host("aa");
        let before = char_ids(&app.view(|s| s.get_title_state(doc())).unwrap().ids);
        let _peer = app
            .call(|s| s.title_apply_delta(doc(), vec![retain(1), insert("a")]))
            .unwrap();
        let refused = app
            .call(|s| s.title_apply_delta_on(doc(), "aa".to_owned(), vec![insert("b")], None))
            .unwrap();
        let after = char_ids(&refused.ids);
        assert_eq!(refused.text, "aaa");
        assert_eq!(after.len(), 3);
        assert_eq!((&after[0], &after[2]), (&before[0], &before[1]));
        let state = app.view(|s| s.get_title_state(doc())).unwrap();
        assert_eq!((state.text.as_str(), char_ids(&state.ids)), ("aaa", after));
    }

    #[test]
    fn an_anchored_write_away_from_its_anchor_is_refused_even_on_the_current_text() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let applied = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    String::new(),
                    vec![insert("b1")],
                    None,
                )
            })
            .unwrap();
        let anchor = applied.anchor;
        // A peer's `1` beside ours: the client read the peer's as its own.
        let _peer = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![retain(2), insert("a1")]))
            .unwrap();
        let send = |at: usize| {
            let (block, anchor) = (block.clone(), anchor.clone());
            move |s: &mut DocsState| {
                let ops = vec![retain(at), insert("X")];
                s.apply_delta_on(doc(), block, "b1a1".to_owned(), ops, anchor)
            }
        };
        let drifted = app.call(send(4)).unwrap();
        assert!(!drifted.applied);
        assert_eq!(drifted.anchor_pos, Some(2));
        let placed = app.call(send(2)).unwrap();
        assert!(placed.applied);
        assert_eq!(placed.spans[0].text, "b1Xa1");
    }

    #[test]
    fn title_apply_delta_on_refuses_an_anchored_write_that_is_not_an_insert() {
        let mut app = host("Shared:");
        let anchor = guarded_title(&mut app, "a").anchor;
        let refused = app
            .call(|s| {
                s.title_apply_delta_on(
                    doc(),
                    "Shared:a".to_owned(),
                    vec![retain(7), Change::Delete { delete: 1 }],
                    anchor,
                )
            })
            .unwrap();
        assert!(!refused.applied);
        assert_eq!(refused.anchor_pos, Some(8));
        assert_eq!(title(&app), "Shared:a");
    }

    #[test]
    fn apply_delta_on_places_the_anchor_of_a_refused_write_beside_its_own_letter() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let applied = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    String::new(),
                    vec![insert("Shared:a")],
                    None,
                )
            })
            .unwrap();
        assert_eq!(applied.anchor_pos, Some(8));
        let anchor = applied.anchor;
        let _left = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![retain(7), insert("b3")]))
            .unwrap();
        let _right = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![retain(10), insert("3c3")]))
            .unwrap();
        let refused = app
            .call(|s| {
                s.apply_delta_on(
                    doc(),
                    block.clone(),
                    "Shared:a".to_owned(),
                    vec![retain(8), insert("3")],
                    anchor.clone(),
                )
            })
            .unwrap();
        assert!(!refused.applied);
        assert_eq!(refused.spans[0].text, "Shared:b3a3c3");
        assert_eq!(refused.anchor, anchor);
        assert_eq!(refused.anchor_pos, Some(10));
    }

    #[test]
    fn split_block_then_merge_blocks_round_trips_the_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let before = digest(&app);

        let tail = app
            .call(|s| s.split_block(doc(), block.clone(), 5))
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{:hello};paragraph/0{: world};");

        app.call(|s| s.merge_blocks(doc(), block.clone(), tail))
            .unwrap();
        assert_eq!(digest(&app), before);
    }

    /// A section link names the heading's block id, so a split must leave that
    /// id on the head half rather than moving it to the new block.
    #[test]
    fn a_split_heading_keeps_its_id_on_the_head_text() {
        let mut app = host("t");
        let heading = add_block(&mut app, "heading");
        let _typed = type_text(&mut app, &heading, "Goals for Q3");
        let tail = app
            .call(|s| s.split_block(doc(), heading.clone(), 3))
            .unwrap();
        let head = app
            .view(|s| s.get_block(doc(), heading.clone()))
            .unwrap()
            .expect("the heading id still resolves");
        assert_eq!(head.kind, "heading");
        assert_eq!(
            app.view(|s| s.get_text(doc(), heading.clone())).unwrap(),
            "Goa"
        );
        assert_eq!(
            app.view(|s| s.list_blocks(doc())).unwrap(),
            vec![heading, tail]
        );
    }

    #[test]
    fn mark_renders_as_two_spans_over_the_marked_range() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let mark = app
            .call(|s| {
                s.mark(
                    doc(),
                    block.clone(),
                    0,
                    5,
                    "bold".to_owned(),
                    Some("true".to_owned()),
                )
            })
            .unwrap();
        assert!(mark.is_some(), "a first bold is not redundant");

        let spans = app
            .view(|s| s.get_block_delta(doc(), block.clone()))
            .unwrap();
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].text, "hello");
        assert_eq!(
            spans[0].attributes.get("bold").map(String::as_str),
            Some("true")
        );
        assert_eq!(spans[1].text, " world");
        assert!(spans[1].attributes.is_empty());
        assert_eq!(digest(&app), "paragraph/0{bold=true:hello}{: world};");

        // Bold is `Expand::After`, so typing at the run's end joins it.
        let _typed = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![retain(5), insert("X")]))
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{bold=true:helloX}{: world};");
    }

    #[test]
    fn undo_returns_the_block_to_its_previous_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let before = digest(&app);

        let undo = app
            .call(|s| {
                s.apply_delta(
                    doc(),
                    block.clone(),
                    vec![
                        Change::Retain {
                            retain: 6,
                            attributes: Some(Attrs::from([(
                                "bold".to_owned(),
                                Some("true".to_owned()),
                            )])),
                        },
                        Change::Delete { delete: 5 },
                        insert("there"),
                    ],
                )
            })
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{bold=true:hello there};");

        let _redo = app.call(|s| s.undo(doc(), block.clone(), undo)).unwrap();
        assert_eq!(digest(&app), before);
    }

    #[test]
    fn structure_writes_land_in_the_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "Alpha");
        app.call(|s| s.set_kind(doc(), block.clone(), "heading".to_owned()))
            .unwrap();
        app.call(|s| s.set_depth(doc(), block.clone(), 2)).unwrap();
        app.call(|s| {
            s.set_attr(
                doc(),
                block.clone(),
                "align".to_owned(),
                Some("end".to_owned()),
            )
        })
        .unwrap();
        assert_eq!(digest(&app), "heading/2[align=end]{:Alpha};");

        app.call(|s| s.set_attr(doc(), block.clone(), "align".to_owned(), None))
            .unwrap();
        assert_eq!(digest(&app), "heading/2{:Alpha};");

        app.call(|s| s.delete_block(doc(), block)).unwrap();
        assert_eq!(digest(&app), "");
    }

    #[test]
    fn move_block_reorders_the_document() {
        let mut app = host("t");
        let first = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &first, "Alpha");
        let second = app
            .call(|s| s.insert_block(doc(), Some(first.clone()), "paragraph".to_owned(), 0))
            .unwrap();
        let _typed = type_text(&mut app, &second, "Beta");
        assert_eq!(digest(&app), "paragraph/0{:Alpha};paragraph/0{:Beta};");

        app.call(|s| s.move_block(doc(), second.clone(), None))
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{:Beta};paragraph/0{:Alpha};");
        assert_eq!(
            app.view(|s| s.get_document(doc()))
                .unwrap()
                .iter()
                .map(|b| b.id.clone())
                .collect::<Vec<_>>(),
            vec![second, first]
        );
    }

    #[test]
    fn an_anchor_survives_an_edit_before_it() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let anchor = app
            .view(|s| s.anchor_at(doc(), block.clone(), 6, true))
            .unwrap();
        let _typed = app
            .call(|s| s.apply_delta(doc(), block.clone(), vec![insert("say ")]))
            .unwrap();
        assert_eq!(
            app.view(|s| s.resolve_ids(doc(), block.clone(), vec![anchor]))
                .unwrap(),
            vec![Some(10)]
        );
        assert_eq!(
            app.view(|s| s.passage_count(doc(), block, "hello world".to_owned()))
                .unwrap(),
            1
        );
    }

    /// A subscriber is told WHERE to re-read and nothing else, so every payload
    /// has to name the document and the block it points at.
    #[test]
    fn every_body_event_names_the_document_and_the_block() {
        use calimero_sdk::serde_json::{from_slice, json, Value};

        let mut app = host("t");
        let _ignored = app.take_events();
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let _mark = app
            .call(|s| {
                s.mark(
                    doc(),
                    block.clone(),
                    0,
                    5,
                    "bold".to_owned(),
                    Some("true".to_owned()),
                )
            })
            .unwrap();
        app.call(|s| s.move_block(doc(), block.clone(), None))
            .unwrap();
        app.call(|s| s.delete_block(doc(), block.clone())).unwrap();

        let seen: Vec<(String, Value)> = app
            .events()
            .iter()
            .map(|e| (e.kind.clone(), from_slice(&e.data).expect("JSON payload")))
            .collect();
        let kinds: Vec<&str> = seen.iter().map(|(kind, _)| kind.as_str()).collect();
        assert_eq!(
            kinds,
            [
                "BlockInserted",
                "TextChanged",
                "MarkApplied",
                "BlockMoved",
                "BlockDeleted"
            ]
        );
        for (kind, payload) in &seen {
            assert_eq!(payload["doc"], json!(doc()), "{kind} lost the document");
            assert_eq!(payload["block"], json!(block), "{kind} lost the block");
            assert!(
                payload.get("position").is_none() && payload.get("start").is_none(),
                "{kind} ships a position, which indexes the EMITTING node only"
            );
        }
    }

    // ---- documents -------------------------------------------------------

    #[test]
    fn create_doc_assigns_a_fresh_id_each_time() {
        let mut app = DocsState::init();
        let a = app.create_doc_inner("a".into()).unwrap();
        let b = app.create_doc_inner("b".into()).unwrap();
        assert_ne!(a, b);
        let (a, b) = (
            a.split('-').collect::<Vec<_>>(),
            b.split('-').collect::<Vec<_>>(),
        );
        assert_eq!(
            (a[0], &a[2..]),
            (b[0], &b[2..]),
            "one kind, account and device"
        );
    }

    #[test]
    fn list_docs_returns_created_docs() {
        let mut app = DocsState::init();
        app.create_doc_inner("a".into()).unwrap();
        app.create_doc_inner("b".into()).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 2);
    }

    /// What the node's indexer reads for a doc: its title and its body as a
    /// reader sees it, and a body edit names the doc's entry so it is read again.
    #[test]
    fn the_index_holds_a_docs_title_and_body_text() {
        use calimero_sdk::search::{SearchCollection, SearchValue};

        let mut app = DocsState::init();
        let id = app.create_doc_inner("Quarterly plan".into()).unwrap();
        let block = app
            .insert_block(id.clone(), None, "paragraph".into(), 0)
            .unwrap();
        let _undo = app
            .apply_delta(
                id.clone(),
                block,
                vec![Change::Insert {
                    insert: "the budget is final".into(),
                    attributes: None,
                }],
            )
            .unwrap();
        let (ids, next) = app.docs.search_page([0; 32], 10).unwrap();
        assert_eq!((ids.len(), next), (1, None));
        let doc = app.docs.search_extract(&ids).unwrap().remove(0).unwrap();
        let field = |name: &str| {
            doc.fields
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.clone())
        };
        assert_eq!(
            field("title"),
            Some(SearchValue::Str("Quarterly plan".into()))
        );
        assert_eq!(
            field("body"),
            Some(SearchValue::Str("the budget is final".into()))
        );
        let (key, _) = app.docs.search_entry(ids[0]).unwrap().unwrap();
        assert_eq!(key, id);
    }

    #[test]
    fn search_docs_checks_its_input_before_asking_the_node() {
        let app = DocsState::init();
        let huge = "x".repeat(MAX_DOC_SEARCH_QUERY + 1);
        assert!(app.search_docs(huge, false, None, None).is_err());
        let empty = app
            .search_docs("  ".into(), false, None, None)
            .expect("an empty query asks nothing");
        assert!(empty.hits.is_empty() && empty.next_cursor.is_none());
        let err = app
            .search_docs("plan".into(), false, None, None)
            .expect_err("no index here");
        assert!(format!("{err:?}").contains("needs a node"), "{err:?}");
    }

    #[test]
    fn get_doc_missing_is_error() {
        let app = DocsState::init();
        let err = app.get_doc("ghost".into()).unwrap_err();
        assert_eq!(
            calimero_sdk::serde_json::to_value(&err).unwrap(),
            calimero_sdk::serde_json::json!({"kind": "NotFound", "data": "ghost"})
        );
    }

    #[test]
    fn a_refused_write_reaches_the_client_as_a_tagged_kind() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        let err = app
            .call_as_account(BOB, BOB, |s| s.delete_doc(id))
            .unwrap_err();
        let wire = calimero_sdk::serde_json::to_value(&err).unwrap();
        assert_eq!(wire["kind"], "Forbidden");
    }

    #[test]
    fn a_body_write_on_an_unknown_doc_is_an_error() {
        let mut app = DocsState::init();
        let err = app
            .insert_block("ghost".into(), None, "paragraph".into(), 0)
            .unwrap_err();
        let err = format!("{err:?}");
        assert!(err.contains("unknown document 'ghost'"), "{err}");
    }

    #[test]
    fn archive_hides_from_list_by_default() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        app.set_archived_inner(id.clone(), true).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 0);
        assert_eq!(app.list_docs(true).unwrap().len(), 1);
        assert!(app.get_doc(id).unwrap().archived);
    }

    #[test]
    fn unarchive_restores_in_default_list() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
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
        // Through `TestHost`, which aligns the SDK account with the storage
        // writer as a node does: a doc's creator is the owner of its header.
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc_inner("t".into()))
            .unwrap();
        app.call_as_account(ALICE, ALICE, |s| s.delete_doc_inner(id.clone()))
            .unwrap();
        assert!(app.view(|s| s.get_doc(id)).is_err());
        assert_eq!(app.view(|s| s.list_docs(true)).unwrap().len(), 0);
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
        let id = app.create_doc_inner("t".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.tags, vec!["todo".to_string()]);
    }

    /// The storage actions `f` queues for sync.
    fn actions_of(f: impl FnOnce()) -> Vec<calimero_storage::action::Action> {
        calimero_storage::delta::clear_pending_delta();
        f();
        calimero_storage::delta::commit_causal_delta(&[0; 32])
            .unwrap()
            .map(|delta| delta.actions)
            .unwrap_or_default()
    }

    #[test]
    fn add_tag_on_a_set_key_writes_nothing() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        let first = actions_of(|| app.add_tag_inner(id.clone(), "todo".into()).unwrap());
        assert!(!first.is_empty());
        let actions = actions_of(|| app.add_tag_inner(id.clone(), "todo".into()).unwrap());
        assert!(actions.is_empty(), "{actions:?}");
    }

    #[test]
    fn remove_tag_of_an_absent_key_writes_nothing() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        let actions = actions_of(|| app.remove_tag_inner(id.clone(), "never".into()).unwrap());
        assert!(actions.is_empty(), "{actions:?}");
    }

    #[test]
    fn add_tag_accepts_only_a_tag_key() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        app.add_tag_inner(id.clone(), "launch-2".into()).unwrap();
        let too_long = "a".repeat(mero_docs_types::TAG_KEY_MAX + 1);
        for bad in ["", "Launch", "a b", too_long.as_str()] {
            let err = app.add_tag_inner(id.clone(), bad.into()).unwrap_err();
            assert!(
                matches!(&err, DriveError::Invalid(msg) if msg == "invalid tag key"),
                "{bad:?}: {err}"
            );
        }
        assert_eq!(app.get_doc(id).unwrap().tags, vec!["launch-2".to_owned()]);
    }

    #[test]
    fn list_docs_returns_tags_sorted() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        for tag in ["zeta", "alpha", "mid", "beta"] {
            app.add_tag_inner(id.clone(), tag.into()).unwrap();
        }
        app.remove_tag_inner(id.clone(), "mid".into()).unwrap();
        assert_eq!(
            app.list_docs(false).unwrap()[0].tags,
            vec!["alpha".to_owned(), "beta".to_owned(), "zeta".to_owned()]
        );
    }

    #[test]
    fn remove_tag_is_idempotent_even_for_a_key_never_added() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        app.remove_tag_inner(id.clone(), "never".into()).unwrap();
        assert!(app.get_doc(id.clone()).unwrap().tags.is_empty());
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        app.remove_tag_inner(id.clone(), "todo".into()).unwrap();
        app.remove_tag_inner(id.clone(), "todo".into()).unwrap();
        assert!(app.get_doc(id).unwrap().tags.is_empty());
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
        let id = app.create_doc_inner("t".into()).unwrap();
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
    fn archive_advances_updated_at() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        let before = app.get_doc(id.clone()).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        app.set_archived_inner(id.clone(), true).unwrap();
        assert!(app.get_doc(id).unwrap().updated_at > before);
    }

    /// The list's sort key must move when the BODY moves, not only when the
    /// record's metadata does.
    #[test]
    fn a_body_write_advances_updated_at() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        let before = app.get_doc(id.clone()).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let _block = app
            .insert_block(id.clone(), None, "paragraph".into(), 0)
            .unwrap();
        assert!(app.get_doc(id).unwrap().updated_at > before);
    }

    #[test]
    fn create_doc_records_the_caller_and_an_edit_records_the_editor() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("t".to_owned()))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id.clone())).unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert_eq!(doc.updated_by, hex(&ALICE));

        app.call_as_account(BOB, BOB, |s| s.edit_doc(id.clone(), "u".to_owned()))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id.clone())).unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert_eq!(doc.updated_by, hex(&BOB));
    }

    #[test]
    fn archive_records_the_archiver_as_the_last_editor() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("t".to_owned()))
            .unwrap();
        app.call_as_account(BOB, BOB, |s| s.archive_doc(id.clone()))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id.clone())).unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert_eq!(doc.updated_by, hex(&BOB));
    }

    #[test]
    fn a_tag_change_leaves_the_last_editor() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("t".to_owned()))
            .unwrap();
        app.call_as_account(BOB, BOB, |s| s.add_tag(id.clone(), "todo".to_owned()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_doc(id.clone())).unwrap().updated_by,
            hex(&ALICE)
        );
    }

    #[test]
    fn add_tag_does_not_touch_the_title() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        app.add_tag_inner(id.clone(), "x".into()).unwrap();
        assert_eq!(app.get_doc(id).unwrap().title, "t");
    }

    // ---- who may do what ---------------------------------------------------
    //
    // Docs themselves are public (co-editing); these pin what is not.

    const ALICE: [u8; 32] = [0xA1; 32];
    const BOB: [u8; 32] = [0xB0; 32];

    /// A folder context founded by the test host's default account.
    fn folder() -> TestHost<DocsState> {
        TestHost::new(DocsState::init)
    }

    #[test]
    fn concurrent_creators_mint_distinct_ids() {
        let mut app = folder();
        let a = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("a".into()))
            .unwrap();
        let b = app
            .call_as_account(BOB, BOB, |s| s.create_doc("b".into()))
            .unwrap();
        assert_eq!(creator_in(&a), Some(hex(&ALICE).as_str()), "{a}");
        assert_eq!(creator_in(&b), Some(hex(&BOB).as_str()), "{b}");
    }

    #[test]
    fn a_docs_creator_is_its_headers_owner() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id.clone())).unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert!(doc.created_at > 0);

        // Keys are per owner: Bob's write lands as his own entry at the id.
        // The id does not name his account, so it is never the header.
        app.call_as_account(BOB, BOB, |s| s.headers.insert(id.clone(), 1))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id.clone())).unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert!(doc.created_at > 1);
        assert_eq!(app.view(|s| s.list_docs(true)).unwrap().len(), 1);
        let bobs_view = app.call_as_account(BOB, BOB, |s| s.get_doc(id.clone()));
        assert!(
            !bobs_view.unwrap().can_delete,
            "a planted header is not a creator"
        );
        assert!(app.call_as_account(BOB, BOB, |s| s.delete_doc(id)).is_err());
    }

    #[test]
    fn only_the_creator_or_a_moderator_deletes_a_doc() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        assert!(app
            .call_as_account(BOB, BOB, |s| s.delete_doc(id.clone()))
            .is_err());
        // Bob can still edit it: documents are collaborative.
        app.call_as_account(BOB, BOB, |s| s.edit_doc(id.clone(), "ours".into()))
            .unwrap();

        // The folder's founder moderates.
        app.call(|s| s.delete_doc(id.clone())).unwrap();
        assert!(app.view(|s| s.get_doc(id)).is_err());

        let own = app
            .call_as_account(BOB, BOB, |s| s.create_doc("bob's".into()))
            .unwrap();
        app.call_as_account(BOB, BOB, |s| s.delete_doc(own))
            .unwrap();
    }

    #[test]
    fn can_delete_is_true_exactly_for_those_delete_doc_lets_through() {
        let mut app = folder();
        let founder = app.account_id();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        let mut can_delete = |who: [u8; 32]| {
            app.call_as_account(who, who, |s| {
                let one = s.get_doc(id.clone()).unwrap().can_delete;
                let listed = s.list_docs(false).unwrap();
                assert_eq!(listed.iter().find(|d| d.id == id).unwrap().can_delete, one);
                one
            })
        };
        assert!(can_delete(ALICE), "the creator");
        assert!(can_delete(founder), "the folder's founder moderates");
        assert!(!can_delete(BOB), "another member");
        assert!(app
            .call_as_account(BOB, BOB, |s| s.delete_doc(id.clone()))
            .is_err());
    }

    #[test]
    fn a_comment_is_its_authors_and_moderators_remove_any() {
        let mut app = folder();
        let doc = app.call(|s| s.create_doc("d".into())).unwrap();
        let other = app.call(|s| s.create_doc("e".into())).unwrap();
        let cmt = app
            .call_as_account(ALICE, ALICE, |s| s.add_comment(doc.clone(), "hi".into()))
            .unwrap();
        let _elsewhere = app
            .call_as_account(ALICE, ALICE, |s| s.add_comment(other.clone(), "yo".into()))
            .unwrap();

        let listed = app.view(|s| s.list_comments(doc.clone())).unwrap();
        assert_eq!(listed.len(), 1, "only this doc's comments");
        assert_eq!(listed[0].author, hex(&ALICE));
        assert_eq!(listed[0].body, "hi");

        assert!(app
            .call_as_account(BOB, BOB, |s| s.edit_comment(cmt.clone(), "mine".into()))
            .is_err());
        assert!(app
            .call_as_account(BOB, BOB, |s| s.delete_comment(cmt.clone()))
            .is_err());
        app.call_as_account(ALICE, ALICE, |s| {
            s.edit_comment(cmt.clone(), "hello".into())
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.get_comment(cmt.clone())).unwrap().body,
            "hello"
        );

        // The founder is the first moderator.
        app.call(|s| s.delete_comment(cmt.clone())).unwrap();
        assert!(app.view(|s| s.list_comments(doc)).unwrap().is_empty());
    }

    // ---- struct-level DocRecord::merge ------------------------------------
    //
    // Pin the derived Mergeable so a future refactor cannot silently break sync
    // for one field. Explicit zero-HLC baselines on `a` make `b`'s real-clock
    // writes win the tie-break regardless of test-parallelism HLC collisions.

    use calimero_storage::logical_clock::HybridTimestamp;

    fn zero_lww<T>(v: T) -> LwwRegister<T> {
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero())
    }

    fn stub_record() -> DocRecord {
        DocRecord {
            title: FugueText::new(),
            body: Body::new(),
            tags: UnorderedSet::new(),
            archived: zero_lww(false),
            updated_at: zero_lww(0),
            updated_by: zero_lww(String::new()),
        }
    }

    #[test]
    fn doc_record_merge_takes_the_later_metadata() {
        let mut a = stub_record();
        let mut b = stub_record();
        b.archived = LwwRegister::new(true);
        b.updated_at = LwwRegister::new(7);
        b.updated_by = LwwRegister::new("b0".to_owned());
        <DocRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert!(*a.archived.get());
        assert_eq!(*a.updated_at.get(), 7);
        assert_eq!(a.updated_by.get(), "b0");
    }

    #[test]
    fn doc_record_merge_is_idempotent() {
        let mut working = stub_record();
        working.updated_at = LwwRegister::new(3);
        let mut snapshot = stub_record();
        snapshot.updated_at = LwwRegister::new(3);
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        assert_eq!(*working.updated_at.get(), 3);
        assert!(!*working.archived.get());
    }

    // ---- a doc id is its creator's alone ---------------------------------

    /// Two devices of one account, each creating before it has seen the
    /// other's doc, as a partitioned pair of nodes would.
    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn two_devices_of_one_account_create_two_docs() {
        let mut script = calimero_storage::testing::Script::new(DocsState::init);
        let (laptop, phone) = (script.founder(), script.founder());
        assert_eq!(script.account(laptop), script.account(phone));
        let on_laptop = script
            .run(laptop, |s| {
                let _id = s.create_doc_inner("Laptop".into()).unwrap();
            })
            .unwrap();
        let on_phone = script
            .run(phone, |s| {
                let _id = s.create_doc_inner("Phone".into()).unwrap();
            })
            .unwrap();
        assert_eq!(script.deliver(laptop, on_phone), 0);
        assert_eq!(script.deliver(phone, on_laptop), 0);
        for device in [laptop, phone] {
            let mut titles: Vec<String> = script.view(device, |s| {
                s.list_docs(true)
                    .unwrap()
                    .into_iter()
                    .map(|d| d.title)
                    .collect()
            });
            titles.sort();
            assert_eq!(titles, ["Laptop", "Phone"], "one whole doc per create");
        }
    }

    /// A planted header at the creator's id, from an account sharing the
    /// creator's first bytes.
    #[test]
    fn a_prefix_matching_account_cannot_strip_a_docs_creator() {
        const MALLORY: [u8; 32] = {
            let mut id = [0u8; 32];
            id[0] = 0xA1;
            id[1] = 0xA1;
            id[2] = 0xA1;
            id[3] = 0xA1;
            id
        };
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        app.call_as_account(MALLORY, MALLORY, |s| s.headers.insert(id.clone(), 1))
            .unwrap();
        let doc = app
            .call_as_account(ALICE, ALICE, |s| s.get_doc(id.clone()))
            .unwrap();
        assert_eq!(doc.created_by, hex(&ALICE));
        assert!(doc.can_delete);
        app.call_as_account(ALICE, ALICE, |s| s.delete_doc(id))
            .unwrap();
    }

    /// A planted comment at the author's id, from an account that sorts
    /// below the author.
    #[test]
    fn a_comment_planted_at_anothers_id_is_not_theirs() {
        const MALLORY: [u8; 32] = [0x01; 32];
        let mut app = folder();
        let doc = app.call(|s| s.create_doc("d".into())).unwrap();
        let cmt = app
            .call_as_account(ALICE, ALICE, |s| s.add_comment(doc.clone(), "hi".into()))
            .unwrap();
        let planted = Comment {
            doc_id: doc.clone(),
            body: LwwRegister::new("forged".to_owned()),
            created_at: 1,
        };
        app.call_as_account(MALLORY, MALLORY, |s| {
            s.comments.insert(cmt.clone(), planted)
        })
        .unwrap();
        let shown = app.view(|s| s.get_comment(cmt.clone())).unwrap();
        assert_eq!((shown.author, shown.body), (hex(&ALICE), "hi".to_owned()));
        let listed = app.view(|s| s.list_comments(doc)).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(app.view(|s| s.comment_count()).unwrap(), 1);
        assert_eq!(
            (&listed[0].author, &listed[0].body),
            (&hex(&ALICE), &"hi".to_owned())
        );
    }

    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn two_devices_of_one_account_add_two_comments() {
        let mut script = calimero_storage::testing::Script::new(DocsState::init);
        let (laptop, phone) = (script.founder(), script.founder());
        let mut doc = String::new();
        let created = script
            .run(laptop, |s| doc = s.create_doc_inner("d".into()).unwrap())
            .unwrap();
        assert_eq!(script.deliver(phone, created), 0);
        let on_laptop = script
            .run(laptop, |s| {
                let _id = s.add_comment_inner(doc.clone(), "Laptop".into()).unwrap();
            })
            .unwrap();
        let on_phone = script
            .run(phone, |s| {
                let _id = s.add_comment_inner(doc.clone(), "Phone".into()).unwrap();
            })
            .unwrap();
        assert_eq!(script.deliver(laptop, on_phone), 0);
        assert_eq!(script.deliver(phone, on_laptop), 0);
        for device in [laptop, phone] {
            let mut bodies: Vec<String> = script.view(device, |s| {
                s.list_comments(doc.clone())
                    .unwrap()
                    .into_iter()
                    .map(|c| c.body)
                    .collect()
            });
            bodies.sort();
            assert_eq!(bodies, ["Laptop", "Phone"], "one comment per add");
        }
    }

    // ---- a doc is deleted only by its creator or a moderator ---------------

    /// Replicas apply each other's signed deltas as nodes do.
    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn a_direct_body_delete_by_a_non_creator_leaves_the_doc_listed() {
        let mut script = calimero_storage::testing::Script::new(DocsState::init);
        let (alice, bob) = (script.member(), script.member());
        let mut id = String::new();
        let created = script
            .run(alice, |s| id = s.create_doc_inner("mine".into()).unwrap())
            .unwrap();
        assert_eq!(script.deliver(bob, created), 0);

        // A patched node skips `delete_doc`'s check.
        let forged = script
            .run(bob, |s| {
                let _ = s.docs.remove(&id).unwrap();
            })
            .unwrap();
        let _dropped = script.deliver(alice, forged);
        let creator = hex(script.account(alice).as_bytes());
        let listed = script.view(alice, |s| {
            s.list_docs(true)
                .unwrap()
                .into_iter()
                .map(|d| (d.id, d.created_by, d.can_delete))
                .collect::<Vec<_>>()
        });
        assert_eq!(listed, [(id.clone(), creator, true)]);
        let deleted = script.run(alice, |s| s.delete_doc_inner(id.clone()).unwrap());
        assert!(deleted.is_some());
        assert!(script.view(alice, |s| s.list_docs(true).unwrap().is_empty()));
    }

    /// The list is the docs whose creator still holds their header.
    #[test]
    fn a_body_without_its_creators_header_is_not_listed() {
        let mut app = folder();
        let id = app
            .call_as_account(BOB, BOB, |s| s.create_doc("orphan".into()))
            .unwrap();
        let _removed = app
            .call_as_account(BOB, BOB, |s| s.headers.remove(&id))
            .unwrap();
        assert!(app.view(|s| s.list_docs(true)).unwrap().is_empty());
        assert!(app.view(|s| s.get_doc(id)).is_err());
    }

    // ---- a writer cannot pin a doc to the top of every list ----------------

    /// The docs by `updated_at`, newest first, as the app sorts them.
    fn newest_first(s: &DocsState) -> Vec<String> {
        let mut docs = s.list_docs(false).unwrap();
        docs.sort_by_key(|a| std::cmp::Reverse(a.updated_at));
        docs.into_iter().map(|d| d.id).collect()
    }

    #[test]
    #[serial_test::serial]
    #[ignore = "a Script test needs its own process: cargo test -- --ignored"]
    fn a_forged_updated_at_does_not_pin_a_doc_to_the_top() {
        let mut script = calimero_storage::testing::Script::new(DocsState::init);
        let (alice, mallory) = (script.member(), script.member());
        let mut a = String::new();
        let mut b = String::new();
        let created = script
            .run(alice, |s| a = s.create_doc_inner("a".into()).unwrap())
            .unwrap();
        assert_eq!(script.deliver(mallory, created), 0);
        let forged = script
            .run(mallory, |s| {
                b = s.create_doc_inner("b".into()).unwrap();
                s.docs
                    .get_mut(&b)
                    .unwrap()
                    .unwrap()
                    .updated_at
                    .set(u64::MAX);
            })
            .unwrap();
        assert_eq!(script.deliver(alice, forged), 0);

        // Alice edits her doc after Mallory's write: hers is the newest edit.
        let _edited = script
            .run(alice, |s| s.edit_doc(a.clone(), "a2".into()).unwrap())
            .unwrap();
        assert_eq!(script.view(alice, newest_first), [a, b]);
    }

    #[test]
    fn a_creation_time_ahead_of_the_readers_clock_reads_as_unknown() {
        let mut app = folder();
        let id = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("mine".into()))
            .unwrap();
        app.call_as_account(ALICE, ALICE, |s| s.headers.update(&id, u64::MAX))
            .unwrap();
        let doc = app.view(|s| s.get_doc(id)).unwrap();
        assert_eq!(doc.created_at, 0);
        assert!(doc.updated_at > 0 && doc.updated_at < u64::MAX);
    }

    /// A stamp is trusted up to exactly the skew storage accepts on a write.
    #[test]
    fn a_stamp_is_trusted_up_to_the_drift_storage_accepts() {
        let now = 1_000;
        let edge = now + DRIFT_TOLERANCE_NANOS;
        assert_eq!(not_ahead(edge, now), Some(edge));
        assert_eq!(not_ahead(edge + 1, now), None);
    }

    /// Deleting a doc removes its comments as far as the deleter may: a
    /// moderator removes every author's, a creator only their own.
    #[test]
    fn deleting_a_doc_removes_the_comments_the_deleter_may_remove() {
        let mut app = folder();
        let seed = |app: &mut TestHost<DocsState>| {
            let doc = app
                .call_as_account(ALICE, ALICE, |s| s.create_doc("d".into()))
                .unwrap();
            for who in [ALICE, BOB] {
                let _id = app
                    .call_as_account(who, who, |s| s.add_comment(doc.clone(), "c".into()))
                    .unwrap();
            }
            doc
        };
        // What storage still holds, since reads hide a deleted doc's comments.
        let authors = |app: &TestHost<DocsState>, doc: &String| {
            app.view(|s| s.comments.entries_with_owners())
                .unwrap()
                .into_iter()
                .filter(|(_, _, c)| c.doc_id == *doc)
                .map(|(owner, _, _)| hex(owner.as_bytes()))
                .collect::<Vec<_>>()
        };

        let doc = seed(&mut app);
        app.call_as_account(ALICE, ALICE, |s| s.delete_doc(doc.clone()))
            .unwrap();
        assert_eq!(
            authors(&app, &doc),
            [hex(&BOB)],
            "the creator removes her own"
        );

        let doc = seed(&mut app);
        app.call(|s| s.delete_doc(doc.clone())).unwrap();
        assert!(authors(&app, &doc).is_empty(), "a moderator removes all");
    }

    /// A planted comment at the author's id, filed under another doc, is not
    /// that doc's comment, and deleting that doc leaves the author's alone.
    #[test]
    fn a_comment_planted_under_another_doc_stays_out_of_it() {
        const MALLORY: [u8; 32] = [0x01; 32];
        let mut app = folder();
        let z = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("z".into()))
            .unwrap();
        let y = app
            .call_as_account(MALLORY, MALLORY, |s| s.create_doc("y".into()))
            .unwrap();
        let x = app
            .call_as_account(ALICE, ALICE, |s| s.add_comment(z.clone(), "hi".into()))
            .unwrap();
        let planted = Comment {
            doc_id: y.clone(),
            body: LwwRegister::new("forged".to_owned()),
            created_at: 1,
        };
        app.call_as_account(MALLORY, MALLORY, |s| s.comments.insert(x.clone(), planted))
            .unwrap();
        assert!(app.view(|s| s.list_comments(y.clone())).unwrap().is_empty());

        app.call(|s| s.delete_doc(y)).unwrap();
        let on_z = app.view(|s| s.list_comments(z)).unwrap();
        assert_eq!(on_z.len(), 1);
        assert_eq!((&on_z[0].id, &on_z[0].body), (&x, &"hi".to_owned()));
    }

    #[test]
    fn comments_of_a_missing_or_deleted_doc_are_refused_and_hidden() {
        let mut app = folder();
        assert!(app
            .call_as_account(BOB, BOB, |s| s.add_comment("ghost".into(), "c".into()))
            .is_err());
        let doc = app
            .call_as_account(ALICE, ALICE, |s| s.create_doc("d".into()))
            .unwrap();
        let bobs = app
            .call_as_account(BOB, BOB, |s| s.add_comment(doc.clone(), "c".into()))
            .unwrap();
        app.call_as_account(ALICE, ALICE, |s| s.delete_doc(doc.clone()))
            .unwrap();
        assert!(app.view(|s| s.list_comments(doc)).unwrap().is_empty());
        assert_eq!(
            app.view(|s| s.comment_schema_version(bobs.clone()))
                .unwrap(),
            None
        );
        assert!(app.view(|s| s.get_comment(bobs)).is_err());
        assert_eq!(app.view(|s| s.comment_count()).unwrap(), 0);
    }
}
