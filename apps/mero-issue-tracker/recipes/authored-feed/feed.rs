//! RECIPE: an append-ordered, author-owned feed on the component SDK.
//! A complete app module: merge its state field, methods, error and event into
//! an app's `lib.rs`. Compile-checked against core 1.0.0-rc.8, its paths
//! renamed for 1.0.0-rc.9 (`calimero_sdk`); not built here.
//!
//! v1 used `AuthoredVector<T>`: the store remembered who pushed each entry and
//! refused anyone else's edit at merge time. On Calimero 1.0 every write is a
//! method run by the app's leader, so the author is a field, set from
//! `env::caller()` on push and checked against it on edit and delete. A
//! `Vector` keeps insertion order, so the feed needs no sorting.

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;

/// The most entries one `getFeed` answers.
pub const PAGE: u64 = 1000;

/// One entry. `deleted` keeps the position (a tombstone), so later entries keep
/// their indexes.
#[derive(Record)]
#[table(key = "id")]
pub struct Post {
    /// `env::unique_id()`: stable across edits.
    pub id: String,
    /// The account that pushed it: the only one who may edit or delete it.
    pub author: String,
    pub text: String,
    /// Unix milliseconds.
    pub created_at: u64,
    pub edited_at: Option<u64>,
    pub deleted: bool,
}

#[app::state(version = 1)]
pub struct Feed {
    posts: Vector<Post>,
}

#[app::logic]
impl Feed {
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// Appends a post as the caller; answers its index.
    pub fn post(&mut self, text: String) -> app::Result<u64> {
        let author = account()?;
        let index = self.posts.push(&Post {
            id: env::unique_id(),
            author,
            text,
            created_at: env::time_now(),
            edited_at: None,
            deleted: false,
        })?;
        env::emit(Event::Posted { index }, Audience::All)?;
        Ok(index)
    }

    /// Replaces a post's text: its author only (`Forbidden` for anyone else).
    pub fn edit_post(&mut self, index: u64, text: String) -> app::Result<()> {
        let mut p = self.mine(index)?;
        p.text = text;
        p.edited_at = Some(env::time_now());
        let _old = self.posts.set(index, &p)?;
        env::emit(Event::Edited { index }, Audience::All)?;
        Ok(())
    }

    /// Tombstones a post: its author only.
    pub fn delete_post(&mut self, index: u64) -> app::Result<()> {
        let mut p = self.mine(index)?;
        p.text.clear();
        p.deleted = true;
        let _old = self.posts.set(index, &p)?;
        env::emit(Event::Deleted { index }, Audience::All)?;
        Ok(())
    }

    /// `limit` posts from position `offset`, oldest first, tombstones skipped
    /// (at most 1,000 positions read).
    #[app::view]
    pub fn get_feed(&self, offset: u64, limit: u64) -> app::Result<Vec<Post>> {
        let end = offset.saturating_add(limit.min(PAGE)).min(self.posts.len()?);
        let mut out = Vec::new();
        for i in offset..end {
            if let Some(p) = self.posts.get(i)? {
                if !p.deleted {
                    out.push(p);
                }
            }
        }
        Ok(out)
    }

    /// Positions in the feed, tombstones included: a stored count.
    #[app::view]
    pub fn feed_len(&self) -> app::Result<u64> {
        Ok(self.posts.len()?)
    }

    fn mine(&self, index: u64) -> app::Result<Post> {
        let Some(p) = self.posts.get(index)? else {
            return Err(Error::NotFound { index }.into());
        };
        if p.author != account()? {
            return Err(Error::NotAuthor { index }.into());
        }
        Ok(p)
    }
}

#[app::error]
pub enum Error {
    NotFound { index: u64 },
    NotAuthor { index: u64 },
}

#[app::event]
pub enum Event {
    Posted { index: u64 },
    Edited { index: u64 },
    Deleted { index: u64 },
}

fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(a) | Caller::ApiKey { account: a, .. } => Ok(a),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}
