//! Events emitted by the docs service. One instance of this service runs
//! per folder context; events are local to that folder's document set.
//!
//! Ids, never positions: the payload is replayed on the RECEIVING node, where a
//! concurrent edit has already moved everything the author counted.

use crate::Run;

#[calimero_sdk::app::event]
pub enum Event<'a> {
    DocCreated {
        id: &'a str,
    },
    DocEdited {
        id: &'a str,
    },
    DocArchived {
        id: &'a str,
    },
    DocUnarchived {
        id: &'a str,
    },
    DocDeleted {
        id: &'a str,
    },
    DocTagsChanged {
        id: &'a str,
    },
    TitleChanged {
        doc: &'a str,
        ids: Vec<Run>,
    },
    BlockInserted {
        doc: &'a str,
        block: &'a str,
    },
    BlockDeleted {
        doc: &'a str,
        block: &'a str,
    },
    BlockMoved {
        doc: &'a str,
        block: &'a str,
    },
    /// Kind, depth or an attribute changed; re-read the block.
    BlockChanged {
        doc: &'a str,
        block: &'a str,
    },
    TextChanged {
        doc: &'a str,
        block: &'a str,
        ids: Vec<Run>,
    },
    MarkApplied {
        doc: &'a str,
        block: &'a str,
        mark_id: &'a str,
    },
    // Authored, identity-gated comments (each owned by its writer).
    CommentAdded {
        id: &'a str,
    },
    CommentEdited {
        id: &'a str,
    },
    CommentDeleted {
        id: &'a str,
    },
}
