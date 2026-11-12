//! Mero Forum: a discussion forum (threads, flat comments, one vote per account,
//! display names, moderators) on core's component SDK (`calimero-sdk`).
//!
//! One app instance is one forum. The app runs on its cluster's leader, which
//! applies every write in one replicated log, so the state is plain tables and
//! maps: v1's CRDT plumbing (hand-written `Mergeable` rules, tombstones that a
//! concurrent edit could not resurrect, per-owner storage keys and the
//! "lowest holder" pick across them) has nothing left to decide.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Moderated<IndexedMap<String, Post>>`, `#[index(feed(deleted, created_at))]`, author = owner stamp | `posts` table, `author` a field; `feed` index (newest first) and `top` index (`score`, then newest) |
//! | `Moderated<IndexedMap<String, Comment>>`, `#[index(thread(post_id, deleted, created_at))]` | `comments` table, `author` a field; `thread` index; a maintained `perPost` count |
//! | `Authored<IndexedMap<String, Vote>>` keyed `"{post}\|{account}"`, tallied by a scan | `votes: UnorderedMap<(post, account), i8>`, and the post's `score` kept on the record |
//! | `Authored<IndexedMap<String, CommentVote>>` | `commentVotes: UnorderedMap<(comment, account), i8>`, the comment's `score` on its record |
//! | `UserStorage<Profile>` | `profiles: PerUser<String>` |
//! | `Moderated`'s writer set (the founder, then whoever the moderators appoint) | `moderators: Set<String>`, the app's owner at `init` |
//!
//! # Who may do what
//!
//! The organization decides who reaches the forum: its owner, admins, members
//! and guests (in v1, every member of the context). Every one of them may read,
//! post, comment, vote and name themselves. The rules v1 kept in storage
//! (`Moderated`, `Authored`, `UserStorage`) are checks here, in the method,
//! against `env::caller()`, before anything is written:
//!
//! - only a post's or comment's `author` may edit or delete it: anyone else gets
//!   `Forbidden`;
//! - only a moderator may `moderatePost`, `moderateComment` or `setModerators`:
//!   anyone else gets `Forbidden`;
//! - a vote and a display name are always the caller's own: no method takes the
//!   account it writes for.
//!
//! Every write goes through a method, so there is no "patched node" to defend
//! against: v1's forged-write tests are the same calls made as another account.
//!
//! Everything a client sees differently from v1 (camelCase names, 64-bit
//! integers as decimal strings, the error shape, opaque cursors, a delete that
//! removes) is in `apps/mero-forum/README.md`, "What changed in the port".

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;
use serde::Serialize;

/// Longest a title may be, in bytes.
pub const MAX_TITLE: usize = 300;
/// Longest a post or comment body may be, in bytes.
pub const MAX_BODY: usize = 10_000;
/// A display name, not a bio, in bytes (after trimming).
pub const MAX_NICKNAME: usize = 64;
/// Largest page `listPosts` / `listComments` return, whatever is asked for.
pub const MAX_PAGE: u32 = 100;
/// Page size used when the caller asks for 0.
pub const DEFAULT_PAGE: u32 = 20;
/// Rows read per batch when a delete removes what hangs off a post or comment.
const BATCH: u32 = 1000;

// ── stored records ───────────────────────────────────────────────────────────

/// A thread. `score` is the sum of its votes, kept here so `top` is an index.
#[derive(Record)]
#[table(
    key = "id",
    index(feed = ["created_at"]),
    index(top = ["score", "created_at"]),
)]
pub struct Post {
    /// 32 hex characters (16 random bytes of the run).
    pub id: String,
    /// The writer's account. Only they may edit or delete the post.
    pub author: String,
    pub title: String,
    pub body: String,
    /// Unix milliseconds (the log entry's time).
    pub created_at: u64,
    /// Unix milliseconds of the last edit; `created_at` until then.
    pub edited_at: u64,
    pub score: i64,
}

/// A reply on a thread: flat, one level. `score` is the sum of its votes.
#[derive(Record)]
#[table(
    key = "id",
    index(thread = ["post_id", "created_at"]),
    count(per_post = ["post_id"]),
)]
pub struct Comment {
    /// 32 hex characters.
    pub id: String,
    pub post_id: String,
    /// The writer's account. Only they may edit or delete the comment.
    pub author: String,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Unix milliseconds of the last edit; `created_at` until then.
    pub edited_at: u64,
    pub score: i64,
}

// ── results ──────────────────────────────────────────────────────────────────

