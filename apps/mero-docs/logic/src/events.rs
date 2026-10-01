//! Events emitted by the docs service. One instance of this service runs
//! per folder context; events are local to that folder's document set.
//!
//! Ids, never positions: the payload is replayed on the RECEIVING node, where a
//! concurrent edit has already moved everything the author counted.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A document was created.
    DocCreated { id: &'a str },
    /// A document was renamed.
    DocEdited { id: &'a str },
    /// A document was archived.
    DocArchived { id: &'a str },
    /// A document was unarchived.
    DocUnarchived { id: &'a str },
    /// A document was deleted.
    DocDeleted { id: &'a str },
    /// A tag was added to or removed from a document.
    DocTagsChanged { id: &'a str },
    /// A document title was edited or undone.
    TitleChanged { doc: &'a str },
    /// A block was added to a document.
    BlockInserted { doc: &'a str, block: &'a str },
    /// A block was removed from a document.
    BlockDeleted { doc: &'a str, block: &'a str },
    /// A block was moved within a document.
    BlockMoved { doc: &'a str, block: &'a str },
    /// Kind, depth or an attribute changed; re-read the block.
    BlockChanged { doc: &'a str, block: &'a str },
    /// A block's text or formatting was edited or undone.
    TextChanged { doc: &'a str, block: &'a str },
    /// A formatting mark was written to a block.
    MarkApplied {
        doc: &'a str,
        block: &'a str,
        mark_id: &'a str,
    },
    /// A comment was added.
    CommentAdded { id: &'a str },
    /// A comment was edited.
    CommentEdited { id: &'a str },
    /// A comment was deleted.
    CommentDeleted { id: &'a str },
}
