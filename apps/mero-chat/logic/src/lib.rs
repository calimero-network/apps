//! Mero Chat: one conversation (a channel, or a direct message between two
//! people) on core's component SDK (`calimero-app-sdk`).
//!
//! One app instance is one conversation, as one v1 context was. A workspace is
//! the organization the instances belong to; a channel is an instance every
//! member of it reaches, a DM one only its two people reach (the frontend
//! creates it with `accounts` access). The app runs on its cluster's leader,
//! which applies every write in one replicated log, so state is plain tables
//! and maps: v1's CRDT plumbing (`Mergeable` rules, owner-stamped entries and
//! "the lowest holder wins" picks, writer sets rotated after every role change)
//! has nothing left to decide.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `AuthoredVector<Message>` (top level) + `Moderated<SortedMap<thread key, Message>>` (replies) + `WriteOnce<UnorderedMap<id, Slot>>` | one `messages` table keyed by id: `thread` index on `(parent, seq)` (`parent` is `""` at the top level), `perThread` count, full-text `search` on the folded text |
//! | the vector's stable index | `seq`: a message's position among its parent's, from `nextSeq`, never reused |
//! | `mentions`, `mentions_usernames`, `files`, `images` inside the message | `extras`, a map beside the table (a record holds no lists), bounded per message |
//! | `Attachment { blob_id: BlobId }`, `blob_announce_to_context` | `BlobRef` in `extras` (the host keeps a referenced blob) |
//! | `AuthoredSortedMap<"msg␟emoji␟account", ()>` | `reactions: UnorderedMap<(message, emoji, account), bool>` |
//! | `UserStorage<StoredProfile>` | `profiles: UnorderedMap<account, Profile>` (listed by `getProfiles`, written only by its account) |
//! | `AccessControl` (admins, `"mod"`) + `SharedStorage<banned>` | `roles: UnorderedMap<account, Role>`; absent is `User` |
//! | `SharedStorage<hidden>` (a staff removal of a top-level message) | the message itself, blanked and marked deleted |
//! | `UserStorage<LwwRegister<u64>>` read receipts | `readReceipts: PerUser<u64>` |
//! | `Frozen<Founding>` + `SharedStorage<ChannelText>` | `info: Cell<Info>` |
//! | `#[app::private] Drafts` (node-local) | `drafts: UnorderedMap<(account, channel), text>` in app state: see `saveDraft` |
//! | `app::search_indexes!` over both collections | `#[table(search = ["search_text"])]` |
//!
//! # Who may do what
//!
//! The platform decides who reaches the conversation (the organization's
//! members, admins, owner and guests for a channel; the two accounts of a DM).
//! Every one of them may read, send, react, keep a draft and name themselves.
//! The rules v1 kept in storage (`Authored*`, `Moderated`, `SharedStorage`,
//! `UserStorage`, `AccessControl`) are checks here, against `env::caller()`,
//! before anything is written:
//!
//! - only a message's sender edits it (`Forbidden`); its sender or a moderator
//!   or admin deletes it;
//! - only an admin (the creator, whoever an admin made one, and the
//!   organization's owner and admins) changes the conversation's info or
//!   anyone's role; a moderator
//!   may only ban a `User` or unban a `Banned` member;
//! - a `Banned` member's sends, edits, deletes, reactions, profile and drafts
//!   are refused (`Banned`). In v1 the ban was checked on the banned member's
//!   own node, which a patched node skipped; here the leader checks it;
//! - a profile, a reaction, a read receipt and a draft are always the caller's
//!   own: no method takes the account it writes for.
//!
//! Every client-visible difference from v1 is in `apps/mero-chat/README.md`,
//! "What changed in the port".

use std::collections::BTreeMap;

use calimero_app_sdk::env::{Caller, OrgRole};
use calimero_app_sdk::prelude::*;
use serde::{Deserialize, Serialize};

mod search;

/// Longest accepted search term, in bytes (the host refuses more than 256).
pub const MAX_SEARCH_TERM_LEN: usize = 256;
/// Hits `searchMessages` returns when the caller names no limit, and the most
/// it returns at all.
pub const DEFAULT_SEARCH_LIMIT: u32 = 20;
pub const MAX_SEARCH_LIMIT: u32 = 50;
/// What one `searchMessagesScan` (and one filtered `getMessages`) may read
/// before it stops: stored messages, and bytes of their text.
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
/// An account id, a mention, a file name or a draft's channel name, in bytes.
pub const MAX_ID_LEN: usize = 256;

/// How far ahead of the log's clock a client timestamp may be, in seconds.
/// Timestamps are the client's (seconds since the epoch) and order unread
/// counts; one far in the future would stay "unread" forever.
pub const MAX_CLOCK_SKEW_SECS: u64 = 300;

/// How many of the newest messages an unread count looks at.
pub const MAX_UNREAD_SCAN: u32 = 500;

/// Messages one `getMessages` / `getMessagesFrom` page holds when the caller
/// names no limit, and the most it holds at all.
pub const DEFAULT_MESSAGE_PAGE: u32 = 100;
pub const MAX_MESSAGE_PAGE: u32 = 500;

/// Rows of a listing (`getProfiles`, `listRoles`) per page, and the most.
pub const DEFAULT_LIST_PAGE: u32 = 100;
pub const MAX_LIST_PAGE: u32 = 1_000;

/// Reactions read for one message: one page of its reactions.
const MAX_REACTIONS_READ: u32 = 1_000;
/// Rows removed per batch when a staff removal clears what hangs off a reply.
const BATCH: u32 = 1_000;

/// The `parent` of a top-level message.
const TOP: &str = "";

// ── stored records ───────────────────────────────────────────────────────────