/// A post as callers see it.
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PostView {
    pub id: String,
    pub author: String,
    /// The author's chosen name, or "" when they have not set one.
    pub author_name: String,
    pub title: String,
    pub body: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub edited_at: u64,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::i64_str")]
    pub score: i64,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub comment_count: u64,
    /// The CALLER's vote (-1, 0 or 1), so the arrows render without a second call.
    pub my_vote: i8,
}

/// A comment as callers see it.
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct CommentView {
    pub id: String,
    pub post_id: String,
    pub author: String,
    pub author_name: String,
    pub body: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub edited_at: u64,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::i64_str")]
    pub score: i64,
    /// The CALLER's vote (-1, 0 or 1).
    pub my_vote: i8,
}

/// One page of the feed, and the cursor of the next (`null` at the end).
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PostPage {
    pub items: Vec<PostView>,
    pub next_cursor: Option<String>,
}

/// One page of a thread, and the cursor of the next (`null` at the end).
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct CommentPage {
    pub items: Vec<CommentView>,
    pub next_cursor: Option<String>,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The forum.
#[app::state(version = 1)]
pub struct MeroForum {
    posts: Table<Post>,
    comments: Table<Comment>,
    /// `(postId, account)` → that account's vote on that post (-1 or 1).
    votes: UnorderedMap<(String, String), i8>,
    /// `(commentId, account)` → that account's vote on that comment (-1 or 1).
    comment_votes: UnorderedMap<(String, String), i8>,
    /// Each account's chosen display name, written only by that account.
    profiles: PerUser<String>,
    /// The accounts that may remove any post or comment and appoint moderators.
    moderators: Set<String>,
}

#[app::logic]
impl MeroForum {
    /// The empty forum. The node runs it once, when the app is created; its
    /// owner (v1's founder) is the first moderator.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut forum = Self::load();
        let _new = forum.moderators.insert(&env::app_owner())?;
        Ok(forum)
    }

    // ── posts ────────────────────────────────────────────────────────────────

    /// Starts a thread written by the caller and returns its id. `title` (at
    /// most 300 bytes) and `body` (at most 10,000) must not be blank, else
    /// `Invalid`. Emits `PostCreated`.
    pub fn create_post(&mut self, title: String, body: String) -> app::Result<String> {
        let author = account()?;
        check_len("title", &title, MAX_TITLE)?;
        check_len("body", &body, MAX_BODY)?;
        let now = env::time_now();
        let id = fresh_id();
        self.posts.insert(Post {
            id: id.clone(),
            author,
            title,
            body,
            created_at: now,
            edited_at: now,
            score: 0,
        })?;
        env::emit(Event::PostCreated { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Replaces a post's title and body. Only its author may (`Forbidden`);
    /// `NotFound` for a missing post. Emits `PostEdited`.
    pub fn edit_post(&mut self, post_id: String, title: String, body: String) -> app::Result<()> {
        check_len("title", &title, MAX_TITLE)?;
        check_len("body", &body, MAX_BODY)?;
        self.own_post(&post_id, "edit")?;
        let now = env::time_now();
        let _ = self.posts.update(&post_id, |p| {
            p.title = title;
            p.body = body;
            p.edited_at = now;
        })?;
        env::emit(Event::PostEdited { id: post_id }, Audience::All)?;
        Ok(())
    }

    /// Deletes the caller's own post, with its comments and every vote on them.
    /// Only its author may (`Forbidden`; a moderator uses `moderatePost`).
    /// Emits `PostDeleted`.
    pub fn delete_post(&mut self, post_id: String) -> app::Result<()> {
        self.own_post(&post_id, "delete")?;
        self.remove_post(&post_id)?;
        env::emit(Event::PostDeleted { id: post_id }, Audience::All)?;
        Ok(())
    }

    /// One post with its score, comment count and the caller's vote.
    /// `NotFound` for a missing (or deleted) post.
    #[app::view]
    pub fn get_post(&self, post_id: String) -> app::Result<PostView> {
        let post = self.require_post(&post_id)?;
        let me = account()?;
        self.post_view(post, &me)
    }

    /// One page of the feed. `sort` is `"new"` (default: newest first) or
    /// `"top"` (highest score first, then newest). `cursor` is the previous
    /// page's `nextCursor` (opaque, and only good for the same sort), `null` for
    /// the first page. `limit` 0 means 20; more than 100 means 100.
    #[app::view]
    pub fn list_posts(
        &self,
        sort: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<PostPage> {
        let index = match sort.as_deref() {
            None | Some("new") => "feed",
            Some("top") => "top",
            Some(other) => {
                return Err(invalid(format!(
                    "sort must be \"new\" or \"top\", not {other:?}"
                )))
            }
        };
        let page = self
            .posts
            .find(index, &[], page_opts(cursor, limit, true))?;
        let me = account()?;
        let items = page
            .items
            .into_iter()
            .map(|p| self.post_view(p, &me))
            .collect::<app::Result<_>>()?;
        Ok(PostPage {
            items,
            next_cursor: page.next,
        })
    }

    // ── comments ─────────────────────────────────────────────────────────────

    /// Replies to a post as the caller and returns the comment's id. `body` must
    /// not be blank (at most 10,000 bytes); `NotFound` for a missing post.
    /// Emits `CommentCreated`.
    pub fn create_comment(&mut self, post_id: String, body: String) -> app::Result<String> {
        let author = account()?;
        check_len("body", &body, MAX_BODY)?;
        self.require_post(&post_id)?;
        let now = env::time_now();
        let id = fresh_id();
        self.comments.insert(Comment {
            id: id.clone(),
            post_id: post_id.clone(),
            author,
            body,
            created_at: now,
            edited_at: now,
            score: 0,
        })?;
        env::emit(
            Event::CommentCreated {
                post_id,
                id: id.clone(),
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Replaces a comment's body. Only its author may (`Forbidden`). Emits
    /// `CommentEdited`.
    pub fn edit_comment(&mut self, comment_id: String, body: String) -> app::Result<()> {
        check_len("body", &body, MAX_BODY)?;
        let comment = self.own_comment(&comment_id, "edit")?;
        let now = env::time_now();
        let _ = self.comments.update(&comment_id, |c| {
            c.body = body;
            c.edited_at = now;
        })?;
        env::emit(
            Event::CommentEdited {
                post_id: comment.post_id,
                id: comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Deletes the caller's own comment and its votes. Only its author may
    /// (`Forbidden`; a moderator uses `moderateComment`). Emits `CommentDeleted`.
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let comment = self.own_comment(&comment_id, "delete")?;
        self.remove_comment(&comment_id)?;
        env::emit(
            Event::CommentDeleted {
                post_id: comment.post_id,
                id: comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// One page of a post's comments, oldest first. `cursor` is the previous
    /// page's `nextCursor`, `null` for the first; `limit` as in `listPosts`. A
    /// post with no comments (or none at all) is an empty page.
    #[app::view]
    pub fn list_comments(
        &self,
        post_id: String,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<CommentPage> {
        let page = self.comments.find(
            "thread",
            &[KeyPart::Str(post_id)],
            page_opts(cursor, limit, false),
        )?;
        let me = account()?;
        let items = page
            .items
            .into_iter()
            .map(|c| self.comment_view(c, &me))
            .collect::<app::Result<_>>()?;
        Ok(CommentPage {
            items,
            next_cursor: page.next,
        })
    }

    // ── votes ────────────────────────────────────────────────────────────────

    /// The caller's vote on a post: up (1), down (-1) or retract (0); anything
    /// else is `Invalid`. One per account: voting again replaces it. `NotFound`
    /// for a missing post. Emits `Voted`.
    pub fn vote(&mut self, post_id: String, value: i8) -> app::Result<()> {
        check_vote(value)?;
        let me = account()?;
        self.require_post(&post_id)?;
        let delta = swap_vote(&mut self.votes, (post_id.clone(), me), value)?;
        if delta != 0 {
            let _ = self.posts.update(&post_id, |p| p.score += delta)?;
        }
        env::emit(Event::Voted { post_id }, Audience::All)?;
        Ok(())
    }

    /// The caller's vote on a comment, as `vote` for a post. `NotFound` for a
    /// missing comment. Emits `CommentVoted`.
    pub fn vote_comment(&mut self, comment_id: String, value: i8) -> app::Result<()> {
        check_vote(value)?;
        let me = account()?;
        let comment = self.require_comment(&comment_id)?;
        let delta = swap_vote(&mut self.comment_votes, (comment_id.clone(), me), value)?;
        if delta != 0 {
            let _ = self.comments.update(&comment_id, |c| c.score += delta)?;
        }
        env::emit(
            Event::CommentVoted {
                post_id: comment.post_id,
                comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── names ────────────────────────────────────────────────────────────────

    /// Claims a display name for the CALLER (trimmed, at most 64 bytes, else
    /// `Invalid`); an empty name clears it. Names are not unique and authorise
    /// nothing. Emits `ProfileSet`.
    pub fn set_nickname(&mut self, name: String) -> app::Result<()> {
        let account = account()?;
        let trimmed = name.trim();
        if trimmed.is_empty() {
            let _old = self.profiles.remove()?;
        } else {
            if trimmed.len() > MAX_NICKNAME {
                return Err(invalid(format!(
                    "nickname is {} bytes, limit is {MAX_NICKNAME}",
                    trimmed.len()
                )));
            }
            let _ = self.profiles.set(&trimmed.to_owned())?;
        }
        env::emit(Event::ProfileSet { account }, Audience::All)?;
        Ok(())
    }

    /// The name `account` chose, or "" when it has not chosen one.
    #[app::view]
    pub fn get_nickname(&self, account: String) -> app::Result<String> {
        self.name_of(&account)
    }

    // ── moderation ───────────────────────────────────────────────────────────

    /// The accounts that may remove any post or comment, in key order.
    #[app::view]
    pub fn moderators(&self) -> app::Result<Vec<String>> {
        Ok(self
            .moderators
            .page(FindOpts::default().limit(BATCH))?
            .items)
    }

    /// Replaces the moderators. Only a moderator may (`Forbidden`). Every
    /// account must be the forum's owner or in its organization, and the list
    /// must not be empty (`Invalid`). Emits `ModeratorsChanged`.
    pub fn set_moderators(&mut self, accounts: Vec<String>) -> app::Result<()> {
        let mut set: Vec<String> = Vec::with_capacity(accounts.len());
        for account in accounts {
            if account != env::app_owner() && env::org_role(&account).is_none() {
                return Err(invalid(format!("not an account of this forum: {account}")));
            }
            if !set.contains(&account) {
                set.push(account);
            }
        }
        if set.is_empty() {
            return Err(invalid("a forum needs at least one moderator"));
        }
        if set.len() > BATCH as usize {
            return Err(invalid(format!("at most {BATCH} moderators")));
        }
        self.require_moderator()?;
        let _removed = self.moderators.clear()?;
        for account in &set {
            let _new = self.moderators.insert(account)?;
        }
        env::emit(
            Event::ModeratorsChanged {
                count: set.len() as u64,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Removes anyone's post as a moderator, with its comments and votes
    /// (`Forbidden` for anyone else). Emits `PostDeleted`.
    pub fn moderate_post(&mut self, post_id: String) -> app::Result<()> {
        self.require_moderator()?;
        self.require_post(&post_id)?;
        self.remove_post(&post_id)?;
        env::emit(Event::PostDeleted { id: post_id }, Audience::All)?;
        Ok(())
    }

    /// Removes anyone's comment as a moderator, with its votes (`Forbidden` for
    /// anyone else). Emits `CommentDeleted`.
    pub fn moderate_comment(&mut self, comment_id: String) -> app::Result<()> {
        self.require_moderator()?;
        let comment = self.require_comment(&comment_id)?;
        self.remove_comment(&comment_id)?;
        env::emit(
            Event::CommentDeleted {
                post_id: comment.post_id,
                id: comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    fn require_post(&self, post_id: &str) -> app::Result<Post> {
        self.posts
            .get(post_id)?
            .ok_or_else(|| not_found("post", post_id))
    }

    fn require_comment(&self, comment_id: &str) -> app::Result<Comment> {
        self.comments
            .get(comment_id)?
            .ok_or_else(|| not_found("comment", comment_id))
    }

    fn own_post(&self, post_id: &str, action: &str) -> app::Result<Post> {
        let post = self.require_post(post_id)?;
        if post.author != account()? {
            return Err(forbidden(format!("only the author can {action} this post")));
        }
        Ok(post)
    }

    fn own_comment(&self, comment_id: &str, action: &str) -> app::Result<Comment> {
        let comment = self.require_comment(comment_id)?;
        if comment.author != account()? {
            return Err(forbidden(format!(
                "only the author can {action} this comment"
            )));
        }
        Ok(comment)
    }

    fn require_moderator(&self) -> app::Result<()> {
        if !self.moderators.contains(&account()?)? {
            return Err(forbidden("only a moderator can do this"));
        }
        Ok(())
    }

    /// The post, its comments (and their votes) and its votes.
    fn remove_post(&mut self, post_id: &str) -> app::Result<()> {
        // Collect a batch, then remove it: never mutate under a cursor.
        loop {
            let page = self.comments.find(
                "thread",
                &[KeyPart::Str(post_id.to_owned())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for comment in page.items {
                self.remove_comment(&comment.id)?;
            }
        }
        clear_votes(&mut self.votes, post_id)?;
        let _ = self.posts.remove(post_id)?;
        Ok(())
    }

    /// The comment and its votes.
    fn remove_comment(&mut self, comment_id: &str) -> app::Result<()> {
        clear_votes(&mut self.comment_votes, comment_id)?;
        let _ = self.comments.remove(comment_id)?;
        Ok(())
    }

    fn name_of(&self, account: &str) -> app::Result<String> {
        Ok(self.profiles.get_for(account)?.unwrap_or_default())
    }

    fn post_view(&self, post: Post, me: &str) -> app::Result<PostView> {
        let my_vote = self
            .votes
            .get(&(post.id.clone(), me.to_owned()))?
            .unwrap_or(0);
        Ok(PostView {
            comment_count: self
                .comments
                .count("perPost", &[KeyPart::Str(post.id.clone())])?,
            author_name: self.name_of(&post.author)?,
            my_vote,
            id: post.id,
            author: post.author,
            title: post.title,
            body: post.body,
            created_at: post.created_at,
            edited_at: post.edited_at,
            score: post.score,
        })
    }

    fn comment_view(&self, comment: Comment, me: &str) -> app::Result<CommentView> {
        let my_vote = self
            .comment_votes
            .get(&(comment.id.clone(), me.to_owned()))?
            .unwrap_or(0);
        Ok(CommentView {
            author_name: self.name_of(&comment.author)?,
            my_vote,
            id: comment.id,
            post_id: comment.post_id,
            author: comment.author,
            body: comment.body,
            created_at: comment.created_at,
            edited_at: comment.edited_at,
            score: comment.score,
        })
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No post or comment (`what`) has this id, or it was deleted.
    NotFound { what: String, id: String },
    /// The caller may not do this (not the author, not a moderator).
    Forbidden { message: String },
    /// An argument is out of range: blank, too long, an unknown sort, a vote
    /// other than -1/0/1, an account outside the forum.
    Invalid { message: String },
}

/// A change to the forum, emitted after the write that caused it, to everyone
/// the forum reaches (guests included: every event carries ids only).
#[app::event]
pub enum Event {
    PostCreated {
        id: String,
    },
    PostEdited {
        id: String,
    },
    /// The author deleted the post, or a moderator removed it.
    PostDeleted {
        id: String,
    },
    CommentCreated {
        post_id: String,
        id: String,
    },
    CommentEdited {
        post_id: String,
        id: String,
    },
    /// The author deleted the comment, or a moderator removed it.
    CommentDeleted {
        post_id: String,
        id: String,
    },
    Voted {
        post_id: String,
    },
    CommentVoted {
        post_id: String,
        comment_id: String,
    },
    ProfileSet {
        account: String,
    },
    ModeratorsChanged {
        count: u64,
    },
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anything that is not one.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// 16 random bytes of the run, as 32 hex characters (v1's id shape).
fn fresh_id() -> String {
    env::random_bytes(16)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn not_found(what: &str, id: &str) -> AppError {
    Error::NotFound {
        what: what.to_owned(),
        id: id.to_owned(),
    }
    .into()
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn check_len(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    if value.len() > max {
        return Err(invalid(format!(
            "{field} is {} bytes, limit is {max}",
            value.len()
        )));
    }
    Ok(())
}

fn check_vote(value: i8) -> app::Result<()> {
    if (-1..=1).contains(&value) {
        Ok(())
    } else {
        Err(invalid("vote must be -1, 0 or 1"))
    }
}

/// One page from `cursor`: `limit` 0 is the default page, anything over the
/// cap is the cap. The feed reads newest first, a thread oldest first.
fn page_opts(cursor: Option<String>, limit: u32, newest_first: bool) -> FindOpts {
    let limit = match limit {
        0 => DEFAULT_PAGE,
        n => n.min(MAX_PAGE),
    };
    let mut opts = FindOpts::default().limit(limit);
    if newest_first {
        opts = opts.reverse();
    }
    match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    }
}

/// Records `value` as the vote at `key` (0 removes it) and answers how the
/// subject's score moves.
fn swap_vote(
    votes: &mut UnorderedMap<(String, String), i8>,
    key: (String, String),
    value: i8,
) -> app::Result<i64> {
    let old = if value == 0 {
        votes.remove(&key)?
    } else {
        votes.insert(&key, &value)?
    };
    Ok(i64::from(value) - i64::from(old.unwrap_or(0)))
}

/// Every vote on one subject.
fn clear_votes(votes: &mut UnorderedMap<(String, String), i8>, subject: &str) -> app::Result<()> {
    loop {
        let page = votes.prefix(
            &[KeyPart::Str(subject.to_owned())],
            FindOpts::default().limit(BATCH),
        )?;
        if page.items.is_empty() {
            return Ok(());
        }
        for (key, _) in page.items {
            let _ = votes.remove(&key)?;
        }
    }
}
