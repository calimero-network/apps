//! Mero Chat: one conversation (a channel or a DM) with threads, reactions,
//! mentions, attachments, profiles, drafts, read receipts and moderation, on
//! core's component SDK (`calimero-sdk`).
//!
//! One app instance is one conversation. The app runs on its cluster's leader,
//! which applies every write in one replicated log, so the state is plain
//! collections: v1's CRDT plumbing (hand-written `Mergeable` rules, owner
//! stamps, writer sets rotated after every role change, the "lowest holder"
//! pick across per-owner keys) has nothing left to decide.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Frozen<Founding>` | `founding: Cell<Founding>`, written once by `init` |
//! | `SharedStorage<ChannelText>` (writers: the admins) | `info: Cell<ChannelText>`; `updateInfo` checks the caller is an admin |
//! | `AuthoredVector<Message>`, sender = owner stamp | `messages: Vector<StoredMessage>`, `sender` a field filled from the caller |
//! | `WriteOnce<UnorderedMap<MessageId, Slot>>` | `messageIds: UnorderedMap<String, Slot>` |
//! | `Moderated<SortedMap<String, Message>>` keyed `parent␟ts␟id` | `threads: UnorderedMap<(parent, ts, id), StoredMessage>`, read by prefix; `threadStats` keeps each thread's count and newest timestamp |
//! | `AuthoredSortedMap<String, ()>` keyed `msg␟emoji␟account` | `reactions: Set<(msg, emoji, account)>` |
//! | `UserStorage<StoredProfile>` | `profiles: UnorderedMap<account, Profile>`, written only for the caller |
//! | `AccessControl` (admin tier + `"mod"` role) | `admins: Set<account>`, `mods: Set<account>` |
//! | `SharedStorage<UnorderedMap<UserId, bool>>` (ban flags) | `banned: Set<account>` |
//! | `SharedStorage<UnorderedMap<MessageId, bool>>` (staff removals) | `hidden: Set<messageId>` |
//! | `UserStorage<LwwRegister<u64>>` (read receipts) | `readReceipts: PerUser<u64>` |
//! | `#[app::private] Drafts` (node-local) | `drafts: UnorderedMap<(account, channel), String>`, read and written for the caller only |
//! | `#[derive(Searchable)]` + the node's full-text index | not at `1.0.0-rc.7`: `searchMessages` walks the channel, as `searchMessagesScan` |
//! | `BlobId` + `env::blob_announce_to_context` | a blob id string (64 lowercase hex), checked; the frontend uploads and downloads through the node's per-app blob API |
//!
//! # Who may do what
//!
//! The node decides who reaches the conversation (the app's access rule: the
//! org for a channel, two accounts for a DM). Inside it the rules v1 kept in
//! storage are checks in each method, against `env::caller()`:
//!
//! - the app's owner (the creator) starts as the only admin; admins change any
//!   role, moderators only flip a plain member to `Banned` and back, and an
//!   admin cannot demote themselves;
//! - a banned member's writes are refused (`Banned`), reads are not;
//! - only a message's sender edits it; the sender blanks their own message,
//!   the staff (admins and moderators) hide a top-level message or remove a
//!   reply (`Forbidden` for anyone else);
//! - a profile, a reaction, a read receipt and a draft are always the caller's
//!   own: no method takes the account it writes for.
//!
//! Everything a client sees differently from v1 is in
//! `apps/mero-chat/README.md`, "What changed in the port".

use std::collections::BTreeMap;

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

mod search;

/// Longest accepted search term, in bytes.
pub const MAX_SEARCH_TERM_LEN: usize = 256;
/// Hits a search returns when the caller names no limit, and the most it
/// returns at all.
pub const DEFAULT_SEARCH_LIMIT: u32 = 20;
pub const MAX_SEARCH_LIMIT: u32 = 50;
/// What one search call may read before it stops and hands back a cursor:
/// stored messages (top-level and replies), and bytes of their text.
pub const MAX_SEARCH_ROWS: usize = 2_000;
pub const MAX_SEARCH_BYTES: usize = 1 << 20;

/// Ceilings on what one write may add.
pub const MAX_MESSAGE_LEN: usize = 20_000;
pub const MAX_ATTACHMENTS: usize = 10;
pub const MAX_MENTIONS: usize = 100;
pub const MAX_EMOJI_LEN: usize = 64;
pub const MAX_NAME_LEN: usize = 100;
pub const MAX_DESCRIPTION_LEN: usize = 1_000;
pub const MAX_USERNAME_LEN: usize = 50;

/// How far ahead of the log's clock a client timestamp may be, in seconds.
pub const MAX_CLOCK_SKEW_SECS: u64 = 300;

/// How many of the newest messages an unread count looks at.
pub const MAX_UNREAD_SCAN: u64 = 500;

/// The most messages one read returns, and the page every multi-row read is
/// taken in.
pub const MAX_PAGE: u32 = 1_000;

/// Emoji containing it are refused (v1 used it to join key parts; kept so the
/// same emoji are accepted as before).
const KEY_SEP: char = '\u{1f}';

// ── stored values ────────────────────────────────────────────────────────────

/// "channel" or "dm", fixed when the conversation is created.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, AbiType)]
pub enum ContextType {
    #[default]
    Channel,
    Dm,
}

/// In-conversation role. `User` is everyone without another one.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, AbiType)]
pub enum Role {
    #[default]
    User,
    Mod,
    Admin,
    Banned,
}

/// What the conversation is founded with; written once, by `init`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Founding {
    pub context_type: ContextType,
    /// Seconds since the epoch (the log's clock at `init`).
    pub created_at: u64,
    /// The account that created it (the app's owner).
    pub creator: String,
}

/// The conversation's name and description; admins change them.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChannelText {
    pub name: String,
    pub description: String,
}

/// An uploaded file a message carries. The blob itself lives in the node's
/// per-app blob store; this is its id and what the uploader said about it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    /// 64 lowercase hex digits (the blob's SHA-256).
    pub blob_id: String,
    /// Milliseconds (the log's clock when the message was sent).
    pub uploaded_at: u64,
}

