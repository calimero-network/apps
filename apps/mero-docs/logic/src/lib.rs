//! Mero Docs on core's component SDK (`calimero-app-sdk`): a workspace of
//! folders, each holding rich-text documents its members edit together.
//!
//! # Instances
//!
//! v1 was a two-service bundle: a `registry` context per namespace and a `docs`
//! context per folder. A component bundle has one service, so this one
//! component carries both method sets and the frontend creates two kinds of
//! instance from it:
//!
//! - **the workspace's registry**: one instance per organization (org access),
//!   holding the managers, the workspace tags and the saved views. It is called
//!   with the registry methods only;
//! - **a folder's documents**: one instance per folder, a team of the
//!   organization (team access), holding that folder's documents, their tags and
//!   comments. It is called with the docs methods only.
//!
//! The node decides who reaches an instance at all (the organization, or the
//! folder's team, with Restricted folders as invite-only teams), and refuses
//! every write by a member whose team row is read-only (`403`). Everything
//! finer is checked here against `env::caller()`, as stated on each method.
//!
//! # State
//!
//! The leader applies every write in one log, so state is plain data. The text
//! stays a sequence CRDT because editors send edits typed against a view that
//! is no longer current: a title and every block's body are each a `RichText`
//! (Tree-Fugue characters + Peritext marks, core#4813) under its own name, and
//! a document's block order is a `Text` with one character per block. What v1's
//! `RichDocument`, anchors and undo tokens did on top is rebuilt in
//! [`rich`]: see that module.
//!
//! # Search, images
//!
//! `searchDocs` asks the node's full-text index (core `1.0.0-rc.8`,
//! `#[table(search = [..])]`): each document has one [`DocIndex`] row, its
//! title and its body's plain text (the first 64 KiB, the most the node
//! indexes per field), rewritten by every write that changes either. An image
//! block names its picture as `blob:<id>` in an attribute; the instance keeps a
//! [`BlobRef`] to it for as long as the block exists, so the node keeps the
//! picture, and refuses a blob it does not hold.
//!
//! Every change a client sees, compared with v1, is in `apps/mero-docs/README.md`,
//! "What changed in the port".

use std::collections::BTreeMap;

use calimero_app_sdk::env::Caller;
use calimero_app_sdk::prelude::*;
use serde::{Deserialize, Serialize};

pub mod rich;

use rich::{Change, Run, Span};

/// The longest title, in Unicode scalar values.
pub const MAX_TITLE_LEN: usize = 1024;
/// The longest comment, in Unicode scalar values.
pub const MAX_COMMENT_LEN: usize = 10_000;
/// The longest block text, in Unicode scalar values.
pub const MAX_BLOCK_TEXT_LEN: usize = 100_000;
/// The longest tag name, in Unicode scalar values.
pub const MAX_TAG_NAME_LEN: usize = 32;
/// The longest tag key, in bytes.
pub const TAG_KEY_MAX: usize = 64;
/// The longest `searchDocs` query, in bytes.
pub const MAX_DOC_SEARCH_QUERY: usize = 256;
/// Hits per `searchDocs` page unless the caller asks for fewer.
pub const DEFAULT_DOC_SEARCH_LIMIT: u32 = 20;
/// The most hits one `searchDocs` page returns.
pub const MAX_DOC_SEARCH_LIMIT: u32 = 100;
/// Rows read per page when a method walks a whole collection.
const BATCH: u32 = 1000;
/// Rows per page of a list view unless the caller asks for fewer.
pub const DEFAULT_PAGE_LIMIT: u32 = 100;
/// The most rows one page of a list view returns.
pub const MAX_PAGE_LIMIT: u32 = 1000;
/// Blocks per page of `getDocument` / `listBlocks` unless the caller asks for fewer.
pub const DEFAULT_BLOCK_PAGE: u32 = 100;
/// The most blocks one page of `getDocument` returns: each carries its text.
pub const MAX_BLOCK_PAGE: u32 = 200;
/// The most blocks a document holds (`insertBlock` / `splitBlock` refuse more).
pub const MAX_DOC_BLOCKS: u64 = 5000;
/// The most attributes one block holds.
pub const MAX_BLOCK_ATTRS: usize = 32;
/// The longest attribute key, in bytes.
pub const MAX_ATTR_KEY: usize = 64;
/// The longest attribute value, in bytes.
pub const MAX_ATTR_VALUE: usize = 4096;
/// The most tags one document carries.
pub const MAX_DOC_TAGS: usize = 64;
/// The most body text a document's search row holds, in bytes: the node
/// indexes at most this much of a field (core `MAX_FIELD_TEXT_BYTES`).
pub const MAX_INDEXED_BODY: usize = 64 * 1024;
/// The character a block takes in its document's order text.
const SLOT: &str = "\u{25a1}";

// ── stored records ───────────────────────────────────────────────────────────

/// A document's row in the node's full-text index: its title and its body's
/// plain text, one line per block, cut at [`MAX_INDEXED_BODY`] bytes. Rewritten
/// whole by every write that changes the title or a block's text; bounded by
/// the title limit and that cut.
#[derive(Record)]
#[table(key = "id", search = ["title", "body"])]
pub struct DocIndex {
    /// The document id.
    pub id: String,
    pub title: String,
    pub body: String,
}

/// A document's header. Its title, block order and bodies are texts named
/// after its id ([`title_of`], [`order_of`], [`body_of`]).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DocMeta {
    /// The account that created it.
    pub created_by: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Unix milliseconds of the last change.
    pub updated_at: u64,
    /// The account that last changed it (tags excepted, as in v1).
    pub updated_by: String,
    pub archived: bool,
}

/// A block id with its row.
type Row = (String, BlockRow);

/// One block of a document.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockRow {
    pub kind: String,
    pub depth: u8,
    /// BlockNote's own attributes (a heading's `level`, an image's blob id):
    /// a handful per block, stored opaquely.
    /// At most [`MAX_BLOCK_ATTRS`], enforced by `setAttr`.
    pub attrs: BTreeMap<String, String>,
    /// The character this block holds in its document's order text.
    pub slot: u64,
    /// Deleted (or merged away): out of the document, its text kept so ids
    /// that name it still resolve.
    pub deleted: bool,
}

/// A comment, its author's alone.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommentRow {
    pub author: String,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
}

/// A workspace tag.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TagRow {
    pub name: String,
    pub color: String,
    /// A deleted tag is a permanent tombstone: its key is never reused.
    pub deleted: bool,
}

/// A saved view.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ViewRow {
    pub name: String,
    pub query: String,
    /// The account that first saved it.
    pub created_by: String,
}

// ── results ──────────────────────────────────────────────────────────────────

/// A document's header as callers see it. The body is read through
/// `getDocument` / `getBlockDelta`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocView {
    pub id: String,
    pub title: String,
    /// Tag keys, sorted; the registry maps each to a name and colour.
    pub tags: Vec<String>,
    pub archived: bool,
    /// Unix milliseconds, a decimal string on the wire.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
    /// Unix milliseconds, a decimal string on the wire.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub updated_at: u64,
    pub created_by: String,
    pub updated_by: String,
    /// Whether the caller may delete it: the rule `deleteDoc` enforces.
    pub can_delete: bool,
}

/// The title with the id of each of its characters.
#[derive(Serialize)]
pub struct TitleState {
    pub text: String,
    pub ids: Vec<Run>,
}

/// What `titleApplyDeltaOn` did; the title comes back either way.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleApplied {
    /// Whether the steps were written.
    pub applied: bool,
    /// The undo token for `titleUndo`; `null` on a refusal.
    pub token: Option<String>,
    /// The title after the write, or the current title on a refusal.
    pub text: String,
    /// The gap after this write's last change, or on a refusal the anchor sent.
    pub anchor: Option<String>,
    /// Where `anchor` sits in `text`.
    pub anchor_pos: Option<u32>,
    pub ids: Vec<Run>,
}

