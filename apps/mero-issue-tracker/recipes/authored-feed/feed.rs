//! RECIPE — append-ordered, author-owned feed using `AuthoredVector<T>`.
//! Reference snippet; merge the field into a service `#[app::state]` and the
//! methods into its `#[app::logic]` impl. Not compiled as-is.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::AuthoredVector;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;
use calimero_storage::env as storage_env;

// `Default` is what `tombstone` overwrites an entry with: an empty post.
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Post {
    pub text: String,
    pub created_ms: u64,
    pub edited: bool,
}

// AuthoredVector<Post> requires Post: Mergeable. Author-conflict handling lives
// in AuthoredVector itself; this value-merge is a deterministic LWW tiebreak
// (edited wins, then longer text) and is not hit on the normal write path.
impl Mergeable for Post {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.edited, other.text.len()) > (self.edited, self.text.len()) {
            self.text = other.text.clone();
            self.edited = other.edited;
        }
        Ok(())
    }
}

/// One feed row as the UI renders it. `author` is read from the entry's owner
/// stamp, which a patched node cannot forge — never from a field in `Post`.
#[derive(Debug, Clone, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FeedEntry {
    pub index: usize,
    pub author: String,
    pub post: Post,
}

// ── add to the service state ───────────────────────────────────────────────
// #[app::state(emits = ...)]
// pub struct FeedState {
//     posts: AuthoredVector<Post>,
//     // ...other fields
// }
//
// In #[app::init]:
//     posts: AuthoredVector::new_with_field_name("feed:posts"),

// ── methods on the #[app::logic] impl ──────────────────────────────────────
impl FeedState {
    /// Append a post. The caller is recorded as the entry's author, so only
    /// they can later edit/delete it. Returns the new entry index.
    pub fn post(&mut self, text: String) -> app::Result<usize> {
        if text.is_empty() || text.len() > 4096 {
            app::bail!(AppError::msg("post must be 1-4096 bytes"));
        }
        let _ = self
            .posts
            .push(Post { text, created_ms: storage_env::time_now(), edited: false })
            .map_err(|e| AppError::msg(format!("posts.push: {e}")))?;
        // `push` returns the entry's id; its position is the last slot.
        let len = self.feed_len()?;
        Ok(len - 1)
    }

    /// Edit your own post. AuthoredVector::update rejects non-authors with
    /// ActionNotAllowed (surface it as a friendly error in real code).
    pub fn edit_post(&mut self, index: usize, text: String) -> app::Result<()> {
        let mut post = self
            .posts
            .get(index)
            .map_err(|e| AppError::msg(format!("posts.get: {e}")))?
            .ok_or_else(|| AppError::msg("post not found"))?;
        post.text = text;
        post.edited = true;
        self.posts
            .update(index, post)
            .map_err(|e| AppError::msg(format!("posts.update: {e}")))?;
        Ok(())
    }

    /// Remove your own post (author-only; leaves a tombstone, preserving order).
    pub fn delete_post(&mut self, index: usize) -> app::Result<()> {
        self.posts
            .tombstone(index)
            .map_err(|e| AppError::msg(format!("posts.tombstone: {e}")))?;
        Ok(())
    }

    /// Read the feed in insertion order (paginated), each post paired with
    /// its author via `owner_of`. Reads only the requested slots, and skips
    /// tombstones (an empty post).
    pub fn get_feed(&self, offset: usize, limit: usize) -> app::Result<Vec<FeedEntry>> {
        let len = self.feed_len()?;
        let mut page = Vec::with_capacity(limit.min(len));
        for index in offset..(offset.saturating_add(limit)).min(len) {
            let Some(post) = self
                .posts
                .get(index)
                .map_err(|e| AppError::msg(format!("posts.get: {e}")))?
            else {
                continue;
            };
            if post.text.is_empty() {
                continue;
            }
            let author = self
                .posts
                .owner_of(index)
                .map_err(|e| AppError::msg(format!("posts.owner_of: {e}")))?
                .map(|a| a.to_string())
                .unwrap_or_default();
            page.push(FeedEntry { index, author, post });
        }
        Ok(page)
    }

    pub fn feed_len(&self) -> app::Result<usize> {
        self.posts.len().map_err(|e| AppError::msg(format!("posts.len: {e}")))
    }
}
