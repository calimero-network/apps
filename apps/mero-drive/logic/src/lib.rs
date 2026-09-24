//! Docs service — per-folder document storage. One WASM instance of this
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
//! - `title` — `FugueText`, plain text that merges character by character
//! - `body` — `RichDocument<DriveMarks>`, an ordered list of blocks each with
//!   its own text, formatting and structure
//! - `tags` — `LwwRegister<Vec<String>>` (LWW-replaced list)
//! - `archived` / `created_at` / `updated_at` — `LwwRegister<_>`
//!
//! ## Scope
//!
//! No cross-service calls into the registry. The docs service knows nothing
//! about the folder tree, color, or visibility — those live in the registry
//! context, which the client queries separately and joins on the folder id.

use std::collections::BTreeMap;
use std::ops::DerefMut;

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::fugue_text::{Anchor, Bias, TextOp, Undo};
use calimero_storage::collections::rich_text::{Attrs, DeltaOp, DeltaUndo};
use calimero_storage::collections::{
    AuthoredMap, BlockId, BlockView, Counter, Expand, FugueText, LwwRegister, MarkId, MarkSchema,
    Mergeable, RichDocument, Span, UnorderedMap, ValueRef,
};
use calimero_storage::env as storage_env;
use mero_drive_types::DriveError;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Mark schema
// ---------------------------------------------------------------------------

/// The boundary policy every mero-drive document is written with.
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
    pub id: String,
    pub kind: String,
    pub depth: u8,
    pub attrs: BTreeMap<String, String>,
    pub spans: Vec<Span>,
}

impl Block {
    fn new(view: BlockView) -> app::Result<Self> {
        Ok(Self {
            id: encode_token(&view.id)?,
            kind: view.kind,
            depth: view.depth,
            attrs: view.attrs,
            spans: view.spans,
        })
    }
}

/// One step of an attributed editor change, mirroring `DeltaOp`, which has no
/// `AbiType`. Untagged so the YAML stays Quill's: `- retain: 6`.
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde", untagged)]
pub enum Change {
    Retain {
        retain: usize,
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    Insert {
        insert: String,
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    Delete {
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
            _ => app::bail!("the title carries no formatting: drop `attributes`"),
        })
    }
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
/// The derive supplies the deterministic re-key cascade `title` and `body`
/// need: a nested collection stored under a value type that is not a
/// registered `RekeyTarget` keeps a per-replica random storage id and never
/// converges.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DocRecord {
    pub title: FugueText,
    pub body: Body,
    /// Tags as an LWW-replaced list. `add_tag` / `remove_tag` read-modify-
    /// write the whole vec; concurrent tag edits on different nodes settle
    /// by HLC (one side's full tag set wins).
    pub tags: LwwRegister<Vec<String>>,
    pub archived: LwwRegister<bool>,
    /// Written once at create time; every replica holds the same value.
    pub created_at: LwwRegister<u64>,
    pub updated_at: LwwRegister<u64>,
}

/// Flat projection of a `DocRecord` for list / get APIs. The body is read
/// through `get_document` / `get_block_delta`, never flattened into a string.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocDto {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub archived: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

