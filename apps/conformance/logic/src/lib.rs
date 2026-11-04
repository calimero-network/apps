//! Conformance: the contract the 1.0 conformance matrix calls.
//!
//! The 0.x matrix drove core's `apps/scaffolding-e2e` (a v1 contract) through
//! one write and read-back per storage kind. This is that contract's
//! counterpart on the component SDK, cut down to what the matrix calls: public
//! values, per-account values (v1 `UserStorage`), content-addressed values (v1
//! `FrozenStorage`), an authored map and vector (v1 `AuthoredMap`,
//! `AuthoredVector`: anyone adds, only an entry's author changes it), a shared
//! value with a writer set (v1 `SharedStorage`), the caller's account, a
//! passkey-confirmed write, a public read, a typed error and a trap. Method
//! names, arguments and events are scaffolding-e2e's (camelCase on the wire);
//! what differs is listed in `apps/conformance/README.md`.
//!
//! One leader applies every write in one log, so nothing here merges: an
//! authored entry is a map row keyed by `(key, author)`, a writer set is a
//! `Set` of accounts, and the checks v1 made when applying a signed delta are
//! the method checks below.
//!
//! Access: the app's organization decides who reaches it (owner, admins,
//! members, guests). Beyond that, only the authored and shared methods check
//! the caller, as each says.

use calimero_sdk::prelude::*;

/// The most rows a paged read returns: one page.
const PAGE: u32 = 1000;

/// One item of the authored vector: its value and the account that pushed it.
#[derive(Record)]
#[table(key = "value")]
pub struct AuthoredItem {
    /// The value.
    pub value: String,
    /// The account that pushed it, the only one that may change it.
    pub owner: String,
}

/// The state: one collection per storage kind the matrix checks.
#[app::state(version = 1)]
pub struct Conformance {
    /// Public values: anyone the app reaches reads and writes them.
    items: UnorderedMap<String, String>,
    /// One value per account (v1 `UserStorage`).
    user: PerUser<String>,
    /// Values addressed by the SHA-256 of their content (v1 `FrozenStorage`).
    frozen: Frozen<String>,
    /// Authored values by `(key, author)` (v1 `AuthoredMap`: per-owner keys).
    authored: UnorderedMap<(String, String), String>,
    /// Authored items in push order (v1 `AuthoredVector`).
    authored_vec: Vector<AuthoredItem>,
    /// The shared value (v1 `SharedStorage`).
    shared: Cell<String>,
    /// Who may write `shared`: the app's owner from `init`, then whoever a writer adds.
    writers: Set<String>,
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No value is stored under `key` (`getResult`).
    NotFound { key: String },
    /// No frozen value has this hash, or it is not a hash (`getFrozen`).
    FrozenNotFound { hash_hex: String },
    /// The caller has no authored entry under `key` to change (`authoredUpdate`).
    NotAuthor { key: String },
    /// The caller did not push the item at `index`, or there is none (`authoredVecUpdate`).
    NotItemOwner { index: u64 },
    /// The caller is not in the shared value's writer set (`sharedSet`, `sharedAddWriter`).
    NotAWriter { account: String },
    /// The method needs a signed-in account (an API key acting for one counts).
    NotAnAccount,
}

/// A change, emitted after the write that caused it, to everyone the app reaches.
#[app::event]
pub enum Event {
    /// A key that was absent now holds `value`.
    Inserted { key: String, value: String },
    /// An existing key's value was replaced by `value`.
    Updated { key: String, value: String },
    /// A key and its value were removed.
    Removed { key: String },
    /// `account` stored its own value.
    UserSimpleSet { account: String, value: String },
    /// `value` was stored under `hash`.
    FrozenAdded { hash: String, value: String },
    /// `owner` added an authored entry under `key`.
    AuthoredInserted {
        key: String,
        value: String,
        owner: String,
    },
    /// An author replaced its entry under `key`.
    AuthoredUpdated { key: String, value: String },
    /// An author removed its entry under `key`.
    AuthoredRemoved { key: String },
    /// `owner` pushed `value` at `index`.
    AuthoredVecPushed {
        index: u64,
        value: String,
        owner: String,
    },
    /// The item at `index` now holds `value`.
    AuthoredVecUpdated { index: u64, value: String },
    /// A writer set the shared value.
    SharedSet { value: String, by: String },
    /// A writer added `writer` to the writer set.
    SharedWriterAdded { writer: String },
}

/// The calling account, or `NotAnAccount`.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        _ => Err(Error::NotAnAccount.into()),
    }
}

