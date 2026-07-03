//! Events emitted by the item-registry service. Borrowed `&'a str` fields keep
//! emission allocation-free (the SDK serialises them before the borrow ends).

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new item was added to the registry.
    ItemAdded { id: &'a str, owner: &'a str },
    /// An item's value was updated.
    ItemUpdated { id: &'a str },
    /// An item was deleted by its owner.
    ItemDeleted { id: &'a str },
}