/// What `applyDeltaOn` did; the block's spans come back either way.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub applied: bool,
    pub token: Option<String>,
    pub spans: Vec<Span>,
    pub anchor: Option<String>,
    pub anchor_pos: Option<u32>,
    pub ids: Vec<Run>,
}

/// One rendered block.
#[derive(Serialize)]
pub struct Block {
    /// The block id every method takes as `block`. Opaque.
    pub id: String,
    pub kind: String,
    pub depth: u8,
    pub attrs: BTreeMap<String, String>,
    pub spans: Vec<Span>,
    /// The id of each character of `spans`, as runs.
    pub ids: Vec<Run>,
}

/// One document `searchDocs` found.
#[derive(Serialize)]
pub struct DocSearchHit {
    pub id: String,
    pub title: String,
    /// The title or body around the first match, matched words in `<b>`.
    pub snippet: String,
    /// Higher is better.
    pub score: f32,
    pub archived: bool,
}

/// A page of `searchDocs`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSearchPage {
    pub hits: Vec<DocSearchHit>,
    /// Documents matched in all, a decimal string on the wire.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub total: u64,
    /// Pass back as `cursor` for the next page; `null` on the last.
    pub next_cursor: Option<u32>,
}

/// One page of a list view: pass `next` back as `cursor` for the following
/// page; `null` on the last.
#[derive(Serialize)]
pub struct ListPage<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// The page size a list view uses: `limit` (1 to `max`), else `default`.
fn page_limit(limit: Option<u32>, default: u32, max: u32) -> app::Result<u32> {
    match limit {
        None => Ok(default),
        Some(n) if (1..=max).contains(&n) => Ok(n),
        Some(n) => Err(invalid(format!("limit {n} is out of range: 1 to {max}"))),
    }
}

/// `FindOpts` for one page from `cursor`.
fn find_opts(cursor: Option<String>, limit: u32) -> FindOpts {
    let opts = FindOpts::default().limit(limit);
    match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    }
}

/// A comment as callers see it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentView {
    pub id: String,
    pub author: String,
    pub doc_id: String,
    pub body: String,
    /// Unix milliseconds, a decimal string on the wire.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

/// A workspace tag.
#[derive(Serialize)]
pub struct TagView {
    pub key: String,
    pub name: String,
    pub color: String,
    pub deleted: bool,
}

/// A saved view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewView {
    pub id: String,
    pub name: String,
    pub query: String,
    pub created_by: String,
}

// ── state ────────────────────────────────────────────────────────────────────

/// One instance: a folder's documents, or a workspace's registry.
#[app::state(version = 1)]
pub struct MeroDocs {
    // ---- a folder's documents
    /// doc id -> header.
    docs: UnorderedMap<String, DocMeta>,
    /// (doc, tag key): a document's tags.
    doc_tags: Set<(String, String)>,
    /// (doc, block id) -> the block.
    blocks: UnorderedMap<(String, String), BlockRow>,
    /// (doc, slot) -> the block holding that character of the order text.
    slots: UnorderedMap<(String, u64), String>,
    /// (doc, comment id) -> the comment.
    comments: UnorderedMap<(String, String), CommentRow>,
    /// comment id -> its document.
    comment_docs: UnorderedMap<String, String>,
    /// Comments on live documents.
    comment_total: Counter,
    /// (doc, block) -> a live block's plain text, what [`DocIndex`] is built from.
    block_text: UnorderedMap<(String, String), String>,
    /// (doc, block, attribute) -> the blob an image block's attribute names
    /// (`blob:<id>`): the node keeps a blob while state refers to it.
    block_blobs: UnorderedMap<(String, String, String), BlobRef>,
    /// The documents' full-text index (`searchDocs`).
    doc_index: Table<DocIndex>,
    // ---- a workspace's registry
    /// Accounts the owner made managers.
    managers: Set<String>,
    /// tag key -> tag; deleted tags stay as tombstones.
    tags: UnorderedMap<String, TagRow>,
    /// view id -> view.
    views: UnorderedMap<String, ViewRow>,
}

/// The text holding a document's title.
fn title_of(doc: &str) -> RichText {
    rich::text(format!("dt:{doc}"))
}

/// The text with one character per block, in document order.
fn order_of(doc: &str) -> Text {
    Text::new(format!("do:{doc}"))
}

/// The text holding one block's body.
fn body_of(doc: &str, block: &str) -> RichText {
    rich::text(format!("db:{doc}:{block}"))
}

#[app::logic]
impl MeroDocs {
    /// An empty instance; the creator (`env::app_owner()`) is the registry's
    /// owner, or the folder's moderator.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── documents ────────────────────────────────────────────────────────────