fn project(id: &str, rec: &DocRecord) -> Result<DocDto, DriveError> {
    Ok(DocDto {
        id: id.to_string(),
        title: rec
            .title
            .get_text()
            .map_err(|e| DriveError::Invalid(format!("title.get_text: {e}")))?,
        tags: rec.tags.get().clone(),
        archived: *rec.archived.get(),
        created_at: *rec.created_at.get(),
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
#[app::mergeable(id = "mero_drive::Comment")]
#[derive(Clone, BorshSerialize, BorshDeserialize, AbiType)]
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
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
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

/// `docs` + authored `comments`.
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

#[app::logic]
impl DocsState {
    #[app::init]
    pub fn init() -> DocsState {
        DocsState {
            docs: UnorderedMap::new_with_field_name("docs:docs"),
            next_id: Counter::new_with_field_name("docs:next_id"),
            comments: AuthoredMap::new_with_field_name("docs:comments"),
            next_comment_id: Counter::new_with_field_name("docs:next_comment_id"),
        }
    }

    // ---- CRUD ------------------------------------------------------------

    /// Creates a document and seeds its title. The body starts empty; a client
    /// adds the first block with `insert_block`.
    pub fn create_doc(&mut self, title: String) -> app::Result<String> {
        let id = self
            .create_doc_inner(title)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::DocCreated { id: &id });
        Ok(id)
    }

    pub(crate) fn create_doc_inner(&mut self, title: String) -> Result<String, DriveError> {
        self.next_id
            .increment()
            .map_err(|e| DriveError::Invalid(format!("next_id.increment: {e}")))?;
        let n = self
            .next_id
            .value()
            .map_err(|e| DriveError::Invalid(format!("next_id.value: {e}")))?;
        let id = format!("doc-{}", n);

        let now = storage_env::time_now();
        let mut title_text = FugueText::new();
        let _minted = title_text
            .insert_str(0, &title)
            .map_err(|e| DriveError::Invalid(format!("title.insert_str: {e}")))?;
        let rec = DocRecord {
            title: title_text,
            body: Body::new(),
            tags: LwwRegister::new(Vec::new()),
            archived: LwwRegister::new(false),
            created_at: LwwRegister::new(now),
            updated_at: LwwRegister::new(now),
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

    /// Renames a document by replacing the whole title, which is what a rename
    /// box does. Character-level edits go through `title_apply_delta`.
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

    #[app::view]
    pub fn get_title(&self, doc: String) -> app::Result<String> {
        Ok(self.read(&doc)?.title.get_text()?)
    }

    /// One editor transaction on the title, returning an opaque token
    /// `title_undo` takes.
    pub fn title_apply_delta(&mut self, doc: String, ops: Vec<Change>) -> app::Result<String> {
        let ops: Vec<TextOp> = ops
            .into_iter()
            .map(Change::into_text_op)
            .collect::<app::Result<_>>()?;
        let steps = self.write(&doc)?.title.apply_delta(&ops)?;
        app::emit!(Event::TitleChanged { doc: &doc });
        encode_token(&steps)
    }

    /// Takes a whole title transaction back, returning a token that redoes it.
    pub fn title_undo(&mut self, doc: String, token: String) -> app::Result<String> {
        let steps: Vec<Undo> = decode_token(&token)?;
        let redo = self.write(&doc)?.title.undo(&steps)?;
        app::emit!(Event::TitleChanged { doc: &doc });
        encode_token(&redo)
    }

    /// A cursor for the gap at `position`, as an opaque token any member resolves.
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

    /// Where anchors sit in THIS replica's title. `null` is an anchor this
    /// replica cannot place yet.
    // ponytail: one tree rebuild per anchor; batch it if a cursor list ever
    // grows past a handful of peers.
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

    pub fn delete_block(&mut self, doc: String, block: String) -> app::Result<()> {
        let id = decode_token(&block)?;
        let _was = self.write(&doc)?.body.delete_block(id)?;
        app::emit!(Event::BlockDeleted {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

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

    pub fn set_kind(&mut self, doc: String, block: String, kind: String) -> app::Result<()> {
        let id = decode_token(&block)?;
        self.write(&doc)?.body.set_kind(id, &kind)?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    pub fn set_depth(&mut self, doc: String, block: String, depth: u8) -> app::Result<()> {
        let id = decode_token(&block)?;
        self.write(&doc)?.body.set_depth(id, depth)?;
        app::emit!(Event::BlockChanged {
            doc: &doc,
            block: &block
        });
        Ok(())
    }

    /// `value: null` removes the attribute.
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

    /// Split at visible position `at`, returning the new block's id.
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

    /// Append `second`'s body to `first` and tombstone `second`.
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

    /// One editor transaction, text and formatting together, returning an
    /// opaque token `undo` takes.
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

    /// Take a whole transaction back, returning a token that redoes it.
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

    /// Set `key` over visible positions `[start, end)`. `null` is a no-op result
    /// when every character already resolves to that value.
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

    #[app::view]
    pub fn get_document(&self, doc: String) -> app::Result<Vec<Block>> {
        self.read(&doc)?
            .body
            .blocks()?
            .into_iter()
            .map(Block::new)
            .collect()
    }

    #[app::view]
    pub fn get_block(&self, doc: String, block: String) -> app::Result<Option<Block>> {
        self.read(&doc)?
            .body
            .block(decode_token(&block)?)?
            .map(Block::new)
            .transpose()
    }

    /// One block's rendered spans: the read a binding does on every keystroke.
    #[app::view]
    pub fn get_block_delta(&self, doc: String, block: String) -> app::Result<Vec<Span>> {
        Ok(self.read(&doc)?.body.block_delta(decode_token(&block)?)?)
    }

    #[app::view]
    pub fn get_text(&self, doc: String, block: String) -> app::Result<String> {
        Ok(self
            .read(&doc)?
            .body
            .block_body(decode_token(&block)?)?
            .get_text()?)
    }

    #[app::view]
    pub fn list_blocks(&self, doc: String) -> app::Result<Vec<String>> {
        self.read(&doc)?
            .body
            .blocks()?
            .iter()
            .map(|view| encode_token(&view.id))
            .collect()
    }

    /// The ordered body as one canonical line, so replicas are compared exactly
    /// by one value. Block ids are excluded because they carry the minting
    /// replica, which no two nodes agree on.
    #[app::view]
    pub fn get_state_digest(&self, doc: String) -> app::Result<String> {
        let mut out = String::new();
        for view in &self.read(&doc)?.body.blocks()? {
            digest_block(view, &mut out);
        }
        Ok(out)
    }

    /// How many times `needle` appears contiguously in a block's text, which is
    /// an exact claim about interleaving that `contains` cannot make.
    #[app::view]
    pub fn passage_count(&self, doc: String, block: String, needle: String) -> app::Result<usize> {
        let text = self
            .read(&doc)?
            .body
            .block_body(decode_token(&block)?)?
            .get_text()?;
        Ok(text.matches(&needle).count())
    }

    /// A cursor for the gap at `position`, as an opaque token any member resolves.
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

    /// Where anchors sit in THIS replica's block, one tree rebuild for the lot.
    /// `null` is an anchor this replica cannot place yet.
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
}

/// Outside `#[app::logic]`: these are plumbing, not JSON-RPC surface.
impl DocsState {
    fn read(&self, doc: &str) -> app::Result<ValueRef<DocRecord>> {
        match self.docs.get(doc)? {
            Some(found) => Ok(found),
            None => app::bail!("unknown document '{doc}'"),
        }
    }

    /// Every mutator goes through here, so the list's sort key advances in one
    /// place rather than at fifteen call sites.
    fn write(&mut self, doc: &str) -> app::Result<impl DerefMut<Target = DocRecord> + '_> {
        match self.docs.get_mut(doc)? {
            Some(mut found) => {
                found.updated_at.set(storage_env::time_now());
                Ok(found)
            }
            None => app::bail!("unknown document '{doc}'"),
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

    const DOC: &str = "doc-1";

    fn host(title: &str) -> TestHost<DocsState> {
        let mut app = TestHost::new(DocsState::init);
        let id = app.call(|s| s.create_doc(title.to_owned())).unwrap();
        assert_eq!(id, DOC);
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
        app.view(|s| s.get_title(DOC.to_owned())).unwrap()
    }

    fn digest(app: &TestHost<DocsState>) -> String {
        app.view(|s| s.get_state_digest(DOC.to_owned())).unwrap()
    }

    fn add_block(app: &mut TestHost<DocsState>, kind: &str) -> String {
        app.call(|s| s.insert_block(DOC.to_owned(), None, kind.to_owned(), 0))
            .unwrap()
    }

    fn type_text(app: &mut TestHost<DocsState>, block: &str, text: &str) -> String {
        app.call(|s| s.apply_delta(DOC.to_owned(), block.to_owned(), vec![insert(text)]))
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
                    DOC.to_owned(),
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
                    DOC.to_owned(),
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
        assert_eq!(
            app.view(|s| s.get_doc(DOC.to_owned())).unwrap().title,
            "Roadmap"
        );
        // The body starts empty; a client adds the first block itself.
        assert_eq!(digest(&app), "");
    }

    /// Position 2 is the gap AFTER the astral scalar: a UTF-16 index would land
    /// inside its surrogate pair, a byte index inside its four bytes.
    #[test]
    fn a_title_delta_indexes_unicode_scalar_values() {
        let mut app = host("a\u{1F600}b");
        let _undo = app
            .call(|s| s.title_apply_delta(DOC.to_owned(), vec![retain(2), insert("X")]))
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
            .call(|s| s.title_apply_delta(DOC.to_owned(), vec![retain(1), insert("-")]))
            .unwrap();
        assert_eq!(title(&app), "\u{1F468}-\u{200D}\u{1F469}\u{200D}\u{1F467}");

        let anchor = app
            .view(|s| s.title_anchor_at(DOC.to_owned(), 6, true))
            .unwrap();
        assert_eq!(
            app.view(|s| s.title_resolve(DOC.to_owned(), vec![anchor]))
                .unwrap(),
            vec![Some(6)]
        );
    }

    #[test]
    fn title_undo_restores_the_previous_text() {
        let mut app = host("Roadmap");
        let undo = app
            .call(|s| {
                s.title_apply_delta(
                    DOC.to_owned(),
                    vec![retain(4), Change::Delete { delete: 3 }, insert("block")],
                )
            })
            .unwrap();
        assert_eq!(title(&app), "Roadblock");

        let redo = app.call(|s| s.title_undo(DOC.to_owned(), undo)).unwrap();
        assert_eq!(title(&app), "Roadmap");
        let _again = app.call(|s| s.title_undo(DOC.to_owned(), redo)).unwrap();
        assert_eq!(title(&app), "Roadblock");
    }

    #[test]
    fn a_title_op_carrying_attributes_is_rejected() {
        let mut app = host("t");
        let err = app
            .call(|s| {
                s.title_apply_delta(
                    DOC.to_owned(),
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
        app.call(|s| s.edit_doc(DOC.to_owned(), "new".to_owned()))
            .unwrap();
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
            app.view(|s| s.get_text(DOC.to_owned(), block.clone()))
                .unwrap(),
            "hello world"
        );
        assert_eq!(
            app.view(|s| s.list_blocks(DOC.to_owned())).unwrap(),
            vec![block]
        );
    }

    #[test]
    fn split_block_then_merge_blocks_round_trips_the_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let before = digest(&app);

        let tail = app
            .call(|s| s.split_block(DOC.to_owned(), block.clone(), 5))
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{:hello};paragraph/0{: world};");

        app.call(|s| s.merge_blocks(DOC.to_owned(), block.clone(), tail))
            .unwrap();
        assert_eq!(digest(&app), before);
    }

    #[test]
    fn mark_renders_as_two_spans_over_the_marked_range() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "hello world");
        let mark = app
            .call(|s| {
                s.mark(
                    DOC.to_owned(),
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
            .view(|s| s.get_block_delta(DOC.to_owned(), block.clone()))
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
            .call(|s| s.apply_delta(DOC.to_owned(), block.clone(), vec![retain(5), insert("X")]))
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
                    DOC.to_owned(),
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

        let _redo = app
            .call(|s| s.undo(DOC.to_owned(), block.clone(), undo))
            .unwrap();
        assert_eq!(digest(&app), before);
    }

    #[test]
    fn structure_writes_land_in_the_digest() {
        let mut app = host("t");
        let block = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &block, "Alpha");
        app.call(|s| s.set_kind(DOC.to_owned(), block.clone(), "heading".to_owned()))
            .unwrap();
        app.call(|s| s.set_depth(DOC.to_owned(), block.clone(), 2))
            .unwrap();
        app.call(|s| {
            s.set_attr(
                DOC.to_owned(),
                block.clone(),
                "align".to_owned(),
                Some("end".to_owned()),
            )
        })
        .unwrap();
        assert_eq!(digest(&app), "heading/2[align=end]{:Alpha};");

        app.call(|s| s.set_attr(DOC.to_owned(), block.clone(), "align".to_owned(), None))
            .unwrap();
        assert_eq!(digest(&app), "heading/2{:Alpha};");

        app.call(|s| s.delete_block(DOC.to_owned(), block)).unwrap();
        assert_eq!(digest(&app), "");
    }

    #[test]
    fn move_block_reorders_the_document() {
        let mut app = host("t");
        let first = add_block(&mut app, "paragraph");
        let _typed = type_text(&mut app, &first, "Alpha");
        let second = app
            .call(|s| {
                s.insert_block(
                    DOC.to_owned(),
                    Some(first.clone()),
                    "paragraph".to_owned(),
                    0,
                )
            })
            .unwrap();
        let _typed = type_text(&mut app, &second, "Beta");
        assert_eq!(digest(&app), "paragraph/0{:Alpha};paragraph/0{:Beta};");

        app.call(|s| s.move_block(DOC.to_owned(), second.clone(), None))
            .unwrap();
        assert_eq!(digest(&app), "paragraph/0{:Beta};paragraph/0{:Alpha};");
        assert_eq!(
            app.view(|s| s.get_document(DOC.to_owned()))
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
            .view(|s| s.anchor_at(DOC.to_owned(), block.clone(), 6, true))
            .unwrap();
        let _typed = app
            .call(|s| s.apply_delta(DOC.to_owned(), block.clone(), vec![insert("say ")]))
            .unwrap();
        assert_eq!(
            app.view(|s| s.resolve_ids(DOC.to_owned(), block.clone(), vec![anchor]))
                .unwrap(),
            vec![Some(10)]
        );
        assert_eq!(
            app.view(|s| s.passage_count(DOC.to_owned(), block, "hello world".to_owned()))
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
                    DOC.to_owned(),
                    block.clone(),
                    0,
                    5,
                    "bold".to_owned(),
                    Some("true".to_owned()),
                )
            })
            .unwrap();
        app.call(|s| s.move_block(DOC.to_owned(), block.clone(), None))
            .unwrap();
        app.call(|s| s.delete_block(DOC.to_owned(), block.clone()))
            .unwrap();

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
            assert_eq!(payload["doc"], json!(DOC), "{kind} lost the document");
            assert_eq!(payload["block"], json!(block), "{kind} lost the block");
            assert!(
                payload.get("position").is_none() && payload.get("start").is_none(),
                "{kind} ships a position, which indexes the EMITTING node only"
            );
        }
    }

    // ---- documents -------------------------------------------------------

    #[test]
    fn create_doc_assigns_an_incrementing_id() {
        let mut app = DocsState::init();
        let a = app.create_doc_inner("a".into()).unwrap();
        let b = app.create_doc_inner("b".into()).unwrap();
        assert_eq!(a, "doc-1");
        assert_eq!(b, "doc-2");
    }

    #[test]
    fn list_docs_returns_created_docs() {
        let mut app = DocsState::init();
        app.create_doc_inner("a".into()).unwrap();
        app.create_doc_inner("b".into()).unwrap();
        assert_eq!(app.list_docs(false).unwrap().len(), 2);
    }

    #[test]
    fn get_doc_missing_is_error() {
        let app = DocsState::init();
        assert!(app.get_doc("ghost".into()).is_err());
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
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
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
        let id = app.create_doc_inner("t".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        app.add_tag_inner(id.clone(), "todo".into()).unwrap();
        let d = app.get_doc(id).unwrap();
        assert_eq!(d.tags, vec!["todo".to_string()]);
    }

    #[test]
    fn add_tag_rejects_empty() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
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
    fn add_tag_does_not_touch_the_title() {
        let mut app = DocsState::init();
        let id = app.create_doc_inner("t".into()).unwrap();
        app.add_tag_inner(id.clone(), "x".into()).unwrap();
        assert_eq!(app.get_doc(id).unwrap().title, "t");
    }

    // ---- struct-level DocRecord::merge ------------------------------------
    //
    // Pin the derived Mergeable so a future refactor cannot silently break sync
    // for one field. Explicit zero-HLC baselines on `a` make `b`'s real-clock
    // writes win the tie-break regardless of test-parallelism HLC collisions.

    use calimero_storage::logical_clock::HybridTimestamp;

    fn zero_lww<T>(v: T) -> LwwRegister<T> {
        LwwRegister::new_with_metadata(v, HybridTimestamp::zero(), [0u8; 32])
    }

    fn stub_record() -> DocRecord {
        DocRecord {
            title: FugueText::new(),
            body: Body::new(),
            tags: zero_lww(Vec::new()),
            archived: zero_lww(false),
            created_at: zero_lww(0),
            updated_at: zero_lww(0),
        }
    }

    #[test]
    fn doc_record_merge_takes_the_later_metadata() {
        let mut a = stub_record();
        let mut b = stub_record();
        b.tags = LwwRegister::new(vec!["urgent".to_owned()]);
        b.archived = LwwRegister::new(true);
        <DocRecord as Mergeable>::merge(&mut a, &b).unwrap();
        assert_eq!(a.tags.get(), &vec!["urgent".to_owned()]);
        assert!(*a.archived.get());
    }

    #[test]
    fn doc_record_merge_is_idempotent() {
        let mut working = stub_record();
        working.tags = LwwRegister::new(vec!["t".to_owned()]);
        let mut snapshot = stub_record();
        snapshot.tags = LwwRegister::new(vec!["t".to_owned()]);
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        <DocRecord as Mergeable>::merge(&mut working, &snapshot).unwrap();
        assert_eq!(working.tags.get(), &vec!["t".to_owned()]);
        assert!(!*working.archived.get());
    }
}