/// One message, top-level or a reply.
///
/// The lists inside are bounded on every write: at most `MAX_MENTIONS`
/// mentions and mentioned names, at most `MAX_ATTACHMENTS` files and as many
/// images.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    /// The client's clock, in seconds.
    pub timestamp: u64,
    /// The account that sent it (the caller of `sendMessage`).
    pub sender: String,
    pub mentions: Vec<String>,
    pub mentions_usernames: Vec<String>,
    pub files: Vec<Attachment>,
    pub images: Vec<Attachment>,
    pub text: String,
    pub edited_on: Option<u64>,
    /// Blanked by its sender.
    pub deleted: bool,
}

/// Where a message lives.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum Slot {
    /// A position in `messages`.
    Channel(u64),
    /// A reply: its parent's id and its timestamp (the rest of its key).
    Thread { parent: String, timestamp: u64 },
}

/// A thread's reply count and its newest reply's timestamp.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStats {
    pub count: u32,
    pub last: u64,
}

/// A member's profile in this conversation.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub username: String,
    /// A blob id.
    pub avatar: Option<String>,
}

// ── arguments and results ────────────────────────────────────────────────────

/// An attachment as `sendMessage` takes it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    /// The blob id an upload answered (`id`, 64 lowercase hex digits).
    pub blob_id_str: String,
}

/// An attachment as reads return it.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub name: String,
    pub mime_type: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub size: u64,
    pub blob_id: String,
    /// Milliseconds; a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub uploaded_at: u64,
}

/// A message as reads return it.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    /// A top-level message's position in the channel (a stable cursor: appends
    /// land after it and a delete keeps its slot), or a reply's position in its
    /// thread. A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub index: u64,
    /// Seconds; a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub timestamp: u64,
    pub sender: String,
    pub mentions: Vec<String>,
    pub mentions_usernames: Vec<String>,
    pub files: Vec<AttachmentView>,
    pub images: Vec<AttachmentView>,
    pub id: String,
    pub text: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::opt_u64_str")]
    pub edited_on: Option<u64>,
    /// Emoji → the accounts that reacted with it; `null` when none (or deleted).
    pub reactions: Option<BTreeMap<String, Vec<String>>>,
    pub deleted: Option<bool>,
    pub thread_count: u32,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub thread_last_timestamp: u64,
    pub parent_message_id: Option<String>,
}

/// A page of messages.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageView>,
    pub start_position: u32,
}

/// One message a search found: enough to list and open it.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    /// Set for a thread reply: the top-level message it replies to.
    pub parent_message_id: Option<String>,
    /// Position of the top-level message: the hit itself, or a reply's parent.
    #[serde(with = "calimero_sdk::json::opt_u64_str")]
    pub index: Option<u64>,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub timestamp: u64,
    /// What the hit is ranked by: its own timestamp, or its parent's for a reply.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub anchor_timestamp: u64,
    pub sender: String,
    /// Plain text around the first match.
    pub snippet: String,
    /// The match inside `snippet`, in UTF-16 code units (a JS string index).
    pub match_start: u32,
    pub match_end: u32,
}

/// A page of a search.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    /// Opaque; pass it back for the next page. `null` once the walk reached the
    /// oldest message.
    pub next_cursor: Option<String>,
    /// The oldest timestamp among the top-level messages this call read.
    #[serde(with = "calimero_sdk::json::opt_u64_str")]
    pub frontier_timestamp: Option<u64>,
}

/// The conversation's metadata.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub name: String,
    pub context_type: ContextType,
    pub description: String,
    /// Seconds; a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub creator: String,
}

/// A member's profile.
#[derive(Serialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub identity: String,
    pub username: String,
    pub avatar: Option<String>,
}

// ── state ────────────────────────────────────────────────────────────────────

/// One conversation.
#[app::state(version = 1)]
pub struct MeroChat {
    founding: Cell<Founding>,
    info: Cell<ChannelText>,
    /// Top-level messages; the position is the stable cursor clients page by.
    messages: Vector<StoredMessage>,
    /// Message id → where it lives.
    message_ids: UnorderedMap<String, Slot>,
    /// `(parent, timestamp, id)` → reply: one thread is one prefix, in time order.
    threads: UnorderedMap<(String, u64, String), StoredMessage>,
    /// Parent id → its thread's count and newest timestamp.
    thread_stats: UnorderedMap<String, ThreadStats>,
    /// `(message, emoji, account)`: the caller's reaction.
    reactions: Set<(String, String, String)>,
    /// Account → profile, each written only by its account.
    profiles: UnorderedMap<String, Profile>,
    admins: Set<String>,
    mods: Set<String>,
    banned: Set<String>,
    /// Top-level messages the staff removed; read back blank.
    hidden: Set<String>,
    /// Each account's last-read timestamp (seconds).
    read_receipts: PerUser<u64>,
    /// `(account, channel)` → unsent text.
    drafts: UnorderedMap<(String, String), String>,
}

#[app::logic]
impl MeroChat {
    /// Founds the conversation. Every argument is optional (a harness or a
    /// cluster creates the app with none): `contextType` defaults to `Channel`.
    /// The app's owner is the creator and the only admin; a non-blank
    /// `creatorUsername` becomes their profile. Emits `Initialized`.
    #[app::init]
    pub fn init(
        name: Option<String>,
        context_type: Option<ContextType>,
        description: Option<String>,
        creator_username: Option<String>,
    ) -> app::Result<Self> {
        let mut chat = Self::load();
        let creator = env::app_owner();
        chat.founding.set(&Founding {
            context_type: context_type.unwrap_or_default(),
            created_at: env::time_now() / 1000,
            creator: creator.clone(),
        })?;
        chat.info.set(&ChannelText {
            name: name.unwrap_or_default(),
            description: description.unwrap_or_default(),
        })?;
        let _new = chat.admins.insert(&creator)?;
        if let Some(username) = creator_username.filter(|u| !u.trim().is_empty()) {
            let _ = chat.profiles.insert(
                &creator,
                &Profile {
                    username,
                    avatar: None,
                },
            )?;
        }
        env::emit(Event::Initialized, Audience::All)?;
        Ok(chat)
    }

