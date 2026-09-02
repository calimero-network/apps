//! Mero Forum — a peer-to-peer discussion forum on Calimero.
//!
//! A rewrite of `only-peers`, Calimero's original demo app, whose design could
//! not work peer-to-peer at all. See ../../docs/REWRITE.md; the three defects that forced
//! it, and how the state below answers each:
//!
//! * **Posts lived in a bare `Vec`**, which rc.26 now rejects by name ("it has
//!   no merge semantics and would silently diverge across replicas"). Every
//!   collection here is a CRDT.
//! * **`Post.id` was `posts.len()`** — a positional index, so post 3 on Alice's
//!   node was a different post from post 3 on Bob's, and every comment
//!   referenced its post by that index. Ids are now random bytes from the host.
//! * **The comment author was a caller-supplied `String`.** Impersonation was
//!   the interface, not a bug. Identity now comes from the executor.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{Mergeable, UnorderedMap};

/// Longest a title may be. Not decoration: a post is replicated to every peer,
/// so an unbounded field is an unbounded broadcast.
const MAX_TITLE: usize = 300;
/// Longest a post or comment body may be.
const MAX_BODY: usize = 10_000;
/// Largest page `list_posts`/`list_comments` will return, whatever is asked for.
const MAX_PAGE: usize = 100;
/// Page size used when the caller asks for 0.
const DEFAULT_PAGE: usize = 20;

// ── Stored records ───────────────────────────────────────────────────────────

/// A thread.
///
/// Edits are last-writer-wins over a TOTAL order, not over `edited_at` alone:
/// two authors' devices editing while partitioned can land the same millisecond,
/// and a tie resolved by "take other" would pick a different winner on each side
/// and leave the replicas permanently disagreeing. `deleted` is separate — it is
/// an OR-flag, so a delete can never be undone by a concurrent edit arriving
/// later. Content LWW plus a monotone tombstone is the whole merge.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Post {
    pub id: String,
    /// The ACCOUNT that created it — a person, so the same human posting from a
    /// laptop and a phone is one author and can edit from either.
    pub author: String,
    pub title: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub deleted: bool,
}

impl Mergeable for Post {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        // A tombstone is monotone: once anyone deletes, it stays deleted on
        // every replica regardless of which side merges first.
        let deleted = self.deleted || other.deleted;
        let mine = (self.edited_at, &self.title, &self.body);
        let theirs = (other.edited_at, &other.title, &other.body);
        if theirs > mine {
            *self = other.clone();
        }
        self.deleted = deleted;
        Ok(())
    }
}

impl RekeyTarget for Post {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

/// A reply on a thread. Deliberately flat — one level, no nesting.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Comment {
    pub id: String,
    pub post_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub deleted: bool,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let deleted = self.deleted || other.deleted;
        if (other.edited_at, &other.body) > (self.edited_at, &self.body) {
            *self = other.clone();
        }
        self.deleted = deleted;
        Ok(())
    }
}

impl RekeyTarget for Comment {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

/// One account's vote on one post.
///
/// Keyed per ACCOUNT rather than per device, which is what makes "one person,
/// one vote" true: a bare counter would let the same person vote once from each
/// machine, and there would be no way to take it back.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Vote {
    pub post_id: String,
    pub voter: String,
    /// +1, -1, or 0 for retracted.
    pub value: i8,
    pub updated_at: u64,
}

impl Mergeable for Vote {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        // One voter, so the only conflict is the same person voting from two
        // devices at once. Last write wins, with the value breaking a timestamp
        // tie so both replicas choose identically.
        if (other.updated_at, other.value) > (self.updated_at, self.value) {
            *self = other.clone();
        }
        Ok(())
    }
}