/// One message: top-level (`parent` is `""`) or a reply in a thread (`parent`
/// is the top-level message's id). The lists a message carries are in
/// `extras`, beside it.
#[derive(Record)]
#[table(
    key = "id",
    index(thread = ["parent", "seq"]),
    count(per_thread = ["parent"]),
    search = ["search_text"],
)]
pub struct Message {
    /// 64 hex characters, `_`, the client timestamp: v1's shape.
    pub id: String,
    /// `""` for a top-level message, else the top-level message it replies to.
    pub parent: String,
    /// Its position among its parent's messages: the stable `index` clients
    /// page and resume by. Appends take the next one; nothing renumbers.
    pub seq: u64,
    /// The account that sent it.
    pub sender: String,
    /// The client's timestamp, seconds since the epoch.
    pub timestamp: u64,
    /// The message as the editor wrote it (HTML).
    pub text: String,
    /// What the host's full-text index holds: the text a reader sees, folded
    /// for case and accents. `""` once deleted, so a deleted message is never
    /// found.
    pub search_text: String,
    /// The client timestamp of the last edit.
    pub edited_on: Option<u64>,
    /// Blanked by its sender or a moderator: the slot stays, the text is gone.
    pub deleted: bool,
}

/// A file or an image on a message.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    /// The blob; the host keeps it while this reference is stored.
    pub blob: BlobRef,
    /// When it was attached: the log's clock, milliseconds since the epoch.
    pub uploaded_at: u64,
}

/// The lists one message carries, kept beside its record (a record holds no
/// lists). Written once, when the message is sent; absent when all are empty.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extras {
    /// At most `MAX_MENTIONS` (enforced by `sendMessage`).
    pub mentions: Vec<String>,
    /// At most `MAX_MENTIONS` (enforced by `sendMessage`).
    pub mentions_usernames: Vec<String>,
    /// At most `MAX_ATTACHMENTS` (enforced by `sendMessage`).
    pub files: Vec<Attachment>,
    /// At most `MAX_ATTACHMENTS` (enforced by `sendMessage`).
    pub images: Vec<Attachment>,
}

/// One account's profile in this conversation.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Fixed by the first `setProfile`.
    pub username: String,
    pub avatar: Option<BlobRef>,
}

/// What the conversation is, and what it is called.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub name: String,
    pub context_type: ContextType,
    pub description: String,
    /// Seconds since the epoch.
    pub created_at: u64,
    /// The account that created it (the app's owner).
    pub creator: String,
}

/// `"Channel"` or `"Dm"`, fixed when the conversation is created.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContextType {
    #[default]
    Channel,
    Dm,
}

/// A member's moderation role here.
///
/// - `User`: everyone without another role;
/// - `Mod`: may ban a `User` and unban a `Banned` member;
/// - `Admin`: may change anyone's role and the info; the creator starts here;
/// - `Banned`: may read, but every write of theirs is refused.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    #[default]
    User,
    Mod,
    Admin,
    Banned,
}

// ── arguments and results ────────────────────────────────────────────────────

/// A file or image to attach: a blob the client uploaded to this app first
/// (`POST /apps/{app}/blobs`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentInput {
    pub name: String,
    pub mime_type: String,
    /// The client's count; the node's own record of the blob's size wins.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub size: u64,
    /// The blob id: 64 lowercase hex digits.
    pub blob_id_str: String,
}

/// An attachment as callers see it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub name: String,
    pub mime_type: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub size: u64,
    /// 64 lowercase hex digits: `GET /apps/{app}/blobs/{id}`.
    pub blob_id: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub uploaded_at: u64,
}

/// A message as callers see it (v1's `MessageWithReactions`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    /// Its position among its parent's messages: stable, so a client can store
    /// it and resume from it (`getMessagesFrom`).
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub index: u64,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub timestamp: u64,
    pub sender: String,
    pub mentions: Vec<String>,
    pub mentions_usernames: Vec<String>,
    pub files: Vec<AttachmentView>,
    pub images: Vec<AttachmentView>,
    pub id: String,
    /// `""` once deleted.
    pub text: String,
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub edited_on: Option<u64>,
    /// Emoji -> the accounts that reacted with it; `null` when none (or deleted).
    pub reactions: Option<BTreeMap<String, Vec<String>>>,
    /// `true` once deleted, else `null`.
    pub deleted: Option<bool>,
    /// Replies, for a top-level message read with its thread; else 0.
    pub thread_count: u32,
    /// The newest reply's timestamp, or 0.
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub thread_last_timestamp: u64,
    /// The top-level message a reply belongs to; `null` at the top level.
    pub parent_message_id: Option<String>,
}

/// A window of messages.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageView>,
    pub start_position: u32,
}

/// One message a search found: enough to list and open it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    /// Set for a thread reply: the top-level message it replies to.
    pub parent_message_id: Option<String>,
    /// Position of the top-level message (the hit, or a reply's parent); `null`
    /// from the index-backed search: ask `messagePosition`.
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub index: Option<u64>,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub timestamp: u64,
    /// The timestamp the hit is listed by: its own (index), its thread's (scan).
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub anchor_timestamp: u64,
    pub sender: String,
    /// Plain text around the first match, not markup.
    pub snippet: String,
    /// The match inside `snippet`, in UTF-16 code units (a JS string index).
    pub match_start: u32,
    pub match_end: u32,
}

/// A page of a search.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    /// Opaque; pass it back for the next page. `null` at the end.
    pub next_cursor: Option<String>,
    /// The scan: the oldest top-level timestamp it read (later pages rank at
    /// or below it). The index ranks by relevance, so it answers `null`.
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub frontier_timestamp: Option<u64>,
}

/// The conversation's metadata (`getInfo`, `getChannelInfo`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub name: String,
    pub context_type: ContextType,
    pub description: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
    pub creator: String,
}

/// A profile as callers see it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub identity: String,
    pub username: String,
    /// The avatar's blob id, or `null`.
    pub avatar: Option<String>,
}

/// A page of profiles.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePage {
    pub items: Vec<UserProfile>,
    pub next: Option<String>,
}

/// A member with a role other than `User`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleEntry {
    pub identity: String,
    pub role: Role,
}

/// A page of roles.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePage {
    pub items: Vec<RoleEntry>,
    pub next: Option<String>,
}

// ── state ────────────────────────────────────────────────────────────────────