    // ── info ─────────────────────────────────────────────────────────────────

    #[app::view]
    pub fn get_info(&self) -> app::Result<ContextInfo> {
        let founding = self.founding.get()?.unwrap_or_default();
        let info = self.info.get()?.unwrap_or_default();
        Ok(ContextInfo {
            name: info.name,
            context_type: founding.context_type,
            description: info.description,
            created_at: founding.created_at,
            creator: founding.creator,
        })
    }

    /// Alias for `getInfo`; `channel` is accepted and ignored.
    #[app::view]
    pub fn get_channel_info(&self, channel: Option<String>) -> app::Result<ContextInfo> {
        let _ = channel;
        self.get_info()
    }

    /// Renames the conversation or changes its description. Admins only
    /// (`Forbidden`). Emits `InfoUpdated`.
    pub fn update_info(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<String> {
        let me = account()?;
        if !self.admins.contains(&me)? {
            return Err(forbidden("Only an admin can change the channel's info"));
        }
        if name.as_ref().is_some_and(|n| n.len() > MAX_NAME_LEN) {
            return Err(invalid(format!(
                "Name cannot be longer than {MAX_NAME_LEN} bytes"
            )));
        }
        if description
            .as_ref()
            .is_some_and(|d| d.len() > MAX_DESCRIPTION_LEN)
        {
            return Err(invalid(format!(
                "Description cannot be longer than {MAX_DESCRIPTION_LEN} bytes"
            )));
        }
        let mut info = self.info.get()?.unwrap_or_default();
        if let Some(n) = name {
            info.name = n;
        }
        if let Some(d) = description {
            info.description = d;
        }
        self.info.set(&info)?;
        env::emit(Event::InfoUpdated, Audience::All)?;
        Ok("Info updated".to_owned())
    }

    // ── read state ───────────────────────────────────────────────────────────

    /// A no-op kept for clients that call it. Read state is `markAsRead`.
    #[app::view]
    pub fn mark_messages_as_read(
        &self,
        channel: Option<String>,
        timestamp: Option<u64>,
    ) -> app::Result<String> {
        let _ = (channel, timestamp);
        Ok("ok".to_owned())
    }

    /// Records the caller's last-read timestamp (seconds). Emits nothing.
    pub fn mark_as_read(&mut self, timestamp: u64) -> app::Result<String> {
        let _ = self.read_receipts.set(&timestamp)?;
        Ok("ok".to_owned())
    }

    /// Top-level messages newer than the caller's last read, not their own and
    /// not deleted, among the newest `MAX_UNREAD_SCAN` (the count saturates there).
    #[app::view]
    pub fn get_unread_count(&self) -> app::Result<u32> {
        let me = account()?;
        self.unread(&me, |_| true)
    }

    /// As `getUnreadCount`, counting only messages that mention the caller or
    /// `@everyone` / `@here`.
    #[app::view]
    pub fn get_unread_mentions(&self) -> app::Result<u32> {
        let me = account()?;
        let mine = me.clone();
        self.unread(&me, move |m| {
            m.mentions_usernames
                .iter()
                .any(|u| u == "everyone" || u == "here")
                || m.mentions.contains(&mine)
        })
    }

    // ── profiles ─────────────────────────────────────────────────────────────

    /// Sets the caller's profile. The username is kept from the first call on
    /// (only the avatar changes after that); it must not be blank and is at
    /// most 50 bytes (`Invalid`). `avatar` is a blob id; `null` keeps the
    /// current one. Emits `ProfileUpdated`.
    pub fn set_profile(&mut self, username: String, avatar: Option<String>) -> app::Result<String> {
        let me = self.member()?;
        if username.trim().is_empty() {
            return Err(invalid("Username cannot be empty"));
        }
        if username.len() > MAX_USERNAME_LEN {
            return Err(invalid(format!(
                "Username cannot be longer than {MAX_USERNAME_LEN} characters"
            )));
        }
        if let Some(blob) = &avatar {
            if !is_blob_id(blob) {
                return Err(invalid(format!("Invalid avatar blob ID: {blob}")));
            }
        }
        let profile = match self.profiles.get(&me)? {
            Some(existing) => Profile {
                username: existing.username,
                avatar: avatar.or(existing.avatar),
            },
            None => Profile { username, avatar },
        };
        let _ = self.profiles.insert(&me, &profile)?;
        env::emit(Event::ProfileUpdated { account: me }, Audience::All)?;
        Ok("Profile set".to_owned())
    }

    /// Every member's profile, in account order; at most 1,000.
    #[app::view]
    pub fn get_profiles(&self) -> app::Result<Vec<UserProfile>> {
        Ok(self
            .profiles
            .page(FindOpts::default().limit(MAX_PAGE))?
            .items
            .into_iter()
            .map(|(identity, p)| UserProfile {
                identity,
                username: p.username,
                avatar: p.avatar,
            })
            .collect())
    }

    // ── drafts ───────────────────────────────────────────────────────────────

    /// Saves the caller's draft for `channel`; an empty text deletes it. At
    /// most `MAX_MESSAGE_LEN` bytes (`Invalid`).
    pub fn save_draft(&mut self, channel: String, text: String) -> app::Result<()> {
        let me = self.member()?;
        if text.len() > MAX_MESSAGE_LEN {
            return Err(invalid(format!(
                "Draft cannot be longer than {MAX_MESSAGE_LEN} bytes"
            )));
        }
        let key = (me, channel);
        if text.is_empty() {
            let _ = self.drafts.remove(&key)?;
        } else {
            let _ = self.drafts.insert(&key, &text)?;
        }
        Ok(())
    }

    /// The caller's draft for `channel`, or "".
    #[app::view]
    pub fn get_draft(&self, channel: String) -> app::Result<String> {
        let me = account()?;
        Ok(self.drafts.get(&(me, channel))?.unwrap_or_default())
    }

    /// Deletes the caller's draft for `channel`.
    pub fn delete_draft(&mut self, channel: String) -> app::Result<()> {
        let me = self.member()?;
        let _ = self.drafts.remove(&(me, channel))?;
        Ok(())
    }

    // ── roles ────────────────────────────────────────────────────────────────

    /// `identity`'s role; `User` when it has none.
    #[app::view]
    pub fn get_member_role(&self, identity: String) -> app::Result<Role> {
        self.role_of(&identity)
    }

    /// Every account with a role other than `User`, as `[account, role]`; at
    /// most 1,000 of each kind.
    #[app::view]
    pub fn list_roles(&self) -> app::Result<Vec<(String, Role)>> {
        let mut ids: Vec<String> = Vec::new();
        for set in [&self.banned, &self.admins, &self.mods] {
            for who in set.page(FindOpts::default().limit(MAX_PAGE))?.items {
                if !ids.contains(&who) {
                    ids.push(who);
                }
            }
        }
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let role = self.role_of(&id)?;
            if role != Role::User {
                out.push((id, role));
            }
        }
        Ok(out)
    }