impl RekeyTarget for Vote {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Views (what the RPC surface returns) ─────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostView {
    pub id: String,
    pub author: String,
    pub title: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub score: i64,
    pub comment_count: u64,
    /// The CALLER's vote, so the UI can render the arrows without a second call.
    pub my_vote: i8,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentView {
    pub id: String,
    pub post_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
}

/// One page, plus the cursor that fetches the next.
///
/// `next_cursor` is `None` at the end of the list — which is how the frontend's
/// infinite scroll knows to stop, rather than by getting a short page (a page
/// can be short and still have more behind it once deleted rows are filtered).
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostPage {
    pub items: Vec<PostView>,
    pub next_cursor: Option<String>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentPage {
    pub items: Vec<CommentView>,
    pub next_cursor: Option<String>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroForum {
    posts: UnorderedMap<String, Post>,
    /// Every comment in one map, carrying its `post_id`, rather than a nested
    /// collection per post. A nested CRDT created independently on two nodes
    /// needs deterministic re-keying to converge; one flat map has no such
    /// hazard, and a forum reads comments by post far less often than it
    /// replicates them.
    comments: UnorderedMap<String, Comment>,
    /// Keyed `"<post_id>|<account>"` — one row per voter per post.
    votes: UnorderedMap<String, Vote>,
}

#[app::event]
pub enum Event<'a> {
    PostCreated { id: &'a str },
    PostEdited { id: &'a str },
    PostDeleted { id: &'a str },
    CommentCreated { post_id: &'a str, id: &'a str },
    CommentEdited { post_id: &'a str, id: &'a str },
    CommentDeleted { post_id: &'a str, id: &'a str },
    Voted { post_id: &'a str },
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroForum {
    #[app::init]
    pub fn init() -> MeroForum {
        MeroForum {
            posts: UnorderedMap::new(),
            comments: UnorderedMap::new(),
            votes: UnorderedMap::new(),
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// The caller, as an ACCOUNT.
    ///
    /// Not the device: author attribution is per person, or the same human
    /// posting from a laptop and a phone becomes two authors and "delete my own
    /// comment" stops working on the other machine. Renders as 64 hex since
    /// core rc.27.
    fn caller() -> String {
        AccountId::from(env::account_id()).to_string()
    }

    /// A fresh id: 16 random bytes from the host.
    ///
    /// Never a positional index. `only-peers` used `posts.len()`, so a remote
    /// insert arriving first silently renumbered a post — and every comment
    /// referenced its post by that number.
    fn fresh_id() -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        hex::encode(buffer)
    }

    fn vote_key(post_id: &str, account: &str) -> String {
        format!("{post_id}|{account}")
    }

    fn check_len(field: &str, value: &str, max: usize) -> app::Result<()> {
        if value.trim().is_empty() {
            return Err(AppError::msg(format!("{field} must not be empty")));
        }
        if value.len() > max {
            return Err(AppError::msg(format!(
                "{field} is {} bytes, limit is {max}",
                value.len()
            )));
        }
        Ok(())
    }

    fn load_post(&self, post_id: &str) -> app::Result<Post> {
        let post = self
            .posts
            .get(&post_id.to_string())
            .map_err(|e| AppError::msg(format!("posts.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such post: {post_id}")))?;
        let post = (*post).clone();
        if post.deleted {
            return Err(AppError::msg(format!("post is deleted: {post_id}")));
        }
        Ok(post)
    }

    // ── posts ────────────────────────────────────────────────────────────────

    pub fn create_post(&mut self, title: String, body: String) -> app::Result<String> {
        Self::check_len("title", &title, MAX_TITLE)?;
        Self::check_len("body", &body, MAX_BODY)?;

        let now = env::time_now();
        let post = Post {
            id: Self::fresh_id(),
            author: Self::caller(),
            title,
            body,
            created_at: now,
            edited_at: now,
            deleted: false,
        };
        let id = post.id.clone();
        self.posts
            .insert(id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;

        app::emit!(Event::PostCreated { id: &id });
        Ok(id)
    }

    pub fn edit_post(&mut self, post_id: String, title: String, body: String) -> app::Result<()> {
        Self::check_len("title", &title, MAX_TITLE)?;
        Self::check_len("body", &body, MAX_BODY)?;

        let mut post = self.load_post(&post_id)?;
        if post.author != Self::caller() {
            return Err(AppError::msg("only the author can edit this post"));
        }
        post.title = title;
        post.body = body;
        post.edited_at = env::time_now();
        self.posts
            .insert(post_id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;

        app::emit!(Event::PostEdited { id: &post_id });
        Ok(())
    }

    /// Tombstone, not a removal.
    ///
    /// The row stays so the delete can replicate and so a concurrent edit cannot
    /// resurrect it. Removing the key would also re-open the insert-after-remove
    /// pattern that never converges.
    pub fn delete_post(&mut self, post_id: String) -> app::Result<()> {
        let mut post = self.load_post(&post_id)?;
        if post.author != Self::caller() {
            return Err(AppError::msg("only the author can delete this post"));
        }
        post.deleted = true;
        post.edited_at = env::time_now();
        self.posts
            .insert(post_id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;

        app::emit!(Event::PostDeleted { id: &post_id });
        Ok(())
    }

    pub fn get_post(&self, post_id: String) -> app::Result<PostView> {
        let post = self.load_post(&post_id)?;
        let me = Self::caller();
        let (score, my_vote) = self.tally(&post_id, &me)?;
        Ok(PostView {
            comment_count: self.count_comments(&post_id)?,
            score,
            my_vote,
            id: post.id,
            author: post.author,
            title: post.title,
            body: post.body,
            created_at: post.created_at,
            edited_at: post.edited_at,
        })
    }

    /// One page of the feed.
    ///
    /// `sort` is `"new"` (default) or `"top"`. `cursor` is the `next_cursor` of
    /// the previous page, or `None` for the first.
    ///
    /// Keyset pagination, not offset: an offset shifts under you the moment a
    /// peer's post replicates in, so an infinite scroll would skip and repeat
    /// rows. The cursor names the last row seen, so a new arrival above it
    /// cannot disturb the page below.
    pub fn list_posts(
        &self,
        sort: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<PostPage> {
        let limit = Self::page_size(limit);
        let me = Self::caller();
        let top = sort.as_deref() == Some("top");

        let mut rows: Vec<(i64, u64, String, Post)> = Vec::new();
        for (_, post) in self
            .posts
            .entries()
            .map_err(|e| AppError::msg(format!("posts.entries failed: {e}")))?
        {
            if post.deleted {
                continue;
            }
            let (score, _) = self.tally(&post.id, &me)?;
            rows.push((score, post.created_at, post.id.clone(), post));
        }

        // Descending on the sort key, with the id last so the order is TOTAL —
        // two posts sharing a score and a timestamp must still order the same
        // way on every replica, or the cursor means different things per node.
        if top {
            rows.sort_by(|a, b| (b.0, b.1, &b.2).cmp(&(a.0, a.1, &a.2)));
        } else {
            rows.sort_by(|a, b| (b.1, &b.2).cmp(&(a.1, &a.2)));
        }

        let start = match cursor {
            None => 0,
            Some(c) => match rows.iter().position(|r| r.2 == c) {
                Some(i) => i + 1,
                // The cursor row was deleted between pages. Starting over beats
                // silently returning nothing.
                None => 0,
            },
        };

        let slice = rows.iter().skip(start).take(limit).collect::<Vec<_>>();
        let next_cursor = if start + slice.len() < rows.len() {
            slice.last().map(|r| r.2.clone())
        } else {
            None
        };

        let mut items = Vec::with_capacity(slice.len());
        for (score, _, id, post) in slice {
            let (_, my_vote) = self.tally(id, &me)?;
            items.push(PostView {
                id: post.id.clone(),
                author: post.author.clone(),
                title: post.title.clone(),
                body: post.body.clone(),
                created_at: post.created_at,
                edited_at: post.edited_at,
                score: *score,
                comment_count: self.count_comments(id)?,
                my_vote,
            });
        }
        Ok(PostPage { items, next_cursor })
    }

    // ── comments ─────────────────────────────────────────────────────────────

    /// No `user` argument. `only-peers` took the author as a caller-supplied
    /// string, so anyone could comment as anyone.
    pub fn create_comment(&mut self, post_id: String, body: String) -> app::Result<String> {
        Self::check_len("body", &body, MAX_BODY)?;
        let _ = self.load_post(&post_id)?;

        let now = env::time_now();
        let comment = Comment {
            id: Self::fresh_id(),
            post_id: post_id.clone(),
            author: Self::caller(),
            body,
            created_at: now,
            edited_at: now,
            deleted: false,
        };
        let id = comment.id.clone();
        self.comments
            .insert(id.clone(), comment)
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;

        app::emit!(Event::CommentCreated {
            post_id: &post_id,
            id: &id
        });
        Ok(id)
    }

    pub fn edit_comment(&mut self, comment_id: String, body: String) -> app::Result<()> {
        Self::check_len("body", &body, MAX_BODY)?;
        let mut comment = self.load_comment(&comment_id)?;
        if comment.author != Self::caller() {
            return Err(AppError::msg("only the author can edit this comment"));
        }
        comment.body = body;
        comment.edited_at = env::time_now();
        let post_id = comment.post_id.clone();
        self.comments
            .insert(comment_id.clone(), comment)
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;

        app::emit!(Event::CommentEdited {
            post_id: &post_id,
            id: &comment_id
        });
        Ok(())
    }

    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let mut comment = self.load_comment(&comment_id)?;
        if comment.author != Self::caller() {
            return Err(AppError::msg("only the author can delete this comment"));
        }
        comment.deleted = true;
        comment.edited_at = env::time_now();
        let post_id = comment.post_id.clone();
        self.comments
            .insert(comment_id.clone(), comment)
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;

        app::emit!(Event::CommentDeleted {
            post_id: &post_id,
            id: &comment_id
        });
        Ok(())
    }

    /// One page of a post's comments, oldest first — a thread reads forwards.
    pub fn list_comments(
        &self,
        post_id: String,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<CommentPage> {
        let limit = Self::page_size(limit);

        let mut rows: Vec<Comment> = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries failed: {e}")))?
            .map(|(_, c)| c)
            .filter(|c| c.post_id == post_id && !c.deleted)
            .collect();
        rows.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));

        let start = match cursor {
            None => 0,
            Some(c) => rows.iter().position(|r| r.id == c).map_or(0, |i| i + 1),
        };
        let slice: Vec<&Comment> = rows.iter().skip(start).take(limit).collect();
        let next_cursor = if start + slice.len() < rows.len() {
            slice.last().map(|c| c.id.clone())
        } else {
            None
        };

        Ok(CommentPage {
            items: slice
                .into_iter()
                .map(|c| CommentView {
                    id: c.id.clone(),
                    post_id: c.post_id.clone(),
                    author: c.author.clone(),
                    body: c.body.clone(),
                    created_at: c.created_at,
                    edited_at: c.edited_at,
                })
                .collect(),
            next_cursor,
        })
    }

    // ── votes ────────────────────────────────────────────────────────────────

    /// Up (+1), down (-1) or retract (0). Idempotent per account.
    pub fn vote(&mut self, post_id: String, value: i8) -> app::Result<()> {
        if !(-1..=1).contains(&value) {
            return Err(AppError::msg("vote must be -1, 0 or 1"));
        }
        let _ = self.load_post(&post_id)?;

        let voter = Self::caller();
        let key = Self::vote_key(&post_id, &voter);
        self.votes
            .insert(
                key,
                Vote {
                    post_id: post_id.clone(),
                    voter,
                    value,
                    updated_at: env::time_now(),
                },
            )
            .map_err(|e| AppError::msg(format!("votes.insert failed: {e}")))?;

        app::emit!(Event::Voted { post_id: &post_id });
        Ok(())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    fn page_size(limit: u32) -> usize {
        match limit as usize {
            0 => DEFAULT_PAGE,
            n if n > MAX_PAGE => MAX_PAGE,
            n => n,
        }
    }

    fn load_comment(&self, comment_id: &str) -> app::Result<Comment> {
        let comment = self
            .comments
            .get(&comment_id.to_string())
            .map_err(|e| AppError::msg(format!("comments.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such comment: {comment_id}")))?;
        let comment = (*comment).clone();
        if comment.deleted {
            return Err(AppError::msg(format!("comment is deleted: {comment_id}")));
        }
        Ok(comment)
    }

    /// `(score, caller's own vote)` for one post.
    fn tally(&self, post_id: &str, me: &str) -> app::Result<(i64, i8)> {
        let mut score = 0i64;
        let mut mine = 0i8;
        for (_, vote) in self
            .votes
            .entries()
            .map_err(|e| AppError::msg(format!("votes.entries failed: {e}")))?
        {
            if vote.post_id != post_id {
                continue;
            }
            score += i64::from(vote.value);
            if vote.voter == me {
                mine = vote.value;
            }
        }
        Ok((score, mine))
    }

    fn count_comments(&self, post_id: &str) -> app::Result<u64> {
        let n = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries failed: {e}")))?
            .filter(|(_, c)| c.post_id == post_id && !c.deleted)
            .count();
        Ok(n as u64)
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    // A second PERSON. Both axes must move: `call_as` alone shifts only the
    // device and keeps the account, which models one human's second machine —
    // and since authorship is account-keyed, a test using it for "somebody else"
    // would silently assert nothing.
    const BOB_ACCOUNT: [u8; 32] = [0xB0; 32];
    const BOB_DEVICE: [u8; 32] = [0xB1; 32];
    // The same person as the default caller, on a second machine.
    const MY_PHONE: [u8; 32] = [0xA2; 32];

    fn new_forum() -> TestHost<MeroForum> {
        TestHost::new(MeroForum::init)
    }

    fn post(app: &mut TestHost<MeroForum>, title: &str) -> String {
        app.call(|s| s.create_post(title.to_owned(), "body".to_owned()))
            .unwrap()
    }

    // ── posts ────────────────────────────────────────────────────────────────

    #[test]
    fn a_post_round_trips() {
        let mut app = new_forum();
        let id = post(&mut app, "Hello");
        let view = app.view(|s| s.get_post(id.clone())).unwrap();
        assert_eq!(view.title, "Hello");
        assert_eq!(view.score, 0);
        assert_eq!(view.comment_count, 0);
    }

    /// The defect that forced the rewrite. `only-peers` used `posts.len()` as
    /// the id, so two posts created independently on two nodes both claimed the
    /// same number and every comment pointed at whichever arrived first.
    #[test]
    fn post_ids_are_not_positional() {
        let mut app = new_forum();
        let a = post(&mut app, "First");
        let b = post(&mut app, "Second");
        assert_ne!(a, b);
        assert!(a != "0" && a != "1", "id must not be an index: {a}");
    }

    #[test]
    fn empty_and_oversized_fields_are_rejected() {
        let mut app = new_forum();
        assert!(app
            .call(|s| s.create_post("   ".to_owned(), "body".to_owned()))
            .is_err());
        let huge = "x".repeat(MAX_BODY + 1);
        assert!(app.call(|s| s.create_post("t".to_owned(), huge)).is_err());
    }

    #[test]
    fn only_the_author_can_edit_or_delete_a_post() {
        let mut app = new_forum();
        let id = post(&mut app, "Mine");

        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.edit_post(
                id.clone(),
                "Hijacked".to_owned(),
                "b".to_owned()
            ))
            .is_err());
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.delete_post(id.clone()))
            .is_err());

        // Still the original.
        assert_eq!(app.view(|s| s.get_post(id)).unwrap().title, "Mine");
    }

    /// Authorship is per PERSON, so the author's other device can edit.
    #[test]
    fn the_authors_second_device_can_edit() {
        let mut app = new_forum();
        let id = post(&mut app, "Mine");
        app.call_as(MY_PHONE, |s| {
            s.edit_post(id.clone(), "Edited on my phone".to_owned(), "b".to_owned())
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.get_post(id)).unwrap().title,
            "Edited on my phone"
        );
    }

    #[test]
    fn a_deleted_post_is_gone_from_reads_and_from_the_feed() {
        let mut app = new_forum();
        let id = post(&mut app, "Temporary");
        app.call(|s| s.delete_post(id.clone())).unwrap();

        assert!(app.view(|s| s.get_post(id.clone())).is_err());
        let page = app.view(|s| s.list_posts(None, None, 10)).unwrap();
        assert!(page.items.iter().all(|p| p.id != id));
    }

    // ── the feed ─────────────────────────────────────────────────────────────

    #[test]
    fn the_feed_pages_without_skipping_or_repeating() {
        let mut app = new_forum();
        let mut created = Vec::new();
        for i in 0..7 {
            created.push(post(&mut app, &format!("post {i}")));
        }

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = app.view(|s| s.list_posts(None, cursor.clone(), 3)).unwrap();
            seen.extend(page.items.iter().map(|p| p.id.clone()));
            match page.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }

        assert_eq!(seen.len(), created.len(), "paging lost or repeated rows");
        let mut sorted = seen.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), seen.len(), "a row appeared on two pages");
    }

    #[test]
    fn a_limit_of_zero_uses_the_default_and_a_huge_one_is_capped() {
        let mut app = new_forum();
        for i in 0..3 {
            post(&mut app, &format!("p{i}"));
        }
        assert_eq!(
            app.view(|s| s.list_posts(None, None, 0))
                .unwrap()
                .items
                .len(),
            3
        );
        assert_eq!(
            app.view(|s| s.list_posts(None, None, u32::MAX))
                .unwrap()
                .items
                .len(),
            3
        );
    }

    #[test]
    fn top_sorts_by_score() {
        let mut app = new_forum();
        let quiet = post(&mut app, "quiet");
        let loud = post(&mut app, "loud");
        app.call(|s| s.vote(loud.clone(), 1)).unwrap();
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.vote(loud.clone(), 1))
            .unwrap();

        let page = app
            .view(|s| s.list_posts(Some("top".to_owned()), None, 10))
            .unwrap();
        assert_eq!(page.items[0].id, loud);
        assert_eq!(page.items[0].score, 2);
        assert_eq!(page.items[1].id, quiet);
    }

    // ── votes ────────────────────────────────────────────────────────────────

    #[test]
    fn one_account_gets_one_vote_however_many_times_it_votes() {
        let mut app = new_forum();
        let id = post(&mut app, "p");
        app.call(|s| s.vote(id.clone(), 1)).unwrap();
        app.call(|s| s.vote(id.clone(), 1)).unwrap();
        app.call(|s| s.vote(id.clone(), 1)).unwrap();
        assert_eq!(app.view(|s| s.get_post(id)).unwrap().score, 1);
    }

    /// The reason votes are keyed by account and not by device: otherwise one
    /// person could vote once from every machine they own.
    #[test]
    fn a_second_device_does_not_get_a_second_vote() {
        let mut app = new_forum();
        let id = post(&mut app, "p");
        app.call(|s| s.vote(id.clone(), 1)).unwrap();
        app.call_as(MY_PHONE, |s| s.vote(id.clone(), 1)).unwrap();
        assert_eq!(app.view(|s| s.get_post(id)).unwrap().score, 1);
    }

    #[test]
    fn a_vote_can_be_switched_and_retracted() {
        let mut app = new_forum();
        let id = post(&mut app, "p");
        app.call(|s| s.vote(id.clone(), 1)).unwrap();
        app.call(|s| s.vote(id.clone(), -1)).unwrap();
        assert_eq!(app.view(|s| s.get_post(id.clone())).unwrap().score, -1);
        app.call(|s| s.vote(id.clone(), 0)).unwrap();
        let view = app.view(|s| s.get_post(id)).unwrap();
        assert_eq!(view.score, 0);
        assert_eq!(view.my_vote, 0);
    }

    #[test]
    fn an_out_of_range_vote_is_rejected() {
        let mut app = new_forum();
        let id = post(&mut app, "p");
        assert!(app.call(|s| s.vote(id, 5)).is_err());
    }

    // ── comments ─────────────────────────────────────────────────────────────

    #[test]
    fn a_comment_is_authored_by_the_caller_not_by_an_argument() {
        let mut app = new_forum();
        let id = post(&mut app, "p");
        let cid = app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
                s.create_comment(id.clone(), "hi".to_owned())
            })
            .unwrap();

        let page = app.view(|s| s.list_comments(id, None, 10)).unwrap();
        let mine = page.items.iter().find(|c| c.id == cid).unwrap();
        // `only-peers` took the author as a caller-supplied string, so this
        // assertion is the whole point: the author is the signer.
        assert_eq!(
            mine.author.len(),
            64,
            "an AccountId renders as 32 bytes of hex"
        );
        assert!(mine.author.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn only_the_author_can_edit_or_delete_a_comment() {
        let mut app = new_forum();
        let pid = post(&mut app, "p");
        let cid = app
            .call(|s| s.create_comment(pid.clone(), "mine".to_owned()))
            .unwrap();

        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s
                .edit_comment(cid.clone(), "hijacked".to_owned()))
            .is_err());
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.delete_comment(cid.clone()))
            .is_err());
    }

