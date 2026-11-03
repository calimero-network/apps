//! RECIPE: a tally (`Counter`) and one-vote-per-person votes on the component
//! SDK. A complete app module: merge its state fields, methods and error into
//! an app's `lib.rs`. Compile-checked against core 1.0.0-rc.8, not built here.
//!
//! Two different things, on purpose:
//!
//! * A **counter** counts calls: every `like` adds one. v1's `GCounter` /
//!   `PNCounter` merged per-device slots; one leader orders every write here, so
//!   `Counter` is a stored integer kept with `Store::add` (`add` takes a
//!   negative delta for v1's `PNCounter`). It still does not know who called,
//!   so use it only where nobody gains by inflating it.
//! * A **vote** is one per person: a row keyed `(item, account)`, the account
//!   being `env::caller()`'s, so a second vote replaces the first and nobody
//!   votes for someone else. A maintained count and a sum make `score` cheap.
//!   v1 needed `Authored<IndexedMap>` owner stamps for this; here the key is the
//!   check.

use calimero_app_sdk::env::Caller;
use calimero_app_sdk::prelude::*;

/// One account's vote on one item: +1 or -1.
#[derive(Record)]
#[table(key = ["item_id", "account"], index(by_item = ["item_id"]), count(per_item = ["item_id"]))]
pub struct Vote {
    pub item_id: String,
    pub account: String,
    pub value: i64,
}

#[app::state(version = 1)]
pub struct Tally {
    likes: Counter,
    votes: Table<Vote>,
    /// item -> the sum of its votes, kept with every vote.
    scores: UnorderedMap<String, i64>,
}

#[app::logic]
impl Tally {
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// One more like; answers the new total.
    pub fn like(&mut self) -> app::Result<u64> {
        Ok(self.likes.increment()?)
    }

    #[app::view]
    pub fn total_likes(&self) -> app::Result<u64> {
        Ok(self.likes.get()?)
    }

    /// The caller's vote on `item_id`: `1`, `-1`, or `0` to retract it.
    pub fn vote(&mut self, item_id: String, value: i64) -> app::Result<()> {
        if !(-1..=1).contains(&value) {
            return Err(Error::BadVote { value }.into());
        }
        let account = match env::caller() {
            Caller::Account(a) | Caller::ApiKey { account: a, .. } => a,
            Caller::Public | Caller::System | Caller::App(_) => return Err(AppError::login_required()),
        };
        let key = (item_id.clone(), account.clone());
        let previous = self.votes.get(&key)?.map_or(0, |v| v.value);
        if value == 0 {
            let _removed = self.votes.remove(&key)?;
        } else {
            self.votes.upsert(Vote {
                item_id: item_id.clone(),
                account,
                value,
            })?;
        }
        let score = self.scores.get(&item_id)?.unwrap_or(0) - previous + value;
        let _old = self.scores.insert(&item_id, &score)?;
        Ok(())
    }

    /// The sum of `item_id`'s votes: one read.
    #[app::view]
    pub fn score(&self, item_id: String) -> app::Result<i64> {
        Ok(self.scores.get(&item_id)?.unwrap_or(0))
    }

    /// How many accounts voted on `item_id`: a maintained count.
    #[app::view]
    pub fn voters(&self, item_id: String) -> app::Result<u64> {
        Ok(self.votes.count("perItem", &[KeyPart::Str(item_id)])?)
    }
}

#[app::error]
pub enum Error {
    BadVote { value: i64 },
}