    /// Changes `target`'s role. An admin may set any role; a moderator may only
    /// flip a `User` to `Banned` and back; anyone else is `Forbidden`. An admin
    /// cannot demote themselves (`Forbidden`). Emits `RoleUpdated` when the role
    /// changed.
    pub fn set_member_role(&mut self, target: String, role: Role) -> app::Result<String> {
        let me = account()?;
        let actor = self.role_of(&me)?;
        let current = self.role_of(&target)?;
        if me == target && actor == Role::Admin && role != Role::Admin {
            return Err(forbidden("An admin cannot demote themselves below Admin"));
        }
        if !can_change_role(actor, current, role) {
            return Err(forbidden(
                "You don't have permission to change this member's role",
            ));
        }
        let by_admin = actor == Role::Admin;
        match role {
            Role::Admin => {
                let _ = self.mods.remove(&target)?;
                let _ = self.banned.remove(&target)?;
                let _ = self.admins.insert(&target)?;
            }
            Role::Mod => {
                let _ = self.admins.remove(&target)?;
                let _ = self.banned.remove(&target)?;
                let _ = self.mods.insert(&target)?;
            }
            Role::Banned => {
                if by_admin {
                    let _ = self.mods.remove(&target)?;
                    let _ = self.admins.remove(&target)?;
                }
                let _ = self.banned.insert(&target)?;
            }
            Role::User => {
                if by_admin {
                    let _ = self.mods.remove(&target)?;
                    let _ = self.admins.remove(&target)?;
                }
                let _ = self.banned.remove(&target)?;
            }
        }
        if current == role {
            return Ok("Role unchanged".to_owned());
        }
        env::emit(Event::RoleUpdated { account: target }, Audience::All)?;
        Ok("Role updated".to_owned())
    }

    // ── messages ─────────────────────────────────────────────────────────────

    /// Sends a message as the caller: top-level, or a reply to the top-level
    /// message `parentMessage`. `timestamp` is the client's clock in seconds, at
    /// most `MAX_CLOCK_SKEW_SECS` ahead of the log's. Attachments name blobs
    /// uploaded to this app. Emits `MessageSent` or `MessageSentThread`.
    #[allow(clippy::too_many_arguments)]
    pub fn send_message(
        &mut self,
        message: String,
        mentions: Vec<String>,
        mentions_usernames: Vec<String>,
        parent_message: Option<String>,
        timestamp: u64,
        files: Option<Vec<AttachmentInput>>,
        images: Option<Vec<AttachmentInput>>,
    ) -> app::Result<MessageView> {
        let me = self.member()?;
        check_timestamp(timestamp)?;
        if message.len() > MAX_MESSAGE_LEN {
            return Err(invalid(format!(
                "Message cannot be longer than {MAX_MESSAGE_LEN} bytes"
            )));
        }
        if mentions.len() > MAX_MENTIONS || mentions_usernames.len() > MAX_MENTIONS {
            return Err(invalid(format!(
                "A message can mention at most {MAX_MENTIONS} members"
            )));
        }
        let files = files.unwrap_or_default();
        let images = images.unwrap_or_default();
        if files.len() > MAX_ATTACHMENTS || images.len() > MAX_ATTACHMENTS {
            return Err(invalid(format!(
                "A message can carry at most {MAX_ATTACHMENTS} files and {MAX_ATTACHMENTS} images"
            )));
        }
        if let Some(parent) = &parent_message {
            if !matches!(self.message_ids.get(parent)?, Some(Slot::Channel(_))) {
                return Err(not_found("Parent message not found"));
            }
        }
        let now = env::time_now();
        let files = attachments(files, now)?;
        let images = attachments(images, now)?;
        let mut unique_mentions: Vec<String> = Vec::with_capacity(mentions.len());
        for m in mentions {
            if !unique_mentions.contains(&m) {
                unique_mentions.push(m);
            }
        }
        let id = format!("{}_{timestamp}", fresh_id());
        let msg = StoredMessage {
            id: id.clone(),
            timestamp,
            sender: me,
            mentions: unique_mentions,
            mentions_usernames,
            files,
            images,
            text: message,
            edited_on: None,
            deleted: false,
        };
        if let Some(parent) = parent_message {
            let position = self.thread_stats.get(&parent)?.unwrap_or_default().count;
            let _ = self
                .threads
                .insert(&(parent.clone(), timestamp, id.clone()), &msg)?;
            let _ = self.message_ids.insert(
                &id,
                &Slot::Thread {
                    parent: parent.clone(),
                    timestamp,
                },
            )?;
            let mut stats = self.thread_stats.get(&parent)?.unwrap_or_default();
            stats.count += 1;
            stats.last = stats.last.max(timestamp);
            let _ = self.thread_stats.insert(&parent, &stats)?;
            env::emit(
                Event::MessageSentThread {
                    message_id: id.clone(),
                },
                Audience::All,
            )?;
            let mut view = self.view_of(&msg, u64::from(position), false)?;
            view.parent_message_id = Some(parent);
            Ok(view)
        } else {
            let position = self.messages.push(&msg)?;
            let _ = self.message_ids.insert(&id, &Slot::Channel(position))?;
            env::emit(
                Event::MessageSent {
                    message_id: id.clone(),
                },
                Audience::All,
            )?;
            self.view_of(&msg, position, true)
        }
    }

