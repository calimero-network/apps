//! Item-registry service — the neutral foundation template.
//!
//! A generic shared registry of items (`add` / `list` / `get` / `update` /
//! owner-gated `delete`). It is deliberately domain-agnostic: the build agent
//! copies this crate per spec service and renames the entity. It demonstrates,
//! in one cohesive context, the core Calimero patterns every generated app
//! needs:
//!
//! - `#[app::state]` / `#[app::logic]` / `#[app::init]`
//! - `UnorderedMap` (the registry) and `AuthoredMap` (the authorship index that
//!   structurally owner-gates `update`/`delete`)
//! - `LwwRegister` (the item's mutable value, last-writer-wins on conflict)
//! - one hand-written `Mergeable` + matching `RekeyTarget` on `Item` (it nests a
//!   CRDT, so it must re-key its child or the nested register is LWW'd as an
//!   opaque blob — see `RekeyTarget` impl)
//! - deriving `Mergeable` via `#[derive(Mergeable)]` (`use calimero_sdk::app::Mergeable;`)
//!   is the normal path for a struct whose fields are all CRDTs already — this
//!   template hand-writes the impl instead only because `Item` nests a register
//!   that requires custom rekeying (see above)
//! - `app::emit!`, `#[app::private]` (per-node draft, never replicated),
//!   named-struct returns (`Item` / `ItemView`), and base58 owner keys.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::{field_child_id, RekeyTarget};
use calimero_storage::collections::{AuthoredMap, LwwRegister, Mergeable, UnorderedMap};
use calimero_storage::env as storage_env;
use issue_tracker_types::{generate_id, validate_label, Error};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

/// A registry item. `value` is a `LwwRegister` so concurrent edits converge by
/// hybrid-logical-clock last-writer-wins; `label` and `created_ms` are set once
/// at add time and never change. Because this struct **nests a CRDT** and is
/// stored as a map value, it implements `Mergeable` by hand AND `RekeyTarget`
/// (see below).
// Nests a `LwwRegister`, which is Borsh-only (no serde impl in calimero_storage).
// Item is the internal map value, stored/replicated via Borsh; callers get the
// serde-able `ItemView` instead. So no serde derives here.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Item {
    pub label: String,
    /// The item's mutable body. LWW on concurrent updates.
    pub value: LwwRegister<String>,
    pub created_ms: u64,
}

/// Hand-written merge. The immutable fields (`label`, `created_ms`) tie-break
/// deterministically; `value` delegates to the nested `LwwRegister` so the
/// freshest write wins. A `#[derive(Mergeable)]` would generate this, but we
/// write it by hand to demonstrate the pattern (and to pair it with the
/// required `RekeyTarget`).
impl Mergeable for Item {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Deterministic tie-break for the set-once fields so merge is
        // commutative even if two replicas raced the initial insert.
        if (other.created_ms, &other.label) < (self.created_ms, &self.label) {
            self.label = other.label.clone();
            self.created_ms = other.created_ms;
        }
        // `LwwRegister::merge` returns `()` (infallible HLC last-writer-wins),
        // so wrap it back into the fallible `Mergeable::merge` signature.
        self.value.merge(&other.value);
        Ok(())
    }
}

/// Deterministic re-keying for a hand-written CRDT-value struct (#2577).
///
/// `Item` nests a `LwwRegister`. Stored as an `UnorderedMap` value it would be
/// LWW'd as an opaque blob unless we re-key the nested register under a
/// field-namespaced child of the entry id, so every replica derives identical
/// ids and the register converges as a child entity. `#[derive(Mergeable)]`
/// generates this for you; a hand-written `Mergeable` MUST provide it too.
impl RekeyTarget for Item {
    fn rekey_relative_to(&mut self, parent_id: Id) {
        calimero_storage::rekey_field_if_supported!(
            &mut self.value,
            field_child_id(parent_id, "value")
        );
    }
}

/// Read-shaped view returned to callers: the registry id, the item, and the
/// base58 owner key. A named struct (not a tuple) so the generated ABI client
/// gets typed fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ItemView {
    pub id: String,
    pub label: String,
    pub value: String,
    pub created_ms: u64,
    pub owner: String,
}

