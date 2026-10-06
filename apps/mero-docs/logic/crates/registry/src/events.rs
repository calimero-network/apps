//! Events emitted by the registry service. One variant per mutation type.
//!
//! The UI subscribes to these over the Calimero event stream to re-fetch
//! just the affected slice (managers, tags, saved views) instead of
//! re-reading the entire registry on every change.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A manager was added.
    ManagerAdded { member: &'a str },
    /// A manager was removed.
    ManagerRemoved { member: &'a str },
    /// A tag's name, colour, or tombstone flag changed.
    TagChanged { key: &'a str },
    /// A saved view was created, edited, or deleted.
    ViewChanged { id: &'a str },
}
