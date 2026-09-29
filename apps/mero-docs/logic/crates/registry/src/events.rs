//! Events emitted by the registry service. One variant per mutation type.
//!
//! The UI subscribes to these over the Calimero event stream to re-fetch
//! just the affected slice (folder tree, one folder's metadata, sort order)
//! instead of re-reading the entire registry on every change.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A folder was added to the registry.
    FolderRegistered { id: &'a str },
    /// A folder was removed from the registry.
    FolderUnregistered { id: &'a str },
    /// A docs context was bound to a folder.
    FolderContextBound {
        folder_id: &'a str,
        context_id: &'a str,
    },
    /// A folder's colour changed.
    FolderColorChanged { id: &'a str },
    /// A folder's display name changed.
    FolderAliasChanged { id: &'a str },
    /// A folder's recorded parent changed.
    FolderParentChanged { id: &'a str },
    /// The display order of a parent's child folders changed.
    FolderSortOrderChanged { parent_id: &'a str },
    /// A folder's registry visibility flag changed.
    FolderVisibilityChanged { id: &'a str },
    /// A manager was added.
    ManagerAdded { member: &'a str },
    /// A manager was removed.
    ManagerRemoved { member: &'a str },
    /// A folder's per-member role was set or cleared (UI re-fetches the row).
    FolderRoleChanged { folder_id: &'a str, member: &'a str },
    /// A tag's name, colour, or tombstone flag changed.
    TagChanged { key: &'a str },
    /// A saved view was created, edited, or deleted.
    ViewChanged { id: &'a str },
}