/// Per-node draft, never replicated. `#[app::private]` keeps it local to the
/// node — handy for "save before submit" UX that should not leak to peers.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[calimero_sdk::app::private]
pub struct Draft {
    pub text: String,
}

impl Default for Draft {
    fn default() -> Draft {
        Draft { text: String::new() }
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// `#[app::state]` injects the borsh derives itself (SDK 0.11+); a manual derive
// here would collide.
#[app::state(emits = for<'a> Event<'a>)]
pub struct Registry {
    /// The items, keyed by generated id. Plain `UnorderedMap`: any peer may add
    /// or update an item's value (LWW), so no per-author gate on the data.
    items: UnorderedMap<String, Item>,
    /// Authorship index: `item_id → owner-claim`. `AuthoredMap` stamps the
    /// adding executor as owner and rejects `update`/`remove` by anyone else,
    /// so it structurally owner-gates deletion without a manual key check.
    owners: AuthoredMap<String, LwwRegister<u64>>,
}

#[app::logic]
impl Registry {
    #[app::init]
    pub fn init() -> Registry {
        Registry {
            items: UnorderedMap::new_with_field_name("registry:items"),
            owners: AuthoredMap::new_with_field_name("registry:owners"),
        }
    }

    /// Add an item. Returns its generated id. The caller becomes the owner; only
    /// the owner may later delete it.
    pub fn add(&mut self, label: String, value: String) -> app::Result<String> {
        validate_label(&label).map_err(AppError::from)?;

        let now = storage_env::time_now();
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("item", now, &nonce);

        let item = Item {
            label,
            value: LwwRegister::new(value),
            created_ms: now,
        };
        self.items
            .insert(id.clone(), item)
            .map_err(|e| AppError::msg(format!("items.insert: {e}")))?;
        // Stamp the adding executor as the owner. The value is unused; the
        // authorship stamp on the AuthoredMap entry is what gates delete.
        self.owners
            .insert(id.clone(), LwwRegister::new(now))
            .map_err(|e| AppError::msg(format!("owners.insert: {e}")))?;

        let owner = self.owner_b58();
        app::emit!(Event::ItemAdded {
            id: &id,
            owner: &owner,
        });
        Ok(id)
    }

    /// Update an item's value (LWW). Anyone may update — concurrent edits
    /// converge to the last writer. Errors if the id is unknown.
    pub fn update(&mut self, id: String, value: String) -> app::Result<()> {
        let mut guard = self
            .items
            .get_mut(&id)
            .map_err(|e| AppError::msg(format!("items.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(id.clone())))?;
        guard.value.set(value);
        drop(guard);

        app::emit!(Event::ItemUpdated { id: &id });
        Ok(())
    }

    /// Delete an item. Owner-gated: `AuthoredMap::remove` returns
    /// `ActionNotAllowed` for non-owners, surfaced here as `Forbidden`.
    pub fn delete(&mut self, id: String) -> app::Result<()> {
        let removed = self
            .owners
            .remove(&id)
            .map_err(map_owner_error())?;
        if removed.is_none() {
            app::bail!(Error::NotFound(id));
        }
        self.items
            .remove(&id)
            .map_err(|e| AppError::msg(format!("items.remove: {e}")))?;

        app::emit!(Event::ItemDeleted { id: &id });
        Ok(())
    }

    /// Get one item by id.
    pub fn get(&self, id: String) -> app::Result<Option<ItemView>> {
        let Some(item) = self
            .items
            .get(&id)
            .map_err(|e| AppError::msg(format!("items.get: {e}")))?
        else {
            return Ok(None);
        };
        Ok(Some(self.to_view(id, &item)?))
    }

    /// List all items, sorted by creation time then id for a stable order
    /// (`UnorderedMap` iteration order is unspecified).
    pub fn list(&self) -> app::Result<Vec<ItemView>> {
        let mut out: Vec<ItemView> = self
            .items
            .entries()
            .map_err(|e| AppError::msg(format!("items.entries: {e}")))?
            .map(|(id, item)| self.to_view(id, &item))
            .collect::<app::Result<_>>()?;
        out.sort_by(|a, b| (a.created_ms, &a.id).cmp(&(b.created_ms, &b.id)));
        Ok(out)
    }

    /// Number of items in the registry.
    pub fn count(&self) -> app::Result<usize> {
        self.items
            .len()
            .map_err(|e| AppError::msg(format!("items.len: {e}")))
    }

    // ---- Per-node draft (never replicated) ----

    pub fn save_draft(&self, text: String) -> app::Result<()> {
        let mut draft = Draft::private_load_or_default()?;
        draft.as_mut().text = text;
        Ok(())
    }

    pub fn get_draft(&self) -> app::Result<String> {
        Ok(Draft::private_load_or_default()?.text.clone())
    }
}

impl Registry {
    /// Base58 of the current executor — the public, shareable owner identity.
    fn owner_b58(&self) -> String {
        bs58::encode(env::executor_id()).into_string()
    }

    fn to_view(&self, id: String, item: &Item) -> app::Result<ItemView> {
        // `owner_of` yields a `PublicKey`; `String::from(PublicKey)` is its
        // canonical base58 encoding (see calimero_primitives::identity).
        let owner = self
            .owners
            .owner_of(&id)
            .map_err(|e| AppError::msg(format!("owners.owner_of: {e}")))?
            .map(String::from)
            .unwrap_or_default();
        Ok(ItemView {
            id,
            label: item.label.clone(),
            value: item.value.get().clone(),
            created_ms: item.created_ms,
            owner,
        })
    }
}

/// Translate an `AuthoredMap` access-control error into a friendly `Forbidden`.
fn map_owner_error() -> impl FnOnce(calimero_storage::collections::StoreError) -> AppError {
    move |e| {
        let s = e.to_string();
        if s.contains("ActionNotAllowed") {
            AppError::from(Error::Forbidden("only the owner may delete this item".into()))
        } else {
            AppError::msg(format!("owners.remove: {s}"))
        }
    }
}

// ---------------------------------------------------------------------------
// In-process tests — one TestHost roundtrip per mutation.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    #[test]
    fn add_get_and_list() {
        let mut app = TestHost::new(Registry::init);

        let id = app.call(|s| s.add("widget".into(), "v1".into())).unwrap();
        let view = app.view(|s| s.get(id.clone())).unwrap().unwrap();
        assert_eq!(view.label, "widget");
        assert_eq!(view.value, "v1");
        assert_eq!(app.view(|s| s.count()).unwrap(), 1);
        assert_eq!(app.view(|s| s.list()).unwrap().len(), 1);
        // `add` emits exactly one event.
        assert_eq!(app.events().len(), 1);
    }

    #[test]
    fn update_changes_value() {
        let mut app = TestHost::new(Registry::init);

        let id = app.call(|s| s.add("widget".into(), "v1".into())).unwrap();
        app.call(|s| s.update(id.clone(), "v2".into())).unwrap();
        assert_eq!(app.view(|s| s.get(id)).unwrap().unwrap().value, "v2");
    }

    #[test]
    fn update_unknown_id_errors() {
        let mut app = TestHost::new(Registry::init);
        assert!(app.call(|s| s.update("nope".into(), "x".into())).is_err());
    }

    #[test]
    fn owner_can_delete() {
        let mut app = TestHost::new(Registry::init);

        let id = app.call(|s| s.add("widget".into(), "v1".into())).unwrap();
        app.call(|s| s.delete(id.clone())).unwrap();
        assert_eq!(app.view(|s| s.count()).unwrap(), 0);
        assert!(app.view(|s| s.get(id)).unwrap().is_none());
    }

    #[test]
    fn non_owner_cannot_delete() {
        let mut app = TestHost::new(Registry::init);

        // Default identity adds the item, so it owns it.
        let id = app.call(|s| s.add("widget".into(), "v1".into())).unwrap();

        // A different executor is not the owner — AuthoredMap rejects the
        // delete, surfaced as Forbidden.
        let other = [9u8; 32];
        assert!(app.call_as(other, |s| s.delete(id.clone())).is_err());
        // The item survives the rejected delete.
        assert_eq!(app.view(|s| s.count()).unwrap(), 1);
    }

    #[test]
    fn private_draft_roundtrips() {
        let mut app = TestHost::new(Registry::init);

        app.call(|s| s.save_draft("hello".into())).unwrap();
        assert_eq!(app.view(|s| s.get_draft()).unwrap(), "hello");
    }
}