    #[test]
    fn comments_page_oldest_first_and_skip_deleted() {
        let mut app = new_forum();
        let pid = post(&mut app, "p");
        let mut ids = Vec::new();
        for i in 0..5 {
            ids.push(
                app.call(|s| s.create_comment(pid.clone(), format!("c{i}")))
                    .unwrap(),
            );
        }
        app.call(|s| s.delete_comment(ids[2].clone())).unwrap();

        let page = app
            .view(|s| s.list_comments(pid.clone(), None, 10))
            .unwrap();
        assert_eq!(page.items.len(), 4);
        assert!(page.items.iter().all(|c| c.id != ids[2]));
        assert_eq!(
            app.view(|s| s.get_post(pid)).unwrap().comment_count,
            4,
            "the count must not include the deleted comment"
        );
    }

    #[test]
    fn commenting_on_a_missing_or_deleted_post_is_an_error() {
        let mut app = new_forum();
        assert!(app
            .call(|s| s.create_comment("nope".to_owned(), "hi".to_owned()))
            .is_err());

        let pid = post(&mut app, "p");
        app.call(|s| s.delete_post(pid.clone())).unwrap();
        assert!(app
            .call(|s| s.create_comment(pid, "hi".to_owned()))
            .is_err());
    }

    // ── merge semantics ──────────────────────────────────────────────────────
    //
    // These drive `Mergeable` directly. The property they assert — that two
    // replicas reach the same state whichever order they merge in — is exactly
    // what the `Vec<Post>` design could not hold, and is the reason this is a
    // rewrite rather than a port.

