//! Events emitted by the docs service. One instance of this service runs
//! per folder context; events are local to that folder's document set.

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
    // Emitted by the v2 schema migrate (feature `schema_v2`).
    #[cfg(feature = "schema_v2")]
    Migrated {
        from_version: &'a str,
        to_version: &'a str,
    },
}
