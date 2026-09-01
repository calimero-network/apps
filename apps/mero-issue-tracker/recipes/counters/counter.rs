//! RECIPE — CRDT counters (likes / votes). Reference snippet; merge into a
//! service `#[app::state]` + `#[app::logic]`. Not compiled as-is.

use calimero_sdk::app;
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::{Counter, GCounter, PNCounter, UnorderedMap};
// GCounter = Counter<false> (increment-only); PNCounter = Counter<true> (inc + dec).

// ── add to the service state ───────────────────────────────────────────────
// #[app::state]
// pub struct TallyState {
//     // total likes across everything (monotonic)
//     total_likes: GCounter,
//     // net vote score per item (can go up or down)
//     votes: UnorderedMap<String, PNCounter>,
// }
//
// In #[app::init]:
//     total_likes: GCounter::new(),
//     votes: UnorderedMap::new(),

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

    /// Upvote / downvote an item by id. Lazily creates a PNCounter per item.
    pub fn vote(&mut self, item_id: String, up: bool) -> app::Result<i64> {
        let mut counter = self
            .votes
            .get(&item_id)
            .map_err(|e| AppError::msg(format!("votes.get: {e}")))?
            .unwrap_or_default();
        if up {
            counter.increment().map_err(|e| AppError::msg(format!("vote+: {e}")))?;
        } else {
            counter.decrement().map_err(|e| AppError::msg(format!("vote-: {e}")))?;
        }
        let score = counter
            .value_signed()
            .map_err(|e| AppError::msg(format!("vote.value: {e}")))?;
        self.votes
            .insert(item_id, counter)
            .map_err(|e| AppError::msg(format!("votes.insert: {e}")))?;
        Ok(score)
    }

    /// Net score for an item (0 if never voted).
    pub fn score(&self, item_id: String) -> app::Result<i64> {
        match self.votes.get(&item_id).map_err(|e| AppError::msg(format!("votes.get: {e}")))? {
            Some(c) => c.value_signed().map_err(|e| AppError::msg(format!("score: {e}"))),
            None => Ok(0),
        }
    }
}
