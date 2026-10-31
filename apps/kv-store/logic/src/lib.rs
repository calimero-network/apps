//! KV Store: a string key-value store every member of the app's organization
//! shares. The reference app, on core's component SDK (`calimero-app-sdk`).
//!
//! State is one ordered map. The app runs on its cluster's leader, which applies
//! every write in one replicated log, so a later write to a key replaces an
//! earlier one: v1's `LwwRegister` around each value has nothing left to decide
//! and is gone. Every change emits an event to everyone the app reaches.
//!
//! The methods, their arguments and the events are v1's. What the wire sees
//! differently (camelCase method names, `len` as a decimal string, the error's
//! shape, `entries` paged at 1,000) is listed in `apps/kv-store/README.md`.
//!
//! Access: the organization decides who reaches the app (members, admins and the
//! owner; a guest too, as in v1, where every member of the context could write).
//! There is no per-method rule beyond that.

use std::collections::BTreeMap;

use calimero_app_sdk::prelude::*;

/// The most entries one `entries` call returns: one page of the map.
const PAGE: u32 = 1000;

/// The store.
#[app::state(version = 1)]
pub struct KvStore {
    /// Every value by key, in key order, with its count kept alongside.
    items: UnorderedMap<String, String>,
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No value is stored under `key` (`getResult`).
    NotFound { key: String },
}

/// A change to the store, emitted after the write that caused it.
#[app::event]
pub enum Event {
    /// A key that was absent now holds `value`.
    Inserted { key: String, value: String },
    /// An existing key's value was replaced by `value`.
    Updated { key: String, value: String },
    /// A key and its value were removed.
    Removed { key: String },
    /// Every key was removed from a store that was not empty.
    Cleared,
}

#[app::logic]
#[allow(clippy::len_without_is_empty)]
impl KvStore {
    /// The empty store. The node runs it once, when the app is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// Stores `value` under `key`, replacing any value already there. Emits
    /// `Inserted` for a new key and `Updated` for an existing one.
    pub fn set(&mut self, key: String, value: String) -> app::Result<()> {
        env::log(&format!("set {key:?} = {value:?}"));
        let event = match self.items.insert(&key, &value)? {
            Some(_) => Event::Updated { key, value },
            None => Event::Inserted { key, value },
        };
        env::emit(event, Audience::All)?;
        Ok(())
    }

    /// Replaces the value under `key` only if the key exists, and says whether it
    /// did. An absent key is left absent: `false`, nothing written, no event.
    /// Emits `Updated` when the value is replaced.
    pub fn update_if_exists(&mut self, key: String, value: String) -> app::Result<bool> {
        env::log(&format!("update if exists {key:?} -> {value:?}"));
        if !self.items.contains(&key)? {
            return Ok(false);
        }
        let _previous = self.items.insert(&key, &value)?;
        env::emit(Event::Updated { key, value }, Audience::All)?;
        Ok(true)
    }

    /// The value under `key`, first storing `value` there if the key is absent.
    /// An existing value is returned unchanged, NOT the argument (the entry API's
    /// point). Emits `Inserted` only when it stores.
    pub fn get_or_insert(&mut self, key: String, value: String) -> app::Result<String> {
        env::log(&format!("get or insert {key:?} -> {value:?}"));
        if let Some(existing) = self.items.get(&key)? {
            return Ok(existing);
        }
        let _previous = self.items.insert(&key, &value)?;
        env::emit(
            Event::Inserted {
                key,
                value: value.clone(),
            },
            Audience::All,
        )?;
        Ok(value)
    }

    /// Every key with its value, as a JSON object in key order; `{}` for an empty
    /// store. At most the first 1,000 keys: one page of the map.
    #[app::view]
    pub fn entries(&self) -> app::Result<BTreeMap<String, String>> {
        let page = self.items.page(FindOpts::default().limit(PAGE))?;
        Ok(page.items.into_iter().collect())
    }

    /// How many keys the store holds (a stored count, not a scan). A `u64`, so a
    /// decimal string on the wire: `"0"` for an empty store.
    #[app::view]
    pub fn len(&self) -> app::Result<u64> {
        Ok(self.items.len()?)
    }

    /// The value under `key`, or `null` when it is absent.
    #[app::view]
    pub fn get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.items.get(&key)?)
    }

    /// The value under `key`; an absent key aborts the run with a panic, which the
    /// node reports as a trap (`422 TRAP`) and which commits nothing. Kept as the
    /// counter-example: use `get` or `getResult`.
    #[app::view]
    pub fn get_unchecked(&self, key: String) -> app::Result<String> {
        #[allow(clippy::expect_used, reason = "this method exists to show a panic")]
        let value = self.items.get(&key)?.expect("key not found");
        Ok(value)
    }

    /// The value under `key`; `NotFound { key }` when it is absent.
    #[app::view]
    pub fn get_result(&self, key: String) -> app::Result<String> {
        match self.items.get(&key)? {
            Some(value) => Ok(value),
            None => Err(Error::NotFound { key }.into()),
        }
    }

    /// Removes `key` and returns the value it held, or `null` when it was absent.
    /// Emits `Removed` only when a value was removed: an event for an absent key
    /// would announce a change that never happened.
    pub fn remove(&mut self, key: String) -> app::Result<Option<String>> {
        env::log(&format!("remove {key:?}"));
        let removed = self.items.remove(&key)?;
        if removed.is_some() {
            env::emit(Event::Removed { key }, Audience::All)?;
        }
        Ok(removed)
    }

    /// Removes every key, as any member may (no passkey confirmation, as in v1).
    /// Emits `Cleared` only when the store was not already empty.
    pub fn clear(&mut self) -> app::Result<()> {
        env::log("clear");
        if self.items.clear()? > 0 {
            env::emit(Event::Cleared, Audience::All)?;
        }
        Ok(())
    }
}