#[app::logic]
#[allow(clippy::len_without_is_empty)]
impl Conformance {
    /// The empty state, with the app's owner as the shared value's one writer
    /// (v1: the context's creator). The node runs it once, as the owner.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut state = Self::load();
        let _new = state.writers.insert(&env::app_owner())?;
        Ok(state)
    }

    // ── public values ───────────────────────────────────────────────────────

    /// Stores `value` under `key`. Emits `Inserted` for a new key, `Updated` otherwise.
    pub fn set(&mut self, key: String, value: String) -> app::Result<()> {
        let event = match self.items.insert(&key, &value)? {
            Some(_) => Event::Updated { key, value },
            None => Event::Inserted { key, value },
        };
        env::emit(event, Audience::All)?;
        Ok(())
    }

    /// `set`, approved with the caller's passkey (`412 CONFIRM_REQUIRED` without it).
    #[app::confirm]
    pub fn confirmed_set(&mut self, key: String, value: String) -> app::Result<()> {
        self.set(key, value)
    }

    /// The value under `key`, or `null`.
    #[app::view]
    pub fn get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.items.get(&key)?)
    }

    /// The value under `key`, readable by anyone once the app's access is public.
    #[app::view]
    #[app::public]
    pub fn public_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.items.get(&key)?)
    }

    /// The value under `key`; `NotFound { key }` when it is absent.
    #[app::view]
    pub fn get_result(&self, key: String) -> app::Result<String> {
        match self.items.get(&key)? {
            Some(value) => Ok(value),
            None => Err(Error::NotFound { key }.into()),
        }
    }

    /// The value under `key`; an absent key panics, which the node reports as
    /// a trap (`422 TRAP`) and which commits nothing.
    #[app::view]
    pub fn get_unchecked(&self, key: String) -> app::Result<String> {
        #[allow(clippy::expect_used, reason = "this method exists to trap")]
        let value = self.items.get(&key)?.expect("key not found");
        Ok(value)
    }

    /// Removes `key`, returning what it held; emits `Removed` only when it held something.
    pub fn remove(&mut self, key: String) -> app::Result<Option<String>> {
        let removed = self.items.remove(&key)?;
        if removed.is_some() {
            env::emit(Event::Removed { key }, Audience::All)?;
        }
        Ok(removed)
    }

    /// How many public keys there are (a stored count): a decimal string.
    #[app::view]
    pub fn len(&self) -> app::Result<u64> {
        Ok(self.items.len()?)
    }

    /// The caller's account id: what the platform names it, the id the
    /// authored and shared methods record.
    #[app::view]
    pub fn my_account(&self) -> app::Result<String> {
        account()
    }

    // ── per-account values (v1 UserStorage) ─────────────────────────────────

    /// Stores the caller's own value. Emits `UserSimpleSet`.
    pub fn set_user_simple(&mut self, value: String) -> app::Result<()> {
        let account = self.user.set(&value)?;
        env::emit(Event::UserSimpleSet { account, value }, Audience::All)?;
        Ok(())
    }

    /// The caller's own value, or `null`.
    #[app::view]
    pub fn get_user_simple(&self) -> app::Result<Option<String>> {
        self.user.get()
    }

    /// `account`'s value, or `null`: anyone the app reaches may read it.
    #[app::view]
    pub fn get_user_simple_for(&self, account: String) -> app::Result<Option<String>> {
        Ok(self.user.get_for(&account)?)
    }

    // ── content-addressed values (v1 FrozenStorage) ─────────────────────────

    /// Stores `value` and returns its hash (hex); the same value again writes
    /// nothing and returns the same hash. Emits `FrozenAdded` when it is new.
    pub fn add_frozen(&mut self, value: String) -> app::Result<String> {
        let (hash, new) = self.frozen.insert(&value)?;
        if new {
            env::emit(
                Event::FrozenAdded {
                    hash: hash.clone(),
                    value,
                },
                Audience::All,
            )?;
        }
        Ok(hash)
    }

    /// The value with this hash; `FrozenNotFound` when there is none or
    /// `hash_hex` is not a 64-digit hex hash.
    #[app::view]
    pub fn get_frozen(&self, hash_hex: String) -> app::Result<String> {
        let well_formed = hash_hex.len() == 64 && hash_hex.bytes().all(|b| b.is_ascii_hexdigit());
        let found = if well_formed {
            self.frozen.get(&hash_hex)?
        } else {
            None
        };
        found.ok_or_else(|| Error::FrozenNotFound { hash_hex }.into())
    }

    // ── the authored map (v1 AuthoredMap) ───────────────────────────────────

    /// Adds (or replaces) the caller's own entry under `key`: keys are per
    /// author, so another author's entry under the same key is untouched.
    /// Emits `AuthoredInserted` for a new entry, `AuthoredUpdated` otherwise.
    pub fn authored_insert(&mut self, key: String, value: String) -> app::Result<()> {
        let owner = account()?;
        let event = match self
            .authored
            .insert(&(key.clone(), owner.clone()), &value)?
        {
            Some(_) => Event::AuthoredUpdated { key, value },
            None => Event::AuthoredInserted { key, value, owner },
        };
        env::emit(event, Audience::All)?;
        Ok(())
    }

    /// Replaces the caller's own entry under `key`; `NotAuthor` when it has
    /// none (another author's entry is never changed). Emits `AuthoredUpdated`.
    pub fn authored_update(&mut self, key: String, value: String) -> app::Result<()> {
        let owner = account()?;
        let at = (key.clone(), owner);
        if !self.authored.contains(&at)? {
            return Err(Error::NotAuthor { key }.into());
        }
        let _previous = self.authored.insert(&at, &value)?;
        env::emit(Event::AuthoredUpdated { key, value }, Audience::All)?;
        Ok(())
    }

    /// Removes the caller's own entry under `key`, returning its value, or
    /// `null` when it has none. Emits `AuthoredRemoved` only when one went.
    pub fn authored_remove(&mut self, key: String) -> app::Result<Option<String>> {
        let owner = account()?;
        let removed = self.authored.remove(&(key.clone(), owner))?;
        if removed.is_some() {
            env::emit(Event::AuthoredRemoved { key }, Audience::All)?;
        }
        Ok(removed)
    }

    /// The value under `key` of its first author (by account id), or `null`.
    #[app::view]
    pub fn authored_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.first_authored(key)?.map(|(_, value)| value))
    }

    /// The first author (by account id) of an entry under `key`, or `null`.
    #[app::view]
    pub fn authored_get_owner(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.first_authored(key)?.map(|(owner, _)| owner))
    }

    // ── the authored vector (v1 AuthoredVector) ─────────────────────────────

    /// Appends `value`, authored by the caller, and returns its index (a decimal
    /// string). Emits `AuthoredVecPushed`.
    pub fn authored_vec_push(&mut self, value: String) -> app::Result<u64> {
        let owner = account()?;
        let index = self.authored_vec.push(&AuthoredItem {
            value: value.clone(),
            owner: owner.clone(),
        })?;
        env::emit(
            Event::AuthoredVecPushed {
                index,
                value,
                owner,
            },
            Audience::All,
        )?;
        Ok(index)
    }

    /// Replaces the item at `index`; `NotItemOwner` unless the caller pushed it.
    /// Emits `AuthoredVecUpdated`.
    pub fn authored_vec_update(&mut self, index: u64, value: String) -> app::Result<()> {
        let caller = account()?;
        match self.authored_vec.get(index)? {
            Some(item) if item.owner == caller => {
                let _previous = self.authored_vec.set(
                    index,
                    &AuthoredItem {
                        value: value.clone(),
                        owner: caller,
                    },
                )?;
                env::emit(Event::AuthoredVecUpdated { index, value }, Audience::All)?;
                Ok(())
            }
            _ => Err(Error::NotItemOwner { index }.into()),
        }
    }

    /// The value at `index`, or `null`.
    #[app::view]
    pub fn authored_vec_get(&self, index: u64) -> app::Result<Option<String>> {
        Ok(self.authored_vec.get(index)?.map(|item| item.value))
    }

    /// Who pushed the item at `index`, or `null`.
    #[app::view]
    pub fn authored_vec_get_owner(&self, index: u64) -> app::Result<Option<String>> {
        Ok(self.authored_vec.get(index)?.map(|item| item.owner))
    }

    /// How many items were pushed: a decimal string.
    #[app::view]
    pub fn authored_vec_len(&self) -> app::Result<u64> {
        Ok(self.authored_vec.len()?)
    }

    // ── the shared value (v1 SharedStorage) ─────────────────────────────────

    /// Sets the shared value; `NotAWriter` unless the caller is in the writer
    /// set (the app's owner, and whoever a writer added). Emits `SharedSet`.
    pub fn shared_set(&mut self, value: String) -> app::Result<()> {
        let by = self.writer()?;
        self.shared.set(&value)?;
        env::emit(Event::SharedSet { value, by }, Audience::All)?;
        Ok(())
    }

    /// The shared value, or `null` before any writer set it.
    #[app::view]
    pub fn shared_get(&self) -> app::Result<Option<String>> {
        Ok(self.shared.get()?)
    }

    /// Adds `account` to the writer set; `NotAWriter` unless the caller is a
    /// writer. Emits `SharedWriterAdded` when the account was not one yet.
    pub fn shared_add_writer(&mut self, account: String) -> app::Result<()> {
        let _by = self.writer()?;
        if self.writers.insert(&account)? {
            env::emit(Event::SharedWriterAdded { writer: account }, Audience::All)?;
        }
        Ok(())
    }

    /// The writer set, in account order (at most 1,000: one page).
    #[app::view]
    pub fn shared_get_writers(&self) -> app::Result<Vec<String>> {
        Ok(self.writers.page(FindOpts::default().limit(PAGE))?.items)
    }
}

impl Conformance {
    /// The first `(author, value)` under `key`, by author.
    fn first_authored(&self, key: String) -> app::Result<Option<(String, String)>> {
        let page = self
            .authored
            .prefix(&[KeyPart::Str(key)], FindOpts::default().limit(1))?;
        Ok(page
            .items
            .into_iter()
            .next()
            .map(|((_, owner), value)| (owner, value)))
    }

    /// The caller, if it is in the writer set; `NotAWriter` otherwise.
    fn writer(&self) -> app::Result<String> {
        let caller = account()?;
        if self.writers.contains(&caller)? {
            Ok(caller)
        } else {
            Err(Error::NotAWriter { account: caller }.into())
        }
    }
}