    /// A page of the channel, or of one thread (`parentMessage`), counted back
    /// from the END: offset 0 is the newest page. `limit` defaults to, and is
    /// capped at, 1,000. `searchTerm` keeps only messages whose text contains it
    /// (as `searchMessages` compares), and `totalCount` is then the number of
    /// matches. A search here, and a thread, read the whole collection.
    #[app::view]
    pub fn get_messages(
        &self,
        parent_message: Option<String>,
        limit: Option<u32>,
        offset: Option<u32>,
        search_term: Option<String>,
    ) -> app::Result<FullMessageResponse> {
        if let Some(term) = &search_term {
            check_term(term)?;
        }
        let needle = search_term.as_deref().map(search::fold_query);
        let limit = Some(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE));

        if let Some(parent) = parent_message {
            let replies = self.replies(&parent, None)?;
            let mut matched: Vec<(u64, StoredMessage)> = Vec::new();
            for (i, reply) in replies.into_iter().enumerate() {
                if needle
                    .as_deref()
                    .is_none_or(|n| self.text_matches(&reply, n).unwrap_or(false))
                {
                    matched.push((i as u64, reply));
                }
            }
            let (window, start_position) = page_window(matched.len(), limit, offset);
            let mut messages = Vec::with_capacity(window.len());
            for (index, reply) in &matched[window] {
                let mut view = self.view_of(reply, *index, false)?;
                view.parent_message_id = Some(parent.clone());
                messages.push(view);
            }
            return Ok(FullMessageResponse {
                total_count: matched.len() as u32,
                messages,
                start_position,
            });
        }

        let Some(needle) = needle else {
            let total = self.messages.len()?;
            let (window, start_position) = page_window(total as usize, limit, offset);
            let mut messages = Vec::with_capacity(window.len());
            for index in window {
                if let Some(view) = self.view_at(index as u64)? {
                    messages.push(view);
                }
            }
            return Ok(FullMessageResponse {
                total_count: total as u32,
                messages,
                start_position,
            });
        };

        let mut matches: Vec<(u64, StoredMessage)> = Vec::new();
        let mut index = 0u64;
        let mut cursor: Option<String> = None;
        loop {
            let mut opts = FindOpts::default().limit(MAX_PAGE);
            if let Some(c) = cursor.take() {
                opts = opts.cursor(c);
            }
            let page = self.messages.page(opts)?;
            for message in page.items {
                if self.text_matches(&message, &needle)? {
                    matches.push((index, message));
                }
                index += 1;
            }
            match page.next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        let (window, start_position) = page_window(matches.len(), limit, offset);
        let mut messages = Vec::with_capacity(window.len());
        for (index, message) in &matches[window] {
            messages.push(self.view_of(message, *index, true)?);
        }
        Ok(FullMessageResponse {
            total_count: matches.len() as u32,
            messages,
            start_position,
        })
    }