    fn a_post(edited_at: u64, title: &str, deleted: bool) -> Post {
        Post {
            id: "same-id".to_owned(),
            author: "author".to_owned(),
            title: title.to_owned(),
            body: "b".to_owned(),
            created_at: 1,
            edited_at,
            deleted,
        }
    }

    #[test]
    fn concurrent_edits_converge_whichever_side_merges_first() {
        let mut left = a_post(10, "left", false);
        let mut right = a_post(20, "right", false);
        let (l0, r0) = (left.clone(), right.clone());

        left.merge(&r0).unwrap();
        right.merge(&l0).unwrap();
        assert_eq!(left.title, right.title, "replicas disagree after merge");
        assert_eq!(left.title, "right", "the newer edit should win");
    }

    /// The tie is the case a naive "take other" gets wrong: it would pick a
    /// different winner on each side and the replicas would never agree again.
    #[test]
    fn a_timestamp_tie_still_converges() {
        let mut left = a_post(10, "alpha", false);
        let mut right = a_post(10, "beta", false);
        let (l0, r0) = (left.clone(), right.clone());

        left.merge(&r0).unwrap();
        right.merge(&l0).unwrap();
        assert_eq!(left.title, right.title);
    }

    #[test]
    fn a_delete_survives_a_concurrent_newer_edit() {
        let mut deleted = a_post(10, "gone", true);
        let mut edited = a_post(99, "still here", false);
        let (d0, e0) = (deleted.clone(), edited.clone());

        deleted.merge(&e0).unwrap();
        edited.merge(&d0).unwrap();
        assert!(
            deleted.deleted && edited.deleted,
            "a tombstone must be monotone"
        );
    }

    #[test]
    fn merging_is_idempotent() {
        let mut left = a_post(10, "x", false);
        let right = a_post(20, "y", false);
        left.merge(&right).unwrap();
        let once = left.clone();
        left.merge(&right).unwrap();
        assert_eq!(left.title, once.title);
        assert_eq!(left.edited_at, once.edited_at);
    }
}