/// One conversation.
#[app::state(version = 1)]
pub struct MeroChat {
    /// Name, type, description, creation. Set by `init`.
    info: Cell<Info>,
    /// Every message, top-level and reply.
    messages: Table<Message>,
    /// Parent (`""` for the top level) -> the `seq` its next message takes.
    next_seq: UnorderedMap<String, u64>,
    /// Message id -> its mentions and attachments, when it has any.
    extras: UnorderedMap<String, Extras>,
    /// `(message, emoji, account)` -> `true`: the key is the reaction.
    reactions: UnorderedMap<(String, String, String), bool>,
    /// Account -> its profile, written only by that account.
    profiles: UnorderedMap<String, Profile>,
    /// Account -> its role, when it is not `User`.
    roles: UnorderedMap<String, Role>,
    /// Each account's last-read timestamp, written only by that account.
    read_receipts: PerUser<u64>,
    /// `(account, channel)` -> that account's unsent draft.
    drafts: UnorderedMap<(String, String), String>,
}

#[app::logic]
#[allow(clippy::too_many_arguments)]
impl MeroChat {
    /// The new conversation. The node runs it once, when the app is created,
    /// with the `initArgs` the creator passes (all optional: a nameless
    /// `Channel` without them). The creator (the app's owner) is its first
    /// admin; a non-blank `creatorUsername` is their profile. `createdAt`
    /// (seconds) defaults to the log's clock. Emits `Initialized`.
    #[app::init]
    pub fn init(
        name: Option<String>,
        context_type: Option<ContextType>,
        description: Option<String>,
        created_at: Option<u64>,
        creator_username: Option<String>,
    ) -> app::Result<Self> {
        let name = name.unwrap_or_default();
        let description = description.unwrap_or_default();
        check_max("name", &name, MAX_NAME_LEN)?;
        check_max("description", &description, MAX_DESCRIPTION_LEN)?;
        let creator = env::app_owner();
        let mut chat = Self::load();
        chat.info.set(&Info {
            name,
            context_type: context_type.unwrap_or_default(),
            description,
            created_at: created_at.unwrap_or_else(now_secs),
            creator: creator.clone(),
        })?;
        let _old = chat.roles.insert(&creator, &Role::Admin)?;
        if let Some(username) = creator_username.filter(|u| !u.trim().is_empty()) {
            check_username(&username)?;
            let _old = chat.profiles.insert(
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

    /// The conversation's name, type, description, creation time and creator.
    #[app::view]
    pub fn get_info(&self) -> app::Result<ContextInfo> {
        let info = self.info()?;
        Ok(ContextInfo {
            name: info.name,
            context_type: info.context_type,
            description: info.description,
            created_at: info.created_at,
            creator: info.creator,
        })
    }

    /// `getInfo`, for frontends that ask for it by its old name. `channel` is
    /// accepted and ignored: one app is one conversation.
    #[app::view]
    pub fn get_channel_info(&self, channel: Option<String>) -> app::Result<ContextInfo> {
        let _ = channel;
        self.get_info()
    }

    /// Renames the conversation or changes its description (either may be
    /// `null`: unchanged). Admins only (`Forbidden`). Emits `InfoUpdated`.
    pub fn update_info(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<String> {
        let me = account()?;
        if self.role_of(&me)? != Role::Admin {
            return Err(forbidden("Only an admin can change the channel's info"));
        }
        let mut info = self.info()?;
        if let Some(name) = name {
            check_max("name", &name, MAX_NAME_LEN)?;
            info.name = name;
        }
        if let Some(description) = description {
            check_max("description", &description, MAX_DESCRIPTION_LEN)?;
            info.description = description;
        }
        self.info.set(&info)?;
        env::emit(Event::InfoUpdated, Audience::All)?;
        Ok("Info updated".to_owned())
    }

    // ── read state ───────────────────────────────────────────────────────────

    /// Kept so frontends calling it get an answer: `"ok"`, nothing recorded.
    /// `markAsRead` records the read position.
    #[app::view]
    pub fn mark_messages_as_read(
        &self,
        channel: Option<String>,
        timestamp: Option<u64>,
    ) -> app::Result<String> {
        let _ = (channel, timestamp);
        Ok("ok".to_owned())
    }

    /// Records the caller's last-read timestamp (seconds). No event: nobody
    /// else needs to know.
    pub fn mark_as_read(&mut self, timestamp: u64) -> app::Result<String> {
        let _ = account()?;
        let _account = self.read_receipts.set(&timestamp)?;
        Ok("ok".to_owned())
    }

    /// Top-level messages newer than the caller's last-read timestamp, not
    /// sent by the caller and not deleted. Looks at the newest 500 messages
    /// only, so the count saturates there.
    #[app::view]
    pub fn get_unread_count(&self) -> app::Result<u32> {
        let me = account()?;
        self.unread(&me, |_| Ok(true))
    }

    /// The unread messages (as `getUnreadCount` counts them) that mention the
    /// caller or `@everyone` / `@here`.
    #[app::view]
    pub fn get_unread_mentions(&self) -> app::Result<u32> {
        let me = account()?;
        self.unread(&me, |message| {
            let Some(extras) = self.extras.get(&message.id)? else {
                return Ok(false);
            };
            Ok(extras
                .mentions_usernames
                .iter()
                .any(|u| u == "everyone" || u == "here")
                || extras.mentions.contains(&me))
        })
    }

    // ── profiles ─────────────────────────────────────────────────────────────

    /// Sets the caller's profile. The username is fixed by the first call:
    /// later calls change only the avatar (a `null` avatar keeps the one
    /// there). `username` must not be blank (at most 50 bytes); `avatar` is the
    /// id of a blob uploaded to this app (`Invalid` otherwise). Emits
    /// `ProfileUpdated`.
    pub fn set_profile(&mut self, username: String, avatar: Option<String>) -> app::Result<String> {
        let me = self.active_account()?;
        check_username(&username)?;
        let avatar = avatar.map(|id| held_blob(&id)).transpose()?;
        let profile = match self.profiles.get(&me)? {
            Some(existing) => Profile {
                username: existing.username,
                avatar: avatar.or(existing.avatar),
            },
            None => Profile { username, avatar },
        };
        let _old = self.profiles.insert(&me, &profile)?;
        env::emit(Event::ProfileUpdated { identity: me }, Audience::All)?;
        Ok("Profile set".to_owned())
    }

    /// One page of profiles, in account order: `cursor` is the previous page's
    /// `next` (`null` for the first), `limit` at most 1,000 (100 when `null`).
    #[app::view]
    pub fn get_profiles(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ProfilePage> {
        let page = self.profiles.page(list_opts(cursor, limit))?;
        Ok(ProfilePage {
            items: page
                .items
                .into_iter()
                .map(|(identity, p)| UserProfile {
                    identity,
                    username: p.username,
                    avatar: p.avatar.map(|a| a.id()),
                })
                .collect(),
            next: page.next,
        })
    }

    // ── drafts ───────────────────────────────────────────────────────────────

    /// Saves the caller's draft for `channel`; an empty `text` deletes it.
    ///
    /// v1 kept drafts in node-local `#[app::private]` storage, which the
    /// component SDK does not have. They are in the app's state here, keyed by
    /// the caller's account: only `getDraft` reads one, and only its author's.
    pub fn save_draft(&mut self, channel: String, text: String) -> app::Result<()> {
        let me = self.active_account()?;
        check_max("channel", &channel, MAX_ID_LEN)?;
        check_max("text", &text, MAX_MESSAGE_LEN)?;
        let key = (me, channel);
        if text.is_empty() {
            let _old = self.drafts.remove(&key)?;
        } else {
            let _old = self.drafts.insert(&key, &text)?;
        }
        Ok(())
    }

    /// The caller's draft for `channel`, or `""`.
    #[app::view]
    pub fn get_draft(&self, channel: String) -> app::Result<String> {
        let me = account()?;
        Ok(self.drafts.get(&(me, channel))?.unwrap_or_default())
    }

    /// Deletes the caller's draft for `channel`.
    pub fn delete_draft(&mut self, channel: String) -> app::Result<()> {
        let me = self.active_account()?;
        let _old = self.drafts.remove(&(me, channel))?;
        Ok(())
    }

    // ── roles ────────────────────────────────────────────────────────────────

    /// `identity`'s role: the one set for them, else `Admin` for an owner or
    /// admin of the organization, else `User`.
    #[app::view]
    pub fn get_member_role(&self, identity: String) -> app::Result<Role> {
        self.role_of(&identity)
    }

    /// One page of the members whose role was set (not `User`), in account
    /// order (`cursor`, `limit` as `getProfiles`). The organization's owner and
    /// admins are `Admin` without being listed (`getMemberRole` answers them).
    #[app::view]
    pub fn list_roles(&self, cursor: Option<String>, limit: Option<u32>) -> app::Result<RolePage> {
        let page = self.roles.page(list_opts(cursor, limit))?;
        Ok(RolePage {
            items: page
                .items
                .into_iter()
                .map(|(identity, role)| RoleEntry { identity, role })
                .collect(),
            next: page.next,
        })
    }

    /// Changes `target`'s role. An admin may set anyone's role to anything,
    /// except their own below `Admin`; a moderator may only turn a `User` into
    /// `Banned` or back; anyone else gets `Forbidden`. `target` must be the
    /// app's owner or in its organization (`Invalid`). Emits `RoleUpdated`
    /// when the role changes; setting the role someone has answers
    /// `"Role unchanged"` and announces nothing.
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
        if target != env::app_owner() && env::org_role(&target).is_none() {
            return Err(invalid(format!("{target} is not a member")));
        }
        if current == role {
            return Ok("Role unchanged".to_owned());
        }
        if role == Role::User {
            let _old = self.roles.remove(&target)?;
        } else {
            let _old = self.roles.insert(&target, &role)?;
        }
        env::emit(Event::RoleUpdated { identity: target }, Audience::All)?;
        Ok("Role updated".to_owned())
    }

    // ── messages ─────────────────────────────────────────────────────────────

    /// Sends a message as the caller, at the top level or, with
    /// `parentMessage`, as a reply in that top-level message's thread
    /// (`NotFound` for a missing parent). `timestamp` is the client's, in
    /// seconds, at most 300 s ahead of the log's clock. At most 20,000 bytes of
    /// text, 100 mentions, 10 files and 10 images, each a blob uploaded to this
    /// app (`Invalid`). Emits `MessageSent`, or `MessageSentThread` for a reply.
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
        let me = self.active_account()?;
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
        for m in mentions.iter().chain(&mentions_usernames) {
            check_max("mention", m, MAX_ID_LEN)?;
        }
        let files = files.unwrap_or_default();
        let images = images.unwrap_or_default();
        if files.len() > MAX_ATTACHMENTS || images.len() > MAX_ATTACHMENTS {
            return Err(invalid(format!(
                "A message can carry at most {MAX_ATTACHMENTS} files and {MAX_ATTACHMENTS} images"
            )));
        }
        let parent = match &parent_message {
            Some(parent) => {
                let top = self.messages.get(parent)?;
                if !top.is_some_and(|m| m.parent == TOP) {
                    return Err(not_found("message", parent));
                }
                parent.clone()
            }
            None => TOP.to_owned(),
        };
        let extras = Extras {
            mentions,
            mentions_usernames,
            files: attachments(files)?,
            images: attachments(images)?,
        };
        let id = fresh_message_id(timestamp);
        let seq = self.next_seq.get(&parent)?.unwrap_or(0);
        let _old = self.next_seq.insert(&parent, &(seq + 1))?;
        let record = Message {
            id: id.clone(),
            parent: parent.clone(),
            seq,
            sender: me,
            timestamp,
            search_text: search::indexed_text(&message),
            text: message,
            edited_on: None,
            deleted: false,
        };
        self.messages.insert(record)?;
        if !(extras.mentions.is_empty()
            && extras.mentions_usernames.is_empty()
            && extras.files.is_empty()
            && extras.images.is_empty())
        {
            let _old = self.extras.insert(&id, &extras)?;
        }
        let event = if parent == TOP {
            Event::MessageSent {
                message_id: id.clone(),
            }
        } else {
            Event::MessageSentThread {
                message_id: id.clone(),
                parent_message_id: parent,
            }
        };
        env::emit(event, Audience::All)?;
        self.view_of_id(&id)
    }

    /// A window of the channel, or of one thread (`parentMessage`), counted
    /// back from the END: `offset` 0 is the newest page. `limit` defaults to
    /// 100 and is at most 500. Each message carries its `index`, reactions and,
    /// at the top level, its thread's size and newest reply.
    ///
    /// `searchTerm` keeps only messages whose text contains it (folded, as
    /// `searchMessages` compares), among the newest 2,000 messages (or 1 MiB of
    /// text); `totalCount` is then the matches among those. `searchMessages`
    /// searches everything.
    #[app::view]
    pub fn get_messages(
        &self,
        parent_message: Option<String>,
        limit: Option<u32>,
        offset: Option<u32>,
        search_term: Option<String>,
    ) -> app::Result<FullMessageResponse> {
        let parent = parent_message.unwrap_or_default();
        let limit = message_limit(limit);
        let offset = offset.unwrap_or(0);
        let top = parent == TOP;
        if let Some(term) = search_term {
            check_term(&term)?;
            let needle = search::fold_query(&term);
            // Newest first, bounded; then the window, counted from the end.
            let mut matches = Vec::new();
            let (mut rows, mut bytes) = (0usize, 0usize);
            let mut cursor: Option<String> = None;
            'scan: loop {
                let mut opts = FindOpts::default().reverse().limit(BATCH);
                if let Some(c) = cursor.take() {
                    opts = opts.cursor(c);
                }
                let page = self
                    .messages
                    .find("thread", &[KeyPart::Str(parent.clone())], opts)?;
                for message in page.items {
                    if rows >= MAX_SEARCH_ROWS || bytes >= MAX_SEARCH_BYTES {
                        break 'scan;
                    }
                    rows += 1;
                    bytes += message.text.len();
                    if !message.deleted && search::folded_text(&message.text).contains(&needle) {
                        matches.push(message);
                    }
                }
                match page.next {
                    Some(next) => cursor = Some(next),
                    None => break,
                }
            }
            matches.reverse();
            let total = matches.len() as u64;
            let (window, start_position) = page_window(total, limit, offset);
            let messages = matches
                .into_iter()
                .skip(window.start as usize)
                .take((window.end - window.start) as usize)
                .map(|m| self.view(m, top))
                .collect::<app::Result<_>>()?;
            return Ok(FullMessageResponse {
                total_count: total as u32,
                messages,
                start_position,
            });
        }
        let total = self.count_of(&parent)?;
        let end_seq = self.next_seq.get(&parent)?.unwrap_or(0);
        // Positions are seqs: the top level is never removed from, so its count
        // and its next seq agree; a thread's window is its newest seqs.
        let (window, start_position) = page_window(end_seq, limit, offset);
        let messages = self.window(&parent, window.start, window.end, top)?;
        Ok(FullMessageResponse {
            total_count: total as u32,
            messages,
            start_position,
        })
    }

    /// Top-level messages by position, ascending, from `start`: the resumable
    /// read. Positions never move, so a client holding everything through
    /// index `n` asks for `n + 1` and gets exactly what it missed. `limit`
    /// defaults to 100 and is at most 500; `totalCount` is the channel's length.
    #[app::view]
    pub fn get_messages_from(
        &self,
        start: u64,
        limit: Option<u32>,
    ) -> app::Result<FullMessageResponse> {
        let total = self.count_of(TOP)?;
        let end = start
            .saturating_add(u64::from(message_limit(limit)))
            .min(total);
        let messages = if start >= total {
            Vec::new()
        } else {
            self.window(TOP, start, end, true)?
        };
        Ok(FullMessageResponse {
            total_count: total as u32,
            messages,
            start_position: start as u32,
        })
    }

    /// How many top-level messages the channel holds (a stored count).
    #[app::view]
    pub fn get_message_count(&self) -> app::Result<u64> {
        self.count_of(TOP)
    }

    /// Messages whose text contains `query`, from the host's full-text index:
    /// a page costs the same however long the channel is. Text is matched as a
    /// reader sees it, folded for case and accents ("cafe" finds "Café"); a
    /// query of three characters or more matches anywhere, a shorter one the
    /// start of a word. Deleted messages are never found. Top-level messages
    /// and replies come together, best match first, newest first within a
    /// page; at most `limit` hits (20 when `null`, at most 50), `nextCursor`
    /// continues. Hits carry no `index`: open one with `messagePosition`.
    #[app::view]
    pub fn search_messages(
        &self,
        query: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage> {
        check_term(&query)?;
        let needle = search::fold_query(&query);
        let limit = search_limit(limit);
        let mut page = SearchPage {
            hits: Vec::new(),
            next_cursor: None,
            frontier_timestamp: None,
        };
        if needle.is_empty() {
            return Ok(page);
        }
        let offset = match cursor {
            None => 0,
            Some(raw) => raw
                .parse::<u32>()
                .map_err(|_| invalid("Invalid search cursor"))?,
        };
        let mode = if needle.chars().count() >= 3 {
            SearchMode::Substring
        } else {
            SearchMode::Prefix
        };
        let found = self.messages.search(
            &needle,
            SearchOpts::default().mode(mode).cursor(offset).limit(limit),
        )?;
        for hit in found.items {
            let message = hit.record;
            if message.deleted {
                continue;
            }
            let snippet = search::snippet(&search::plain_text(&message.text), &needle);
            let parent = (message.parent != TOP).then(|| message.parent.clone());
            page.hits.push(search_hit(
                &message,
                parent,
                None,
                message.timestamp,
                snippet,
            ));
        }
        page.hits.sort_by_key(|h| std::cmp::Reverse(h.timestamp));
        page.next_cursor = found.next.map(|n| n.to_string());
        Ok(page)
    }

    /// The position of the top-level message `messageId`, for opening a search
    /// hit where it was said (`getMessagesFrom`); `null` for a reply (open its
    /// parent's) or an unknown id.
    #[app::view]
    pub fn message_position(&self, message_id: String) -> app::Result<Option<u64>> {
        Ok(self
            .messages
            .get(&message_id)?
            .filter(|m| m.parent == TOP)
            .map(|m| m.seq))
    }

    /// The id of the message at position `index` among `parentMessage`'s
    /// replies (the top level when `null`), or `null`: `messagePosition`'s
    /// inverse, for a link that names a position. New in the port.
    #[app::view]
    pub fn message_id_at(
        &self,
        parent_message: Option<String>,
        index: u64,
    ) -> app::Result<Option<String>> {
        let parent = parent_message.unwrap_or_default();
        Ok(self.at(&parent, index)?.map(|m| m.id))
    }

    /// `searchMessages` without the index: walks the channel from the newest
    /// message down, each top-level message followed by its thread, so a reply
    /// is listed with its thread and ranked by `anchorTimestamp`. A call stops
    /// at `limit` hits (20, at most 50) or after reading 2,000 messages or
    /// 1 MiB of text, and returns a `nextCursor` to continue from; a page can
    /// hold fewer hits than `limit`, even none, and still not be the last.
    #[app::view]
    pub fn search_messages_scan(
        &self,
        query: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage> {
        check_term(&query)?;
        let needle = search::fold_query(&query);
        let limit = search_limit(limit) as usize;
        let total = self.count_of(TOP)? as usize;
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
                .ok_or_else(|| invalid("Invalid search cursor"))?,
        };
        let (mut rows, mut bytes) = (0usize, 0usize);
        let spent =
            |rows: usize, bytes: usize| rows >= MAX_SEARCH_ROWS || bytes >= MAX_SEARCH_BYTES;
        'walk: loop {
            if page.hits.len() >= limit || spent(rows, bytes) {
                page.next_cursor = Some(at.encode());
                break;
            }
            if let Some(message) = self.at(TOP, at.index as u64)? {
                rows += 1;
                let anchor = message.timestamp;
                page.frontier_timestamp =
                    Some(page.frontier_timestamp.map_or(anchor, |f| f.min(anchor)));
                let mut after = match &at.step {
                    search::Step::Message => {
                        bytes += message.text.len();
                        if let Some(found) = hit_snippet(&message, &needle) {
                            page.hits.push(search_hit(
                                &message,
                                None,
                                Some(at.index as u64),
                                anchor,
                                found,
                            ));
                        }
                        None
                    }
                    search::Step::Replies(after) => match after {
                        None => None,
                        Some(seq) => Some(
                            seq.parse::<u64>()
                                .map_err(|_| invalid("Invalid search cursor"))?,
                        ),
                    },
                };
                let mut next_reply: Option<String> = None;
                loop {
                    let from = after.map_or(0, |s| s + 1);
                    let mut opts = FindOpts::default()
                        .from(vec![KeyPart::Int(i128::from(from))])
                        .limit(BATCH);
                    if let Some(c) = next_reply.take() {
                        opts = opts.cursor(c);
                    }
                    let replies =
                        self.messages
                            .find("thread", &[KeyPart::Str(message.id.clone())], opts)?;
                    for reply in replies.items {
                        if page.hits.len() >= limit || spent(rows, bytes) {
                            at.step = search::Step::Replies(after.map(|s| s.to_string()));
                            page.next_cursor = Some(at.encode());
                            break 'walk;
                        }
                        rows += 1;
                        bytes += reply.text.len();
                        if let Some(found) = hit_snippet(&reply, &needle) {
                            page.hits.push(search_hit(
                                &reply,
                                Some(message.id.clone()),
                                Some(at.index as u64),
                                anchor,
                                found,
                            ));
                        }
                        after = Some(reply.seq);
                    }
                    match replies.next {
                        Some(next) => next_reply = Some(next),
                        None => break,
                    }
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

    /// Adds (`add`) or removes the caller's `emoji` reaction to a message
    /// (`NotFound` for a missing one). `emoji` is 1 to 64 bytes. Emits
    /// `ReactionUpdated`.
    pub fn update_reaction(
        &mut self,
        message_id: String,
        emoji: String,
        add: bool,
    ) -> app::Result<String> {
        let me = self.active_account()?;
        if emoji.is_empty() || emoji.len() > MAX_EMOJI_LEN {
            return Err(invalid("Invalid emoji"));
        }
        if !self.messages.contains(&message_id)? {
            return Err(not_found("message", &message_id));
        }
        let key = (message_id.clone(), emoji, me);
        if add {
            let _old = self.reactions.insert(&key, &true)?;
        } else {
            let _old = self.reactions.remove(&key)?;
        }
        env::emit(Event::ReactionUpdated { message_id }, Audience::All)?;
        let action = if add { "added" } else { "removed" };
        Ok(format!("Reaction {action} successfully"))
    }

    /// Replaces the text of the caller's own message (`Forbidden` for anyone
    /// else's; `NotFound` for a missing or deleted one, or a `parentId` that is
    /// not its thread's). `timestamp` (seconds) becomes its `editedOn`. Emits
    /// `MessageEdited`.
    pub fn edit_message(
        &mut self,
        message_id: String,
        new_message: String,
        timestamp: u64,
        parent_id: Option<String>,
    ) -> app::Result<MessageView> {
        let me = self.active_account()?;
        check_timestamp(timestamp)?;
        if new_message.len() > MAX_MESSAGE_LEN {
            return Err(invalid(format!(
                "Message cannot be longer than {MAX_MESSAGE_LEN} bytes"
            )));
        }
        let message = self.find_message(&message_id, parent_id.as_deref())?;
        if message.deleted {
            return Err(not_found("message", &message_id));
        }
        if message.sender != me {
            return Err(forbidden("You can only edit your own messages"));
        }
        let _ = self.messages.update(&message_id, |m| {
            m.search_text = search::indexed_text(&new_message);
            m.text = new_message;
            m.edited_on = Some(timestamp);
        })?;
        env::emit(
            Event::MessageEdited {
                message_id: message_id.clone(),
            },
            Audience::All,
        )?;
        self.view_of_id(&message_id)
    }

    /// Deletes a message. Its sender blanks it in place (the slot and its
    /// `index` stay). A moderator or admin deletes anyone's: a reply is removed
    /// from its thread outright (with its reactions), a top-level message is
    /// blanked. Anyone else gets `Forbidden`; a missing message, or a
    /// `parentId` that is not its thread's, `NotFound`. Emits `MessageSent`
    /// (top level) or `MessageSentThread` (reply), as v1 did.
    pub fn delete_message(
        &mut self,
        message_id: String,
        parent_id: Option<String>,
    ) -> app::Result<String> {
        let me = self.active_account()?;
        let message = self.find_message(&message_id, parent_id.as_deref())?;
        let staff = matches!(self.role_of(&me)?, Role::Admin | Role::Mod);
        let reply = message.parent != TOP;
        if message.sender == me || (staff && !reply) {
            let _ = self.messages.update(&message_id, |m| {
                m.text = String::new();
                m.search_text = String::new();
                m.deleted = true;
            })?;
        } else if staff {
            self.remove_reply(&message_id)?;
        } else {
            return Err(forbidden(
                "You don't have permission to delete this message",
            ));
        }
        if reply {
            env::emit(
                Event::MessageSentThread {
                    message_id,
                    parent_message_id: message.parent,
                },
                Audience::All,
            )?;
            Ok("Thread message deleted successfully".to_owned())
        } else {
            env::emit(Event::MessageSent { message_id }, Audience::All)?;
            Ok("Message deleted successfully".to_owned())
        }
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No `what` with this `id` (a message, a parent).
    NotFound { what: String, id: String },
    /// The caller may not do this.
    Forbidden { message: String },
    /// An argument is out of bounds or malformed.
    Invalid { message: String },
    /// The caller is banned here: every write of theirs is refused.
    Banned,
}

/// A change to the conversation, emitted after the write that caused it, to
/// everyone who reaches it.
#[app::event]
pub enum Event {
    /// The conversation was created.
    Initialized,
    /// A top-level message was sent, or deleted (as in v1).
    MessageSent { message_id: String },
    /// A reply was sent in `parentMessageId`'s thread, or deleted.
    MessageSentThread {
        message_id: String,
        parent_message_id: String,
    },
    /// Someone's reactions to `messageId` changed.
    ReactionUpdated { message_id: String },
    /// The text of `messageId` changed.
    MessageEdited { message_id: String },
    /// `identity` set their profile.
    ProfileUpdated { identity: String },
    /// The name or description changed.
    InfoUpdated,
    /// `identity`'s role changed.
    RoleUpdated { identity: String },
}

impl MeroChat {
    fn info(&self) -> app::Result<Info> {
        self.info
            .get()?
            .ok_or_else(|| not_found("info", "conversation"))
    }

    /// `account`'s role: the one set for them; else `Admin` for an owner or
    /// admin of the app's organization (v1's frontend made every workspace
    /// admin an admin of each channel they opened); else `User`.
    fn role_of(&self, account: &str) -> app::Result<Role> {
        if let Some(role) = self.roles.get(&account.to_owned())? {
            return Ok(role);
        }
        Ok(match env::org_role(account) {
            Some(OrgRole::Admin | OrgRole::Owner) => Role::Admin,
            _ => Role::User,
        })
    }

    /// The caller, refused when banned.
    fn active_account(&self) -> app::Result<String> {
        let me = account()?;
        if self.role_of(&me)? == Role::Banned {
            return Err(Error::Banned.into());
        }
        Ok(me)
    }

    /// How many messages `parent` holds now (a maintained count).
    fn count_of(&self, parent: &str) -> app::Result<u64> {
        Ok(self
            .messages
            .count("perThread", &[KeyPart::Str(parent.to_owned())])?)
    }

    /// The message of `parent`'s at position `seq`.
    fn at(&self, parent: &str, seq: u64) -> app::Result<Option<Message>> {
        let page = self.messages.find(
            "thread",
            &[KeyPart::Str(parent.to_owned())],
            FindOpts::default()
                .from(vec![KeyPart::Int(i128::from(seq))])
                .to(vec![KeyPart::Int(i128::from(seq) + 1)])
                .limit(1),
        )?;
        Ok(page.items.into_iter().next())
    }

    /// `parent`'s messages at positions `[start, end)`, rendered, ascending.
    fn window(
        &self,
        parent: &str,
        start: u64,
        end: u64,
        with_threads: bool,
    ) -> app::Result<Vec<MessageView>> {
        if start >= end {
            return Ok(Vec::new());
        }
        let page = self.messages.find(
            "thread",
            &[KeyPart::Str(parent.to_owned())],
            FindOpts::default()
                .from(vec![KeyPart::Int(i128::from(start))])
                .to(vec![KeyPart::Int(i128::from(end))])
                .limit((end - start).min(u64::from(MAX_MESSAGE_PAGE)) as u32),
        )?;
        page.items
            .into_iter()
            .map(|m| self.view(m, with_threads))
            .collect()
    }

    /// The message `id`, which must be in `parent`'s thread when one is named.
    fn find_message(&self, id: &str, parent: Option<&str>) -> app::Result<Message> {
        match self.messages.get(id)? {
            Some(m) if parent.is_none_or(|p| p == m.parent) => Ok(m),
            _ => Err(not_found("message", id)),
        }
    }

    fn view_of_id(&self, id: &str) -> app::Result<MessageView> {
        let message = self
            .messages
            .get(id)?
            .ok_or_else(|| not_found("message", id))?;
        let top = message.parent == TOP;
        self.view(message, top)
    }

    /// One stored message rendered for the API: its lists, its reactions (none
    /// once deleted) and, with `with_threads`, its thread's size and newest
    /// reply. Every read renders through here, so they cannot drift.
    fn view(&self, m: Message, with_threads: bool) -> app::Result<MessageView> {
        let extras = self.extras.get(&m.id)?.unwrap_or_default();
        let (thread_count, thread_last_timestamp) = if with_threads {
            let count = self.count_of(&m.id)?;
            let last = self.messages.find(
                "thread",
                &[KeyPart::Str(m.id.clone())],
                FindOpts::default().reverse().limit(1),
            )?;
            (count as u32, last.items.first().map_or(0, |r| r.timestamp))
        } else {
            (0, 0)
        };
        let reactions = if m.deleted {
            None
        } else {
            self.reactions_of(&m.id)?
        };
        Ok(MessageView {
            index: m.seq,
            timestamp: m.timestamp,
            sender: m.sender,
            mentions: extras.mentions,
            mentions_usernames: extras.mentions_usernames,
            files: extras.files.into_iter().map(attachment_view).collect(),
            images: extras.images.into_iter().map(attachment_view).collect(),
            id: m.id,
            text: if m.deleted { String::new() } else { m.text },
            edited_on: m.edited_on,
            reactions,
            deleted: m.deleted.then_some(true),
            thread_count,
            thread_last_timestamp,
            parent_message_id: (m.parent != TOP).then_some(m.parent),
        })
    }

    /// Emoji -> the accounts that reacted with it, over one page of the
    /// message's reactions; `None` when there are none.
    fn reactions_of(&self, message_id: &str) -> app::Result<Option<BTreeMap<String, Vec<String>>>> {
        let page = self.reactions.prefix(
            &[KeyPart::Str(message_id.to_owned())],
            FindOpts::default().limit(MAX_REACTIONS_READ),
        )?;
        let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for ((_, emoji, account), _) in page.items {
            out.entry(emoji).or_default().push(account);
        }
        Ok((!out.is_empty()).then_some(out))
    }

    /// A staff removal of a reply: the reply, its reactions and its lists.
    fn remove_reply(&mut self, id: &str) -> app::Result<()> {
        let _removed = self.messages.remove(&id.to_owned())?;
        let _old = self.extras.remove(&id.to_owned())?;
        loop {
            let page = self.reactions.prefix(
                &[KeyPart::Str(id.to_owned())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                return Ok(());
            }
            for (key, _) in page.items {
                let _old = self.reactions.remove(&key)?;
            }
        }
    }

    /// Unread top-level messages matching `wanted`, over the newest 500.
    fn unread(&self, me: &str, wanted: impl Fn(&Message) -> app::Result<bool>) -> app::Result<u32> {
        let last_read = self.read_receipts.get_for(me)?.unwrap_or(0);
        let page = self.messages.find(
            "thread",
            &[KeyPart::Str(TOP.to_owned())],
            FindOpts::default().reverse().limit(MAX_UNREAD_SCAN),
        )?;
        let mut count = 0;
        for m in page.items {
            if m.timestamp <= last_read || m.sender == me || m.deleted {
                continue;
            }
            if wanted(&m)? {
                count += 1;
            }
        }
        Ok(count)
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The signed-in caller's account.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// The log's clock in seconds.
fn now_secs() -> u64 {
    env::time_now() / 1_000
}

/// A new message id: 32 random bytes of the run as hex, `_`, the timestamp
/// (v1's shape; the random half is seeded per logged run, so replay agrees).
fn fresh_message_id(timestamp: u64) -> String {
    let hex: String = env::random_bytes(32)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{hex}_{timestamp}")
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

fn check_max(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.len() > max {
        return Err(invalid(format!(
            "{field} cannot be longer than {max} bytes"
        )));
    }
    Ok(())
}

fn check_username(username: &str) -> app::Result<()> {
    if username.trim().is_empty() {
        return Err(invalid("Username cannot be empty"));
    }
    check_max("username", username, MAX_USERNAME_LEN)
}

fn check_term(term: &str) -> app::Result<()> {
    if term.len() > MAX_SEARCH_TERM_LEN {
        return Err(invalid(format!(
            "Search term too long: {} bytes, limit is {MAX_SEARCH_TERM_LEN}",
            term.len()
        )));
    }
    Ok(())
}

/// Refuses a client timestamp too far ahead of the log's clock.
fn check_timestamp(timestamp: u64) -> app::Result<()> {
    if timestamp > now_secs().saturating_add(MAX_CLOCK_SKEW_SECS) {
        return Err(invalid(format!(
            "Timestamp {timestamp} is too far in the future"
        )));
    }
    Ok(())
}

fn message_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_MESSAGE_PAGE).min(MAX_MESSAGE_PAGE)
}

fn search_limit(limit: Option<u32>) -> u32 {
    limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT)
}

fn list_opts(cursor: Option<String>, limit: Option<u32>) -> FindOpts {
    let opts = FindOpts::default().limit(limit.unwrap_or(DEFAULT_LIST_PAGE).min(MAX_LIST_PAGE));
    match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    }
}

/// The positions a `(limit, offset)` window covers among `total`, counted
/// back from the END (offset 0 is the newest page), and the `startPosition` it
/// reports: the offset, except 0 for an empty collection.
fn page_window(total: u64, limit: u32, offset: u32) -> (std::ops::Range<u64>, u32) {
    if total == 0 {
        return (0..0, 0);
    }
    let offset_u = u64::from(offset);
    if offset_u >= total {
        return (0..0, offset);
    }
    let end = total - offset_u;
    (end.saturating_sub(u64::from(limit))..end, offset)
}

/// The blob `id` as a reference, if this app holds it.
fn held_blob(id: &str) -> app::Result<BlobRef> {
    let blob = BlobRef::parse(id).ok_or_else(|| invalid(format!("Invalid blob id {id:?}")))?;
    if blob.info().is_none() {
        return Err(invalid(format!("No such blob: {id}")));
    }
    Ok(blob)
}

fn attachments(inputs: Vec<AttachmentInput>) -> app::Result<Vec<Attachment>> {
    inputs
        .into_iter()
        .map(|input| {
            check_max("attachment name", &input.name, MAX_ID_LEN)?;
            check_max("mime type", &input.mime_type, MAX_ID_LEN)?;
            let blob = BlobRef::parse(&input.blob_id_str)
                .ok_or_else(|| invalid(format!("Invalid blob id {:?}", input.blob_id_str)))?;
            let info = blob
                .info()
                .ok_or_else(|| invalid(format!("No such blob: {}", input.blob_id_str)))?;
            Ok(Attachment {
                name: input.name,
                mime_type: input.mime_type,
                size: info.size,
                blob,
                uploaded_at: env::time_now(),
            })
        })
        .collect()
}

fn attachment_view(a: Attachment) -> AttachmentView {
    AttachmentView {
        name: a.name,
        mime_type: a.mime_type,
        size: a.size,
        blob_id: a.blob.id(),
        uploaded_at: a.uploaded_at,
    }
}

fn can_change_role(actor: Role, current: Role, new: Role) -> bool {
    match actor {
        Role::Admin => true,
        Role::Mod => {
            (current == Role::User && new == Role::Banned)
                || (current == Role::Banned && new == Role::User)
        }
        Role::User | Role::Banned => false,
    }
}

/// The snippet for `message` if its text, as a reader sees it, holds `needle`.
fn hit_snippet(message: &Message, needle: &str) -> Option<search::Snippet> {
    (!message.deleted && search::folded_text(&message.text).contains(needle))
        .then(|| search::snippet(&search::plain_text(&message.text), needle))
}

fn search_hit(
    message: &Message,
    parent: Option<String>,
    index: Option<u64>,
    anchor_timestamp: u64,
    found: search::Snippet,
) -> SearchHit {
    SearchHit {
        id: message.id.clone(),
        parent_message_id: parent,
        index,
        timestamp: message.timestamp,
        anchor_timestamp,
        sender: message.sender.clone(),
        snippet: found.text,
        match_start: found.match_start,
        match_end: found.match_end,
    }
}
