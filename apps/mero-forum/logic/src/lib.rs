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
//!
//! # Who may write what — enforced by every node, not by these methods
//!
//! A member can run a patched node that skips every check written here, so the
//! checks only make a refused write fail early. What holds is the storage type:
//!
//! * `posts` and `comments` are `Moderated<IndexedMap>`: an entry is owned by the
//!   account that wrote it, only that account edits or tombstones it, and a
//!   moderator (the founder, then whoever the moderators appoint) may remove it.
//!   The author shown is the entry's owner stamp, never a field in the value.
//! * `votes` and `comment_votes` are `Authored<IndexedMap>`: a vote row is owned
//!   by its voter. A tally counts a key only as the entry of the account the key
//!   names, read by name, so a patched node inventing rows under made-up keys,
//!   or under someone else's key, adds nothing.
//! * `profiles` is `UserStorage`: one slot per account, written only by it.
//!
//! # Keys are per owner (core rc.57)
//!
//! Storage keys an owned entry by its owner AND its key, so two accounts
//! writing one id hold two independent entries, and a key-only `get`,
//! `contains`, `owner_of` or `remove` acts on the CALLER's entry only. Post
//! and comment ids are 16 random bytes, so a second holder of an id only
//! exists if a patched node copied it. Every read by id alone (`get_post`,
//! `create_comment`, `vote`, `list_comments`, the paging cursors) therefore
//! reads the entry of the LOWEST account holding that id, the same pick on
//! every node. A feed row's author is found among its id's holders by the
//! entry's bytes. Editing and deleting act on the caller's own entry, and a
//! moderator's removal removes every holder's entry at the id (`remove_by`).

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use std::collections::BTreeSet;
use std::str::FromStr;

use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Authored, Indexed, IndexedMap, Mergeable, Moderated, StoreError, UserStorage,
};