    /// Creates a document with the given title (at most 1024 characters) and an
    /// empty body, and returns its id. Not idempotent: a retry after a lost
    /// response creates a second document. Emits `DocCreated`.
    pub fn create_doc(&mut self, title: String) -> app::Result<String> {
        let me = account()?;
        check_chars("title", &title, MAX_TITLE_LEN)?;
        let id = fresh_id("doc");
        let now = env::time_now();
        let _ = self.docs.insert(
            &id,
            &DocMeta {
                created_by: me.clone(),
                created_at: now,
                updated_at: now,
                updated_by: me,
                archived: false,
            },
        )?;
        let _ids = title_of(&id).text_mut().insert(0, &title)?;
        self.reindex(&id)?;
        env::emit(Event::DocCreated { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// One document's header. `NotFound` for a missing document.
    #[app::view]
    pub fn get_doc(&self, id: String) -> app::Result<DocView> {
        let meta = self.meta(&id)?;
        self.doc_view(&id, &meta)
    }

    /// One page of the folder's documents (archived ones only with
    /// `includeArchived`), in id order: `limit` (1 to 1000, default 100)
    /// documents are read from `cursor` (the previous page's `next`), so a page
    /// without archived ones may hold fewer, and `next` is `null` on the last.
    #[app::view]
    pub fn list_docs(
        &self,
        include_archived: bool,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<DocView>> {
        let limit = page_limit(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
        let page = self.docs.page(find_opts(cursor, limit))?;
        let mut items = Vec::new();
        for (id, meta) in page.items {
            if include_archived || !meta.archived {
                items.push(self.doc_view(&id, &meta)?);
            }
        }
        Ok(ListPage {
            items,
            next: page.next,
        })
    }

    /// Searches the folder's titles and bodies with the node's full-text index
    /// (BM25): every word of `query` must occur in the title or the body, the
    /// last one as a prefix (search as you type), case-insensitively; best match
    /// first. `cursor` is the previous page's `nextCursor`; `limit` 1 to 100,
    /// default 20. Archived documents are left out of a page unless
    /// `includeArchived`, so such a page may hold fewer; `total` counts every
    /// match. A blank query finds nothing; one over 256 bytes is `Invalid`.
    #[app::view]
    pub fn search_docs(
        &self,
        query: String,
        include_archived: bool,
        cursor: Option<u32>,
        limit: Option<u32>,
    ) -> app::Result<DocSearchPage> {
        if query.len() > MAX_DOC_SEARCH_QUERY {
            return Err(invalid(format!(
                "Search query too long: {} bytes, limit is {MAX_DOC_SEARCH_QUERY}",
                query.len()
            )));
        }
        let limit = page_limit(limit, DEFAULT_DOC_SEARCH_LIMIT, MAX_DOC_SEARCH_LIMIT)?;
        let mut page = DocSearchPage {
            hits: Vec::new(),
            total: 0,
            next_cursor: None,
        };
        if query.trim().is_empty() {
            return Ok(page);
        }
        let mut opts = SearchOpts::default().mode(SearchMode::Prefix).limit(limit);
        if let Some(c) = cursor {
            opts = opts.cursor(c);
        }
        let found = self.doc_index.search(&query, opts)?;
        page.total = found.total;
        page.next_cursor = found.next;
        for hit in found.items {
            let Some(meta) = self.docs.get(&hit.record.id)? else {
                continue;
            };
            if meta.archived && !include_archived {
                continue;
            }
            page.hits.push(DocSearchHit {
                id: hit.record.id,
                title: hit.record.title,
                snippet: hit.snippet,
                score: hit.score,
                archived: meta.archived,
            });
        }
        Ok(page)
    }

    /// Replaces the whole title. Emits `TitleChanged` and `DocEdited`.
    pub fn edit_doc(&mut self, id: String, title: String) -> app::Result<()> {
        let len = rich::chars(&title_of(&id))?.len() as u32;
        let ops = vec![
            Change::Delete { delete: len },
            Change::Insert {
                insert: title,
                attributes: None,
            },
        ];
        let _undo = self.title_apply_delta(id.clone(), ops)?;
        env::emit(Event::DocEdited { id }, Audience::All)?;
        Ok(())
    }

    /// Hides a document from the default list. Emits `DocArchived`.
    pub fn archive_doc(&mut self, id: String) -> app::Result<()> {
        self.set_archived(&id, true)?;
        env::emit(Event::DocArchived { id }, Audience::All)?;
        Ok(())
    }

    /// Brings an archived document back. Emits `DocUnarchived`.
    pub fn unarchive_doc(&mut self, id: String) -> app::Result<()> {
        self.set_archived(&id, false)?;
        env::emit(Event::DocUnarchived { id }, Audience::All)?;
        Ok(())
    }

    /// Deletes a document with its title, body, tags and comments. Only its
    /// creator or the folder's moderator (whoever created this instance) may
    /// (`Forbidden`). Emits `DocDeleted`.
    pub fn delete_doc(&mut self, id: String) -> app::Result<()> {
        let meta = self.meta(&id)?;
        if !may_delete(&meta.created_by)? {
            return Err(forbidden(format!(
                "only the creator of {id} or a moderator may delete it"
            )));
        }
        let _ = self.docs.remove(&id)?;
        title_of(&id).clear()?;
        // Every block ever written, deleted ones included.
        loop {
            let page = self.blocks.prefix(
                &[KeyPart::Str(id.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for ((doc, block), row) in page.items {
                body_of(&doc, &block).clear()?;
                let _ = self.block_text.remove(&(doc.clone(), block.clone()))?;
                let _ = self.slots.remove(&(doc.clone(), row.slot))?;
                let _ = self.blocks.remove(&(doc, block))?;
            }
        }
        loop {
            let page = self.slots.prefix(
                &[KeyPart::Str(id.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for (key, _) in page.items {
                let _ = self.slots.remove(&key)?;
            }
        }
        order_of(&id).clear()?;
        loop {
            let page = self.block_blobs.prefix(
                &[KeyPart::Str(id.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for (key, _) in page.items {
                let _ = self.block_blobs.remove(&key)?;
            }
        }
        let _ = self.doc_index.remove(&id)?;
        loop {
            let page = self.doc_tags.prefix(
                &[KeyPart::Str(id.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for key in page.items {
                let _ = self.doc_tags.remove(&key)?;
            }
        }
        loop {
            let page = self.comments.prefix(
                &[KeyPart::Str(id.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for ((doc, comment), _) in page.items {
                let _ = self.comment_docs.remove(&comment)?;
                let _ = self.comments.remove(&(doc, comment))?;
                self.comment_total.add(-1)?;
            }
        }
        env::emit(Event::DocDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Tags a document; a tag it has already is a no-op. `tag` is a key of
    /// lowercase letters, digits and dashes (1 to 64), else `Invalid`. Leaves
    /// `updatedBy`. Emits `DocTagsChanged`.
    pub fn add_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        if !is_valid_tag_key(&tag) {
            return Err(invalid("invalid tag key"));
        }
        let _meta = self.meta(&id)?;
        let key = (id.clone(), tag);
        if !self.doc_tags.contains(&key)? && self.tags_of(&id)?.len() >= MAX_DOC_TAGS {
            return Err(invalid(format!(
                "a document carries at most {MAX_DOC_TAGS} tags"
            )));
        }
        let _new = self.doc_tags.insert(&key)?;
        env::emit(Event::DocTagsChanged { id }, Audience::All)?;
        Ok(())
    }

    /// Removes a tag; one the document does not have is a no-op. Emits
    /// `DocTagsChanged`.
    pub fn remove_tag(&mut self, id: String, tag: String) -> app::Result<()> {
        let _meta = self.meta(&id)?;
        let _was = self.doc_tags.remove(&(id.clone(), tag))?;
        env::emit(Event::DocTagsChanged { id }, Audience::All)?;
        Ok(())
    }

    // ── title ────────────────────────────────────────────────────────────────

    /// The title text.
    #[app::view]
    pub fn get_title(&self, doc: String) -> app::Result<String> {
        let _meta = self.meta(&doc)?;
        Ok(rich::plain(&rich::chars(&title_of(&doc))?))
    }

    /// The title with the id of each of its characters.
    #[app::view]
    pub fn get_title_state(&self, doc: String) -> app::Result<TitleState> {
        let _meta = self.meta(&doc)?;
        let chars = rich::chars(&title_of(&doc))?;
        Ok(TitleState {
            text: rich::plain(&chars),
            ids: rich::runs(&chars)?,
        })
    }

    /// Applies Quill steps (no `attributes`: the title is plain) to the title;
    /// returns the undo token for `titleUndo`. At most 1024 characters after.
    /// Emits `TitleChanged`.
    pub fn title_apply_delta(&mut self, doc: String, ops: Vec<Change>) -> app::Result<String> {
        let chars = rich::chars(&title_of(&doc))?;
        self.write_title(doc, &chars, &ops)
    }

    /// `titleApplyDelta`, only if the title is still `base` and, with an
    /// `anchor`, the steps are an insert right at it; otherwise nothing is
    /// written and the current title comes back to rebase onto.
    pub fn title_apply_delta_on(
        &mut self,
        doc: String,
        base: String,
        ops: Vec<Change>,
        anchor: Option<String>,
    ) -> app::Result<TitleApplied> {
        let _meta = self.meta(&doc)?;
        let title = title_of(&doc);
        let chars = rich::chars(&title)?;
        let current = rich::plain(&chars);
        let anchor_pos = match &anchor {
            Some(token) => rich::resolve(&title, &chars, std::slice::from_ref(token))?
                .pop()
                .flatten(),
            None => None,
        };
        if current != base || !rich::at_anchor(anchor.is_some(), anchor_pos, &ops) {
            return Ok(TitleApplied {
                applied: false,
                token: None,
                text: current,
                anchor: anchor_pos.and(anchor),
                anchor_pos,
                ids: rich::runs(&chars)?,
            });
        }
        let end = rich::edit_end(&ops) as u32;
        let token = self.write_title(doc.clone(), &chars, &ops)?;
        let chars = rich::chars(&title_of(&doc))?;
        Ok(TitleApplied {
            applied: true,
            token: Some(token),
            text: rich::plain(&chars),
            anchor: Some(rich::anchor_at(&chars, end, false)?),
            anchor_pos: Some(end),
            ids: rich::runs(&chars)?,
        })
    }

    /// Applies an undo token from `titleApplyDelta` (or `titleUndo`); returns
    /// the token that undoes this. Emits `TitleChanged`.
    pub fn title_undo(&mut self, doc: String, token: String) -> app::Result<String> {
        let edit = rich::Edit::from_token(&token)?;
        self.touch(&doc)?;
        let mut title = title_of(&doc);
        // A token is the caller's JSON: its result is checked like any edit's.
        check_len("title", rich::len_after_edit(&title, &edit)?, MAX_TITLE_LEN)?;
        let redo = rich::apply_edit(&mut title, &edit)?;
        self.reindex(&doc)?;
        env::emit(Event::TitleChanged { doc }, Audience::All)?;
        Ok(redo)
    }

    /// An anchor for the gap at `position` of the title, stuck to the character
    /// after it (`before`) or before it.
    #[app::view]
    pub fn title_anchor_at(&self, doc: String, position: u32, before: bool) -> app::Result<String> {
        let _meta = self.meta(&doc)?;
        rich::anchor_at(&rich::chars(&title_of(&doc))?, position, before)
    }

    /// Where each title anchor sits now; `null` for an unknown one.
    #[app::view]
    pub fn title_resolve(
        &self,
        doc: String,
        anchors: Vec<String>,
    ) -> app::Result<Vec<Option<u32>>> {
        let _meta = self.meta(&doc)?;
        let title = title_of(&doc);
        let chars = rich::chars(&title)?;
        rich::resolve(&title, &chars, &anchors)
    }

    // ── body structure ───────────────────────────────────────────────────────

    /// Inserts an empty block of `kind` at `depth` after the block `after`
    /// (`null`: first), and returns its id. Emits `BlockInserted`.
    pub fn insert_block(
        &mut self,
        doc: String,
        after: Option<String>,
        kind: String,
        depth: u8,
    ) -> app::Result<String> {
        self.touch(&doc)?;
        let block = self.new_block(&doc, after.as_deref(), kind, depth, BTreeMap::new())?;
        env::emit(
            Event::BlockInserted {
                doc,
                block: block.clone(),
            },
            Audience::All,
        )?;
        Ok(block)
    }

    /// Takes a block out of the document; its text is kept, so ids that name
    /// it still resolve. Emits `BlockDeleted`.
    pub fn delete_block(&mut self, doc: String, block: String) -> app::Result<()> {
        self.touch(&doc)?;
        let mut row = self.block_row(&doc, &block)?;
        if !row.deleted {
            let _gone = order_of(&doc).delete_ids(&[row.slot])?;
            row.deleted = true;
            let _ = self.blocks.insert(&(doc.clone(), block.clone()), &row)?;
            self.refresh_text(&doc, &[&block])?;
        }
        env::emit(Event::BlockDeleted { doc, block }, Audience::All)?;
        Ok(())
    }

    /// Moves a block after `after` (`null`: first). Emits `BlockMoved`.
    pub fn move_block(
        &mut self,
        doc: String,
        block: String,
        after: Option<String>,
    ) -> app::Result<()> {
        self.touch(&doc)?;
        let mut row = self.block_row(&doc, &block)?;
        let after_slot = match &after {
            Some(a) => Some(self.block_row(&doc, a)?.slot),
            None => None,
        };
        let mut order = order_of(&doc);
        if !row.deleted {
            let _gone = order.delete_ids(&[row.slot])?;
        }
        let _ = self.slots.remove(&(doc.clone(), row.slot))?;
        let slot = order.insert_after(after_slot, SLOT)?[0];
        let _ = self.slots.insert(&(doc.clone(), slot), &block)?;
        let revived = row.deleted;
        row.slot = slot;
        row.deleted = false;
        let _ = self.blocks.insert(&(doc.clone(), block.clone()), &row)?;
        if revived {
            self.refresh_text(&doc, &[&block])?;
        }
        env::emit(Event::BlockMoved { doc, block }, Audience::All)?;
        Ok(())
    }

    /// Sets a block's type (BlockNote's own string). Emits `BlockChanged`.
    pub fn set_kind(&mut self, doc: String, block: String, kind: String) -> app::Result<()> {
        self.change_block(doc, block, |row| row.kind = kind)
    }

    /// Sets a block's nesting depth. Emits `BlockChanged`.
    pub fn set_depth(&mut self, doc: String, block: String, depth: u8) -> app::Result<()> {
        self.change_block(doc, block, |row| row.depth = depth)
    }

    /// Sets a block attribute, or removes it with `null`. Emits `BlockChanged`.
    pub fn set_attr(
        &mut self,
        doc: String,
        block: String,
        key: String,
        value: Option<String>,
    ) -> app::Result<()> {
        if key.is_empty() || key.len() > MAX_ATTR_KEY {
            return Err(invalid(format!(
                "an attribute key is 1 to {MAX_ATTR_KEY} bytes"
            )));
        }
        if let Some(v) = &value {
            check_len("attribute value", v.len(), MAX_ATTR_VALUE)?;
            let row = self.block_row(&doc, &block)?;
            if !row.attrs.contains_key(&key) && row.attrs.len() >= MAX_BLOCK_ATTRS {
                return Err(invalid(format!(
                    "a block holds at most {MAX_BLOCK_ATTRS} attributes"
                )));
            }
        }
        self.change_block(doc, block, |row| {
            let _old = match value {
                Some(v) => row.attrs.insert(key, v),
                None => row.attrs.remove(&key),
            };
        })
    }

    /// Splits a block at character `at`: the text from `at` on moves, with its
    /// formatting, to a new block of the same type, depth and attributes right
    /// after it, whose id is returned. The head keeps the block's id. Emits
    /// `BlockInserted` and `BlockChanged`.
    pub fn split_block(&mut self, doc: String, block: String, at: u32) -> app::Result<String> {
        self.touch(&doc)?;
        let row = self.block_row(&doc, &block)?;
        let mut head = body_of(&doc, &block);
        let chars = rich::chars(&head)?;
        let at = at as usize;
        if at > chars.len() {
            return Err(invalid(format!(
                "split at {at} is past the end ({})",
                chars.len()
            )));
        }
        let new = self.new_block(&doc, Some(&block), row.kind, row.depth, row.attrs)?;
        let tail = &chars[at..];
        if !tail.is_empty() {
            rich::append(&mut body_of(&doc, &new), tail)?;
            let ids: Vec<u64> = tail.iter().map(|c| c.id).collect();
            let _gone = head.text_mut().delete_ids(&ids)?;
        }
        self.refresh_text(&doc, &[&block, &new])?;
        env::emit(
            Event::BlockInserted {
                doc: doc.clone(),
                block: new.clone(),
            },
            Audience::All,
        )?;
        env::emit(Event::BlockChanged { doc, block }, Audience::All)?;
        Ok(new)
    }

    /// Appends `second`'s text (with its formatting) to `first` and takes
    /// `second` out of the document. At most 100,000 characters joined. Emits
    /// `BlockChanged` and `BlockDeleted`.
    pub fn merge_blocks(&mut self, doc: String, first: String, second: String) -> app::Result<()> {
        if first == second {
            return Err(invalid("a block cannot merge into itself"));
        }
        self.touch(&doc)?;
        let _head = self.block_row(&doc, &first)?;
        let mut tail_row = self.block_row(&doc, &second)?;
        let mut head = body_of(&doc, &first);
        let tail = rich::chars(&body_of(&doc, &second))?;
        let joined = rich::chars(&head)?.len() + tail.len();
        check_len("block text", joined, MAX_BLOCK_TEXT_LEN)?;
        rich::append(&mut head, &tail)?;
        if !tail_row.deleted {
            let _gone = order_of(&doc).delete_ids(&[tail_row.slot])?;
            tail_row.deleted = true;
            let _ = self
                .blocks
                .insert(&(doc.clone(), second.clone()), &tail_row)?;
        }
        self.refresh_text(&doc, &[&first, &second])?;
        env::emit(
            Event::BlockChanged {
                doc: doc.clone(),
                block: first,
            },
            Audience::All,
        )?;
        env::emit(Event::BlockDeleted { doc, block: second }, Audience::All)?;
        Ok(())
    }

    // ── body text ────────────────────────────────────────────────────────────

    /// Applies Quill steps to a block's text; returns the undo token for
    /// `undo`. An insert's `attributes` are its complete formatting; a retain's
    /// change only the keys they name. Keys outside the schema (`bold`,
    /// `italic`, `underline`, `strike`, `textColor`, `backgroundColor`, `link`,
    /// `code`, `comment`) are `Invalid`. At most 100,000 characters after.
    /// Emits `TextChanged`.
    pub fn apply_delta(
        &mut self,
        doc: String,
        block: String,
        ops: Vec<Change>,
    ) -> app::Result<String> {
        let _row = self.block_row(&doc, &block)?;
        let chars = rich::chars(&body_of(&doc, &block))?;
        self.write_block(doc, block, &chars, &ops)
    }

    /// `applyDelta`, only if the block's text is still `base` and, with an
    /// `anchor`, the steps are an insert right at it; otherwise nothing is
    /// written and the block's current spans and ids come back to rebase onto.
    pub fn apply_delta_on(
        &mut self,
        doc: String,
        block: String,
        base: String,
        ops: Vec<Change>,
        anchor: Option<String>,
    ) -> app::Result<Applied> {
        let _meta = self.meta(&doc)?;
        let _row = self.block_row(&doc, &block)?;
        let body = body_of(&doc, &block);
        let chars = rich::chars(&body)?;
        let anchor_pos = match &anchor {
            Some(token) => rich::resolve(&body, &chars, std::slice::from_ref(token))?
                .pop()
                .flatten(),
            None => None,
        };
        if rich::plain(&chars) != base || !rich::at_anchor(anchor.is_some(), anchor_pos, &ops) {
            return Ok(Applied {
                applied: false,
                token: None,
                spans: rich::spans(&chars),
                anchor: anchor_pos.and(anchor),
                anchor_pos,
                ids: rich::runs(&chars)?,
            });
        }
        let end = rich::edit_end(&ops) as u32;
        let token = self.write_block(doc.clone(), block.clone(), &chars, &ops)?;
        let chars = rich::chars(&body_of(&doc, &block))?;
        Ok(Applied {
            applied: true,
            token: Some(token),
            spans: rich::spans(&chars),
            anchor: Some(rich::anchor_at(&chars, end, false)?),
            anchor_pos: Some(end),
            ids: rich::runs(&chars)?,
        })
    }

    /// Applies an undo token from `applyDelta` (or `undo`) to the block;
    /// returns the token that undoes this. Emits `TextChanged`.
    pub fn undo(&mut self, doc: String, block: String, token: String) -> app::Result<String> {
        let edit = rich::Edit::from_token(&token)?;
        self.touch(&doc)?;
        let _row = self.block_row(&doc, &block)?;
        let mut body = body_of(&doc, &block);
        // A token is the caller's JSON: its result is checked like any edit's.
        check_len(
            "block text",
            rich::len_after_edit(&body, &edit)?,
            MAX_BLOCK_TEXT_LEN,
        )?;
        let redo = rich::apply_edit(&mut body, &edit)?;
        self.refresh_text(&doc, &[&block])?;
        env::emit(Event::TextChanged { doc, block }, Audience::All)?;
        Ok(redo)
    }

    /// Formats the characters `[start, end)` of a block: `key` to `value`, or
    /// removes it with `null`. Returns the mark's id (`null` for an empty
    /// range). Emits `MarkApplied`.
    pub fn mark(
        &mut self,
        doc: String,
        block: String,
        start: u32,
        end: u32,
        key: String,
        value: Option<String>,
    ) -> app::Result<Option<String>> {
        self.touch(&doc)?;
        let _row = self.block_row(&doc, &block)?;
        let minted = rich::mark(
            &mut body_of(&doc, &block),
            start,
            end,
            &key,
            value.as_deref(),
        )?;
        if let Some(mark_id) = &minted {
            env::emit(
                Event::MarkApplied {
                    doc,
                    block,
                    mark_id: mark_id.clone(),
                },
                Audience::All,
            )?;
        }
        Ok(minted)
    }

    // ── body reads ───────────────────────────────────────────────────────────

    /// One page of the document's blocks, in order: `limit` 1 to 200 (default
    /// 100) from `cursor` (the previous page's `next`: a position, so a block
    /// inserted or removed before it between two reads shifts the pages).
    #[app::view]
    pub fn get_document(
        &self,
        doc: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<Block>> {
        let _meta = self.meta(&doc)?;
        let limit = page_limit(limit, DEFAULT_BLOCK_PAGE, MAX_BLOCK_PAGE)?;
        let (rows, next) = self.blocks_page(&doc, cursor, limit)?;
        Ok(ListPage {
            items: rows
                .into_iter()
                .map(|(id, row)| block_view(&doc, id, row))
                .collect::<app::Result<_>>()?,
            next,
        })
    }

    /// One block, or `null` when it is not in the document.
    #[app::view]
    pub fn get_block(&self, doc: String, block: String) -> app::Result<Option<Block>> {
        let _meta = self.meta(&doc)?;
        match self.blocks.get(&(doc.clone(), block.clone()))? {
            Some(row) if !row.deleted => Ok(Some(block_view(&doc, block, row)?)),
            _ => Ok(None),
        }
    }

    /// A block's text as runs of equally formatted characters.
    #[app::view]
    pub fn get_block_delta(&self, doc: String, block: String) -> app::Result<Vec<Span>> {
        let _row = self.block_row(&doc, &block)?;
        Ok(rich::spans(&rich::chars(&body_of(&doc, &block))?))
    }

    /// A block's plain text.
    #[app::view]
    pub fn get_text(&self, doc: String, block: String) -> app::Result<String> {
        let _row = self.block_row(&doc, &block)?;
        Ok(rich::plain(&rich::chars(&body_of(&doc, &block))?))
    }

    /// One page of the ids of the document's blocks, in order: `limit` 1 to
    /// 1000 (default 100) from `cursor`, as `getDocument`.
    #[app::view]
    pub fn list_blocks(
        &self,
        doc: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<String>> {
        let _meta = self.meta(&doc)?;
        let limit = page_limit(limit, DEFAULT_BLOCK_PAGE, MAX_PAGE_LIMIT)?;
        let (rows, next) = self.blocks_page(&doc, cursor, limit)?;
        Ok(ListPage {
            items: rows.into_iter().map(|(id, _)| id).collect(),
            next,
        })
    }

    /// The whole body as one string, `kind/depth[attr=value]{marks:text};` per
    /// block: two readers agree on a document exactly when their digests match.
    #[app::view]
    pub fn get_state_digest(&self, doc: String) -> app::Result<String> {
        let _meta = self.meta(&doc)?;
        let mut out = String::new();
        for (id, row) in self.ordered_blocks(&doc)? {
            out.push_str(&row.kind);
            out.push('/');
            out.push_str(&row.depth.to_string());
            for (key, value) in &row.attrs {
                out.push_str(&format!("[{key}={value}]"));
            }
            for span in rich::spans(&rich::chars(&body_of(&doc, &id))?) {
                let attrs: Vec<String> = span
                    .attributes
                    .iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect();
                out.push_str(&format!("{{{}:{}}}", attrs.join(","), span.text));
            }
            out.push(';');
        }
        Ok(out)
    }

    /// How many times `needle` occurs in a block's text (non-overlapping).
    #[app::view]
    pub fn passage_count(&self, doc: String, block: String, needle: String) -> app::Result<u32> {
        let _row = self.block_row(&doc, &block)?;
        if needle.is_empty() {
            return Ok(0);
        }
        let text = rich::plain(&rich::chars(&body_of(&doc, &block))?);
        Ok(text.matches(&needle).count() as u32)
    }

    /// An anchor for the gap at `position` of a block, stuck to the character
    /// after it (`before`) or before it.
    #[app::view]
    pub fn anchor_at(
        &self,
        doc: String,
        block: String,
        position: u32,
        before: bool,
    ) -> app::Result<String> {
        let _row = self.block_row(&doc, &block)?;
        rich::anchor_at(&rich::chars(&body_of(&doc, &block))?, position, before)
    }

    /// Where each of a block's anchors sits now; `null` for an unknown one.
    #[app::view]
    pub fn resolve_ids(
        &self,
        doc: String,
        block: String,
        anchors: Vec<String>,
    ) -> app::Result<Vec<Option<u32>>> {
        let _row = self.block_row(&doc, &block)?;
        let body = body_of(&doc, &block);
        let chars = rich::chars(&body)?;
        rich::resolve(&body, &chars, &anchors)
    }

    // ── comments ─────────────────────────────────────────────────────────────

    /// Adds the caller's comment (at most 10,000 characters) to a document and
    /// returns its id. Emits `CommentAdded`.
    pub fn add_comment(&mut self, doc_id: String, body: String) -> app::Result<String> {
        let me = account()?;
        check_chars("comment", &body, MAX_COMMENT_LEN)?;
        let _meta = self.meta(&doc_id)?;
        let id = fresh_id("cmt");
        let _ = self.comments.insert(
            &(doc_id.clone(), id.clone()),
            &CommentRow {
                author: me,
                body,
                created_at: env::time_now(),
            },
        )?;
        let _ = self.comment_docs.insert(&id, &doc_id)?;
        self.comment_total.add(1)?;
        env::emit(Event::CommentAdded { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// One page of a document's comments, in id order (ids are random, not
    /// by time): `limit` 1 to 1000 (default 100) from `cursor`, the previous
    /// page's `next`. None for a missing document.
    #[app::view]
    pub fn list_comments(
        &self,
        doc_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<CommentView>> {
        let limit = page_limit(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
        let page = self
            .comments
            .prefix(&[KeyPart::Str(doc_id)], find_opts(cursor, limit))?;
        Ok(ListPage {
            items: page
                .items
                .into_iter()
                .map(|((doc, id), row)| comment_view(id, doc, row))
                .collect(),
            next: page.next,
        })
    }

    /// One comment. `NotFound` for a missing one.
    #[app::view]
    pub fn get_comment(&self, id: String) -> app::Result<CommentView> {
        let (doc, row) = self.comment(&id)?;
        Ok(comment_view(id, doc, row))
    }

    /// How many comments the folder's documents hold.
    #[app::view]
    pub fn comment_count(&self) -> app::Result<u64> {
        Ok(self.comment_total.get()?)
    }

    /// The schema version a comment was written under: 1 for every live
    /// comment (one schema since the port), `null` for a missing one.
    #[app::view]
    pub fn comment_schema_version(&self, id: String) -> app::Result<Option<u32>> {
        Ok(self.comment_docs.get(&id)?.map(|_| 1))
    }

    /// Replaces the text of the caller's own comment. Anyone else's is
    /// `Forbidden`. Emits `CommentEdited`.
    pub fn edit_comment(&mut self, id: String, body: String) -> app::Result<()> {
        let me = account()?;
        check_chars("comment", &body, MAX_COMMENT_LEN)?;
        let (doc, mut row) = self.comment(&id)?;
        if row.author != me {
            return Err(forbidden(format!("only its author may edit {id}")));
        }
        row.body = body;
        let _ = self.comments.insert(&(doc, id.clone()), &row)?;
        env::emit(Event::CommentEdited { id }, Audience::All)?;
        Ok(())
    }

    /// Deletes a comment: its author's own, or any as the folder's moderator.
    /// Emits `CommentDeleted`.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        let (doc, row) = self.comment(&id)?;
        if !may_delete(&row.author)? {
            return Err(forbidden(format!(
                "only its author or a moderator may delete {id}"
            )));
        }
        let _ = self.comments.remove(&(doc, id.clone()))?;
        let _ = self.comment_docs.remove(&id)?;
        self.comment_total.add(-1)?;
        env::emit(Event::CommentDeleted { id }, Audience::All)?;
        Ok(())
    }

    // ── registry: owner and managers ─────────────────────────────────────────

    /// The registry's owner: the account that created this instance.
    #[app::view]
    pub fn get_owner(&self) -> app::Result<String> {
        Ok(env::app_owner())
    }

    /// Makes a member of the organization a manager. Only the owner may
    /// (`Forbidden`); the owner itself, or someone outside the organization,
    /// is `Invalid`. Emits `ManagerAdded`.
    pub fn add_manager(&mut self, member: String) -> app::Result<()> {
        self.owner_only("add managers")?;
        if member == env::app_owner() {
            return Err(invalid("owner is implicitly a manager"));
        }
        if env::org().is_some() && env::org_role(&member).is_none() {
            return Err(invalid(format!("{member} is not in the organization")));
        }
        let _new = self.managers.insert(&member)?;
        env::emit(Event::ManagerAdded { member }, Audience::All)?;
        Ok(())
    }

    /// Takes a manager's role away. Only the owner may (`Forbidden`); someone
    /// who is not a manager is `NotFound`. Emits `ManagerRemoved`.
    pub fn remove_manager(&mut self, member: String) -> app::Result<()> {
        self.owner_only("remove managers")?;
        if !self.managers.remove(&member)? {
            return Err(not_found("manager", &member));
        }
        env::emit(Event::ManagerRemoved { member }, Audience::All)?;
        Ok(())
    }

    /// One page of the managers (the owner not included), in account order:
    /// `limit` 1 to 1000 (default 100) from `cursor`, the previous page's `next`.
    #[app::view]
    pub fn list_managers(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<String>> {
        let limit = page_limit(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
        let page = self.managers.page(find_opts(cursor, limit))?;
        Ok(ListPage {
            items: page.items,
            next: page.next,
        })
    }

    // ── registry: tags ───────────────────────────────────────────────────────

    /// Creates or renames a workspace tag. `key`: 1 to 64 lowercase letters,
    /// digits and dashes; `name`: 1 to 32 characters after trimming; `color`:
    /// `#rrggbb`. A deleted tag's key is `Invalid` for good. Emits `TagChanged`.
    pub fn set_tag(&mut self, key: String, name: String, color: String) -> app::Result<()> {
        if !is_valid_tag_key(&key) {
            return Err(invalid(format!("invalid tag key: {key}")));
        }
        let name = name.trim().to_owned();
        if !(1..=MAX_TAG_NAME_LEN).contains(&name.chars().count()) {
            return Err(invalid("invalid tag name"));
        }
        if !is_hex_color(&color) {
            return Err(invalid(format!("invalid color: {color}")));
        }
        let mut row = self.tags.get(&key)?.unwrap_or_default();
        if row.deleted {
            return Err(invalid("tag deleted"));
        }
        row.name = name;
        row.color = color;
        let _ = self.tags.insert(&key, &row)?;
        env::emit(Event::TagChanged { key }, Audience::All)?;
        Ok(())
    }

    /// Deletes a workspace tag for good (its key stays taken). `NotFound` for
    /// an unknown key. Emits `TagChanged`.
    pub fn delete_tag(&mut self, key: String) -> app::Result<()> {
        let Some(mut row) = self.tags.get(&key)? else {
            return Err(not_found("tag", &key));
        };
        row.deleted = true;
        let _ = self.tags.insert(&key, &row)?;
        env::emit(Event::TagChanged { key }, Audience::All)?;
        Ok(())
    }

    /// One page of the workspace tags, deleted ones included, in key order:
    /// `limit` 1 to 1000 (default 100) from `cursor`, the previous page's `next`.
    #[app::view]
    pub fn list_tags(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<TagView>> {
        let limit = page_limit(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
        let page = self.tags.page(find_opts(cursor, limit))?;
        Ok(ListPage {
            items: page
                .items
                .into_iter()
                .map(|(key, row)| TagView {
                    key,
                    name: row.name,
                    color: row.color,
                    deleted: row.deleted,
                })
                .collect(),
            next: page.next,
        })
    }

    // ── registry: saved views ────────────────────────────────────────────────

    /// Saves (or renames) a view. `id`: 1 to 64 ASCII letters, digits and
    /// dashes; `name`: 1 to 60 bytes after trimming; `query`: at most 1000
    /// bytes. The first saver is its `createdBy`. Emits `ViewChanged`.
    pub fn save_view(&mut self, id: String, name: String, query: String) -> app::Result<()> {
        let me = account()?;
        let valid_id = (1..=64).contains(&id.len())
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if !valid_id {
            return Err(invalid(format!("invalid view id: {id}")));
        }
        let name = name.trim().to_owned();
        if !(1..=60).contains(&name.len()) {
            return Err(invalid("invalid view name"));
        }
        if query.len() > 1000 {
            return Err(invalid("query too long"));
        }
        let created_by = match self.views.get(&id)? {
            Some(old) => old.created_by,
            None => me,
        };
        let _ = self.views.insert(
            &id,
            &ViewRow {
                name,
                query,
                created_by,
            },
        )?;
        env::emit(Event::ViewChanged { id }, Audience::All)?;
        Ok(())
    }

    /// Deletes a view. `NotFound` for an unknown id. Emits `ViewChanged`.
    pub fn delete_view(&mut self, id: String) -> app::Result<()> {
        if self.views.remove(&id)?.is_none() {
            return Err(not_found("view", &id));
        }
        env::emit(Event::ViewChanged { id }, Audience::All)?;
        Ok(())
    }

    /// One page of the saved views, in id order: `limit` 1 to 1000 (default
    /// 100) from `cursor`, the previous page's `next`.
    #[app::view]
    pub fn list_views(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<ViewView>> {
        let limit = page_limit(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)?;
        let page = self.views.page(find_opts(cursor, limit))?;
        Ok(ListPage {
            items: page
                .items
                .into_iter()
                .map(|(id, row)| ViewView {
                    id,
                    name: row.name,
                    query: row.query,
                    created_by: row.created_by,
                })
                .collect(),
            next: page.next,
        })
    }
}

/// Why a call was refused. Every variant carries a `message`.
#[app::error]
pub enum Error {
    /// No document, block, comment, tag, view or manager has this id.
    NotFound { message: String },
    /// An argument is out of range: too long, a bad key or colour, a position
    /// past the end, a mark key outside the schema, a malformed token.
    Invalid { message: String },
    /// The caller may not do this (not the creator, author, moderator or owner).
    Forbidden { message: String },
}

/// A change, emitted after the write that caused it, to everyone the
/// instance reaches. Ids only: never positions.
#[app::event]
pub enum Event {
    DocCreated {
        id: String,
    },
    DocEdited {
        id: String,
    },
    DocArchived {
        id: String,
    },
    DocUnarchived {
        id: String,
    },
    DocDeleted {
        id: String,
    },
    DocTagsChanged {
        id: String,
    },
    TitleChanged {
        doc: String,
    },
    BlockInserted {
        doc: String,
        block: String,
    },
    BlockDeleted {
        doc: String,
        block: String,
    },
    BlockMoved {
        doc: String,
        block: String,
    },
    BlockChanged {
        doc: String,
        block: String,
    },
    TextChanged {
        doc: String,
        block: String,
    },
    MarkApplied {
        doc: String,
        block: String,
        mark_id: String,
    },
    CommentAdded {
        id: String,
    },
    CommentEdited {
        id: String,
    },
    CommentDeleted {
        id: String,
    },
    ManagerAdded {
        member: String,
    },
    ManagerRemoved {
        member: String,
    },
    TagChanged {
        key: String,
    },
    ViewChanged {
        id: String,
    },
}

// ── private helpers ──────────────────────────────────────────────────────────

impl MeroDocs {
    fn meta(&self, id: &str) -> app::Result<DocMeta> {
        self.docs
            .get(&id.to_owned())?
            .ok_or_else(|| not_found("document", id))
    }

    /// The document's header, stamped as just changed by the caller.
    fn touch(&mut self, doc: &str) -> app::Result<()> {
        let mut meta = self.meta(doc)?;
        meta.updated_at = env::time_now();
        meta.updated_by = account()?;
        let _ = self.docs.insert(&doc.to_owned(), &meta)?;
        Ok(())
    }

    fn set_archived(&mut self, id: &str, archived: bool) -> app::Result<()> {
        self.touch(id)?;
        let mut meta = self.meta(id)?;
        meta.archived = archived;
        let _ = self.docs.insert(&id.to_owned(), &meta)?;
        Ok(())
    }

    /// A document's tag keys, sorted: at most [`MAX_DOC_TAGS`].
    fn tags_of(&self, id: &str) -> app::Result<Vec<String>> {
        Ok(self
            .doc_tags
            .prefix(
                &[KeyPart::Str(id.to_owned())],
                FindOpts::default().limit(BATCH),
            )?
            .items
            .into_iter()
            .map(|(_, tag)| tag)
            .collect())
    }

    /// `titleApplyDelta` on the title as `chars` read it: the length check,
    /// the write, the search row (from the text the edit produced, without
    /// reading the title again) and `TitleChanged`.
    fn write_title(
        &mut self,
        doc: String,
        chars: &[rich::Char],
        ops: &[Change],
    ) -> app::Result<String> {
        self.touch(&doc)?;
        check_len("title", rich::len_after(chars.len(), ops), MAX_TITLE_LEN)?;
        let (token, title) = rich::apply_delta(&mut title_of(&doc), chars, ops, true)?;
        self.reindex_with(&doc, title)?;
        env::emit(Event::TitleChanged { doc }, Audience::All)?;
        Ok(token)
    }

    /// `applyDelta` on a block as `chars` read it: the length check, the
    /// write, its `block_text` and search row (from the text the edit produced)
    /// and `TextChanged`.
    fn write_block(
        &mut self,
        doc: String,
        block: String,
        chars: &[rich::Char],
        ops: &[Change],
    ) -> app::Result<String> {
        self.touch(&doc)?;
        check_len(
            "block text",
            rich::len_after(chars.len(), ops),
            MAX_BLOCK_TEXT_LEN,
        )?;
        let (token, text) = rich::apply_delta(&mut body_of(&doc, &block), chars, ops, false)?;
        // A deleted block keeps its text but stays out of the search row.
        if !self.block_row(&doc, &block)?.deleted {
            let _ = self
                .block_text
                .insert(&(doc.clone(), block.clone()), &text)?;
        }
        self.reindex(&doc)?;
        env::emit(Event::TextChanged { doc, block }, Audience::All)?;
        Ok(token)
    }

    /// Re-reads the text of `blocks` into `block_text` (a deleted block's is
    /// dropped), then rebuilds the document's search row.
    fn refresh_text(&mut self, doc: &str, blocks: &[&str]) -> app::Result<()> {
        for block in blocks {
            let key = (doc.to_owned(), (*block).to_owned());
            match self.blocks.get(&key)? {
                Some(row) if !row.deleted => {
                    let text = rich::plain(&rich::chars(&body_of(doc, block))?);
                    let _ = self.block_text.insert(&key, &text)?;
                }
                _ => {
                    let _ = self.block_text.remove(&key)?;
                }
            }
        }
        self.reindex(doc)
    }

    /// Rewrites the document's [`DocIndex`] row: the title, and every live
    /// block's text in block-id order, one line each, cut at
    /// [`MAX_INDEXED_BODY`] bytes. One range read of `block_text` (a document
    /// holds at most [`MAX_DOC_BLOCKS`] blocks).
    fn reindex(&mut self, doc: &str) -> app::Result<()> {
        let title = rich::plain(&rich::chars(&title_of(doc))?);
        self.reindex_with(doc, title)
    }

    /// [`Self::reindex`] with the title already known.
    fn reindex_with(&mut self, doc: &str, title: String) -> app::Result<()> {
        let mut body = String::new();
        let mut cursor: Option<String> = None;
        'pages: loop {
            let page = self
                .block_text
                .prefix(&[KeyPart::Str(doc.to_owned())], find_opts(cursor, BATCH))?;
            for (_, text) in page.items {
                if !body.is_empty() {
                    body.push('\n');
                }
                body.push_str(&text);
                if body.len() >= MAX_INDEXED_BODY {
                    break 'pages;
                }
            }
            match page.next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        if body.len() > MAX_INDEXED_BODY {
            let mut cut = MAX_INDEXED_BODY;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            body.truncate(cut);
        }
        self.doc_index.upsert(DocIndex {
            id: doc.to_owned(),
            title,
            body,
        })?;
        Ok(())
    }

    /// Keeps a [`BlobRef`] for every attribute of the block that names a blob
    /// (`blob:<id>`) and drops the ones it no longer names. A blob the instance
    /// does not hold (never uploaded to it, or deleted) is `Invalid`.
    fn link_blobs(
        &mut self,
        doc: &str,
        block: &str,
        attrs: &BTreeMap<String, String>,
    ) -> app::Result<()> {
        let held = self
            .block_blobs
            .prefix(
                &[KeyPart::Str(doc.to_owned()), KeyPart::Str(block.to_owned())],
                FindOpts::default().limit(BATCH),
            )?
            .items;
        for ((d, b, key), blob) in &held {
            if attrs.get(key).and_then(|v| blob_in(v)) != Some(*blob) {
                let _ = self
                    .block_blobs
                    .remove(&(d.clone(), b.clone(), key.clone()))?;
            }
        }
        for (key, value) in attrs {
            let Some(blob) = blob_in(value) else {
                continue;
            };
            let already = held.iter().any(|((_, _, k), b)| k == key && *b == blob);
            if already {
                continue;
            }
            if blob.info().is_none() {
                return Err(invalid(format!(
                    "{value} names a blob this folder does not hold"
                )));
            }
            let _ = self
                .block_blobs
                .insert(&(doc.to_owned(), block.to_owned(), key.clone()), &blob)?;
        }
        Ok(())
    }

    fn doc_view(&self, id: &str, meta: &DocMeta) -> app::Result<DocView> {
        let tags = self.tags_of(id)?;
        Ok(DocView {
            id: id.to_owned(),
            title: rich::plain(&rich::chars(&title_of(id))?),
            tags,
            archived: meta.archived,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            created_by: meta.created_by.clone(),
            updated_by: meta.updated_by.clone(),
            can_delete: may_delete(&meta.created_by)?,
        })
    }

    fn block_row(&self, doc: &str, block: &str) -> app::Result<BlockRow> {
        self.blocks
            .get(&(doc.to_owned(), block.to_owned()))?
            .ok_or_else(|| not_found("block", block))
    }

    fn new_block(
        &mut self,
        doc: &str,
        after: Option<&str>,
        kind: String,
        depth: u8,
        attrs: BTreeMap<String, String>,
    ) -> app::Result<String> {
        let after_slot = match after {
            Some(a) => Some(self.block_row(doc, a)?.slot),
            None => None,
        };
        let mut order = order_of(doc);
        if order.len()? >= MAX_DOC_BLOCKS {
            return Err(invalid(format!(
                "a document holds at most {MAX_DOC_BLOCKS} blocks"
            )));
        }
        let slot = order.insert_after(after_slot, SLOT)?[0];
        let block = fresh_id("blk");
        self.link_blobs(doc, &block, &attrs)?;
        let _ = self.slots.insert(&(doc.to_owned(), slot), &block)?;
        let _ = self.blocks.insert(
            &(doc.to_owned(), block.clone()),
            &BlockRow {
                kind,
                depth,
                attrs,
                slot,
                deleted: false,
            },
        )?;
        Ok(block)
    }

    fn change_block(
        &mut self,
        doc: String,
        block: String,
        change: impl FnOnce(&mut BlockRow),
    ) -> app::Result<()> {
        self.touch(&doc)?;
        let mut row = self.block_row(&doc, &block)?;
        change(&mut row);
        self.link_blobs(&doc, &block, &row.attrs)?;
        let _ = self.blocks.insert(&(doc.clone(), block.clone()), &row)?;
        env::emit(Event::BlockChanged { doc, block }, Audience::All)?;
        Ok(())
    }

    /// `limit` live blocks of the document from position `cursor` (a decimal
    /// string, `null` for the start), and the position after them when more
    /// follow. Reads the order text whole (one character per block, at most
    /// [`MAX_DOC_BLOCKS`]) and only the page's rows.
    fn blocks_page(
        &self,
        doc: &str,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<(Vec<Row>, Option<String>)> {
        let from = match cursor {
            None => 0,
            Some(c) => c
                .parse::<usize>()
                .map_err(|_| invalid(format!("bad cursor: {c}")))?,
        };
        let slots = order_of(doc).chars()?;
        let to = from.saturating_add(limit as usize).min(slots.len());
        let mut out = Vec::new();
        for (slot, _) in slots.get(from..to).unwrap_or_default() {
            let Some(id) = self.slots.get(&(doc.to_owned(), *slot))? else {
                continue;
            };
            if let Some(row) = self.blocks.get(&(doc.to_owned(), id.clone()))? {
                if !row.deleted && row.slot == *slot {
                    out.push((id, row));
                }
            }
        }
        let next = (to < slots.len()).then(|| to.to_string());
        Ok((out, next))
    }

    /// The document's live blocks in order.
    fn ordered_blocks(&self, doc: &str) -> app::Result<Vec<Row>> {
        let mut out = Vec::new();
        for (slot, _) in order_of(doc).chars()? {
            let Some(id) = self.slots.get(&(doc.to_owned(), slot))? else {
                continue;
            };
            if let Some(row) = self.blocks.get(&(doc.to_owned(), id.clone()))? {
                if !row.deleted && row.slot == slot {
                    out.push((id, row));
                }
            }
        }
        Ok(out)
    }

    fn comment(&self, id: &str) -> app::Result<(String, CommentRow)> {
        let doc = self
            .comment_docs
            .get(&id.to_owned())?
            .ok_or_else(|| not_found("comment", id))?;
        let row = self
            .comments
            .get(&(doc.clone(), id.to_owned()))?
            .ok_or_else(|| not_found("comment", id))?;
        Ok((doc, row))
    }

    fn owner_only(&self, what: &str) -> app::Result<()> {
        if account()? != env::app_owner() {
            return Err(forbidden(format!("only the registry owner may {what}")));
        }
        Ok(())
    }
}

fn block_view(doc: &str, id: String, row: BlockRow) -> app::Result<Block> {
    let chars = rich::chars(&body_of(doc, &id))?;
    Ok(Block {
        spans: rich::spans(&chars),
        ids: rich::runs(&chars)?,
        id,
        kind: row.kind,
        depth: row.depth,
        attrs: row.attrs,
    })
}

fn comment_view(id: String, doc_id: String, row: CommentRow) -> CommentView {
    CommentView {
        id,
        author: row.author,
        doc_id,
        body: row.body,
        created_at: row.created_at,
    }
}

/// The calling account; `LoginRequired` for anything that is not one.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// Whether the caller may delete what `creator` made: its creator, or the
/// folder's moderator (the account that created this instance).
fn may_delete(creator: &str) -> app::Result<bool> {
    let me = account()?;
    Ok(me == creator || me == env::app_owner())
}

/// `<kind>-<16 hex>`: 8 random bytes of the run.
fn fresh_id(kind: &str) -> String {
    let hex: String = env::random_bytes(8)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{kind}-{hex}")
}

/// The blob an attribute value names: `blob:` and the blob's 64 hex digits.
fn blob_in(value: &str) -> Option<BlobRef> {
    value.strip_prefix("blob:").and_then(BlobRef::parse)
}

/// A tag key: 1 to 64 lowercase letters, digits and dashes.
pub fn is_valid_tag_key(key: &str) -> bool {
    (1..=TAG_KEY_MAX).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn check_chars(what: &str, value: &str, max: usize) -> app::Result<()> {
    check_len(what, value.chars().count(), max)
}

fn check_len(what: &str, len: usize, max: usize) -> app::Result<()> {
    if len > max {
        return Err(invalid(format!(
            "{what} too long: {len} characters, limit is {max}"
        )));
    }
    Ok(())
}

pub(crate) fn not_found(what: &str, id: &str) -> AppError {
    Error::NotFound {
        message: format!("{what} not found: {id}"),
    }
    .into()
}

pub(crate) fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

pub(crate) fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}
