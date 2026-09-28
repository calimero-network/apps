//! RECIPE — CRDT counters (likes / tallies) and one-vote-per-person votes.
//! Reference snippet; merge into a service `#[app::state]` + `#[app::logic]`.
//! Not compiled as-is.
//!
//! Two different things, on purpose:
//!
//! * A **counter** (`GCounter` / `PNCounter`) merges concurrent increments
//!   without losing any, which is what a view count or a "likes" tally needs.
//!   It does NOT know who incremented it: every call adds one, every device has
//!   its own slot, and a plain counter field is writable by any member — a
//!   patched node can set it to anything. Use it only where nobody gains by
//!   inflating it.
//! * A **vote** must be one per person and must not be forgeable. That is a row
//!   per `(item, account)` in an `Authored` map, owned by the voter, and a
//!   tally that counts a row only when its key names its owner — see `score`.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{env, AccountId};
use calimero_storage::collections::{Authored, GCounter, IndexedMap};
// GCounter = Counter<false> (increment-only); PNCounter = Counter<true> (inc + dec).

/// One account's vote on one item: +1, -1, or 0 for retracted. The voter is
/// the entry's owner stamp, never a field.
#[derive(BorshSerialize, BorshDeserialize, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Vote {
    #[index]
    pub item_id: String,
    pub value: i8,
}

// ── add to the service state ───────────────────────────────────────────────
// #[app::state]
// pub struct TallyState {
//     // total likes across everything (monotonic, honest-peer tally)
//     total_likes: GCounter,
//     // "<item_id>|<account>" -> that account's vote, owned by the voter
//     votes: Authored<IndexedMap<String, Vote>>,
// }
//
// In #[app::init]:
//     total_likes: GCounter::new(),
//     votes: Authored::new(),

fn caller() -> String {
    AccountId::from(env::account_id()).to_string()
}

fn vote_key(item_id: &str, account: &str) -> String {
    format!("{item_id}|{account}")
}

impl TallyState {
    /// Increment the global like tally (caller's contribution merges CRDT-safe).
    pub fn like(&mut self) -> app::Result<u64> {
        self.total_likes
            .increment()
            .map_err(|e| AppError::msg(format!("total_likes.increment: {e}")))?;
        self.total_likes
            .value()
            .map_err(|e| AppError::msg(format!("total_likes.value: {e}")))
    }

    pub fn total_likes(&self) -> app::Result<u64> {
        self.total_likes
            .value()
            .map_err(|e| AppError::msg(format!("total_likes.value: {e}")))
    }

    /// Up (+1), down (-1) or retract (0) a vote on an item. Idempotent per
    /// account: voting again replaces the caller's own row.
    pub fn vote(&mut self, item_id: String, value: i8) -> app::Result<()> {
        if !(-1..=1).contains(&value) {
            app::bail!(AppError::msg("vote must be -1, 0 or 1"));
        }
        let key = vote_key(&item_id, &caller());
        let vote = Vote { item_id, value };
        // Only the owner may update a row, on every node, so a row already at
        // this key is either the caller's own or a squatter's, which storage
        // refuses to let the caller overwrite.
        let exists = self
            .votes
            .contains(&key)
            .map_err(|e| AppError::msg(format!("votes.contains: {e}")))?;
        if exists {
            self.votes.update(&key, vote)
        } else {
            self.votes.insert(key, vote)
        }
        .map_err(|e| AppError::msg(format!("votes.write: {e}")))?;
        Ok(())
    }

    /// Net score for an item (0 if never voted). A seek on the `item_id` index.
    ///
    /// A row counts only when its key is `vote_key(item, owner)` and its value
    /// is a real vote: a patched node can write any row under its own stamp,
    /// but only one key names it, so it still gets one vote.
    pub fn score(&self, item_id: String) -> app::Result<i64> {
        let mut score = 0i64;
        for (key, vote) in self
            .votes
            .query("item_id")
            .eq(&item_id)
            .entries()
            .map_err(|e| AppError::msg(format!("votes.query: {e}")))?
        {
            let Some(owner) = self
                .votes
                .owner_of(&key)
                .map_err(|e| AppError::msg(format!("votes.owner_of: {e}")))?
            else {
                continue;
            };
            if key == vote_key(&item_id, &owner.to_string()) && (-1..=1).contains(&vote.value) {
                score += i64::from(vote.value);
            }
        }
        Ok(score)
    }
}