/// Longest a title may be. Not decoration: a post is replicated to every peer,
/// so an unbounded field is an unbounded broadcast.
const MAX_TITLE: usize = 300;
/// Longest a post or comment body may be.
const MAX_BODY: usize = 10_000;
/// Largest page `list_posts`/`list_comments` will return, whatever is asked for.
const MAX_PAGE: usize = 100;
/// A display name, not a bio. Long enough for a real name, short enough that it
/// cannot be used to smuggle a paragraph into every byline on the page.
const MAX_NICKNAME: usize = 64;
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
/// later. Content LWW plus a monotone tombstone is the whole merge. Only the
/// author writes a post (see `MeroForum::posts`), so these conflicts are
/// between one person's own devices.
///
/// There is no author field: the author is the entry's owner stamp, the one
/// thing a patched node cannot forge. `feed` is the live feed, newest first.
#[app::mergeable(id = "mero_forum::Post")]
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[index(feed(deleted, created_at))]
pub struct Post {
    pub id: String,
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

/// A reply on a thread. Deliberately flat — one level, no nesting. Like a post,
/// its author is the owner stamp. `thread` is one post's live comments, oldest
/// first, so a page and a count are seeks.
#[app::mergeable(id = "mero_forum::Comment")]
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[index(thread(post_id, deleted, created_at))]
pub struct Comment {
    pub id: String,
    pub post_id: String,
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

/// One account's vote on one post.
///
/// Keyed per ACCOUNT rather than per device, which is what makes "one person,
/// one vote" true: a bare counter would let the same person vote once from each
/// machine, and there would be no way to take it back.
///
/// The voter is the row's owner stamp, and the row counts only when its key is
/// `vote_key(post_id, owner)` — see `MeroForum::tally`.
#[app::mergeable(id = "mero_forum::Vote")]
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Vote {
    #[index]
    pub post_id: String,
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

/// One account's vote on one COMMENT.
///
/// A separate type and a separate map from {@link Vote}, rather than widening
/// `Vote` to carry either kind of subject. Two reasons, and the second is the
/// load-bearing one:
///
///   * `Vote.post_id` holding a comment id would be a lie in the field name,
///     and the ABI is a public surface that clients read;
///   * a post's tally reads the `post_id` index; folding comment votes into
///     the same map would put every comment vote into that index too, on a
///     page that never displays one.
#[app::mergeable(id = "mero_forum::CommentVote")]
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentVote {
    #[index]
    pub comment_id: String,
    /// +1, -1, or 0 for retracted.
    pub value: i8,
    pub updated_at: u64,
}

impl Mergeable for CommentVote {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        // Same rule as Vote: one voter, so the only conflict is that person
        // voting from two devices at once. The value breaks a timestamp tie so
        // both replicas choose identically.
        if (other.updated_at, other.value) > (self.updated_at, self.value) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// The display name one ACCOUNT chose for itself.
///
/// ── Why this is in the contract and not just localStorage ────────────────────
///
/// A nickname kept only in the browser is a nickname only its owner can see:
/// every other reader still gets a 64-hex account id, which is the thing the
/// name was supposed to replace. localStorage remains the source for the input
/// (so the field is pre-filled and survives a reload before you ever post), but
/// the value has to reach the contract for anyone else's feed to render it.
///
/// One `UserStorage` slot per ACCOUNT, matching a post's owner stamp — so one
/// person is one name across their laptop and their phone, and only they can
/// write it.
///
/// This is a claim, not an identity. Names are not unique and are not verified;
/// the account id remains the only thing that authorises anything, and every
/// author-gated check below still compares accounts, never names.
#[app::mergeable(id = "mero_forum::Profile")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Profile {
    pub name: String,
    pub updated_at: u64,
}

impl Mergeable for Profile {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        // One owner, so the only conflict is renaming from two devices at once.
        // The name breaks a timestamp tie so both replicas pick the same one.
        if (other.updated_at, &other.name) > (self.updated_at, &self.name) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Views (what the RPC surface returns) ─────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostView {
    pub id: String,
    pub author: String,
    /// The author's chosen name, or "" when they have not set one. Empty is a
    /// real state — someone can post before naming themselves — so the UI falls
    /// back to a short id rather than rendering a blank byline.
    pub author_name: String,
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
    pub author_name: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub score: i64,
    /// The CALLER's vote, so the UI can render the arrows without a second call.
    pub my_vote: i8,
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
    /// Post id → post. Its author edits and tombstones it; a moderator removes
    /// it. The founder is the first moderator.
    posts: Moderated<IndexedMap<String, Post>>,
    /// Every comment in one map, carrying its `post_id`, rather than a nested
    /// collection per post. A nested CRDT created independently on two nodes
    /// needs deterministic re-keying to converge; one flat map has no such
    /// hazard, and the `thread` index makes one post's comments a seek.
    comments: Moderated<IndexedMap<String, Comment>>,
    /// Keyed `"<post_id>|<account>"` — one row per voter per post, owned by the
    /// voter.
    votes: Authored<IndexedMap<String, Vote>>,
    /// Keyed `"<comment_id>|<account>"` — one row per voter per comment.
    comment_votes: Authored<IndexedMap<String, CommentVote>>,
    /// The display name each account chose, in that account's own slot.
    profiles: UserStorage<Profile>,
}

#[app::event]
pub enum Event<'a> {
    PostCreated {
        id: &'a str,
    },
    PostEdited {
        id: &'a str,
    },
    PostDeleted {
        id: &'a str,
    },
    CommentCreated {
        post_id: &'a str,
        id: &'a str,
    },
    CommentEdited {
        post_id: &'a str,
        id: &'a str,
    },
    CommentDeleted {
        post_id: &'a str,
        id: &'a str,
    },
    Voted {
        post_id: &'a str,
    },
    CommentVoted {
        post_id: &'a str,
        comment_id: &'a str,
    },
    ProfileSet {
        account: &'a str,
    },
    ModeratorsChanged {
        count: usize,
    },
}

/// A storage error, named by the call that raised it.
fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what} failed: {e}"))
}

/// The entry at one id of the lowest account holding it: the deterministic
/// pick every node makes when several accounts hold one id.
fn lowest<V>(holders: Vec<(AccountId, V)>) -> Option<(AccountId, V)> {
    holders.into_iter().min_by_key(|(owner, _)| *owner)
}

/// The account, among `holders` of one id, whose entry is `row`.
///
/// Keys are per owner, so an index query hands back rows without saying whose
/// each is. The owner is recovered by matching the row's bytes against every
/// holder's entry at the id; the lowest matching account if two entries are
/// byte-identical.
fn holder_of<V: BorshSerialize>(holders: Vec<(AccountId, V)>, row: &V) -> Option<AccountId> {
    let row = calimero_sdk::borsh::to_vec(row).ok()?;
    holders
        .into_iter()
        .filter(|(_, held)| calimero_sdk::borsh::to_vec(held).is_ok_and(|bytes| bytes == row))
        .map(|(owner, _)| owner)
        .min()
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroForum {
    #[app::init]
    pub fn init() -> MeroForum {
        MeroForum {
            posts: Moderated::new(),
            comments: Moderated::new(),
            votes: Authored::new(),
            comment_votes: Authored::new(),
            profiles: UserStorage::new(),
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

    /// The post at `post_id` of the lowest account holding one, with that
    /// account. A key-only `get` would read the caller's own post only.
    fn post_holder(&self, post_id: &str) -> app::Result<Option<(AccountId, Post)>> {
        Ok(lowest(
            self.posts
                .entries_at(&post_id.to_string())
                .map_err(store_err("posts.entries_at"))?,
        ))
    }

    /// The live post at `post_id`, whoever holds it, with its author.
    fn load_post(&self, post_id: &str) -> app::Result<(AccountId, Post)> {
        let (author, post) = self
            .post_holder(post_id)?
            .ok_or_else(|| AppError::msg(format!("no such post: {post_id}")))?;
        if post.deleted {
            return Err(AppError::msg(format!("post is deleted: {post_id}")));
        }
        Ok((author, post))
    }

    /// The caller's OWN live post at `post_id`, for an edit or a delete. Any
    /// other account's post at the id is a different entry, which the caller
    /// could not change anyway.
    fn load_own_post(&self, post_id: &String, action: &str) -> app::Result<Post> {
        match self.posts.get(post_id).map_err(store_err("posts.get"))? {
            Some(post) if post.deleted => Err(AppError::msg(format!("post is deleted: {post_id}"))),
            Some(post) => Ok(post),
            None => {
                // `NoPost` / `deleted` if that is what it is, else not yours.
                let _ = self.load_post(post_id)?;
                Err(AppError::msg(format!(
                    "only the author can {action} this post"
                )))
            }
        }
    }

    // ── posts ────────────────────────────────────────────────────────────────

    pub fn create_post(&mut self, title: String, body: String) -> app::Result<String> {
        Self::check_len("title", &title, MAX_TITLE)?;
        Self::check_len("body", &body, MAX_BODY)?;

        let now = env::time_now();
        let post = Post {
            id: Self::fresh_id(),
            title,
            body,
            created_at: now,
            edited_at: now,
            deleted: false,
        };
        let id = post.id.clone();
        self.posts
            .insert(id.clone(), post)
            .map_err(store_err("posts.insert"))?;

        app::emit!(Event::PostCreated { id: &id });
        Ok(id)
    }

    pub fn edit_post(&mut self, post_id: String, title: String, body: String) -> app::Result<()> {
        Self::check_len("title", &title, MAX_TITLE)?;
        Self::check_len("body", &body, MAX_BODY)?;

        let _ = self.load_own_post(&post_id, "edit")?;
        let now = env::time_now();
        self.posts
            .modify(&post_id, |post| {
                post.title = title;
                post.body = body;
                post.edited_at = now;
            })
            .map_err(store_err("posts.modify"))?;

        app::emit!(Event::PostEdited { id: &post_id });
        Ok(())
    }

    /// Tombstone, not a removal.
    ///
    /// The row stays so the delete can replicate and so a concurrent edit from
    /// the author's other device cannot resurrect it. Removing the key would
    /// also re-open the insert-after-remove pattern that never converges. A
    /// moderator removes instead: see `moderate_post`.
    pub fn delete_post(&mut self, post_id: String) -> app::Result<()> {
        let _ = self.load_own_post(&post_id, "delete")?;
        let now = env::time_now();
        self.posts
            .modify(&post_id, |post| {
                post.deleted = true;
                post.edited_at = now;
            })
            .map_err(store_err("posts.modify"))?;

        app::emit!(Event::PostDeleted { id: &post_id });
        Ok(())
    }

    pub fn get_post(&self, post_id: String) -> app::Result<PostView> {
        let (author, post) = self.load_post(&post_id)?;
        let me = Self::caller();
        let (score, my_vote) = self.tally(&post_id, &me)?;
        self.post_view(author.to_string(), post, score, my_vote)
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
    ///
    /// `"new"` is a seek on the `feed` index and reads only the page (plus any
    /// posts sharing the cursor's timestamp). `"top"` has to score every live
    /// post: a converging vote count cannot be an index key.
    pub fn list_posts(
        &self,
        sort: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<PostPage> {
        let limit = Self::page_size(limit);
        let me = Self::caller();

        if sort.as_deref() == Some("top") {
            return self.list_top_posts(cursor, limit, &me);
        }

        // Newest first; posts sharing a timestamp come in the index's own total
        // order (by entry id), which every replica shares.
        let rows = match cursor {
            None => self
                .posts
                .query("feed")
                .eq(&false)
                .desc()
                .limit(limit + 1)
                .entries(),
            Some(c) => match self.post_holder(&c)?.map(|(_, post)| post) {
                // Everything at or below the cursor's timestamp; the rows up to
                // and including the cursor are skipped below.
                Some(at) => {
                    let ties = self
                        .posts
                        .query("feed")
                        .eq(&false)
                        .eq(&at.created_at)
                        .count()
                        .map_err(store_err("posts.query"))?;
                    self.posts
                        .query("feed")
                        .eq(&false)
                        .range(..=at.created_at)
                        .desc()
                        .limit(ties + limit + 1)
                        .entries()
                        .map(|rows| {
                            let after = rows.iter().position(|(id, _)| *id == c);
                            rows.into_iter().skip(after.map_or(0, |i| i + 1)).collect()
                        })
                }
                // The cursor row is gone. Starting over beats returning nothing.
                None => self
                    .posts
                    .query("feed")
                    .eq(&false)
                    .desc()
                    .limit(limit + 1)
                    .entries(),
            },
        }
        .map_err(store_err("posts.query"))?;

        let has_more = rows.len() > limit;
        let mut items = Vec::with_capacity(limit);
        for (id, post) in rows.into_iter().take(limit) {
            let (score, my_vote) = self.tally(&id, &me)?;
            let author = self.row_author(&self.posts, &id, &post)?;
            items.push(self.post_view(author, post, score, my_vote)?);
        }
        let next_cursor = if has_more {
            items.last().map(|p| p.id.clone())
        } else {
            None
        };
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
            body,
            created_at: now,
            edited_at: now,
            deleted: false,
        };
        let id = comment.id.clone();
        self.comments
            .insert(id.clone(), comment)
            .map_err(store_err("comments.insert"))?;

        app::emit!(Event::CommentCreated {
            post_id: &post_id,
            id: &id
        });
        Ok(id)
    }

    pub fn edit_comment(&mut self, comment_id: String, body: String) -> app::Result<()> {
        Self::check_len("body", &body, MAX_BODY)?;
        let comment = self.load_own_comment(&comment_id, "edit")?;
        let now = env::time_now();
        self.comments
            .modify(&comment_id, |c| {
                c.body = body;
                c.edited_at = now;
            })
            .map_err(store_err("comments.modify"))?;

        app::emit!(Event::CommentEdited {
            post_id: &comment.post_id,
            id: &comment_id
        });
        Ok(())
    }

    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let comment = self.load_own_comment(&comment_id, "delete")?;
        let now = env::time_now();
        self.comments
            .modify(&comment_id, |c| {
                c.deleted = true;
                c.edited_at = now;
            })
            .map_err(store_err("comments.modify"))?;

        app::emit!(Event::CommentDeleted {
            post_id: &comment.post_id,
            id: &comment_id
        });
        Ok(())
    }

    /// One page of a post's comments, oldest first — a thread reads forwards.
    ///
    /// A seek on the `thread` index: other posts' comments are never read.
    pub fn list_comments(
        &self,
        post_id: String,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<CommentPage> {
        let limit = Self::page_size(limit);

        let thread = |from: Option<u64>, take: usize| {
            let query = self.comments.query("thread").eq(&post_id).eq(&false);
            match from {
                Some(at) => query.range(at..).limit(take).entries(),
                None => query.limit(take).entries(),
            }
        };
        let rows = match cursor {
            None => thread(None, limit + 1),
            Some(c) => match self.comment_holder(&c)?.map(|(_, comment)| comment) {
                Some(at) => {
                    let ties = self
                        .comments
                        .query("thread")
                        .eq(&post_id)
                        .eq(&false)
                        .eq(&at.created_at)
                        .count()
                        .map_err(store_err("comments.query"))?;
                    thread(Some(at.created_at), ties + limit + 1).map(|rows| {
                        let after = rows.iter().position(|(id, _)| *id == c);
                        rows.into_iter().skip(after.map_or(0, |i| i + 1)).collect()
                    })
                }
                None => thread(None, limit + 1),
            },
        }
        .map_err(store_err("comments.query"))?;

        let has_more = rows.len() > limit;
        let me = Self::caller();
        let mut items = Vec::with_capacity(limit);
        for (id, c) in rows.into_iter().take(limit) {
            let (score, my_vote) = self.comment_tally(&id, &me)?;
            let author = self.row_author(&self.comments, &id, &c)?;
            items.push(CommentView {
                author_name: self.name_of(&author),
                author,
                id,
                post_id: c.post_id,
                body: c.body,
                created_at: c.created_at,
                edited_at: c.edited_at,
                score,
                my_vote,
            });
        }
        let next_cursor = if has_more {
            items.last().map(|c| c.id.clone())
        } else {
            None
        };

        Ok(CommentPage { items, next_cursor })
    }

    // ── votes ────────────────────────────────────────────────────────────────

    /// Up (+1), down (-1) or retract (0). Idempotent per account.
    pub fn vote(&mut self, post_id: String, value: i8) -> app::Result<()> {
        if !(-1..=1).contains(&value) {
            return Err(AppError::msg("vote must be -1, 0 or 1"));
        }
        let _ = self.load_post(&post_id)?;

        let key = Self::vote_key(&post_id, &Self::caller());
        let vote = Vote {
            post_id: post_id.clone(),
            value,
            updated_at: env::time_now(),
        };
        // Keys are per owner, so this asks about the caller's own row only:
        // nobody else's row at the key can be in the way.
        if self.votes.contains(&key).map_err(store_err("votes.get"))? {
            self.votes
                .update(&key, vote)
                .map_err(store_err("votes.update"))?;
        } else {
            self.votes
                .insert(key, vote)
                .map_err(store_err("votes.insert"))?;
        }

        app::emit!(Event::Voted { post_id: &post_id });
        Ok(())
    }

    /// Up/down/retract one COMMENT, same contract as {@link vote}: +1, -1, or 0.
    ///
    /// Gated on the comment still existing, which also rejects a vote on a
    /// deleted one — `load_comment` treats a tombstone as absent. Without that
    /// check a vote row could outlive its subject and keep a score alive for
    /// something nobody can read.
    pub fn vote_comment(&mut self, comment_id: String, value: i8) -> app::Result<()> {
        if !(-1..=1).contains(&value) {
            return Err(AppError::msg("vote must be -1, 0 or 1"));
        }
        let comment = self.load_comment(&comment_id)?;

        let key = Self::vote_key(&comment_id, &Self::caller());
        let vote = CommentVote {
            comment_id: comment_id.clone(),
            value,
            updated_at: env::time_now(),
        };
        if self
            .comment_votes
            .contains(&key)
            .map_err(store_err("comment_votes.get"))?
        {
            self.comment_votes
                .update(&key, vote)
                .map_err(store_err("comment_votes.update"))?;
        } else {
            self.comment_votes
                .insert(key, vote)
                .map_err(store_err("comment_votes.insert"))?;
        }

        app::emit!(Event::CommentVoted {
            post_id: &comment.post_id,
            comment_id: &comment_id,
        });
        Ok(())
    }

    /// Claim a display name for the calling ACCOUNT.
    ///
    /// No `account` argument, for the same reason `create_post` takes no author:
    /// a caller-supplied identity is an impersonation hole. You can only name
    /// yourself — and `UserStorage` holds every node to that, not just this one.
    ///
    /// An empty name CLEARS the claim rather than storing a blank, so "I'd
    /// rather be anonymous" is expressible and does not leave a row that
    /// renders as an empty byline.
    pub fn set_nickname(&mut self, name: String) -> app::Result<()> {
        let account = Self::caller();
        let trimmed = name.trim();

        if trimmed.is_empty() {
            let _ = self
                .profiles
                .remove()
                .map_err(store_err("profiles.remove"))?;
            app::emit!(Event::ProfileSet { account: &account });
            return Ok(());
        }

        Self::check_len("nickname", trimmed, MAX_NICKNAME)?;
        let _ = self
            .profiles
            .insert(Profile {
                name: trimmed.to_owned(),
                updated_at: env::time_now(),
            })
            .map_err(store_err("profiles.insert"))?;

        app::emit!(Event::ProfileSet { account: &account });
        Ok(())
    }

    /// The name this account chose, or "" when it has not chosen one.
    pub fn get_nickname(&self, account: String) -> app::Result<String> {
        Ok(self.name_of(&account))
    }

    // ── moderation ───────────────────────────────────────────────────────────

    /// The accounts that may remove any post or comment.
    pub fn moderators(&self) -> app::Result<Vec<String>> {
        Ok(self
            .posts
            .moderators()
            .into_iter()
            .map(|a| a.to_string())
            .collect())
    }

    /// Replace the moderators. Only a current moderator may; every node checks
    /// it as a writer-set rotation.
    pub fn set_moderators(&mut self, accounts: Vec<String>) -> app::Result<()> {
        let mut set = BTreeSet::new();
        for account in &accounts {
            let _ = set.insert(
                AccountId::from_str(account)
                    .map_err(|_| AppError::msg(format!("not an account id: {account}")))?,
            );
        }
        if set.is_empty() {
            return Err(AppError::msg("a forum needs at least one moderator"));
        }
        self.require_moderator()?;
        let count = set.len();
        self.posts
            .set_moderators(set.clone())
            .map_err(store_err("posts.set_moderators"))?;
        self.comments
            .set_moderators(set)
            .map_err(store_err("comments.set_moderators"))?;
        app::emit!(Event::ModeratorsChanged { count });
        Ok(())
    }

    /// Remove someone's post as a moderator: every account's post at the id,
    /// since ids are per owner. The author's own delete is `delete_post`.
    ///
    /// `remove_by`, not `remove`: a key-only `remove` removes only the CALLER's
    /// own entry.
    pub fn moderate_post(&mut self, post_id: String) -> app::Result<()> {
        self.require_moderator()?;
        let holders = self
            .posts
            .entries_at(&post_id)
            .map_err(store_err("posts.entries_at"))?;
        if holders.is_empty() {
            return Err(AppError::msg(format!("no such post: {post_id}")));
        }
        for (owner, _) in holders {
            let _ = self
                .posts
                .remove_by(&owner, &post_id)
                .map_err(store_err("posts.remove_by"))?;
        }
        app::emit!(Event::PostDeleted { id: &post_id });
        Ok(())
    }

    /// Remove someone's comment as a moderator: every account's comment at
    /// the id, as `moderate_post` does.
    pub fn moderate_comment(&mut self, comment_id: String) -> app::Result<()> {
        self.require_moderator()?;
        let holders = self
            .comments
            .entries_at(&comment_id)
            .map_err(store_err("comments.entries_at"))?;
        let Some((_, comment)) = lowest(holders.clone()) else {
            return Err(AppError::msg(format!("no such comment: {comment_id}")));
        };
        for (owner, _) in holders {
            let _ = self
                .comments
                .remove_by(&owner, &comment_id)
                .map_err(store_err("comments.remove_by"))?;
        }
        app::emit!(Event::CommentDeleted {
            post_id: &comment.post_id,
            id: &comment_id
        });
        Ok(())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    /// One account's display name, or "" — the lookup every view goes through.
    fn name_of(&self, account: &str) -> String {
        AccountId::from_str(account)
            .ok()
            .and_then(|a| self.profiles.get_for_user(&a).ok().flatten())
            .map(|p| p.name)
            .unwrap_or_default()
    }

    fn page_size(limit: u32) -> usize {
        match limit as usize {
            0 => DEFAULT_PAGE,
            n if n > MAX_PAGE => MAX_PAGE,
            n => n,
        }
    }

    fn require_moderator(&self) -> app::Result<()> {
        if !self.posts.is_moderator(&AccountId::from(env::account_id())) {
            return Err(AppError::msg("only a moderator can do this"));
        }
        Ok(())
    }

    /// The caller's OWN live comment at `comment_id`; see `load_own_post`.
    fn load_own_comment(&self, comment_id: &String, action: &str) -> app::Result<Comment> {
        match self
            .comments
            .get(comment_id)
            .map_err(store_err("comments.get"))?
        {
            Some(comment) if comment.deleted => {
                Err(AppError::msg(format!("comment is deleted: {comment_id}")))
            }
            Some(comment) => Ok(comment),
            None => {
                let _ = self.load_comment(comment_id)?;
                Err(AppError::msg(format!(
                    "only the author can {action} this comment"
                )))
            }
        }
    }

    /// A row's owner stamp — its real author, whatever the value says — found
    /// among the holders of its id. "" if no holder's entry is the row.
    fn row_author<V>(
        &self,
        rows: &Moderated<IndexedMap<String, V>>,
        id: &String,
        row: &V,
    ) -> app::Result<String>
    where
        V: BorshSerialize + BorshDeserialize + Indexed + 'static,
    {
        let holders = rows.entries_at(id).map_err(store_err("entries_at"))?;
        Ok(holder_of(holders, row)
            .map(|a| a.to_string())
            .unwrap_or_default())
    }

    fn post_view(
        &self,
        author: String,
        post: Post,
        score: i64,
        my_vote: i8,
    ) -> app::Result<PostView> {
        Ok(PostView {
            comment_count: self.count_comments(&post.id)?,
            author_name: self.name_of(&author),
            author,
            score,
            my_vote,
            id: post.id,
            title: post.title,
            body: post.body,
            created_at: post.created_at,
            edited_at: post.edited_at,
        })
    }

    /// `"top"`: every live post scored, highest first, with the id last so the
    /// order is TOTAL — two posts sharing a score and a timestamp must still
    /// order the same way on every replica, or the cursor means different
    /// things per node.
    fn list_top_posts(
        &self,
        cursor: Option<String>,
        limit: usize,
        me: &str,
    ) -> app::Result<PostPage> {
        let mut rows: Vec<(i64, i8, String, Post)> = Vec::new();
        for (id, post) in self
            .posts
            .query("feed")
            .eq(&false)
            .entries()
            .map_err(store_err("posts.query"))?
        {
            let (score, my_vote) = self.tally(&id, me)?;
            let author = self.row_author(&self.posts, &id, &post)?;
            rows.push((score, my_vote, author, post));
        }
        rows.sort_by(|a, b| {
            (b.0, b.3.created_at, &b.3.id, &b.2).cmp(&(a.0, a.3.created_at, &a.3.id, &a.2))
        });

        let start = match cursor {
            None => 0,
            // A missing cursor row was deleted between pages. Starting over
            // beats silently returning nothing.
            Some(c) => rows.iter().position(|r| r.3.id == c).map_or(0, |i| i + 1),
        };
        let has_more = start + limit < rows.len();
        let mut items = Vec::with_capacity(limit);
        for (score, my_vote, author, post) in rows.into_iter().skip(start).take(limit) {
            items.push(self.post_view(author, post, score, my_vote)?);
        }
        let next_cursor = if has_more {
            items.last().map(|p| p.id.clone())
        } else {
            None
        };
        Ok(PostPage { items, next_cursor })
    }

    /// The comment at `comment_id` of the lowest account holding one; see
    /// `post_holder`.
    fn comment_holder(&self, comment_id: &str) -> app::Result<Option<(AccountId, Comment)>> {
        Ok(lowest(
            self.comments
                .entries_at(&comment_id.to_string())
                .map_err(store_err("comments.entries_at"))?,
        ))
    }

    fn load_comment(&self, comment_id: &str) -> app::Result<Comment> {
        let (_, comment) = self
            .comment_holder(comment_id)?
            .ok_or_else(|| AppError::msg(format!("no such comment: {comment_id}")))?;
        if comment.deleted {
            return Err(AppError::msg(format!("comment is deleted: {comment_id}")));
        }
        Ok(comment)
    }

    /// `(score, caller's own vote)` for one comment. Same rule as `tally`.
    fn comment_tally(&self, comment_id: &str, me: &str) -> app::Result<(i64, i8)> {
        let keys = self
            .comment_votes
            .query("comment_id")
            .eq(comment_id)
            .keys()
            .map_err(store_err("comment_votes.query"))?;
        let mut score = 0i64;
        let mut mine = 0i8;
        for (voter, vote) in Self::genuine_votes(&self.comment_votes, comment_id, keys)? {
            if vote.comment_id != comment_id || !(-1..=1).contains(&vote.value) {
                continue;
            }
            score += i64::from(vote.value);
            if voter == me {
                mine = vote.value;
            }
        }
        Ok((score, mine))
    }

    /// `(score, caller's own vote)` for one post, from its rows in the
    /// `post_id` index.
    ///
    /// A key counts once, as the entry of the account `vote_key(post_id, _)`
    /// names, read by name, and only if that is a real vote. A patched node can
    /// write any row it likes under its own stamp, but only one key names it,
    /// so it gets one vote; a row it files under someone else's key is its own
    /// entry there, and is never read.
    fn tally(&self, post_id: &str, me: &str) -> app::Result<(i64, i8)> {
        let keys = self
            .votes
            .query("post_id")
            .eq(post_id)
            .keys()
            .map_err(store_err("votes.query"))?;
        let mut score = 0i64;
        let mut mine = 0i8;
        for (voter, vote) in Self::genuine_votes(&self.votes, post_id, keys)? {
            if vote.post_id != post_id || !(-1..=1).contains(&vote.value) {
                continue;
            }
            score += i64::from(vote.value);
            if voter == me {
                mine = vote.value;
            }
        }
        Ok((score, mine))
    }

    /// Each distinct key among `keys` that is `vote_key(subject, account)`,
    /// with `account`'s OWN entry at it.
    ///
    /// Keys are per owner: one key appears once per account holding it, so a
    /// key is read once, and only as the entry of the account it names.
    fn genuine_votes<V>(
        rows: &Authored<IndexedMap<String, V>>,
        subject: &str,
        keys: Vec<String>,
    ) -> app::Result<Vec<(String, V)>>
    where
        V: BorshSerialize + BorshDeserialize + Indexed + 'static,
    {
        let keys: BTreeSet<String> = keys.into_iter().collect();
        let mut out = Vec::new();
        for key in keys {
            let Some(named) = key
                .strip_prefix(subject)
                .and_then(|rest| rest.strip_prefix('|'))
            else {
                continue;
            };
            let Ok(account) = AccountId::from_str(named) else {
                continue;
            };
            let voter = account.to_string();
            if key != Self::vote_key(subject, &voter) {
                continue;
            }
            if let Some(vote) = rows
                .get_by(&account, &key)
                .map_err(store_err("votes.get_by"))?
            {
                out.push((voter, vote));
            }
        }
        Ok(out)
    }

    fn count_comments(&self, post_id: &str) -> app::Result<u64> {
        let n = self
            .comments
            .query("thread")
            .eq(post_id)
            .eq(&false)
            .count()
            .map_err(store_err("comments.query"))?;
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

    // ── nicknames ────────────────────────────────────────────────────────────

    #[test]
    fn a_name_reaches_every_reader_not_just_its_owner() {
        // The whole reason the name is in the contract rather than localStorage:
        // somebody ELSE has to be able to see it.
        let mut app = new_forum();
        app.call(|s| s.set_nickname("ana".to_owned())).unwrap();
        post(&mut app, "p");

        app.set_account(BOB_ACCOUNT);
        app.set_device(BOB_DEVICE);
        let seen_by_bob = app.view(|s| s.list_posts(None, None, 10)).unwrap();
        assert_eq!(seen_by_bob.items[0].author_name, "ana");
    }

    #[test]
    fn an_unnamed_author_reads_as_empty_not_as_a_blank_row() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        assert_eq!(app.view(|s| s.get_post(p)).unwrap().author_name, "");
    }

    #[test]
    fn a_name_is_per_account_so_both_devices_share_it() {
        // Named on the laptop, posting from the phone: one person, one name.
        let mut app = new_forum();
        app.call(|s| s.set_nickname("ana".to_owned())).unwrap();
        let p = app
            .call_as(MY_PHONE, |s| {
                s.create_post("from the phone".to_owned(), "b".to_owned())
            })
            .unwrap();
        assert_eq!(app.view(|s| s.get_post(p)).unwrap().author_name, "ana");
    }

    #[test]
    fn an_empty_nickname_clears_the_claim() {
        let mut app = new_forum();
        app.call(|s| s.set_nickname("ana".to_owned())).unwrap();
        app.call(|s| s.set_nickname("   ".to_owned())).unwrap();
        let p = post(&mut app, "p");
        assert_eq!(app.view(|s| s.get_post(p)).unwrap().author_name, "");
    }

    #[test]
    fn a_nickname_cannot_be_a_paragraph() {
        let mut app = new_forum();
        assert!(app.call(|s| s.set_nickname("x".repeat(65))).is_err());
    }

    #[test]
    fn a_comment_carries_its_authors_name_too() {
        let mut app = new_forum();
        app.call(|s| s.set_nickname("ana".to_owned())).unwrap();
        let p = post(&mut app, "p");
        comment(&mut app, &p, "hello");
        let page = app.view(|s| s.list_comments(p, None, 10)).unwrap();
        assert_eq!(page.items[0].author_name, "ana");
    }

    // ── comment votes ────────────────────────────────────────────────────────

    fn comment(app: &mut TestHost<MeroForum>, post_id: &str, body: &str) -> String {
        app.call(|s| s.create_comment(post_id.to_owned(), body.to_owned()))
            .unwrap()
    }

    #[test]
    fn a_comment_carries_its_score_and_the_callers_own_vote() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");

        app.call(|s| s.vote_comment(c.clone(), 1)).unwrap();
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.vote_comment(c.clone(), 1))
            .unwrap();

        let page = app.view(|s| s.list_comments(p.clone(), None, 10)).unwrap();
        assert_eq!(page.items[0].score, 2);
        // The view is rendered for whoever asks, so my_vote is the CALLER's.
        assert_eq!(page.items[0].my_vote, 1);
    }

    #[test]
    fn one_account_gets_one_vote_per_comment_however_many_times_it_votes() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");
        app.call(|s| s.vote_comment(c.clone(), 1)).unwrap();
        app.call(|s| s.vote_comment(c.clone(), 1)).unwrap();
        app.call(|s| s.vote_comment(c.clone(), 1)).unwrap();
        let page = app.view(|s| s.list_comments(p, None, 10)).unwrap();
        assert_eq!(page.items[0].score, 1);
    }

    #[test]
    fn voting_zero_retracts_a_comment_vote() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");
        app.call(|s| s.vote_comment(c.clone(), -1)).unwrap();
        assert_eq!(
            app.view(|s| s.list_comments(p.clone(), None, 10))
                .unwrap()
                .items[0]
                .score,
            -1
        );
        app.call(|s| s.vote_comment(c.clone(), 0)).unwrap();
        let page = app.view(|s| s.list_comments(p, None, 10)).unwrap();
        assert_eq!(page.items[0].score, 0);
        assert_eq!(page.items[0].my_vote, 0);
    }

    #[test]
    fn a_comment_vote_must_be_minus_one_zero_or_one() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");
        assert!(app.call(|s| s.vote_comment(c.clone(), 2)).is_err());
        assert!(app.call(|s| s.vote_comment(c, -2)).is_err());
    }

    #[test]
    fn a_deleted_comment_cannot_be_voted_on() {
        // Otherwise a vote row outlives its subject and keeps a score alive for
        // something nobody can read.
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");
        app.call(|s| s.delete_comment(c.clone())).unwrap();
        assert!(app.call(|s| s.vote_comment(c, 1)).is_err());
    }

    #[test]
    fn comment_votes_do_not_leak_into_post_scores() {
        // The two live in separate maps precisely so neither tally sees the
        // other. If they were ever folded into one map, this is what breaks.
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "hello");
        app.call(|s| s.vote_comment(c.clone(), 1)).unwrap();
        assert_eq!(app.view(|s| s.get_post(p.clone())).unwrap().score, 0);

        app.call(|s| s.vote(p.clone(), 1)).unwrap();
        assert_eq!(app.view(|s| s.get_post(p.clone())).unwrap().score, 1);
        let page = app.view(|s| s.list_comments(p, None, 10)).unwrap();
        assert_eq!(page.items[0].score, 1);
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

    // ── what every node enforces ─────────────────────────────────────────────
    //
    // These write straight into the collections, the way a patched node that
    // skips every method check would, and assert that storage still refuses.

    fn founder(app: &TestHost<MeroForum>) -> [u8; 32] {
        let hex = app.view(|s| s.moderators()).unwrap().remove(0);
        hex::decode(hex).unwrap().try_into().unwrap()
    }

    #[test]
    fn another_account_cannot_rewrite_or_remove_a_post_in_storage() {
        let mut app = new_forum();
        let id = post(&mut app, "Mine");

        let rewrite = app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.posts.modify(&id, |p| p.title = "Hijacked".to_owned())
        });
        assert!(rewrite.is_err(), "only the author edits a post");
        let tombstone = app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.posts.modify(&id, |p| p.deleted = true)
        });
        assert!(tombstone.is_err(), "nor can anyone else tombstone it");
        // Keys are per owner: Bob's key-only remove names HIS entry at the id,
        // and he holds none, so it removes nothing.
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.posts.remove(&id))
            .unwrap()
            .is_none());

        let view = app.view(|s| s.get_post(id)).unwrap();
        assert_eq!(view.title, "Mine");
        assert_eq!(view.author, app.view(|_| MeroForum::caller()));
    }

    #[test]
    fn another_account_cannot_rewrite_a_comment_in_storage() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let c = comment(&mut app, &p, "mine");
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
                s.comments.modify(&c, |c| c.body = "hijacked".to_owned())
            })
            .is_err());
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.comments.remove(&c))
            .unwrap()
            .is_none());
        let page = app.view(|s| s.list_comments(p, None, 10)).unwrap();
        assert_eq!(page.items[0].body, "mine");
    }

    /// The ballot-stuffing hole: `tally` used to add up every row whose
    /// `post_id` matched, whatever its key or `voter` field said.
    #[test]
    fn forged_vote_rows_do_not_count() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let me = app.view(|_| MeroForum::caller());

        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            let forged = |value| Vote {
                post_id: p.clone(),
                value,
                updated_at: 1,
            };
            // A row under someone else's key, rows under made-up keys, and an
            // out-of-range value under Bob's own key.
            s.votes
                .insert(MeroForum::vote_key(&p, &me), forged(1))
                .unwrap();
            for i in 0..5 {
                s.votes.insert(format!("{p}|sock{i}"), forged(1)).unwrap();
            }
            let bob = AccountId::from(BOB_ACCOUNT).to_string();
            s.votes
                .insert(MeroForum::vote_key(&p, &bob), forged(100))
                .unwrap();
        });

        let view = app.view(|s| s.get_post(p.clone())).unwrap();
        assert_eq!(view.score, 0, "no forged row counts");
        assert_eq!(view.my_vote, 0, "Bob's row under my key is not my vote");
    }

    #[test]
    fn a_squatted_vote_key_cannot_be_overwritten_by_the_squatter() {
        let mut app = new_forum();
        let p = post(&mut app, "p");
        app.call(|s| s.vote(p.clone(), 1)).unwrap();
        let me = app.view(|_| MeroForum::caller());
        let flip = app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.votes.update(
                &MeroForum::vote_key(&p, &me),
                Vote {
                    post_id: p.clone(),
                    value: -1,
                    updated_at: u64::MAX,
                },
            )
        });
        assert!(flip.is_err(), "a vote row belongs to its voter");
        assert_eq!(app.view(|s| s.get_post(p)).unwrap().score, 1);
    }

    #[test]
    fn a_nickname_slot_is_written_only_by_its_account() {
        let mut app = new_forum();
        app.call(|s| s.set_nickname("ana".to_owned())).unwrap();
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.set_nickname("ana".to_owned())
        })
        .unwrap();
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.set_nickname("   ".to_owned())
        })
        .unwrap();
        let me = app.view(|_| MeroForum::caller());
        assert_eq!(app.view(|s| s.get_nickname(me)).unwrap(), "ana");
    }

    #[test]
    fn the_founder_moderates_and_nobody_else_does_until_appointed() {
        let mut app = new_forum();
        let founder = founder(&app);
        let spam = app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
                s.create_post("spam".to_owned(), "buy now".to_owned())
            })
            .unwrap();
        let reply = app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
                s.create_comment(spam.clone(), "and again".to_owned())
            })
            .unwrap();

        // Bob is not a moderator, so he cannot moderate a post of the founder's.
        let mine = post(&mut app, "mine");
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.moderate_post(mine.clone()))
            .is_err());

        app.call_as_account(founder, founder, |s| s.moderate_comment(reply.clone()))
            .unwrap();
        app.call_as_account(founder, founder, |s| s.moderate_post(spam.clone()))
            .unwrap();
        assert!(app.view(|s| s.get_post(spam)).is_err());
        assert!(app.view(|s| s.get_post(mine.clone())).is_ok());

        // Bob cannot appoint himself; the founder appointing him hands him
        // the power.
        let bob = AccountId::from(BOB_ACCOUNT).to_string();
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s
                .set_moderators(vec![bob.clone()]))
            .is_err());
        app.call_as_account(founder, founder, |s| {
            s.set_moderators(vec![AccountId::from(founder).to_string(), bob.clone()])
        })
        .unwrap();
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.moderate_post(mine.clone()))
            .unwrap();
        assert!(app.view(|s| s.get_post(mine)).is_err());
    }

    /// Keys are per owner, so a patched node can file its own post under an
    /// id someone else already holds. Both entries stand: each feed row names
    /// its real author, a read by id takes the lowest account's, the author
    /// edits only their own, and a moderator removes both.
    #[test]
    fn a_post_id_two_accounts_hold_is_two_posts() {
        let mut app = new_forum();
        let founder = founder(&app);
        let me = app.view(|_| MeroForum::caller());
        let id = post(&mut app, "mine");
        let copy = app.view(|s| s.posts.get(&id).unwrap().unwrap());
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.posts.insert(
                id.clone(),
                Post {
                    title: "bob's".to_owned(),
                    ..copy
                },
            )
        })
        .unwrap();
        assert_eq!(app.view(|s| s.posts.entries_at(&id).unwrap()).len(), 2);

        let bob = AccountId::from(BOB_ACCOUNT).to_string();
        let feed = app.view(|s| s.list_posts(None, None, 10)).unwrap().items;
        let mut rows: Vec<(String, String)> =
            feed.into_iter().map(|p| (p.title, p.author)).collect();
        rows.sort();
        let mut want = vec![
            ("bob's".to_owned(), bob.clone()),
            ("mine".to_owned(), me.clone()),
        ];
        want.sort();
        assert_eq!(rows, want, "each row names its own author");

        let lowest = std::cmp::min(me.clone(), bob.clone());
        let read = app
            .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.get_post(id.clone()))
            .unwrap();
        assert_eq!(read.author, lowest, "the lowest holder, on every node");

        app.call(|s| s.edit_post(id.clone(), "mine, edited".to_owned(), "b".to_owned()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.posts.get_by(&AccountId::from(BOB_ACCOUNT), &id))
                .unwrap()
                .unwrap()
                .title,
            "bob's",
            "an edit reaches only the caller's own entry"
        );

        app.call_as_account(founder, founder, |s| s.moderate_post(id.clone()))
            .unwrap();
        assert!(app.view(|s| s.posts.entries_at(&id).unwrap()).is_empty());
    }

    #[test]
    fn comments_page_across_a_shared_timestamp() {
        // The cursor seek has to skip rows sharing the cursor's timestamp; the
        // mock clock does not advance, so every comment here shares one.
        let mut app = new_forum();
        let p = post(&mut app, "p");
        let mut made = Vec::new();
        for i in 0..5 {
            made.push(comment(&mut app, &p, &format!("c{i}")));
        }
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = app
                .view(|s| s.list_comments(p.clone(), cursor.clone(), 2))
                .unwrap();
            seen.extend(page.items.iter().map(|c| c.id.clone()));
            match page.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        seen.sort();
        made.sort();
        assert_eq!(seen, made);
    }
}