    /// Top-level messages by ABSOLUTE position, ascending, from `start`: the
    /// resumable read. `limit` defaults to, and is capped at, 1,000.
    /// `totalCount` is the channel's length.
    #[app::view]
    pub fn get_messages_from(
        &self,
        start: u64,
        limit: Option<u32>,
    ) -> app::Result<FullMessageResponse> {
        let total = self.messages.len()?;
        let start_position = u32::try_from(start).unwrap_or(u32::MAX);
        if start >= total {
            return Ok(FullMessageResponse {
                total_count: total as u32,
                messages: Vec::new(),
                start_position,
            });
        }
        let limit = u64::from(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE));
        let end = start.saturating_add(limit).min(total);
        let mut messages = Vec::with_capacity((end - start) as usize);
        for index in start..end {
            if let Some(view) = self.view_at(index)? {
                messages.push(view);
            }
        }
        Ok(FullMessageResponse {
            total_count: total as u32,
            messages,
            start_position,
        })
    }

    /// How many top-level messages the channel holds (one stored count).
    #[app::view]
    pub fn get_message_count(&self) -> app::Result<u64> {
        Ok(self.messages.len()?)
    }

    /// Messages whose text contains `query`, newest first by position, each
    /// top-level message followed by its replies. The node's full-text index is
    /// not available to components at `1.0.0-rc.7`, so this is the bounded walk
    /// `searchMessagesScan` makes; see there.
    #[app::view]
    pub fn search_messages(
        &self,
        query: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage> {
        self.scan(&query, cursor, limit)
    }

    /// The position of the top-level message `messageId`, for opening a search
    /// hit where it was said (`getMessagesFrom`). A reply, or an unknown id,
    /// has none.
    #[app::view]
    pub fn message_position(&self, message_id: String) -> app::Result<Option<u64>> {
        Ok(match self.message_ids.get(&message_id)? {
            Some(Slot::Channel(position)) => Some(position),
            _ => None,
        })
    }

    /// Messages whose text contains `query` (markup dropped, folded for case,
    /// accents and width), walking the channel by position from the newest
    /// message down, each followed by its replies. Deleted and staff-removed
    /// messages are never returned. A call stops at `limit` hits (default 20,
    /// at most 50) or once it read `MAX_SEARCH_ROWS` messages or
    /// `MAX_SEARCH_BYTES` of text, and returns `nextCursor` to continue.
    #[app::view]
    pub fn search_messages_scan(
        &self,
        query: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage> {
        self.scan(&query, cursor, limit)
    }

    /// Adds or removes the CALLER's reaction to a message. `emoji` must be
    /// 1-64 bytes (`Invalid`); `NotFound` for an unknown message. Emits
    /// `ReactionUpdated`.
    pub fn update_reaction(
        &mut self,
        message_id: String,
        emoji: String,
        add: bool,
    ) -> app::Result<String> {
        let me = self.member()?;
        if emoji.is_empty() || emoji.len() > MAX_EMOJI_LEN || emoji.contains(KEY_SEP) {
            return Err(invalid("Invalid emoji"));
        }
        if self.message_ids.get(&message_id)?.is_none() {
            return Err(not_found("Message not found"));
        }
        let key = (message_id.clone(), emoji, me);
        let action = if add {
            let _ = self.reactions.insert(&key)?;
            "added"
        } else {
            let _ = self.reactions.remove(&key)?;
            "removed"
        };
        env::emit(Event::ReactionUpdated { message_id }, Audience::All)?;
        Ok(format!("Reaction {action} successfully"))
    }

    /// Replaces the text of the caller's own message (`parentId` names a
    /// reply's parent). `NotFound` for an unknown message, `Forbidden` for
    /// someone else's. Emits `MessageEdited`.
    pub fn edit_message(
        &mut self,
        message_id: String,
        new_message: String,
        timestamp: u64,
        parent_id: Option<String>,
    ) -> app::Result<MessageView> {
        let me = self.member()?;
        check_timestamp(timestamp)?;
        if new_message.len() > MAX_MESSAGE_LEN {
            return Err(invalid(format!(
                "Message cannot be longer than {MAX_MESSAGE_LEN} bytes"
            )));
        }
        let view = match (self.message_ids.get(&message_id)?, parent_id) {
            (
                Some(Slot::Thread {
                    parent,
                    timestamp: at,
                }),
                Some(wanted),
            ) if parent == wanted => {
                let key = (parent.clone(), at, message_id.clone());
                let Some(mut reply) = self.threads.get(&key)? else {
                    return Err(not_found("Message not found"));
                };
                if reply.sender != me {
                    return Err(forbidden("You can only edit your own messages"));
                }
                reply.text = new_message;
                reply.edited_on = Some(timestamp);
                let _ = self.threads.insert(&key, &reply)?;
                let index = self.reply_position(&parent, &message_id)?;
                let mut view = self.view_of(&reply, index, false)?;
                view.parent_message_id = Some(parent);
                view
            }
            (Some(Slot::Channel(position)), None) => {
                let Some(mut message) = self.messages.get(position)? else {
                    return Err(not_found("Message not found"));
                };
                if message.sender != me {
                    return Err(forbidden("You can only edit your own messages"));
                }
                message.text = new_message;
                message.edited_on = Some(timestamp);
                let _ = self.messages.set(position, &message)?;
                self.view_of(&message, position, true)?
            }
            _ => return Err(not_found("Message not found")),
        };
        env::emit(
            Event::MessageEdited {
                message_id: view.id.clone(),
            },
            Audience::All,
        )?;
        Ok(view)
    }

    /// Deletes a message. Its sender blanks it in place (the slot and its
    /// index stay). The staff remove anyone's: a reply is removed from its
    /// thread, a top-level message is hidden and read back blank. Anyone else
    /// is `Forbidden`. Emits `MessageSentThread` for a reply, `MessageSent` for
    /// a top-level message (as v1).
    pub fn delete_message(
        &mut self,
        message_id: String,
        parent_id: Option<String>,
    ) -> app::Result<String> {
        let me = self.member()?;
        let actor = self.role_of(&me)?;
        let staff = actor == Role::Admin || actor == Role::Mod;
        match (self.message_ids.get(&message_id)?, parent_id) {
            (Some(Slot::Thread { parent, timestamp }), Some(wanted)) if parent == wanted => {
                let key = (parent.clone(), timestamp, message_id.clone());
                let Some(mut reply) = self.threads.get(&key)? else {
                    return Err(not_found("Message not found"));
                };
                if reply.sender == me {
                    reply.text = String::new();
                    reply.deleted = true;
                    let _ = self.threads.insert(&key, &reply)?;
                } else if staff {
                    let _ = self.threads.remove(&key)?;
                    let _ = self.message_ids.remove(&message_id)?;
                    self.clear_reactions(&message_id)?;
                    self.recount_thread(&parent)?;
                } else {
                    return Err(forbidden(
                        "You don't have permission to delete this message",
                    ));
                }
                env::emit(Event::MessageSentThread { message_id }, Audience::All)?;
                Ok("Thread message deleted successfully".to_owned())
            }
            (Some(Slot::Channel(position)), None) => {
                let Some(mut message) = self.messages.get(position)? else {
                    return Err(not_found("Message not found"));
                };
                if message.sender == me {
                    message.text = String::new();
                    message.deleted = true;
                    let _ = self.messages.set(position, &message)?;
                } else if staff {
                    let _ = self.hidden.insert(&message_id)?;
                } else {
                    return Err(forbidden(
                        "You don't have permission to delete this message",
                    ));
                }
                env::emit(Event::MessageSent { message_id }, Audience::All)?;
                Ok("Message deleted successfully".to_owned())
            }
            _ => Err(not_found("Message not found")),
        }
    }
}

// ── internal ─────────────────────────────────────────────────────────────────

impl MeroChat {
    /// The caller, refused when banned.
    fn member(&self) -> app::Result<String> {
        let me = account()?;
        if self.role_of(&me)? == Role::Banned {
            return Err(Error::Banned {
                message: "You are banned from this context".to_owned(),
            }
            .into());
        }
        Ok(me)
    }

    /// The admin tier is checked first, so a ban flag on an admin cannot lock
    /// the admins out of the moderation that would undo it.
    fn role_of(&self, account: &str) -> app::Result<Role> {
        let account = account.to_owned();
        Ok(if self.admins.contains(&account)? {
            Role::Admin
        } else if self.banned.contains(&account)? {
            Role::Banned
        } else if self.mods.contains(&account)? {
            Role::Mod
        } else {
            Role::User
        })
    }

    fn is_deleted(&self, message: &StoredMessage) -> app::Result<bool> {
        Ok(message.deleted || self.hidden.contains(&message.id)?)
    }

    fn text_matches(&self, message: &StoredMessage, needle: &str) -> app::Result<bool> {
        Ok(search::folded_text(&message.text).contains(needle) && !self.is_deleted(message)?)
    }

    fn hit_snippet(
        &self,
        message: &StoredMessage,
        needle: &str,
    ) -> app::Result<Option<search::Snippet>> {
        Ok(self
            .text_matches(message, needle)?
            .then(|| search::snippet(&search::plain_text(&message.text), needle)))
    }

    fn unread(&self, me: &str, wanted: impl Fn(&StoredMessage) -> bool) -> app::Result<u32> {
        let last_read = self.read_receipts.get_for(me)?.unwrap_or(0);
        let total = self.messages.len()?;
        let mut count = 0u32;
        for index in (total.saturating_sub(MAX_UNREAD_SCAN)..total).rev() {
            let Some(message) = self.messages.get(index)? else {
                continue;
            };
            if message.timestamp <= last_read || message.sender == me {
                continue;
            }
            if self.is_deleted(&message)? {
                continue;
            }
            if wanted(&message) {
                count += 1;
            }
        }
        Ok(count)
    }

    /// The replies to `parent` in thread order, after `(timestamp, id)` if given.
    fn replies(
        &self,
        parent: &str,
        after: Option<(u64, String)>,
    ) -> app::Result<Vec<StoredMessage>> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut opts = FindOpts::default().limit(MAX_PAGE);
            if let Some((at, id)) = &after {
                opts = opts.from(vec![
                    KeyPart::Int(i128::from(*at)),
                    KeyPart::Str(id.clone()),
                ]);
            }
            if let Some(c) = cursor.take() {
                opts = opts.cursor(c);
            }
            let page = self
                .threads
                .prefix(&[KeyPart::Str(parent.to_owned())], opts)?;
            for ((_, at, id), reply) in page.items {
                if after.as_ref().is_some_and(|(a, i)| *a == at && *i == id) {
                    continue;
                }
                out.push(reply);
            }
            match page.next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(out)
    }

    fn reply_position(&self, parent: &str, id: &str) -> app::Result<u64> {
        Ok(self
            .replies(parent, None)?
            .iter()
            .position(|r| r.id == id)
            .unwrap_or(0) as u64)
    }

    /// Recomputes a thread's stats after a reply was removed.
    fn recount_thread(&mut self, parent: &str) -> app::Result<()> {
        let replies = self.replies(parent, None)?;
        if replies.is_empty() {
            let _ = self.thread_stats.remove(&parent.to_owned())?;
        } else {
            let stats = ThreadStats {
                count: replies.len() as u32,
                last: replies.iter().map(|r| r.timestamp).max().unwrap_or(0),
            };
            let _ = self.thread_stats.insert(&parent.to_owned(), &stats)?;
        }
        Ok(())
    }

    fn clear_reactions(&mut self, message_id: &str) -> app::Result<()> {
        loop {
            let page = self.reactions.prefix(
                &[KeyPart::Str(message_id.to_owned())],
                FindOpts::default().limit(MAX_PAGE),
            )?;
            if page.items.is_empty() {
                return Ok(());
            }
            for key in page.items {
                let _ = self.reactions.remove(&key)?;
            }
        }
    }

    /// Emoji → accounts; at most 1,000 reactions per message are read.
    fn reactions_of(&self, message_id: &str) -> app::Result<Option<BTreeMap<String, Vec<String>>>> {
        let page = self.reactions.prefix(
            &[KeyPart::Str(message_id.to_owned())],
            FindOpts::default().limit(MAX_PAGE),
        )?;
        let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (_, emoji, account) in page.items {
            map.entry(emoji).or_default().push(account);
        }
        Ok((!map.is_empty()).then_some(map))
    }

    fn view_at(&self, index: u64) -> app::Result<Option<MessageView>> {
        match self.messages.get(index)? {
            Some(message) => Ok(Some(self.view_of(&message, index, true)?)),
            None => Ok(None),
        }
    }

    /// One stored message rendered for the API; every read renders through it.
    fn view_of(
        &self,
        message: &StoredMessage,
        index: u64,
        include_threads: bool,
    ) -> app::Result<MessageView> {
        let stats = if include_threads {
            self.thread_stats.get(&message.id)?.unwrap_or_default()
        } else {
            ThreadStats::default()
        };
        let deleted = self.is_deleted(message)?;
        let (text, reactions) = if deleted {
            (String::new(), None)
        } else {
            (message.text.clone(), self.reactions_of(&message.id)?)
        };
        Ok(MessageView {
            index,
            timestamp: message.timestamp,
            sender: message.sender.clone(),
            mentions: message.mentions.clone(),
            mentions_usernames: message.mentions_usernames.clone(),
            files: message.files.iter().map(attachment_view).collect(),
            images: message.images.iter().map(attachment_view).collect(),
            id: message.id.clone(),
            text,
            edited_on: message.edited_on,
            reactions,
            deleted: deleted.then_some(true),
            thread_count: stats.count,
            thread_last_timestamp: stats.last,
            parent_message_id: None,
        })
    }

    fn scan(
        &self,
        query: &str,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage> {
        check_term(query)?;
        let needle = search::fold_query(query);
        let limit = limit
            .unwrap_or(DEFAULT_SEARCH_LIMIT)
            .clamp(1, MAX_SEARCH_LIMIT) as usize;
        let total = self.messages.len()?;
        let mut page = SearchPage {
            hits: Vec::new(),
            next_cursor: None,
            frontier_timestamp: None,
        };
        if needle.is_empty() || total == 0 {
            return Ok(page);
        }
        let mut at = match cursor {
            None => search::Cursor {
                index: total - 1,
                step: search::Step::Message,
            },
            Some(raw) => search::Cursor::decode(&raw)
                .filter(|c| c.index < total)
                .filter(|c| match &c.step {
                    // A reply id is `<hex>_<timestamp>`.
                    search::Step::Replies(Some(id)) => id
                        .rsplit_once('_')
                        .is_some_and(|(_, ts)| ts.parse::<u64>().is_ok()),
                    _ => true,
                })
                .ok_or_else(|| invalid("Invalid search cursor"))?,
        };
        let mut rows = 0usize;
        let mut bytes = 0usize;
        let spent =
            |rows: usize, bytes: usize| rows >= MAX_SEARCH_ROWS || bytes >= MAX_SEARCH_BYTES;
        'walk: loop {
            if page.hits.len() >= limit || spent(rows, bytes) {
                page.next_cursor = Some(at.encode());
                break;
            }
            if let Some(message) = self.messages.get(at.index)? {
                rows += 1;
                let anchor = message.timestamp;
                page.frontier_timestamp =
                    Some(page.frontier_timestamp.map_or(anchor, |f| f.min(anchor)));
                let mut last = match &at.step {
                    search::Step::Message => {
                        bytes += message.text.len();
                        if let Some(found) = self.hit_snippet(&message, &needle)? {
                            page.hits
                                .push(search_hit(&message, None, at.index, anchor, found));
                        }
                        None
                    }
                    search::Step::Replies(after) => after.clone(),
                };
                let after = match &last {
                    Some(id) => match self.message_ids.get(id)? {
                        Some(Slot::Thread { timestamp, .. }) => Some((timestamp, id.clone())),
                        // The reply the cursor names is gone: start the thread over.
                        _ => None,
                    },
                    None => None,
                };
                for reply in self.replies(&message.id, after)? {
                    if page.hits.len() >= limit || spent(rows, bytes) {
                        at.step = search::Step::Replies(last);
                        page.next_cursor = Some(at.encode());
                        break 'walk;
                    }
                    rows += 1;
                    bytes += reply.text.len();
                    if let Some(found) = self.hit_snippet(&reply, &needle)? {
                        page.hits.push(search_hit(
                            &reply,
                            Some(&message.id),
                            at.index,
                            anchor,
                            found,
                        ));
                    }
                    last = Some(reply.id.clone());
                }
            }
            let Some(next) = at.index.checked_sub(1) else {
                break;
            };
            at = search::Cursor {
                index: next,
                step: search::Step::Message,
            };
        }
        Ok(page)
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. Each
/// carries v1's message text.
#[app::error]
pub enum Error {
    /// An argument is out of range: too long, a bad emoji, timestamp, blob id
    /// or cursor.
    Invalid { message: String },
    /// The caller may not do this (not the sender, not staff, not an admin).
    Forbidden { message: String },
    /// No such message (or parent message).
    NotFound { message: String },
    /// The caller is banned from this conversation.
    Banned { message: String },
}

/// A change to the conversation, emitted after the write that caused it, to
/// everyone the app reaches. Every event carries ids only.
#[app::event]
pub enum Event {
    Initialized,
    MessageSent {
        message_id: String,
    },
    MessageSentThread {
        message_id: String,
    },
    ReactionUpdated {
        message_id: String,
    },
    /// The TEXT of this message changed.
    MessageEdited {
        message_id: String,
    },
    ProfileUpdated {
        account: String,
    },
    InfoUpdated,
    /// This account's role changed.
    RoleUpdated {
        account: String,
    },
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anything that is not one.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        _ => Err(AppError::login_required()),
    }
}

/// 16 random bytes of the run, as 32 hex characters.
fn fresh_id() -> String {
    hex(&env::random_bytes(16))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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

fn not_found(message: impl Into<String>) -> AppError {
    Error::NotFound {
        message: message.into(),
    }
    .into()
}

/// A blob id: 64 lowercase hex digits (what an upload answers as `id`).
pub fn is_blob_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn attachments(inputs: Vec<AttachmentInput>, now: u64) -> app::Result<Vec<Attachment>> {
    inputs
        .into_iter()
        .map(|a| {
            if !is_blob_id(&a.blob_id_str) {
                return Err(invalid(format!("Invalid blob ID: {}", a.blob_id_str)));
            }
            Ok(Attachment {
                name: a.name,
                mime_type: a.mime_type,
                size: a.size,
                blob_id: a.blob_id_str,
                uploaded_at: now,
            })
        })
        .collect()
}

fn attachment_view(a: &Attachment) -> AttachmentView {
    AttachmentView {
        name: a.name.clone(),
        mime_type: a.mime_type.clone(),
        size: a.size,
        blob_id: a.blob_id.clone(),
        uploaded_at: a.uploaded_at,
    }
}

/// Refuses a client timestamp (seconds) too far ahead of the log's clock.
fn check_timestamp(timestamp: u64) -> app::Result<()> {
    let now_secs = env::time_now() / 1000;
    if timestamp > now_secs.saturating_add(MAX_CLOCK_SKEW_SECS) {
        return Err(invalid(format!(
            "Timestamp {timestamp} is too far in the future"
        )));
    }
    Ok(())
}

fn check_term(term: &str) -> app::Result<()> {
    if term.len() > MAX_SEARCH_TERM_LEN {
        return Err(invalid(format!(
            "Search term too long: {} characters, limit is {MAX_SEARCH_TERM_LEN}",
            term.len()
        )));
    }
    Ok(())
}

fn can_change_role(actor: Role, current: Role, new: Role) -> bool {
    match actor {
        Role::Admin => true,
        Role::Mod => {
            (current == Role::User && new == Role::Banned)
                || (current == Role::Banned && new == Role::User)
        }
        _ => false,
    }
}

/// The slice of `total` items a `(limit, offset)` page covers, counted back
/// from the END (offset 0 is the newest page), and the `startPosition` it
/// reports: the offset, except 0 for an empty collection.
fn page_window(
    total: usize,
    limit: Option<u32>,
    offset: Option<u32>,
) -> (std::ops::Range<usize>, u32) {
    if total == 0 {
        return (0..0, 0);
    }
    let offset = offset.unwrap_or(0);
    if offset as usize >= total {
        return (0..0, offset);
    }
    let end = total - offset as usize;
    let limit = limit.map_or(total, |l| l as usize);
    (end.saturating_sub(limit)..end, offset)
}

fn search_hit(
    message: &StoredMessage,
    parent: Option<&str>,
    index: u64,
    anchor_timestamp: u64,
    found: search::Snippet,
) -> SearchHit {
    SearchHit {
        id: message.id.clone(),
        parent_message_id: parent.map(str::to_owned),
        index: Some(index),
        timestamp: message.timestamp,
        anchor_timestamp,
        sender: message.sender.clone(),
        snippet: found.text,
        match_start: found.match_start,
        match_end: found.match_end,
    }
}
