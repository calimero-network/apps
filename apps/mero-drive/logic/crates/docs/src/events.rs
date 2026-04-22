//! Events emitted by the docs service. One instance of this service runs
//! per folder context; events are local to that folder's document set.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    DocCreated { id: &'a str },
    DocEdited { id: &'a str },
    DocArchived { id: &'a str },
    DocUnarchived { id: &'a str },
    DocDeleted { id: &'a str },
    DocTagsChanged { id: &'a str },
}
