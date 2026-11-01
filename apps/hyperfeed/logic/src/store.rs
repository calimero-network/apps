//! The few pieces every module shares: the maps the state is made of, the
//! typed errors, and emitting an event.
//!
//! v1 kept every collection as a `calimero-storage` `UnorderedMap<String, T>`
//! of mergeable records. Here one leader applies every write in log order, so a
//! record is plain data and a later write replaces an earlier one; [`Map`] is
//! the SDK's `UnorderedMap<String, T>` with v1's call shapes (`get(&str)`,
//! `insert(String, T)`, `entries()`), so the rules read as they did.

use calimero_app_sdk::app::StateField;
use calimero_app_sdk::prelude::*;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::{Error, Ev, Event};

/// Rows read per page when a method walks a whole map.
const PAGE: u32 = 1000;

/// `UnorderedMap<String, V>`, keyed by string, read in key order.
pub struct Map<V> {
    inner: UnorderedMap<String, V>,
}

impl<V> StateField for Map<V> {
    const KIND: &'static str = <UnorderedMap<String, V> as StateField>::KIND;
}

impl<V: Serialize + DeserializeOwned> Map<V> {
    /// The map stored under `name` (the state field's camelCase name).
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            inner: UnorderedMap::new(name),
        }
    }

    pub fn get(&self, key: &str) -> app::Result<Option<V>> {
        Ok(self.inner.get(&key.to_owned())?)
    }

    /// Writes `value` under `key`; the previous value, if any.
    pub fn insert(&mut self, key: String, value: V) -> app::Result<Option<V>> {
        Ok(self.inner.insert(&key, &value)?)
    }

    pub fn remove(&mut self, key: &str) -> app::Result<Option<V>> {
        Ok(self.inner.remove(&key.to_owned())?)
    }

    /// A stored count, not a scan; a `usize`, as v1's was.
    pub fn len(&self) -> app::Result<usize> {
        Ok(usize::try_from(self.inner.len()?).unwrap_or(usize::MAX))
    }

    /// Every entry, in key order, read a page of 1,000 at a time. The maps
    /// a feed holds are each capped by the contract's own limits (or prune
    /// themselves), as they were in v1, where `entries()` read them whole too.
    pub fn entries(&self) -> app::Result<std::vec::IntoIter<(String, V)>> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut opts = FindOpts::default().limit(PAGE);
            opts.cursor = cursor.take();
            let page = self.inner.page(opts)?;
            out.extend(page.items);
            match page.next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(out.into_iter())
    }
}

/// A refused argument or a rule the call breaks: `422 APP_ERROR`,
/// `{ code: "Invalid", fields: { message } }`. v1 answered the same message as
/// a plain string error.
pub fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

/// The caller may not make this call (only the owner decides; an agent speaks
/// only as itself): `{ code: "Forbidden", fields: { message } }`.
pub fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

/// Emits `event` to everyone the feed reaches: you, on every device, and the
/// agents you let into it.
pub fn emit(event: Ev<'_>) -> app::Result<()> {
    env::emit(Event::from(event), Audience::All)
}
