//! Events emitted by the registry service. One variant per mutation type.
//!
//! The UI subscribes to these over the Calimero event stream to re-fetch
//! just the affected slice (folder tree, one folder's metadata, sort order)
//! instead of re-reading the entire registry on every change.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    FolderRegistered {
        id: &'a str,
    },
    FolderUnregistered {
        id: &'a str,
    },
    FolderContextBound {
        folder_id: &'a str,
        context_id: &'a str,
    },
    FolderColorChanged {
        id: &'a str,
    },
    FolderAliasChanged {
        id: &'a str,
    },
    FolderParentChanged {
        id: &'a str,
    },
    FolderSortOrderChanged {
        parent_id: &'a str,
    },
    FolderVisibilityChanged {
        id: &'a str,
    },
}
