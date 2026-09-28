use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env, AccountId, BlobId};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, AuthoredSortedMap, AuthoredVector, Frozen, LwwRegister,
    Mergeable as MergeableTrait, Moderated, Op, SharedStorage, SortedMap, UnorderedMap,
    UnorderedSet, UserStorage, Vector, WriteOnce,
};
use types::id;
mod types;
use std::collections::{BTreeSet, HashMap};
use std::fmt::Write;

id::define!(pub UserId<32, 44>);
type MessageId = String;

/// Build the storage key for a user's per-channel draft.
/// Format: "<base58_user_id>:<channel_name>"
/// Longest accepted search term.
///
/// A search walks every message and every thread, lowercasing the term once and
/// running a substring match per message — so the work is (messages x term
/// length) and the caller chooses the second factor. Without a bound, one
/// request with a multi-megabyte term is a cheap way to make a node chew
/// through the whole channel, and the runtime charges per wasm operator with no
/// read limit to stop it.
///
/// 256 is well past any real query; the point is that the ceiling exists, not
/// where exactly it sits.
const MAX_SEARCH_TERM_LEN: usize = 256;

/// Ceilings on what one write may add. Every member's node stores and replays
/// whatever another member writes, so an unbounded field is a way to make every
/// node carry (and every reader decode) as much as one sender cares to send.
const MAX_MESSAGE_LEN: usize = 20_000;
const MAX_ATTACHMENTS: usize = 10;
const MAX_MENTIONS: usize = 100;
const MAX_EMOJI_LEN: usize = 64;
const MAX_NAME_LEN: usize = 100;
const MAX_DESCRIPTION_LEN: usize = 1_000;

/// How far ahead of this node's clock a client timestamp may be, in seconds.
/// Timestamps are the client's (seconds since the epoch) and order threads and
/// unread counts; one far in the future would stay "newest" and "unread"
/// forever. Clocks run behind as well as ahead, so the past is not bounded.
const MAX_CLOCK_SKEW_SECS: u64 = 300;

/// How many of the newest messages an unread count looks at. The count walks
/// back from the end of the channel, so its cost is this, not the channel's
/// length; a count at the ceiling reads as "at least this many".
const MAX_UNREAD_SCAN: usize = 500;

/// Separates the parts of a composite `threads` / `reactions` key. It cannot
/// occur in a hex id, and emoji containing it are refused.
const KEY_SEP: char = '\u{1f}';

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        // SAFETY: writing to a String cannot fail.
        write!(&mut s, "{b:02x}").unwrap();
    }
    s
}

fn user_of(account: AccountId) -> UserId {
    UserId::new(*account.as_bytes())
}

/// The account, among `holders` of one key, whose entry is `row`.
///
/// Keys of an owned collection are per owner (core rc.57): one key appears
/// once per account holding it, and an ordered read hands back rows without
/// saying whose each is. The owner is recovered by matching the row's bytes
/// against every holder's entry at the key. A `Message` is built from
/// `LwwRegister`s, which carry the write's timestamp and writer, so two
/// accounts' entries are never byte-identical; the lowest matching account
/// answers if they ever were.
fn holder_of<V: BorshSerialize>(holders: Vec<(AccountId, V)>, row: &V) -> Option<AccountId> {
    let row = calimero_sdk::borsh::to_vec(row).ok()?;
    holders
        .into_iter()
        .filter(|(_, held)| calimero_sdk::borsh::to_vec(held).is_ok_and(|bytes| bytes == row))
        .map(|(owner, _)| owner)
        .min()
}

/// Refuses a client timestamp too far ahead of this node's clock.
fn check_timestamp(timestamp: u64) -> app::Result<()> {
    let now_secs = env::time_now() / 1_000_000_000;
    if timestamp > now_secs.saturating_add(MAX_CLOCK_SKEW_SECS) {
        app::bail!("Timestamp {timestamp} is too far in the future");
    }
    Ok(())
}

/// `"<parent>␟<timestamp:020>␟<id>"`: one thread is one key prefix, in time
/// order. The timestamp is recovered from the id's `_<timestamp>` suffix, so a
/// reply's key follows from its parent and its id alone.
fn thread_key(parent: &str, message_id: &str) -> app::Result<String> {
    let Some(timestamp) = message_id
        .rsplit_once('_')
        .and_then(|(_, ts)| ts.parse::<u64>().ok())
    else {
        app::bail!("Malformed message id");
    };
    Ok(format!(
        "{parent}{KEY_SEP}{timestamp:020}{KEY_SEP}{message_id}"
    ))
}

fn thread_prefix(parent: &str) -> String {
    format!("{parent}{KEY_SEP}")
}

/// `"<message>␟<emoji>␟<account hex>"`: one message's reactions are one prefix.
fn reaction_key(message_id: &str, emoji: &str, account: &UserId) -> String {
    format!(
        "{message_id}{KEY_SEP}{emoji}{KEY_SEP}{}",
        hex(account.as_ref())
    )
}

fn draft_key(user_base58: &str, channel: &str) -> String {
    format!("{user_base58}:{channel}")
}

/// Unsent drafts — node-local, never synced.
///
/// These used to live on the replicated state as
/// `UnorderedMap<String, LwwRegister<String>>`, keyed `"{user}:{channel}"`, with
/// a comment calling them "effectively private — each user only reads/writes
/// their own keys". That was true of the API and false of the storage: the keys
/// gate what the CONTRACT will hand back, while the bytes themselves replicated
/// to every member of the channel and sat decrypted in their local store. Half
/// a sentence typed and abandoned was readable by everyone it was about.
///
/// `#[app::private]` puts them in the node-local namespace instead, so they are
/// never part of the synced tree at all — the gate stops being a convention the
/// contract has to keep and becomes a property of where the data lives.
///
/// The value is a plain `String`, not an `LwwRegister`: private storage has a
/// single writer, so there is no concurrent edit to reconcile. (The macro
/// rejects CRDT types here for exactly that reason.)
#[derive(BorshDeserialize, BorshSerialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[app::private]
pub struct Drafts {
    entries: UnorderedMap<String, String>,
}

impl Default for Drafts {
    fn default() -> Self {
        Self {
            entries: UnorderedMap::new(),
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MessageSentEvent {
    pub message_id: String,
}

// `#[app::mergeable]`, not `#[derive(Mergeable)]`: since core 0.11.0-rc.32 a type
// that implements `Mergeable` must SAY how it merges, and the two answers are
// different decisions, not styles. The derive writes a field-by-field merge and
// sets `DISPATCHED = false` — the storage layer then resolves the entry
// structurally and never calls the rule below, which for `Attachment` would
// silently discard "newest upload wins" in favour of last-write-wins on the
// whole value. The attribute stamps a `CustomTypeId` on every entry holding an
// `Attachment` and dispatches merge to the impl here, which is the rule this app
// actually depends on. It also emits the `RekeyTarget` that used to be written
// by hand just below — writing one as well is a conflicting-impl error.
//
// No `id = "..."` override: the default digest is over `module_path!()` + the
// type name, and neither this crate nor this module is expected to be renamed.
// Pin an id only if the type may move after entries have been stamped.
#[app::mergeable]
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Attachment {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub blob_id: BlobId,
    pub uploaded_at: u64,
}

impl MergeableTrait for Attachment {
    /// Newest upload wins, with a deterministic tie-break.
    ///
    /// The tie-break is not decoration. `merge` must be commutative and
    /// idempotent, and `uploaded_at` is a millisecond clock: two replicas that
    /// attach different files in the same millisecond compare equal, and a rule
    /// that only acts on `>` then leaves each side holding its own value
    /// forever — every re-merge changes nothing, so the entry never converges
    /// and no error is ever raised. Ordering the equal-clock case by the
    /// remaining fields gives both sides the same answer whichever way round
    /// they merge. `blob_id` is compared as its hex string, which is what the
    /// wire carries since rc.27.
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let newer = other.uploaded_at > self.uploaded_at;
        let wins_tie =
            other.uploaded_at == self.uploaded_at && other.tie_break_key() > self.tie_break_key();
        if newer || wins_tie {
            *self = other.clone();
        }
        Ok(())
    }
}

impl Attachment {
    /// Total order over the fields that identify an attachment, used only to
    /// settle an equal-`uploaded_at` merge. `blob_id` alone would do in
    /// practice, but including the rest keeps the key a function of the whole
    /// value, so two attachments that differ at all order differently.
    fn tie_break_key(&self) -> (String, String, u64, String) {
        (
            self.blob_id.to_string(),
            self.name.clone(),
            self.size,
            self.mime_type.clone(),
        )
    }

    fn to_public(&self) -> AttachmentPublic {
        AttachmentPublic {
            name: self.name.clone(),
            mime_type: self.mime_type.clone(),
            size: self.size,
            blob_id: self.blob_id.to_string(),
            uploaded_at: self.uploaded_at,
        }
    }
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AttachmentPublic {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub blob_id: String,
    pub uploaded_at: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AttachmentInput {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub blob_id_str: String,
}

#[app::event]
pub enum Event {
    Initialized(),
    MessageSent(MessageSentEvent),
    MessageSentThread(MessageSentEvent),
    ReactionUpdated(String),
    /// Payload: the id of the message whose TEXT changed.
    ///
    /// Editing used to emit `MessageSent`, which is what a brand-new message
    /// emits. A peer could not tell the two apart, so it announced an edit as
    /// "X sent a message" and refreshed the newest page looking for it — and an
    /// edit to an older message is not in that page, so the change never
    /// appeared. Naming the message lets a reader refresh exactly it.
    MessageEdited(String),
    ProfileUpdated(String),
    InfoUpdated(),
    /// Payload: target identity (base58) whose role just changed.
    RoleUpdated(String),
}

/// "channel" or "dm", fixed when the context is created.
#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone, Default, AbiType,
)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum ContextType {
    #[default]
    Channel,
    Dm,
}

/// In-context moderation role. Who holds which role is enforced by storage
/// (`roles` and `banned` are writer-set guarded). What a ban STOPS is not: every
/// state-mutating method checks the caller is not Banned, but that check runs
/// on the banned member's own node, so a patched node skips it. Banned users
/// stay in the underlying group; removing them for good is a core group kick.
///
/// - `User`     default for everyone except the creator
/// - `Mod`      can flip a User to Banned (and back)
/// - `Admin`    can change anyone's role; creator starts here
/// - `Banned`   cannot perform any state-mutating action
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    BorshDeserialize,
    BorshSerialize,
    Serialize,
    Deserialize,
    AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[derive(Default)]
pub enum Role {
    #[default]
    User,
    Mod,
    Admin,
    Banned,
}

/// Named role inside `AccessControl` for moderators. `Admin` is the admin tier
/// (writer set) and `Banned` is a separate exclusion set, so `"mod"` is the only
/// named role the registry stores.
const ROLE_MOD: &str = "mod";

// Dispatched merge (see `Attachment` for why the attribute and not the derive).
// `Message` cannot take `#[derive(Mergeable)]` in any case: the derive writes its
// own `Mergeable` impl, which would collide with the one below, and its
// field lint rejects a bare `sender: UserId`. The attribute also emits the
// `RekeyTarget` impl that used to be hand-written after the merge, field by
// field under `field_child_id(parent_id, "<field name>")` — the same child ids,
// so nothing moves in storage.
#[app::mergeable]
#[derive(BorshDeserialize, BorshSerialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Message {
    pub timestamp: LwwRegister<u64>,
    /// Whoever the writing node SAID sent it, echoed back to that sender. A
    /// patched node can put anyone here, so no read trusts it: views take the
    /// sender from the entry's owner stamp.
    pub sender: UserId,
    pub mentions: UnorderedSet<UserId>,
    pub mentions_usernames: Vector<LwwRegister<String>>,
    pub files: Vector<Attachment>,
    pub images: Vector<Attachment>,
    pub id: LwwRegister<MessageId>,
    pub text: LwwRegister<String>,
    pub edited_on: Option<LwwRegister<u64>>,
    pub deleted: Option<LwwRegister<bool>>,
}

impl MergeableTrait for Message {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        MergeableTrait::merge(&mut self.timestamp, &other.timestamp)?;
        MergeableTrait::merge(&mut self.id, &other.id)?;
        MergeableTrait::merge(&mut self.text, &other.text)?;
        MergeableTrait::merge(&mut self.mentions, &other.mentions)?;
        MergeableTrait::merge(&mut self.mentions_usernames, &other.mentions_usernames)?;
        MergeableTrait::merge(&mut self.files, &other.files)?;
        MergeableTrait::merge(&mut self.images, &other.images)?;
        if let Some(ref b) = other.edited_on {
            if let Some(ref mut a) = self.edited_on {
                MergeableTrait::merge(a, b)?;
            } else {
                self.edited_on = Some(b.clone());
            }
        }
        if let Some(ref b) = other.deleted {
            if let Some(ref mut a) = self.deleted {
                MergeableTrait::merge(a, b)?;
            } else {
                self.deleted = Some(b.clone());
            }
        }
        Ok(())
    }
}

// The `RekeyTarget` impl that used to sit here is now emitted by
// `#[app::mergeable]` on the struct above. It re-keys every field under
// `field_child_id(parent_id, "<field name>")` — byte-for-byte the child ids the
// hand-written version derived — and its `register_nested_value_types` scans
// the field types, so `Attachment` (reached through `files`/`images:
// Vector<Attachment>`) is still registered. Writing one here as well is a
// conflicting-impl error.

impl Clone for Message {
    fn clone(&self) -> Self {
        Message {
            timestamp: self.timestamp.clone(),
            sender: self.sender,
            mentions: {
                let mut new_set = UnorderedSet::new();
                if let Ok(iter) = self.mentions.iter() {
                    for item in iter {
                        let _ = new_set.insert(item);
                    }
                }
                new_set
            },
            mentions_usernames: {
                let mut new_vec = Vector::new();
                if let Ok(iter) = self.mentions_usernames.iter() {
                    for item in iter {
                        let _ = new_vec.push(item.clone());
                    }
                }
                new_vec
            },
            files: {
                let mut new_vec = Vector::new();
                if let Ok(iter) = self.files.iter() {
                    for attachment in iter {
                        let _ = new_vec.push(attachment.clone());
                    }
                }
                new_vec
            },
            images: {
                let mut new_vec = Vector::new();
                if let Ok(iter) = self.images.iter() {
                    for attachment in iter {
                        let _ = new_vec.push(attachment.clone());
                    }
                }
                new_vec
            },
            id: self.id.clone(),
            text: self.text.clone(),
            edited_on: self.edited_on.clone(),
            deleted: self.deleted.clone(),
        }
    }
}

impl Serialize for Message {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: calimero_sdk::serde::Serializer,
    {
        use calimero_sdk::serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("Message", 10)?;
        state.serialize_field("timestamp", &*self.timestamp)?;
        state.serialize_field("sender", &self.sender)?;

        let mentions_vec: Vec<UserId> = if let Ok(iter) = self.mentions.iter() {
            iter.collect()
        } else {
            Vec::new()
        };
        state.serialize_field("mentions", &mentions_vec)?;

        let mentions_usernames_vec: Vec<String> = if let Ok(iter) = self.mentions_usernames.iter() {
            iter.map(|r| r.get().clone()).collect()
        } else {
            Vec::new()
        };
        state.serialize_field("mentions_usernames", &mentions_usernames_vec)?;
        let files_vec = attachments_vector_to_public(&self.files);
        state.serialize_field("files", &files_vec)?;
        let images_vec = attachments_vector_to_public(&self.images);
        state.serialize_field("images", &images_vec)?;

        state.serialize_field("id", self.id.get())?;
        state.serialize_field("text", self.text.get())?;
        state.serialize_field("edited_on", &self.edited_on.as_ref().map(|r| **r))?;
        state.serialize_field("deleted", &self.deleted.as_ref().map(|r| **r))?;
        state.end()
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MessageWithReactions {
    /// Position in the channel's append-only vector.
    ///
    /// A STABLE cursor, and the reason clients can page and resume without
    /// gaps: appends land at the end and never renumber what came before, and
    /// a delete keeps its slot (the text is blanked, the entry stays). So an
    /// index a client stored two hours ago still names the same message.
    ///
    /// Counting a window from the END, which `get_messages` does, has no such
    /// property: every append shifts it and a client paging that way re-reads
    /// or skips messages. Use `get_messages_from` for anything that resumes.
    pub index: u64,
    pub timestamp: u64,
    pub sender: UserId,
    pub mentions: Vec<UserId>,
    pub mentions_usernames: Vec<String>,
    pub files: Vec<AttachmentPublic>,
    pub images: Vec<AttachmentPublic>,
    pub id: MessageId,
    pub text: String,
    pub edited_on: Option<u64>,
    pub reactions: Option<HashMap<String, Vec<UserId>>>,
    pub deleted: Option<bool>,
    pub thread_count: u32,
    pub thread_last_timestamp: u64,
    pub parent_message_id: Option<String>,
}

fn attachments_vector_to_public(vector: &Vector<Attachment>) -> Vec<AttachmentPublic> {
    let mut attachments = Vec::new();
    if let Ok(iter) = vector.iter() {
        for attachment in iter {
            attachments.push(attachment.to_public());
        }
    }
    attachments
}

fn attachment_inputs_to_vector(
    inputs: Option<Vec<AttachmentInput>>,
    context_id: &[u8; 32],
) -> app::Result<Vector<Attachment>> {
    let mut vector = Vector::new();
    if let Some(attachment_inputs) = inputs {
        for attachment_input in attachment_inputs {
            let blob_id: BlobId = attachment_input.blob_id_str.parse()?;
            if !env::blob_announce_to_context(blob_id.as_ref(), context_id) {
                app::log!(
                    "Warning: failed to announce blob {} to context",
                    attachment_input.blob_id_str,
                );
            }
            let _ = vector.push(Attachment {
                name: attachment_input.name,
                mime_type: attachment_input.mime_type,
                size: attachment_input.size,
                blob_id,
                uploaded_at: env::time_now(),
            });
        }
    }
    Ok(vector)
}

#[derive(Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageWithReactions>,
    pub start_position: u32,
}

/// Per-context metadata returned by `get_info` / `get_channel_info`.
#[derive(Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextInfo {
    pub name: String,
    pub context_type: ContextType,
    pub description: String,
    pub created_at: u64,
    pub creator: String,
}

/// Per-context user profile returned by `get_profiles`.
#[derive(Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UserProfile {
    pub identity: UserId,
    pub username: String,
    pub avatar: Option<String>,
}

/// Per-context profile stored in CRDT state.
// Dispatched merge (see `Attachment`). The rule below is not plain field-by-field
// delegation — it lifts a `None` avatar to the other side's `Some` — so the
// derive's structural resolution would quietly lose an avatar set concurrently
// with a rename. `#[app::mergeable]` also emits the `RekeyTarget` that followed
// the impl.
#[app::mergeable]
#[derive(BorshDeserialize, BorshSerialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct StoredProfile {
    pub username: LwwRegister<String>,
    pub avatar: Option<LwwRegister<String>>,
}

impl MergeableTrait for StoredProfile {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        MergeableTrait::merge(&mut self.username, &other.username)?;
        if let (Some(ref mut a), Some(ref b)) = (&mut self.avatar, &other.avatar) {
            MergeableTrait::merge(a, b)?;
        } else if other.avatar.is_some() {
            self.avatar = other.avatar.clone();
        }
        Ok(())
    }
}

/// What a context is founded with. Frozen in `init`: nobody, the creator
/// included, can change it afterwards.
#[derive(BorshDeserialize, BorshSerialize, Default, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Founding {
    pub context_type: ContextType,
    pub created_at: u64,
    pub creator: String,
}

/// The channel's name and description, writable by the admins only.
#[derive(BorshDeserialize, BorshSerialize, Default, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ChannelText {
    pub name: LwwRegister<String>,
    pub description: LwwRegister<String>,
}

/// Where a message lives: a slot of the channel, or a key of the thread map.
#[derive(BorshDeserialize, BorshSerialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum Slot {
    /// The `messages` entry's id, as bytes.
    Channel([u8; 32]),
    Thread(String),
}

/// One context = one conversation (channel or DM).
/// Messages, threads, reactions, profiles, and metadata live here.
///
/// Every field that is not collaborative is held to its writer by storage, on
/// every node, so a patched node cannot get around the checks below by
/// skipping them: the checks only make a refused write fail early.
#[app::state(emits = Event)]
pub struct MeroChat {
    founding: Frozen<Founding>,
    /// Writers: the admins (kept equal to `roles.admins()`, see `sync_staff`).
    info: SharedStorage<ChannelText>,
    /// Top-level messages. Each slot is owned by its sender; the index is the
    /// stable cursor clients page and resume by.
    messages: AuthoredVector<Message>,
    /// Message id -> the `messages` entry holding it, written once by the
    /// sender. Turns edits, deletes and "does this message exist" into one
    /// lookup instead of a walk of the channel.
    message_ids: WriteOnce<UnorderedMap<MessageId, Slot>>,
    /// `thread_key(parent, id)` -> reply. The author edits their reply; the
    /// staff (the moderators) remove any.
    threads: Moderated<SortedMap<String, Message>>,
    /// `reaction_key(message, emoji, account)` -> nothing: the key is the
    /// reaction, and the entry is owned by whoever reacted.
    reactions: AuthoredSortedMap<String, ()>,
    /// One profile per account, written only by that account.
    profiles: UserStorage<StoredProfile>,
    /// Per-context moderation roles, backed by a writer-set-guarded registry.
    /// The admin tier IS the writer set, so a non-admin's forged `grant`/
    /// `grant_admin` delta is rejected at merge. `Admin` maps to the admin
    /// tier; `Mod` to the `"mod"` named role; `Banned` lives in `banned`.
    roles: AccessControl,
    /// Soft-ban exclusion set. Missing/`false` entry = not banned. Kept apart
    /// from `AccessControl` because moderators (not just admins) may ban and
    /// unban, which its admin-gated `grant` cannot express. Writers: the
    /// staff, admins and moderators (see `sync_staff`).
    banned: SharedStorage<UnorderedMap<UserId, LwwRegister<bool>>>,
    /// Top-level messages the staff removed. A message's slot belongs to its
    /// sender and cannot be rewritten by anyone else, so a removal is recorded
    /// here and every read blanks the message. Writers: the staff.
    hidden: SharedStorage<UnorderedMap<MessageId, LwwRegister<bool>>>,
    /// Per-account last-read timestamp, written only by that account. Enables
    /// cross-device unread tracking without localStorage.
    read_receipts: UserStorage<LwwRegister<u64>>,
    // Drafts are NOT here: they are node-local, in `Drafts`. They lived on this
    // synced state until it was noticed that "each user only reads/writes their
    // own keys" describes the API, not the storage — the bytes replicated to
    // everyone regardless.
}

#[app::logic]
impl MeroChat {
    #[app::init]
    pub fn init(
        name: String,
        context_type: ContextType,
        description: String,
        created_at: u64,
        creator_username: String,
    ) -> MeroChat {
        app::emit!(Event::Initialized());

        let creator = Self::executor_id().to_string();
        let me: AccountId = env::account_id().into();

        // The context creator is the sole initial admin (the writer set), and so
        // the sole initial staff member of every staff-written field. Other
        // admins/mods are granted at runtime by an existing admin.
        let roles = AccessControl::new(me);

        // Pre-seed the creator's profile so get_profiles returns their name
        // immediately after context state gossip, without waiting for an
        // explicit set_profile call from the creator.
        let mut profiles = UserStorage::new();
        // The creator is `info`'s only writer, so this write cannot be refused.
        let mut info = SharedStorage::new(BTreeSet::from([me]), false);
        let _ = info.insert(ChannelText {
            name: LwwRegister::new(name),
            description: LwwRegister::new(description),
        });
        if !creator_username.trim().is_empty() {
            let _ = profiles.insert(StoredProfile {
                username: LwwRegister::new(creator_username),
                avatar: None,
            });
        }

        MeroChat {
            founding: Frozen::new(Founding {
                context_type,
                created_at,
                creator,
            }),
            info,
            messages: AuthoredVector::new(),
            message_ids: WriteOnce::new(),
            threads: Moderated::new(),
            reactions: AuthoredSortedMap::new(),
            profiles,
            roles,
            banned: SharedStorage::new(BTreeSet::from([me]), false),
            hidden: SharedStorage::new(BTreeSet::from([me]), false),
            read_receipts: UserStorage::new(),
        }
    }

    pub fn get_info(&self) -> app::Result<ContextInfo> {
        let founding = self.founding.get()?;
        let info = self.info.get()?;
        Ok(ContextInfo {
            name: info.name.get().clone(),
            context_type: founding.context_type.clone(),
            description: info.description.get().clone(),
            created_at: founding.created_at,
            creator: founding.creator.clone(),
        })
    }

    /// Alias for `get_info` — satisfies frontends that call `get_channel_info`.
    /// The legacy `channel` argument is accepted but ignored.
    pub fn get_channel_info(&self, _channel: Option<String>) -> app::Result<ContextInfo> {
        self.get_info()
    }

    /// No-op stub so frontends that call `mark_messages_as_read` don't get
    /// a "method not found" error. Read state is tracked client-side only.
    pub fn mark_messages_as_read(
        &self,
        _channel: Option<String>,
        _timestamp: Option<u64>,
    ) -> app::Result<String> {
        Ok("ok".to_string())
    }

    /// Persist the caller's last-read position. No event is emitted so this
    /// is a silent CRDT write — it gossips to other nodes but does not trigger
    /// an SSE notification on any subscriber.
    pub fn mark_as_read(&mut self, timestamp: u64) -> app::Result<String> {
        let _ = self.read_receipts.insert(LwwRegister::new(timestamp))?;
        Ok("ok".to_string())
    }

    /// Count messages newer than the caller's last-read timestamp, excluding
    /// messages sent by the caller and soft-deleted messages. Looks at the
    /// newest `MAX_UNREAD_SCAN` messages only, so the count saturates there.
    pub fn get_unread_count(&self) -> u32 {
        let caller = Self::executor_id();
        self.unread(|_| true, &caller)
    }

    /// Count unread messages that mention the caller directly (@username),
    /// or use a broadcast mention (@everyone / @here). Same window as
    /// `get_unread_count`.
    pub fn get_unread_mentions(&self) -> u32 {
        let caller = Self::executor_id();
        self.unread(
            |msg| {
                // Broadcast mentions (@everyone / @here) always count.
                let is_broadcast = msg.mentions_usernames.iter().is_ok_and(|mut unames| {
                    unames.any(|r| {
                        let s = r.get().as_str();
                        s == "everyone" || s == "here"
                    })
                });
                // Direct mention: caller's UserId is in the message's mentions set.
                is_broadcast
                    || msg
                        .mentions
                        .iter()
                        .is_ok_and(|mut mentions| mentions.any(|uid| uid == caller))
            },
            &caller,
        )
    }

    /// Rename the channel or change its description. Admins only: storage
    /// refuses anyone outside `info`'s writer set, on every node.
    pub fn update_info(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<String> {
        self.roles
            .only_admin()
            .map_err(|_| app::err!("Only an admin can change the channel's info"))?;
        if name.as_ref().is_some_and(|n| n.len() > MAX_NAME_LEN) {
            app::bail!("Name cannot be longer than {MAX_NAME_LEN} bytes");
        }
        if description
            .as_ref()
            .is_some_and(|d| d.len() > MAX_DESCRIPTION_LEN)
        {
            app::bail!("Description cannot be longer than {MAX_DESCRIPTION_LEN} bytes");
        }
        let current = self.info.get()?;
        let mut next = ChannelText {
            name: current.name.clone(),
            description: current.description.clone(),
        };
        if let Some(n) = name {
            next.name.set(n);
        }
        if let Some(d) = description {
            next.description.set(d);
        }
        let _ = self.info.insert(next)?;
        app::emit!(Event::InfoUpdated());
        Ok("Info updated".to_string())
    }

    /// Set or update this user's profile in the current context.
    ///
    /// Username is **write-once** as far as this method goes: once a profile
    /// exists for an identity, the `username` field is preserved on subsequent
    /// calls — only the avatar can be changed. This freezes a member's handle
    /// to whatever they registered at first profile creation (typically on
    /// join), so other members keep seeing a stable identity even if the user
    /// later rotates their local `chat-username` from a different device.
    ///
    /// The profile lives in the caller's own `UserStorage` slot, so nobody
    /// else can write it — not even first. That is what stops one member
    /// claiming another's slot before they do and speaking under their name.
    /// The username freeze is the owner's own choice, not something storage
    /// enforces against them.
    pub fn set_profile(&mut self, username: String, avatar: Option<String>) -> app::Result<String> {
        self.require_not_banned()?;
        if username.trim().is_empty() {
            app::bail!("Username cannot be empty");
        }
        if username.len() > 50 {
            app::bail!("Username cannot be longer than 50 characters");
        }

        let executor_id = Self::executor_id();

        // Announce avatar blob to this context so it replicates to other nodes.
        let avatar_register: Option<LwwRegister<String>> = if let Some(ref blob_id_str) = avatar {
            let blob_id: BlobId = blob_id_str
                .parse()
                .map_err(|e| app::err!("Invalid avatar blob ID: {e}"))?;
            if !env::blob_announce_to_context(blob_id.as_ref(), &env::context_id()) {
                app::log!(
                    "Warning: failed to announce avatar blob {} to context",
                    blob_id_str
                );
            }
            Some(LwwRegister::new(blob_id_str.clone()))
        } else {
            None
        };

        let profile = match self.profiles.get()? {
            // Preserve the frozen username; only the avatar is mutable.
            // If no new avatar is provided (caller passed null), keep the existing one.
            Some(existing) => StoredProfile {
                username: LwwRegister::new(existing.username.get().clone()),
                avatar: avatar_register.or(existing.avatar),
            },
            None => StoredProfile {
                username: LwwRegister::new(username),
                avatar: avatar_register,
            },
        };
        let _ = self.profiles.insert(profile)?;

        app::emit!(Event::ProfileUpdated(executor_id.to_string()));
        Ok("Profile set".to_string())
    }

    pub fn get_profiles(&self) -> Vec<UserProfile> {
        let mut result = Vec::new();
        if let Ok(entries) = self.profiles.entries() {
            for (account, profile) in entries {
                result.push(UserProfile {
                    identity: user_of(account),
                    username: profile.username.get().clone(),
                    avatar: profile.avatar.as_ref().map(|a| a.get().clone()),
                });
            }
        }
        result
    }

    // ── Drafts ─────────────────────────────────────────────────────────────

    /// Save a draft for the calling user in the given channel.
    /// Passing an empty string is equivalent to deleting the draft.
    pub fn save_draft(&mut self, channel: String, text: String) -> app::Result<()> {
        self.require_not_banned()?;
        let key = draft_key(&Self::executor_id().to_string(), &channel);
        let mut drafts = Drafts::private_load_or_default()?;
        let mut drafts = drafts.as_mut();
        if text.is_empty() {
            let _ = drafts.entries.remove(&key)?;
        } else {
            let _ = drafts.entries.insert(key, text)?;
        }
        Ok(())
    }

    /// Return the calling user's draft for the given channel, or an empty
    /// string if none exists.
    pub fn get_draft(&self, channel: String) -> String {
        let key = draft_key(&Self::executor_id().to_string(), &channel);
        let Ok(drafts) = Drafts::private_load_or_default() else {
            return String::new();
        };
        drafts
            .entries
            .get(&key)
            .ok()
            .flatten()
            .map(|text| text.clone())
            .unwrap_or_default()
    }

    /// Delete the calling user's draft for the given channel.
    pub fn delete_draft(&mut self, channel: String) -> app::Result<()> {
        self.require_not_banned()?;
        let key = draft_key(&Self::executor_id().to_string(), &channel);
        let mut drafts = Drafts::private_load_or_default()?;
        let _ = drafts.as_mut().entries.remove(&key)?;
        Ok(())
    }

    // ── Moderation: roles + ban gate ───────────────────────────────────────

    /// Read the current role of `identity`. Defaults to `User` when the
    /// identity has no explicit entry (i.e. anyone who joined and never
    /// had their role changed).
    pub fn get_member_role(&self, identity: UserId) -> Role {
        self.role_of(&identity)
    }

    /// All members with a non-default role (Admin / Mod / Banned). Members with
    /// the implicit `User` role are not returned (they're inferred).
    pub fn list_roles(&self) -> Vec<(UserId, Role)> {
        let mut ids: Vec<UserId> = Vec::new();
        if let Ok(banned) = self.banned.get() {
            if let Ok(entries) = banned.entries() {
                for (id, flag) in entries {
                    if *flag.get() && !ids.contains(&id) {
                        ids.push(id);
                    }
                }
            }
        }
        for who in self.roles.admins() {
            let id = user_of(who);
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if let Ok(mods) = self.roles.members_of(ROLE_MOD) {
            for who in mods {
                let id = user_of(who);
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        ids.into_iter()
            .map(|id| {
                let r = self.role_of(&id);
                (id, r)
            })
            .filter(|(_, r)| *r != Role::User)
            .collect()
    }

    /// Change a member's role. Authorisation:
    /// - `Admin` may change anyone's role to anything.
    /// - `Mod`   may only flip a `User` to `Banned` (or back).
    /// - `User`/`Banned` may not call this.
    /// An admin cannot demote themselves below `Admin` (lockout-prevention).
    ///
    /// Admin/Mod grants go through `AccessControl` (admin-gated, rejected at
    /// merge if forged). Ban/unban writes `banned`, whose writers are the
    /// staff, so a moderator — who is not an admin — can still moderate and a
    /// member who is neither cannot ban anyone, however patched their node.
    pub fn set_member_role(&mut self, target: UserId, role: Role) -> app::Result<String> {
        let me = Self::executor_id();
        let actor_role = self.role_of(&me);
        let target_role = self.role_of(&target);

        if me == target && actor_role == Role::Admin && role != Role::Admin {
            app::bail!("An admin cannot demote themselves below Admin");
        }
        if !Self::can_change_role(actor_role, target_role, role) {
            app::bail!("You don't have permission to change this member's role");
        }

        let who = Self::to_account(&target);
        let actor_is_admin = actor_role == Role::Admin;
        // Strip grants based on the target's *actual* writer-set / registry
        // membership, NOT the display role. Only an admin may revoke; a
        // moderator's sole permitted transition is User<->Banned on a plain
        // User, which holds no grants.
        let has_mod = self.roles.has_role(ROLE_MOD, &who).unwrap_or(false);
        let has_admin = self.roles.is_admin(&who);
        match role {
            Role::Admin => {
                if has_mod {
                    self.revoke_mod(&who)?;
                }
                self.set_banned(&target, false)?;
                self.roles
                    .grant_admin(who)
                    .map_err(|e| app::err!("grant admin failed: {e}"))?;
            }
            Role::Mod => {
                if has_admin {
                    self.revoke_admin_member(&who)?;
                }
                self.set_banned(&target, false)?;
                self.roles
                    .grant(ROLE_MOD, who)
                    .map_err(|e| app::err!("grant mod failed: {e}"))?;
            }
            Role::Banned => {
                if actor_is_admin {
                    if has_mod {
                        self.revoke_mod(&who)?;
                    }
                    if has_admin {
                        self.revoke_admin_member(&who)?;
                    }
                }
                self.set_banned(&target, true)?;
            }
            Role::User => {
                if actor_is_admin {
                    if has_mod {
                        self.revoke_mod(&who)?;
                    }
                    if has_admin {
                        self.revoke_admin_member(&who)?;
                    }
                }
                self.set_banned(&target, false)?;
            }
        }
        if actor_is_admin {
            self.sync_staff()?;
        }

        app::emit!(Event::RoleUpdated(target.to_string()));
        Ok("Role updated".to_string())
    }

    fn executor_id() -> UserId {
        UserId::new(env::account_id())
    }

    fn me() -> AccountId {
        env::account_id().into()
    }

    // Eight arguments are the ABI: every one is a named parameter the frontend
    // sends. Collapsing them into a struct would change the JSON-RPC shape.
    #[allow(clippy::too_many_arguments)]
    pub fn send_message(
        &mut self,
        message: String,
        mentions: Vec<UserId>,
        mentions_usernames: Vec<String>,
        parent_message: Option<MessageId>,
        timestamp: u64,
        files: Option<Vec<AttachmentInput>>,
        images: Option<Vec<AttachmentInput>>,
    ) -> app::Result<Message> {
        self.require_not_banned()?;
        check_timestamp(timestamp)?;
        if message.len() > MAX_MESSAGE_LEN {
            app::bail!("Message cannot be longer than {MAX_MESSAGE_LEN} bytes");
        }
        if mentions.len() > MAX_MENTIONS || mentions_usernames.len() > MAX_MENTIONS {
            app::bail!("A message can mention at most {MAX_MENTIONS} members");
        }
        if files.as_ref().is_some_and(|f| f.len() > MAX_ATTACHMENTS)
            || images.as_ref().is_some_and(|i| i.len() > MAX_ATTACHMENTS)
        {
            app::bail!(
                "A message can carry at most {MAX_ATTACHMENTS} files and {MAX_ATTACHMENTS} images"
            );
        }
        if let Some(parent) = &parent_message {
            if self.entry_of(parent)?.is_none() {
                app::bail!("Parent message not found");
            }
        }
        let executor_id = Self::executor_id();

        let message_id = self.get_message_id(&executor_id, &message, timestamp);
        let current_context = env::context_id();

        let files_vector = attachment_inputs_to_vector(files, &current_context)?;
        let images_vector = attachment_inputs_to_vector(images, &current_context)?;

        let mut mentions_set = UnorderedSet::new();
        for m in &mentions {
            let _ = mentions_set.insert(*m);
        }
        let mut mentions_usernames_vec = Vector::new();
        for m in &mentions_usernames {
            let _ = mentions_usernames_vec.push(LwwRegister::new(m.clone()));
        }

        let msg = Message {
            timestamp: LwwRegister::new(timestamp),
            sender: executor_id,
            mentions: mentions_set,
            mentions_usernames: mentions_usernames_vec,
            files: files_vector,
            images: images_vector,
            id: LwwRegister::new(message_id.clone()),
            text: LwwRegister::new(message),
            deleted: None,
            edited_on: None,
        };

        if let Some(parent_id) = parent_message {
            let key = thread_key(&parent_id, &message_id)?;
            self.threads.insert(key.clone(), msg.clone())?;
            self.message_ids
                .insert(message_id.clone(), Slot::Thread(key))?;

            app::emit!(Event::MessageSentThread(MessageSentEvent {
                message_id: message_id.clone(),
            }));
        } else {
            let entry = self.messages.push(msg.clone())?;
            self.message_ids
                .insert(message_id.clone(), Slot::Channel(entry.into()))?;

            app::emit!(Event::MessageSent(MessageSentEvent {
                message_id: message_id.clone(),
            }));
        }

        Ok(msg)
    }

    pub fn get_messages(
        &self,
        parent_message: Option<MessageId>,
        limit: Option<usize>,
        offset: Option<usize>,
        search_term: Option<String>,
    ) -> app::Result<FullMessageResponse> {
        if let Some(term) = &search_term {
            if term.len() > MAX_SEARCH_TERM_LEN {
                app::bail!(
                    "Search term too long: {} characters, limit is {MAX_SEARCH_TERM_LEN}",
                    term.len()
                );
            }
        }
        let normalized_search = search_term.map(|term| term.to_lowercase());

        if let Some(parent_id) = parent_message {
            let replies: Vec<MessageWithReactions> = self
                .thread_replies(&parent_id)?
                .into_iter()
                .enumerate()
                .filter(|(_, (_, message))| {
                    Self::message_matches_search(message, normalized_search.as_deref())
                })
                .map(|(index, (sender, message))| {
                    self.message_to_public(&message, sender, false, index as u64)
                })
                .collect();
            return Ok(Self::paginate(replies, limit, offset));
        }

        if normalized_search.is_none() {
            return Ok(self.page_unfiltered(&self.messages, limit, offset, true));
        }

        let filtered = self.collect_messages_with_reactions(
            &self.messages,
            normalized_search.as_deref(),
            true,
        );
        Ok(Self::paginate(filtered, limit, offset))
    }

    /// Messages by ABSOLUTE position, ascending — the resumable read.
    ///
    /// `get_messages` counts its window from the END, so every append shifts
    /// it: a client that stored an offset and came back later re-reads or skips
    /// messages, and the gap is silent. Indices from the START do not move,
    /// because appends land after them and a delete keeps its slot. That makes
    /// `start` a cursor a client can persist across sessions.
    ///
    /// Two uses, both needed for a chat that survives being closed:
    ///
    /// - **Catch up.** A client holding everything through index `n` asks for
    ///   `n + 1` onward and gets exactly what it missed, however long it was
    ///   away and whether or not it was subscribed at the time. Live events are
    ///   an optimisation on top of this, never the only way to learn.
    /// - **Backfill.** Scrolling up asks for a window ending where the local
    ///   copy begins.
    ///
    /// `total_count` is the channel's length, so a client can tell how far
    /// behind it is before fetching anything.
    pub fn get_messages_from(
        &self,
        start: u64,
        limit: Option<usize>,
    ) -> app::Result<FullMessageResponse> {
        let total = self.messages.len().unwrap_or(0);
        let start_idx = start as usize;

        if start_idx >= total {
            return Ok(FullMessageResponse {
                total_count: total as u32,
                messages: Vec::new(),
                start_position: start as u32,
            });
        }

        let end_idx = limit
            .map_or(total, |l| start_idx.saturating_add(l))
            .min(total);

        let mut page = Vec::with_capacity(end_idx - start_idx);
        for idx in start_idx..end_idx {
            if let Some(public) = self.public_at(&self.messages, idx, true) {
                page.push(public);
            }
        }

        Ok(FullMessageResponse {
            total_count: total as u32,
            messages: page,
            start_position: start as u32,
        })
    }

    /// How many messages the channel holds, without reading any of them.
    ///
    /// One row read — the child trie maintains the count. A client compares it
    /// with the highest index it has stored to know whether it is behind, and
    /// by how much, before deciding what to fetch.
    pub fn get_message_count(&self) -> app::Result<u64> {
        Ok(self.messages.len().unwrap_or(0) as u64)
    }

    pub fn search_all_messages(
        &self,
        search_term: String,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> app::Result<FullMessageResponse> {
        if search_term.len() > MAX_SEARCH_TERM_LEN {
            app::bail!(
                "Search term too long: {} characters, limit is {MAX_SEARCH_TERM_LEN}",
                search_term.len()
            );
        }
        let normalized = search_term.to_lowercase();
        let term = normalized.as_str();

        let mut all = self.collect_messages_with_reactions(&self.messages, Some(term), false);

        // Every reply, in one walk of the thread map; the parent is the key's
        // first part.
        let mut position: HashMap<String, u64> = HashMap::new();
        for (key, message) in self.threads.entries()? {
            let Some((parent_id, _)) = key.split_once(KEY_SEP) else {
                continue;
            };
            let slot = position.entry(parent_id.to_owned()).or_default();
            let index = *slot;
            *slot += 1;
            if !Self::message_matches_search(&message, Some(term)) {
                continue;
            }
            let sender = self.thread_sender(&key, &message);
            let mut public = self.message_to_public(&message, sender, false, index);
            public.parent_message_id = Some(parent_id.to_owned());
            all.push(public);
        }

        all.sort_by_key(|m| std::cmp::Reverse(m.timestamp));
        Ok(Self::paginate(all, limit, offset))
    }

    /// Add or remove the CALLER's reaction to a message.
    ///
    /// Reactions are keyed by ACCOUNT, and each is an entry owned by the
    /// account that made it: storage refuses anyone else's add in their name
    /// (the key's account must match the owner stamp to be counted) and any
    /// removal but their own. The client resolves accounts to names for
    /// display.
    pub fn update_reaction(
        &mut self,
        message_id: MessageId,
        emoji: String,
        add: bool,
    ) -> app::Result<String> {
        self.require_not_banned()?;
        if emoji.is_empty() || emoji.len() > MAX_EMOJI_LEN || emoji.contains(KEY_SEP) {
            app::bail!("Invalid emoji");
        }
        if self.slot_of(&message_id)?.is_none() {
            app::bail!("Message not found");
        }
        let action = if add { "added" } else { "removed" };

        let key = reaction_key(&message_id, &emoji, &Self::executor_id());
        if add {
            if !self.reactions.contains(&key)? {
                self.reactions.insert(key, ())?;
            }
        } else {
            let _ = self.reactions.remove(&key)?;
        }

        app::emit!(Event::ReactionUpdated(message_id.to_string()));
        Ok(format!("Reaction {} successfully", action))
    }

    pub fn edit_message(
        &mut self,
        message_id: MessageId,
        new_message: String,
        timestamp: u64,
        parent_id: Option<MessageId>,
    ) -> app::Result<Message> {
        self.require_not_banned()?;
        check_timestamp(timestamp)?;
        if new_message.len() > MAX_MESSAGE_LEN {
            app::bail!("Message cannot be longer than {MAX_MESSAGE_LEN} bytes");
        }

        let updated = if let Some(parent_message_id) = parent_id {
            let key = thread_key(&parent_message_id, &message_id)?;
            // Keys are per owner: `owned_by_me` asks about the caller's own
            // reply, `entries_at` about anyone's.
            if !self.threads.owned_by_me(&key)? {
                if self.threads.entries_at(&key)?.is_empty() {
                    app::bail!("Message not found");
                }
                app::bail!("You can only edit your own messages");
            }
            self.threads.modify(&key, |message| {
                message.text.set(new_message);
                message.edited_on = Some(LwwRegister::new(timestamp));
                message.clone()
            })?
        } else {
            let Some(entry) = self.entry_of(&message_id)? else {
                app::bail!("Message not found");
            };
            if !self.messages.owned_by_me_id(entry)? {
                app::bail!("You can only edit your own messages");
            }
            let Some(mut updated) = self.messages.get_by_id(entry)? else {
                app::bail!("Message not found");
            };
            updated.text.set(new_message);
            updated.edited_on = Some(LwwRegister::new(timestamp));
            self.messages.update_by_id(entry, updated.clone())?;
            updated
        };

        // An edit, not a send. Emitting `MessageSent` here told every peer
        // a new message had arrived: they announced "X sent a message" for
        // text that was already on screen, and went looking for it in the
        // newest page — where an edit to an older message is not.
        app::emit!(Event::MessageEdited(updated.id.get().clone()));
        Ok(updated)
    }

    /// Delete a message. Its sender blanks it in place (the slot and its
    /// index stay). The staff remove anyone's: a thread reply is removed from
    /// the thread outright, and a top-level message, whose slot only its
    /// sender can rewrite, is recorded in `hidden` and read back
    /// blank. Both are enforced by storage, so a member who is neither the
    /// sender nor staff cannot delete, or undelete, anything.
    pub fn delete_message(
        &mut self,
        message_id: MessageId,
        parent_id: Option<MessageId>,
    ) -> app::Result<String> {
        self.require_not_banned()?;
        let actor_role = self.role_of(&Self::executor_id());
        let is_staff = actor_role == Role::Admin || actor_role == Role::Mod;

        if let Some(parent_message_id) = parent_id {
            let key = thread_key(&parent_message_id, &message_id)?;
            let holders = self.threads.entries_at(&key)?;
            if holders.is_empty() {
                app::bail!("Message not found");
            }
            if self.threads.owned_by_me(&key)? {
                self.threads.modify(&key, |message| {
                    message.text.set(String::new());
                    message.deleted = Some(LwwRegister::new(true));
                })?;
            } else if is_staff {
                // `remove_by`, naming each holder: a key-only `remove` removes
                // only the caller's own entry, and the staff member holds none.
                for (owner, _) in holders {
                    let _ = self.threads.remove_by(&owner, &key)?;
                }
            } else {
                app::bail!("You don't have permission to delete this message");
            }

            app::emit!(Event::MessageSentThread(MessageSentEvent {
                message_id: message_id.clone(),
            }));
            Ok("Thread message deleted successfully".to_string())
        } else {
            let Some(entry) = self.entry_of(&message_id)? else {
                app::bail!("Message not found");
            };
            if self.messages.owned_by_me_id(entry)? {
                let Some(mut deleted) = self.messages.get_by_id(entry)? else {
                    app::bail!("Message not found");
                };
                deleted.text.set(String::new());
                deleted.deleted = Some(LwwRegister::new(true));
                self.messages.update_by_id(entry, deleted)?;
            } else if is_staff && self.hidden.can(&Self::me(), Op::Write) {
                let _ = self
                    .hidden
                    .get_mut()?
                    .insert(message_id.clone(), LwwRegister::new(true))?;
            } else {
                app::bail!("You don't have permission to delete this message");
            }

            app::emit!(Event::MessageSent(MessageSentEvent {
                message_id: message_id.clone(),
            }));
            Ok("Message deleted successfully".to_string())
        }
    }
}

impl MeroChat {
    fn role_of(&self, user: &UserId) -> Role {
        let who = Self::to_account(user);
        // The admin tier is checked first. A ban flag on an admin (which only
        // a patched moderator could write) must not lock the admins out of
        // the moderation that would undo it; banning an admin through this
        // app revokes the admin grant first.
        if self.roles.is_admin(&who) {
            Role::Admin
        } else if self.is_banned(user) {
            Role::Banned
        } else if self.roles.has_role(ROLE_MOD, &who).unwrap_or(false) {
            Role::Mod
        } else {
            Role::User
        }
    }

    fn is_banned(&self, user: &UserId) -> bool {
        self.banned
            .get()
            .is_ok_and(|b| matches!(b.get(user), Ok(Some(flag)) if *flag.get()))
    }

    /// Storage refuses, on every other node, a ban written by anyone outside
    /// `banned`'s writer set; this makes the refusal local and readable too.
    fn set_banned(&mut self, user: &UserId, banned: bool) -> app::Result<()> {
        if !self.banned.can(&Self::me(), Op::Write) {
            app::bail!("Only an admin or moderator can ban or unban");
        }
        let _ = self
            .banned
            .get_mut()?
            .insert(*user, LwwRegister::new(banned))?;
        Ok(())
    }

    fn revoke_mod(&mut self, who: &AccountId) -> app::Result<()> {
        self.roles
            .revoke(ROLE_MOD, who)
            .map_err(|e| app::err!("revoke mod failed: {e}"))?;
        Ok(())
    }

    fn revoke_admin_member(&mut self, who: &AccountId) -> app::Result<()> {
        self.roles
            .revoke_admin(who)
            .map_err(|e| app::err!("revoke admin failed: {e}"))?;
        Ok(())
    }

    /// Bring every staff-written field's writers in line with `roles`: the
    /// admins write `info`; admins and moderators write `banned` and
    /// `hidden` and moderate `threads`. Each is its own writer set, verified by every node,
    /// so after a role change they are rotated here, by the admin who made it.
    fn sync_staff(&mut self) -> app::Result<()> {
        let admins = self.roles.admins();
        let mut staff = admins.clone();
        staff.extend(self.roles.members_of(ROLE_MOD)?);
        if self.info.writers() != admins {
            self.info.rotate_writers(admins)?;
        }
        if self.banned.writers() != staff {
            self.banned.rotate_writers(staff.clone())?;
        }
        if self.hidden.writers() != staff {
            self.hidden.rotate_writers(staff.clone())?;
        }
        if self.threads.moderators() != staff {
            self.threads.set_moderators(staff)?;
        }
        Ok(())
    }

    /// Map a curb `UserId` (32-byte key) to the `AccountId` the access-control
    /// components key on.
    fn to_account(user: &UserId) -> AccountId {
        let slice: &[u8] = user.as_ref();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(slice);
        AccountId::from(arr)
    }

    /// App-level only. A banned member's own node runs this check, so a
    /// patched one can skip it: the ban keeps honest clients out and marks the
    /// member for the staff, whose removals storage does enforce. Removing
    /// someone for good is a group kick, in core.
    fn require_not_banned(&self) -> app::Result<()> {
        if self.is_banned(&Self::executor_id()) {
            app::bail!("You are banned from this context");
        }
        Ok(())
    }

    fn can_change_role(actor: Role, target_current: Role, target_new: Role) -> bool {
        match actor {
            Role::Admin => true,
            Role::Mod => {
                (target_current == Role::User && target_new == Role::Banned)
                    || (target_current == Role::Banned && target_new == Role::User)
            }
            _ => false,
        }
    }

    /// Where `message_id` lives, if the account that recorded it also owns
    /// the entry it points at. A patched node could record an id against
    /// someone else's entry; such a pointer is ignored.
    ///
    /// Keys are per owner, so several accounts can each hold a pointer under
    /// one id. Each is checked against its own recorder, and the lowest
    /// account whose pointer holds wins: the same pick on every node.
    fn slot_of(&self, message_id: &str) -> app::Result<Option<Slot>> {
        let key = message_id.to_owned();
        let mut pointers = self.message_ids.entries_at(&key)?;
        pointers.sort_by_key(|(recorder, _)| *recorder);
        for (recorder, slot) in pointers {
            let genuine = match &slot {
                Slot::Channel(entry) => {
                    self.messages.owner_of_id(Id::from(*entry))? == Some(recorder)
                }
                // A removed reply is gone; the recorder must hold it.
                Slot::Thread(thread_key) => self.threads.contains_by(&recorder, thread_key)?,
            };
            if genuine {
                return Ok(Some(slot));
            }
        }
        Ok(None)
    }

    /// The `messages` entry a top-level message id names.
    fn entry_of(&self, message_id: &str) -> app::Result<Option<Id>> {
        Ok(match self.slot_of(message_id)? {
            Some(Slot::Channel(entry)) => Some(Id::from(entry)),
            _ => None,
        })
    }

    /// The owner stamp of the thread reply `message` at `key`, as a `UserId`:
    /// the holder of `key` whose entry it is (keys are per owner, so a
    /// key-only `owner_of` would only ever name the caller).
    fn thread_sender(&self, key: &String, message: &Message) -> UserId {
        self.threads
            .entries_at(key)
            .ok()
            .and_then(|holders| holder_of(holders, message))
            .map_or(UserId::new([0; 32]), user_of)
    }

    /// One thread, oldest first, with each reply's sender from its owner stamp.
    fn thread_replies(&self, parent: &str) -> app::Result<Vec<(UserId, Message)>> {
        Ok(self
            .threads
            .prefix(thread_prefix(parent).as_bytes())?
            .map(|(key, message)| (self.thread_sender(&key, &message), message))
            .collect())
    }

    /// Unread top-level messages matching `wanted`, newest first, over the
    /// newest `MAX_UNREAD_SCAN` messages.
    fn unread(&self, wanted: impl Fn(&Message) -> bool, caller: &UserId) -> u32 {
        let last_read = self
            .read_receipts
            .get_for_user(&Self::to_account(caller))
            .ok()
            .flatten()
            .map(|r| *r.get())
            .unwrap_or(0);

        let total = self.messages.len().unwrap_or(0);
        let mut count = 0u32;
        for idx in (total.saturating_sub(MAX_UNREAD_SCAN)..total).rev() {
            let Ok(Some(msg)) = self.messages.get(idx) else {
                continue;
            };
            if *msg.timestamp <= last_read {
                continue;
            }
            if self.messages.owner_of(idx).ok().flatten().map(user_of) == Some(*caller) {
                continue;
            }
            if self.is_deleted(&msg) {
                continue;
            }
            if wanted(&msg) {
                count += 1;
            }
        }
        count
    }

    fn is_deleted(&self, message: &Message) -> bool {
        message.deleted.as_ref().is_some_and(|r| **r)
            || self
                .hidden
                .get()
                .is_ok_and(|h| matches!(h.get(message.id.get()), Ok(Some(flag)) if *flag.get()))
    }

    /// A message's id: a digest of what identifies it, never a copy of it.
    ///
    /// This function used to build a buffer called `hash_input` and hex-encode
    /// it WITHOUT hashing, so the id was
    /// `hex(account ‖ plaintext ‖ timestamp ‖ counter)`. The message text came
    /// back out of it verbatim, and the id grew with the message — a 37-char
    /// message produced a 184-char id.
    ///
    /// That is not a cosmetic defect. Ids are the app's only handle on a
    /// message: they key `threads`, `reactions` and `hidden`, they
    /// travel in events, and they are what any "link to this message" feature
    /// would put in a URL — where the plaintext would then reach every client,
    /// proxy log, scanner and chat history that touched the link.
    ///
    /// The digest covers the same four fields, so ids stay unique for the same
    /// reasons they were before: the counter separates two identical messages
    /// sent by the same account in the same millisecond.
    fn get_message_id(&self, account: &UserId, message: &str, timestamp: u64) -> MessageId {
        use sha2::{Digest, Sha256};

        let message_counter =
            self.messages.len().unwrap_or(0) as u64 + self.threads.len().unwrap_or(0) as u64 + 1;

        let mut hasher = Sha256::new();
        hasher.update(account.as_ref());
        hasher.update(message.as_bytes());
        hasher.update(timestamp.to_be_bytes());
        hasher.update(message_counter.to_be_bytes());
        let digest = hasher.finalize();

        // The timestamp suffix is kept: it is already public in the message it
        // names, it keeps ids roughly time-ordered for debugging, and
        // `thread_key` orders a reply by it.
        format!("{}_{}", hex(&digest), timestamp)
    }

    fn message_matches_search(message: &Message, search_term: Option<&str>) -> bool {
        match search_term {
            Some(term) => {
                // Text only. Sender names are namespace member metadata now,
                // not message state, so the contract has nothing to match a
                // name against. Searching by sender belongs on the client,
                // which can resolve accounts to their CURRENT names — and get
                // the right answer after a rename, which matching a stamped
                // string never could.
                message.text.get().to_lowercase().contains(term)
            }
            None => true,
        }
    }

    fn collect_messages_with_reactions(
        &self,
        messages: &AuthoredVector<Message>,
        search_term: Option<&str>,
        include_threads: bool,
    ) -> Vec<MessageWithReactions> {
        let mut result = Vec::new();
        if let Ok(iter) = messages.iter() {
            for (index, message) in iter.enumerate() {
                if !Self::message_matches_search(&message, search_term) {
                    continue;
                }
                let sender = messages
                    .owner_of(index)
                    .ok()
                    .flatten()
                    .map_or(UserId::new([0; 32]), user_of);
                result.push(self.message_to_public(
                    &message,
                    sender,
                    include_threads,
                    index as u64,
                ));
            }
        }
        result
    }

    /// The message at `index`, rendered, with its sender from the slot's
    /// owner stamp.
    fn public_at(
        &self,
        messages: &AuthoredVector<Message>,
        index: usize,
        include_threads: bool,
    ) -> Option<MessageWithReactions> {
        let message = messages.get(index).ok().flatten()?;
        let sender = user_of(messages.owner_of(index).ok().flatten()?);
        Some(self.message_to_public(&message, sender, include_threads, index as u64))
    }

    /// One stored message rendered for the API. `sender` is the entry's owner
    /// stamp, never the message's own `sender` field.
    ///
    /// Split out of the scan above so the scanning path and the windowed path
    /// below cannot drift in what they return.
    fn message_to_public(
        &self,
        message: &Message,
        sender: UserId,
        include_threads: bool,
        index: u64,
    ) -> MessageWithReactions {
        let (thread_count, thread_last_timestamp) = if include_threads {
            self.get_thread_info(message.id.get())
        } else {
            (0, 0)
        };

        let mentions_vec: Vec<UserId> = if let Ok(iter) = message.mentions.iter() {
            iter.collect()
        } else {
            Vec::new()
        };
        let mentions_usernames_vec: Vec<String> =
            if let Ok(iter) = message.mentions_usernames.iter() {
                iter.map(|r| r.get().clone()).collect()
            } else {
                Vec::new()
            };

        let msg_id = message.id.get().clone();
        let is_deleted = self.is_deleted(message);
        let (text, reactions) = if is_deleted {
            (String::new(), None)
        } else {
            (
                message.text.get().clone(),
                self.get_reactions_for_message(&msg_id),
            )
        };

        MessageWithReactions {
            index,
            timestamp: *message.timestamp,
            sender,
            id: msg_id,
            text,
            mentions: mentions_vec,
            mentions_usernames: mentions_usernames_vec,
            files: attachments_vector_to_public(&message.files),
            images: attachments_vector_to_public(&message.images),
            reactions,
            deleted: if is_deleted {
                Some(true)
            } else {
                message.deleted.as_ref().map(|r| **r)
            },
            edited_on: message.edited_on.as_ref().map(|r| **r),
            thread_count,
            thread_last_timestamp,
            parent_message_id: None,
        }
    }

    /// The page `paginate` would return, without materialising everything
    /// before it.
    ///
    /// Only correct when nothing is filtered out, which is exactly the
    /// no-search case: every stored message occupies a slot in the response
    /// (a deleted one keeps its place with blanked text), so `total` is the
    /// collection's length and the window is the same slice `paginate` takes.
    ///
    /// Worth stating why this matters, because the old path looked harmless:
    /// it decoded every message, then did a nested reactions lookup and a
    /// thread lookup per message, and only then threw away all but one page.
    /// Cost grew with history until a single `get_messages` exhausted the gas
    /// limit — measured at ~2,300 messages, while `send_message` stayed flat
    /// past 20,000.
    fn page_unfiltered(
        &self,
        messages: &AuthoredVector<Message>,
        limit: Option<usize>,
        offset: Option<usize>,
        include_threads: bool,
    ) -> FullMessageResponse {
        let total = messages.len().unwrap_or(0);
        if total == 0 {
            return FullMessageResponse {
                total_count: 0,
                messages: Vec::new(),
                start_position: 0,
            };
        }

        let limit_value = limit.unwrap_or(total);
        let offset_value = offset.unwrap_or(0);

        if offset_value >= total {
            return FullMessageResponse {
                total_count: total as u32,
                messages: Vec::new(),
                start_position: offset_value as u32,
            };
        }

        let end_idx = total - offset_value;
        let start_idx = end_idx.saturating_sub(limit_value);

        let mut page = Vec::with_capacity(end_idx - start_idx);
        for idx in start_idx..end_idx {
            if let Some(public) = self.public_at(messages, idx, include_threads) {
                page.push(public);
            }
        }

        FullMessageResponse {
            total_count: total as u32,
            messages: page,
            start_position: offset_value as u32,
        }
    }

    /// Emoji -> the ACCOUNTS that reacted with it.
    ///
    /// Accounts, not names: the client resolves them, so a rename is reflected
    /// on reactions already given rather than only on new ones. A reaction
    /// counts only when the account in its key holds it: a patched node can
    /// write a key naming someone else, but that is its own entry at the key.
    ///
    /// Keys are per owner, so one key appears once per account holding it.
    /// Each distinct key is read once, as the entry of the account it names.
    fn get_reactions_for_message(&self, message_id: &str) -> Option<HashMap<String, Vec<UserId>>> {
        let prefix = format!("{message_id}{KEY_SEP}");
        let mut hashmap: HashMap<String, Vec<UserId>> = HashMap::new();
        let mut last: Option<String> = None;
        for (key, ()) in self.reactions.prefix(prefix.as_bytes()).ok()? {
            if last.as_ref() == Some(&key) {
                continue;
            }
            last = Some(key.clone());
            let Some((emoji, account_hex)) = key[prefix.len()..].rsplit_once(KEY_SEP) else {
                continue;
            };
            let Ok(owner) = account_hex.parse::<AccountId>() else {
                continue;
            };
            if hex(owner.as_bytes()) != account_hex
                || !self.reactions.contains_by(&owner, &key).unwrap_or(false)
            {
                continue;
            }
            hashmap
                .entry(emoji.to_owned())
                .or_default()
                .push(user_of(owner));
        }
        (!hashmap.is_empty()).then_some(hashmap)
    }

    fn get_thread_info(&self, message_id: &str) -> (u32, u64) {
        let Ok(replies) = self.threads.prefix(thread_prefix(message_id).as_bytes()) else {
            return (0, 0);
        };
        let mut count = 0u32;
        let mut last_ts = 0;
        for (_, reply) in replies {
            count += 1;
            last_ts = *reply.timestamp;
        }
        (count, last_ts)
    }

    fn paginate(
        filtered: Vec<MessageWithReactions>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> FullMessageResponse {
        let total = filtered.len();
        if total == 0 {
            return FullMessageResponse {
                total_count: 0,
                messages: Vec::new(),
                start_position: 0,
            };
        }

        let limit_value = limit.unwrap_or(total);
        let offset_value = offset.unwrap_or(0);

        if offset_value >= total {
            return FullMessageResponse {
                total_count: total as u32,
                messages: Vec::new(),
                start_position: offset_value as u32,
            };
        }

        let end_idx = total - offset_value;
        let start_idx = end_idx.saturating_sub(limit_value);
        let paginated = filtered[start_idx..end_idx].to_vec();

        FullMessageResponse {
            total_count: total as u32,
            messages: paginated,
            start_position: offset_value as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;
    use calimero_sdk::BlobId;

    use super::{
        draft_key, hex, reaction_key, thread_key, ContextType, LwwRegister, MeroChat, Message, Op,
        Role, UnorderedSet, UserId, Vector, MAX_MESSAGE_LEN, MAX_SEARCH_TERM_LEN,
    };

    // ── AccessControl-backed roles (TestHost) ──────────────────────────────────

    const MODR: [u8; 32] = [0x22; 32];
    const USER: [u8; 32] = [0x33; 32];

    const CREATOR: fn() -> [u8; 32] = calimero_sdk::env::account_id;

    /// Send a top-level message as the default executor; returns its id.
    fn send(app: &mut TestHost<MeroChat>, text: &str) -> String {
        app.call(|s| s.send_message(text.to_owned(), vec![], vec![], None, 1, None, None))
            .expect("send")
            .id
            .get()
            .clone()
    }

    fn send_as(app: &mut TestHost<MeroChat>, who: [u8; 32], text: &str) -> String {
        app.call_as_account(who, who, |s| {
            s.send_message(text.to_owned(), vec![], vec![], None, 1, None, None)
        })
        .expect("send")
        .id
        .get()
        .clone()
    }

    fn new_chat() -> TestHost<MeroChat> {
        // init runs as the default test executor, who becomes the sole admin.
        // `TestHost::new` does not align the storage layer's account with the
        // SDK's while `init` runs, and the moderators of `threads` are read
        // from the storage layer's, so align them here as a node does.
        TestHost::new(|| {
            calimero_storage::env::with_account_id(calimero_sdk::env::account_id(), || {
                MeroChat::init(
                    "ctx".to_owned(),
                    ContextType::Channel,
                    "desc".to_owned(),
                    0,
                    "creator".to_owned(),
                )
            })
        })
    }

    #[test]
    fn removing_the_last_reaction_of_a_kind_removes_the_kind() {
        // `or_insert` creates the set on the way in, so taking the reaction
        // away again used to leave `{"👍": []}` behind: a pill with a count of
        // zero, which a client cannot tell apart from one nobody has pressed.
        // "No reactions" must arrive in one shape, not two.
        let mut app = new_chat();

        let sent = app
            .call(|c| c.send_message("hello".to_owned(), vec![], vec![], None, 0, None, None))
            .expect("send");
        let id = sent.id.to_string();

        app.call(|c| c.update_reaction(id.clone(), "👍".to_owned(), true))
            .expect("add");

        let with_reaction = app
            .call(|c| c.get_messages(None, Some(10), Some(0), None))
            .expect("read");
        let reacted = with_reaction
            .messages
            .iter()
            .find(|m| m.id == id)
            .expect("message present");
        assert!(
            reacted
                .reactions
                .as_ref()
                .is_some_and(|r| r.contains_key("👍")),
            "the reaction should be there once added",
        );

        app.call(|c| c.update_reaction(id.clone(), "👍".to_owned(), false))
            .expect("remove");

        let after = app
            .call(|c| c.get_messages(None, Some(10), Some(0), None))
            .expect("read");
        let cleared = after
            .messages
            .iter()
            .find(|m| m.id == id)
            .expect("message present");

        let leftover = cleared
            .reactions
            .as_ref()
            .map(|r| r.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        assert!(
            leftover.is_empty(),
            "an emptied reaction kind lingered: {leftover:?}",
        );
    }

    #[test]
    fn creator_is_the_sole_admin() {
        let app = new_chat();
        let admins = app
            .view(|s| s.list_roles())
            .into_iter()
            .filter(|(_, r)| *r == Role::Admin)
            .count();
        assert_eq!(admins, 1);
    }

    #[test]
    fn non_admin_cannot_grant_admin() {
        // The headline fix: a non-admin's attempt to promote themselves (or
        // anyone) to Admin is refused by the fail-fast guard, and the
        // authoritative writer-set check rejects a forged grant delta at merge.
        let mut app = new_chat();
        let target = UserId::new(USER);
        let denied = app.call_as_account(MODR, MODR, |s| s.set_member_role(target, Role::Admin));
        assert!(denied.is_err());
        assert_eq!(app.view(|s| s.get_member_role(target)), Role::User);
    }

    #[test]
    fn admin_promotes_mod_then_mod_moderates_within_limits() {
        let mut app = new_chat();
        let modr = UserId::new(MODR);
        let user = UserId::new(USER);

        // Admin promotes a moderator.
        app.call(|s| s.set_member_role(modr, Role::Mod)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(modr)), Role::Mod);

        // The moderator may ban a user (separate exclusion set, no admin grant).
        app.call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::Banned))
            .unwrap();
        assert_eq!(app.view(|s| s.get_member_role(user)), Role::Banned);

        // …but may not escalate a user to Admin.
        assert!(app
            .call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::Admin))
            .is_err());

        // …and may unban (Banned → User).
        app.call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::User))
            .unwrap();
        assert_eq!(app.view(|s| s.get_member_role(user)), Role::User);
    }

    #[test]
    fn banned_member_is_blocked_from_mutations() {
        let mut app = new_chat();
        let user = UserId::new(USER);
        app.call(|s| s.set_member_role(user, Role::Banned)).unwrap();
        // A banned caller's state-mutating action is rejected by the ban gate.
        let r = app.call_as_account(USER, USER, |s| {
            s.save_draft("general".to_owned(), "hi".to_owned())
        });
        assert!(r.is_err());
    }

    /// A reaction records the ACCOUNT that made it, and nothing the caller says.
    ///
    /// `update_reaction` used to take the reacting user as a caller-supplied
    /// string, which made impersonation reachable through the plain public ABI:
    /// call it with someone else's name to react as them, or with `add: false`
    /// to remove theirs. The parameter is gone; the executor is the only
    /// source.
    #[test]
    fn a_reaction_records_the_caller_account() {
        let mut app = new_chat();
        let id = send(&mut app, "hello");

        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction(id.clone(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();

        let reactors = app
            .view(|s| s.get_reactions_for_message(&id))
            .unwrap_or_default();
        let thumbs = reactors.get("\u{1f44d}").cloned().unwrap_or_default();

        assert_eq!(thumbs, vec![UserId::new(MODR)], "the reactor is the caller");
    }

    /// Two members with the SAME display name must hold separate reactions.
    ///
    /// Keying by name meant they shared one slot — each able to remove the
    /// other's — and that a rename split a member's own reaction in two.
    #[test]
    fn same_named_members_do_not_share_a_reaction() {
        let mut app = new_chat();
        let id = send(&mut app, "hello");

        let name = "Xabi".to_owned();
        app.call_as_account(MODR, MODR, |s| s.set_profile(name.clone(), None))
            .unwrap();
        app.call_as_account(USER, USER, |s| s.set_profile(name.clone(), None))
            .unwrap();

        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction(id.clone(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();
        app.call_as_account(USER, USER, |s| {
            s.update_reaction(id.clone(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();

        let reactors = app
            .view(|s| s.get_reactions_for_message(&id))
            .unwrap_or_default();
        let mut thumbs = reactors.get("\u{1f44d}").cloned().unwrap_or_default();
        thumbs.sort();
        let mut want = vec![UserId::new(MODR), UserId::new(USER)];
        want.sort();

        assert_eq!(thumbs, want, "each account holds its own reaction");

        // And one removing does not take the other's with it.
        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction(id.clone(), "\u{1f44d}".to_owned(), false)
        })
        .unwrap();
        let after = app
            .view(|s| s.get_reactions_for_message(&id))
            .unwrap_or_default();
        assert_eq!(
            after.get("\u{1f44d}").cloned().unwrap_or_default(),
            vec![UserId::new(USER)],
        );
    }

    /// D7: a search term has a ceiling.
    ///
    /// Search walks every message in the channel and every thread, matching the
    /// term against each — so the cost is (messages x term length) and the
    /// caller picks the second factor. The runtime meters wasm operators and
    /// has no read limit, so an unbounded term is a cheap way to make a node
    /// grind through the whole channel on request.
    #[test]
    fn an_oversized_search_term_is_refused() {
        let mut app = new_chat();
        app.call(|s| {
            s.send_message(
                "hello".to_owned(),
                Vec::new(),
                Vec::new(),
                None,
                1,
                None,
                None,
            )
        })
        .unwrap();

        let huge = "x".repeat(MAX_SEARCH_TERM_LEN + 1);

        assert!(
            app.view(|s| s.search_all_messages(huge.clone(), None, None))
                .is_err(),
            "search_all_messages accepted an oversized term",
        );
        assert!(
            app.view(|s| s.get_messages(None, None, None, Some(huge)))
                .is_err(),
            "get_messages accepted an oversized search term",
        );
    }

    /// The bound must not reject terms anyone would actually type.
    #[test]
    fn a_normal_search_term_still_works() {
        let mut app = new_chat();
        app.call(|s| {
            s.send_message(
                "the merger closes friday".to_owned(),
                Vec::new(),
                Vec::new(),
                None,
                1,
                None,
                None,
            )
        })
        .unwrap();

        let found = app
            .view(|s| s.search_all_messages("merger".to_owned(), None, None))
            .expect("search");
        assert_eq!(found.messages.len(), 1);

        // Exactly at the limit is accepted; the ceiling is inclusive.
        let at_limit = "y".repeat(MAX_SEARCH_TERM_LEN);
        assert!(app
            .view(|s| s.search_all_messages(at_limit, None, None))
            .is_ok());
    }

    /// S2: a draft belongs to its author's node, not to the channel.
    ///
    /// Drafts used to sit on the replicated state, so an unsent message
    /// replicated in the clear to every member of the channel. The API only
    /// ever returned you your own — which is what made it look private — but
    /// the bytes were in everyone's local store either way.
    ///
    /// Round-tripping through the private API is the observable part of the
    /// fix; that the data is node-local is a property of `#[app::private]`.
    #[test]
    fn a_draft_round_trips_for_its_author() {
        let mut app = new_chat();

        app.call(|s| s.save_draft("general".to_owned(), "half a thought".to_owned()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_draft("general".to_owned())),
            "half a thought"
        );

        // A different channel is a different draft, not the same one.
        assert_eq!(app.view(|s| s.get_draft("random".to_owned())), "");

        // Saving empty text clears it, which is how the composer signals
        // "nothing left to keep".
        app.call(|s| s.save_draft("general".to_owned(), String::new()))
            .unwrap();
        assert_eq!(app.view(|s| s.get_draft("general".to_owned())), "");
    }

    /// Deleting a draft removes it rather than blanking it.
    #[test]
    fn a_deleted_draft_is_gone() {
        let mut app = new_chat();

        app.call(|s| s.save_draft("general".to_owned(), "typing…".to_owned()))
            .unwrap();
        app.call(|s| s.delete_draft("general".to_owned())).unwrap();

        assert_eq!(app.view(|s| s.get_draft("general".to_owned())), "");
    }

    /// S1: a message id must be a digest, not a transcript.
    ///
    /// The id used to be `hex(account ‖ plaintext ‖ …)` with no hashing at all,
    /// so the message came straight back out of it. Ids travel in events, key
    /// reactions and threads, and are exactly what a "link to this message"
    /// would carry in a URL.
    #[test]
    fn a_message_id_does_not_contain_the_message() {
        let mut app = new_chat();
        let secret = "the merger closes friday, tell no one";

        let message = app
            .call(|s| {
                s.send_message(
                    secret.to_owned(),
                    Vec::new(),
                    Vec::new(),
                    None,
                    1,
                    None,
                    None,
                )
            })
            .unwrap();

        // Neither as text nor as the hex the old derivation produced.
        assert!(!message.id.contains(secret));
        let as_hex: String = secret.bytes().map(|b| format!("{b:02x}")).collect();
        assert!(
            !message.id.contains(&as_hex),
            "id still carries the plaintext: {}",
            message.id
        );
    }

    /// The id's length must not track the message's.
    ///
    /// A length that grows with the message leaks how much was said even when
    /// the words are hidden, and made ids unusable in a URL: a 500-character
    /// message used to yield an id of about 1080 characters.
    #[test]
    fn message_id_length_does_not_grow_with_the_message() {
        let mut app = new_chat();

        let send = |app: &mut TestHost<MeroChat>, text: String, ts: u64| {
            app.call(|s| s.send_message(text, Vec::new(), Vec::new(), None, ts, None, None))
                .unwrap()
                .id
        };

        let short = send(&mut app, "hi".to_owned(), 1);
        let long = send(&mut app, "x".repeat(500), 2);

        assert_eq!(short.len(), long.len());
        // 64 hex characters of digest, an underscore, and the timestamp.
        assert!(short.starts_with(&short[..64]));
        assert_eq!(short[..64].len(), 64);
    }

    /// Hashing must not cost uniqueness: the same words twice are two messages.
    #[test]
    fn identical_messages_still_get_distinct_ids() {
        let mut app = new_chat();

        let send = |app: &mut TestHost<MeroChat>| {
            app.call(|s| {
                s.send_message(
                    "same".to_owned(),
                    Vec::new(),
                    Vec::new(),
                    None,
                    7,
                    None,
                    None,
                )
            })
            .unwrap()
            .id
        };

        let first = send(&mut app);
        let second = send(&mut app);

        assert_ne!(first, second);
    }

    /// The property the whole resume story rests on: an index, once handed out,
    /// keeps naming the same message however many messages arrive after it.
    ///
    /// If this stopped holding, a client returning after two hours would ask
    /// for "everything after 42" and get the wrong messages — silently, with no
    /// error and no gap it could detect.
    #[test]
    fn an_index_keeps_naming_the_same_message_as_the_channel_grows() {
        let mut app = new_chat();

        let send = |app: &mut TestHost<MeroChat>, n: u64| {
            app.call(|s| {
                s.send_message(format!("m{n}"), Vec::new(), Vec::new(), None, n, None, None)
            })
            .unwrap();
        };

        for n in 0..5 {
            send(&mut app, n);
        }

        let before = app.view(|s| s.get_messages_from(2, Some(2))).unwrap();
        let named: Vec<String> = before.messages.iter().map(|m| m.text.clone()).collect();
        assert_eq!(named, vec!["m2", "m3"]);
        assert_eq!(before.messages[0].index, 2);

        // Twenty more arrive.
        for n in 5..25 {
            send(&mut app, n);
        }

        let after = app.view(|s| s.get_messages_from(2, Some(2))).unwrap();
        let still: Vec<String> = after.messages.iter().map(|m| m.text.clone()).collect();
        assert_eq!(
            still, named,
            "the same indices must still name the same messages after appends"
        );
        assert_eq!(after.total_count, 25);
    }

    /// Catching up asks for everything after the last index held, and gets
    /// exactly that — no overlap to dedupe, no gap to detect.
    #[test]
    fn catching_up_from_the_last_index_returns_exactly_what_was_missed() {
        let mut app = new_chat();
        for n in 0..3 {
            app.call(|s| {
                s.send_message(
                    format!("old{n}"),
                    Vec::new(),
                    Vec::new(),
                    None,
                    n,
                    None,
                    None,
                )
            })
            .unwrap();
        }

        // The client goes away holding everything through index 2.
        let held_through = app.view(|s| s.get_message_count()).unwrap() - 1;
        assert_eq!(held_through, 2);

        for n in 0..4 {
            app.call(|s| {
                s.send_message(
                    format!("new{n}"),
                    Vec::new(),
                    Vec::new(),
                    None,
                    10 + n,
                    None,
                    None,
                )
            })
            .unwrap();
        }

        let missed = app
            .view(|s| s.get_messages_from(held_through + 1, None))
            .unwrap();
        let texts: Vec<String> = missed.messages.iter().map(|m| m.text.clone()).collect();
        assert_eq!(texts, vec!["new0", "new1", "new2", "new3"]);
        assert_eq!(missed.total_count, 7);
    }

    /// A cursor past the end is "you are up to date", not an error and not a
    /// wrapped-around page.
    #[test]
    fn a_cursor_past_the_end_returns_nothing_and_the_current_length() {
        let mut app = new_chat();
        app.call(|s| {
            s.send_message(
                "only".to_owned(),
                Vec::new(),
                Vec::new(),
                None,
                1,
                None,
                None,
            )
        })
        .unwrap();

        let resp = app.view(|s| s.get_messages_from(99, Some(10))).unwrap();
        assert!(resp.messages.is_empty());
        assert_eq!(resp.total_count, 1);
        assert_eq!(resp.start_position, 99);
    }

    /// The windowed read must be a pure optimisation: same page, same
    /// total_count, same start_position as the scan it replaces.
    ///
    /// Worth pinning every combination rather than one happy path, because
    /// `paginate` counts its window from the END of the collection — offset 0
    /// is the NEWEST page, not the oldest — and an off-by-one in that
    /// arithmetic returns plausible-looking messages from the wrong place.
    #[test]
    fn the_windowed_page_matches_the_scan_it_replaces() {
        let mut app = new_chat();

        for i in 0..25 {
            app.call(|s| {
                s.send_message(
                    format!("m{i}"),
                    Vec::new(),
                    Vec::new(),
                    None,
                    i as u64,
                    None,
                    None,
                )
            })
            .unwrap();
        }

        for (limit, offset) in [
            (None, None),
            (Some(1), None),
            (Some(5), None),
            (Some(5), Some(0)),
            (Some(5), Some(5)),
            (Some(5), Some(23)),
            (Some(5), Some(25)),
            (Some(5), Some(100)),
            (Some(100), Some(0)),
            (Some(0), Some(0)),
        ] {
            let (windowed, scanned) = app.view(|s| {
                let windowed = s.page_unfiltered(&s.messages, limit, offset, true);
                let scanned = MeroChat::paginate(
                    s.collect_messages_with_reactions(&s.messages, None, true),
                    limit,
                    offset,
                );
                (windowed, scanned)
            });

            assert_eq!(
                windowed.total_count, scanned.total_count,
                "total_count differs at limit={limit:?} offset={offset:?}"
            );
            assert_eq!(
                windowed.start_position, scanned.start_position,
                "start_position differs at limit={limit:?} offset={offset:?}"
            );

            let got: Vec<&str> = windowed.messages.iter().map(|m| m.text.as_str()).collect();
            let want: Vec<&str> = scanned.messages.iter().map(|m| m.text.as_str()).collect();
            assert_eq!(
                got, want,
                "page differs at limit={limit:?} offset={offset:?}"
            );
        }
    }

    /// An empty collection took a separate early-return in `paginate`
    /// (start_position 0, not the requested offset); the windowed path must
    /// keep that, not "improve" it.
    #[test]
    fn the_windowed_page_matches_the_scan_when_there_are_no_messages() {
        let app = new_chat();

        let (windowed, scanned) = app.view(|s| {
            let windowed = s.page_unfiltered(&s.messages, Some(10), Some(7), true);
            let scanned = MeroChat::paginate(
                s.collect_messages_with_reactions(&s.messages, None, true),
                Some(10),
                Some(7),
            );
            (windowed, scanned)
        });

        assert_eq!(windowed.total_count, scanned.total_count);
        assert_eq!(windowed.start_position, scanned.start_position);
        assert!(windowed.messages.is_empty());
        assert!(scanned.messages.is_empty());
    }

    #[test]
    fn admin_demotes_mod_to_user() {
        let mut app = new_chat();
        let modr = UserId::new(MODR);
        app.call(|s| s.set_member_role(modr, Role::Mod)).unwrap();
        app.call(|s| s.set_member_role(modr, Role::User)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(modr)), Role::User);
    }

    #[test]
    fn banning_then_clearing_does_not_leave_stale_grants() {
        // Banning a mod and later assigning User/Mod must clear the underlying
        // AccessControl grant rather than rely on the (ban-masked) display role,
        // so role_of always matches the requested role.
        let mut app = new_chat();
        let modr = UserId::new(MODR);
        app.call(|s| s.set_member_role(modr, Role::Mod)).unwrap();
        app.call(|s| s.set_member_role(modr, Role::Banned)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(modr)), Role::Banned);
        // Underlying mod grant must already be cleared by the ban.
        app.call(|s| s.set_member_role(modr, Role::User)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(modr)), Role::User);
    }

    // ── Storage-enforced protections ───────────────────────────────────────
    //
    // A member can run a patched node that skips every check in this file, so
    // the tests below that call a collection directly play that node: they are
    // the writes storage itself must refuse.

    const MOD2: [u8; 32] = [0x44; 32];

    fn stored_message(sender: UserId, id: &str, text: &str) -> Message {
        Message {
            timestamp: LwwRegister::new(1),
            sender,
            mentions: UnorderedSet::new(),
            mentions_usernames: Vector::new(),
            files: Vector::new(),
            images: Vector::new(),
            id: LwwRegister::new(id.to_owned()),
            text: LwwRegister::new(text.to_owned()),
            edited_on: None,
            deleted: None,
        }
    }

    #[test]
    fn a_member_who_is_not_staff_cannot_ban_even_bypassing_the_app() {
        let mut app = new_chat();
        let admin = UserId::new(CREATOR());
        let user = UserId::new(USER);

        assert!(app
            .call_as_account(USER, USER, |s| s.set_member_role(admin, Role::Banned))
            .is_err());
        assert!(app
            .call_as_account(USER, USER, |s| s.set_banned(&admin, true))
            .is_err());
        assert!(!app.view(|s| s.is_banned(&admin)));
        // What every other node enforces on a patched node's direct write: only
        // the staff are writers of the ban set.
        assert!(!app.view(|s| s.banned.can(&USER.into(), Op::Write)));
        assert!(app.view(|s| s.banned.can(&CREATOR().into(), Op::Write)));
        assert!(!app.view(|s| s.is_banned(&user)));
    }

    #[test]
    fn a_banned_member_cannot_unban_themselves() {
        let mut app = new_chat();
        let user = UserId::new(USER);
        app.call(|s| s.set_member_role(user, Role::Banned)).unwrap();

        assert!(app
            .call_as_account(USER, USER, |s| s.set_banned(&user, false))
            .is_err());
        assert_eq!(app.view(|s| s.get_member_role(user)), Role::Banned);
    }

    #[test]
    fn a_ban_flag_on_an_admin_does_not_lock_the_admins_out() {
        let mut app = new_chat();
        let admin = UserId::new(CREATOR());
        let modr = UserId::new(MODR);
        app.call(|s| s.set_member_role(modr, Role::Mod)).unwrap();

        // A moderator is staff, so storage lets their node write any ban flag;
        // a patched one could flag an admin.
        app.call_as_account(MODR, MODR, |s| s.set_banned(&admin, true))
            .unwrap();

        assert_eq!(app.view(|s| s.get_member_role(admin)), Role::Admin);
        app.call(|s| s.set_member_role(modr, Role::User))
            .expect("the admin still moderates");
    }

    #[test]
    fn a_profile_slot_is_its_owners_alone() {
        let mut app = new_chat();
        app.call_as_account(USER, USER, |s| s.set_profile("user".to_owned(), None))
            .unwrap();

        let profiles = app.view(|s| s.get_profiles());
        let name_of = |id: [u8; 32]| {
            profiles
                .iter()
                .find(|p| p.identity == UserId::new(id))
                .map(|p| p.username.clone())
        };
        assert_eq!(name_of(USER).as_deref(), Some("user"));
        assert_eq!(name_of(CREATOR()).as_deref(), Some("creator"));
        // Nobody wrote MODR's slot, and nobody but MODR can.
        assert_eq!(name_of(MODR), None);
    }

    #[test]
    fn a_messages_sender_is_its_owner_stamp_not_its_field() {
        let mut app = new_chat();
        let victim = UserId::new(MODR);

        // A patched node pushes a message claiming to be from someone else.
        app.call_as_account(USER, USER, |s| {
            s.messages
                .push(stored_message(victim, "forged_1", "I resign"))
                .map(|_| ())
        })
        .unwrap();

        let page = app
            .view(|s| s.get_messages(None, None, None, None))
            .unwrap();
        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.messages[0].sender, UserId::new(USER));
    }

    #[test]
    fn only_the_sender_edits_a_message() {
        let mut app = new_chat();
        let id = send_as(&mut app, USER, "draft");

        assert!(app
            .call_as_account(MODR, MODR, |s| s.edit_message(
                id.clone(),
                "mine now".to_owned(),
                2,
                None
            ))
            .is_err());
        app.call_as_account(USER, USER, |s| {
            s.edit_message(id.clone(), "final".to_owned(), 2, None)
        })
        .unwrap();

        let page = app
            .view(|s| s.get_messages(None, None, None, None))
            .unwrap();
        assert_eq!(page.messages[0].text, "final");
        assert_eq!(page.messages[0].edited_on, Some(2));
    }

    #[test]
    fn only_the_sender_or_staff_delete_a_message_and_nobody_else_undeletes_it() {
        let mut app = new_chat();
        let id = send_as(&mut app, USER, "spam");

        assert!(app
            .call_as_account(MODR, MODR, |s| s.delete_message(id.clone(), None))
            .is_err());
        // Neither is a writer of the hidden set, which every node checks.
        assert!(!app.view(|s| s.hidden.can(&MODR.into(), Op::Write)));
        assert!(!app.view(|s| s.hidden.can(&USER.into(), Op::Write)));

        // An admin removes someone else's message.
        app.call(|s| s.delete_message(id.clone(), None)).unwrap();
        let page = app
            .view(|s| s.get_messages(None, None, None, None))
            .unwrap();
        assert_eq!(page.messages[0].deleted, Some(true));
        assert_eq!(page.messages[0].text, "");

        // A sender deletes their own.
        let own = send_as(&mut app, USER, "oops");
        app.call_as_account(USER, USER, |s| s.delete_message(own.clone(), None))
            .unwrap();
        assert_eq!(app.view(|s| s.get_unread_count()), 0);
    }

    #[test]
    fn a_moderator_removes_a_thread_reply_and_a_member_cannot() {
        let mut app = new_chat();
        let parent = send(&mut app, "parent");
        let reply = app
            .call_as_account(USER, USER, |s| {
                s.send_message(
                    "reply".to_owned(),
                    vec![],
                    vec![],
                    Some(parent.clone()),
                    2,
                    None,
                    None,
                )
            })
            .unwrap()
            .id
            .get()
            .clone();
        let key = thread_key(&parent, &reply).unwrap();
        let thread_len = |app: &TestHost<MeroChat>| {
            app.view(|s| s.get_messages(Some(parent.clone()), None, None, None))
                .unwrap()
                .messages
                .len()
        };
        assert_eq!(thread_len(&app), 1);

        assert!(app
            .call_as_account(MODR, MODR, |s| s
                .delete_message(reply.clone(), Some(parent.clone())))
            .is_err());
        // Keys are per owner: MODR's key-only remove names MODR's own entry,
        // and removing USER's by name needs a moderator.
        assert!(app
            .call_as_account(MODR, MODR, |s| s.threads.remove(&key))
            .unwrap()
            .is_none());
        assert!(app
            .call_as_account(MODR, MODR, |s| s.threads.remove_by(&USER.into(), &key))
            .is_err());
        assert_eq!(thread_len(&app), 1);

        // Promoting a moderator makes them one of `threads`' moderators.
        app.call(|s| s.set_member_role(UserId::new(MOD2), Role::Mod))
            .unwrap();
        app.call_as_account(MOD2, MOD2, |s| {
            s.delete_message(reply.clone(), Some(parent.clone()))
        })
        .unwrap();
        assert_eq!(thread_len(&app), 0);

        // And demoting them takes it away again.
        app.call(|s| s.set_member_role(UserId::new(MOD2), Role::User))
            .unwrap();
        assert!(!app.view(|s| s.threads.is_moderator(&MOD2.into())));
    }

    #[test]
    fn a_reaction_is_its_reactors_alone() {
        let mut app = new_chat();
        let id = send(&mut app, "hello");
        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction(id.clone(), "+1".to_owned(), true)
        })
        .unwrap();
        let modrs = reaction_key(&id, "+1", &UserId::new(MODR));

        // Nobody else can take it away: keys are per owner, so USER's remove
        // names USER's own entry at the key, of which there is none.
        assert!(app
            .call_as_account(USER, USER, |s| s.reactions.remove(&modrs))
            .unwrap()
            .is_none());
        // Nor can USER file a copy under MODR's key and have it count twice.
        app.call_as_account(USER, USER, |s| s.reactions.insert(modrs.clone(), ()))
            .unwrap();
        // A key naming someone else is stored, but its owner stamp gives it away.
        app.call_as_account(USER, USER, |s| {
            s.reactions
                .insert(reaction_key(&id, "-1", &UserId::new(MODR)), ())
        })
        .unwrap();

        let reactions = app
            .view(|s| s.get_reactions_for_message(&id))
            .unwrap_or_default();
        assert_eq!(reactions.get("+1"), Some(&vec![UserId::new(MODR)]));
        assert_eq!(reactions.get("-1"), None);
    }

    #[test]
    fn only_admins_change_the_channels_info() {
        let mut app = new_chat();

        assert!(app
            .call_as_account(USER, USER, |s| s
                .update_info(Some("pwned".to_owned()), None))
            .is_err());
        let text = app.view(|s| s.get_info()).unwrap();
        assert!(app
            .call_as_account(USER, USER, |s| s.info.insert(super::ChannelText::default()))
            .is_err());

        app.call(|s| s.update_info(Some("renamed".to_owned()), None))
            .unwrap();
        let info = app.view(|s| s.get_info()).unwrap();
        assert_eq!(info.name, "renamed");
        assert_eq!(info.description, text.description);
        // Founding facts come from the frozen record.
        assert_eq!(info.creator, UserId::new(CREATOR()).to_string());
        assert!(info.context_type == ContextType::Channel);
    }

    #[test]
    fn a_read_receipt_is_per_account() {
        let mut app = new_chat();
        send_as(&mut app, USER, "one");
        send_as(&mut app, USER, "two");

        app.call_as_account(MODR, MODR, |s| s.mark_as_read(10))
            .unwrap();
        assert_eq!(app.view(|s| s.get_unread_count()), 2);
        app.set_account(MODR);
        assert_eq!(app.view(|s| s.get_unread_count()), 0);
    }

    #[test]
    fn what_one_write_may_add_is_bounded() {
        let mut app = new_chat();
        let send_text = |app: &mut TestHost<MeroChat>, text: String, ts: u64| {
            app.call(|s| s.send_message(text, vec![], vec![], None, ts, None, None))
        };

        assert!(send_text(&mut app, "x".repeat(MAX_MESSAGE_LEN + 1), 1).is_err());
        assert!(send_text(&mut app, "x".repeat(MAX_MESSAGE_LEN), 1).is_ok());

        // A timestamp an hour ahead of the node's clock is refused.
        let now = calimero_sdk::env::time_now() / 1_000_000_000;
        assert!(send_text(&mut app, "later".to_owned(), now + 3_600).is_err());
        assert!(send_text(&mut app, "now".to_owned(), now).is_ok());

        // Replies and reactions need a message to attach to.
        assert!(app
            .call(|s| s.send_message(
                "orphan".to_owned(),
                vec![],
                vec![],
                Some("nope_1".to_owned()),
                1,
                None,
                None
            ))
            .is_err());
        assert!(app
            .call(|s| s.update_reaction("nope_1".to_owned(), "+1".to_owned(), true))
            .is_err());
        let id = send(&mut app, "hi");
        assert!(app
            .call(|s| s.update_reaction(id.clone(), "x".repeat(65), true))
            .is_err());
        assert!(app
            .call(|s| s.update_reaction(id.clone(), format!("a{}b", '\u{1f}'), true))
            .is_err());
        assert_eq!(hex(&[0xab, 0x01]), "ab01");
    }

    // ── BlobId roundtrip ───────────────────────────────────────────────────────

    #[test]
    fn blob_id_roundtrip_typical() {
        let original = BlobId::from([
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54,
            0x32, 0x10, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98,
            0x76, 0x54, 0x32, 0x10,
        ]);
        let encoded = original.to_string();
        let decoded: BlobId = encoded.parse().expect("roundtrip should succeed");
        assert_eq!(original, decoded);
    }

    #[test]
    fn blob_id_roundtrip_all_zeros() {
        let blob_id = BlobId::from([0u8; 32]);
        let parsed: BlobId = blob_id.to_string().parse().expect("all-zeros roundtrip");
        assert_eq!(blob_id, parsed);
    }

    #[test]
    fn blob_id_roundtrip_all_max() {
        let blob_id = BlobId::from([0xffu8; 32]);
        let parsed: BlobId = blob_id.to_string().parse().expect("all-0xFF roundtrip");
        assert_eq!(blob_id, parsed);
    }

    /// A blob id is 64 lowercase hex characters.
    ///
    /// This replaces a test that asserted the encoded id contained no `0`, `O`,
    /// `I` or `l` — the base58 alphabet's excluded characters. core removed
    /// base58 in 0.11.0-rc.27 and `Display` is `hex::encode` now, so that
    /// assertion was checking a property the type no longer has. It kept
    /// passing only because the byte it chose, `0x42`, happens to render as
    /// "42": the all-zeros id it tested two functions above would have failed
    /// it. Asserting the real shape instead, and over bytes that would catch
    /// the drift.
    #[test]
    fn blob_id_encodes_as_64_lowercase_hex() {
        for bytes in [[0x00u8; 32], [0x42u8; 32], [0xffu8; 32]] {
            let encoded = BlobId::from(bytes).to_string();
            assert_eq!(encoded.len(), 64, "encoded: {encoded}");
            assert!(
                encoded
                    .chars()
                    .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
                "not lowercase hex: {encoded}"
            );
        }
        assert_eq!(BlobId::from([0x00u8; 32]).to_string(), "0".repeat(64));
        assert_eq!(BlobId::from([0xffu8; 32]).to_string(), "f".repeat(64));
    }

    #[test]
    fn parse_blob_id_rejects_non_hex_characters() {
        assert!("not-valid-hex!!!!-/-".parse::<BlobId>().is_err());
        // `g` is past the hex alphabet, and 64 characters long so the length
        // check cannot be what rejects it.
        assert!("g".repeat(64).parse::<BlobId>().is_err());
    }

    /// The whole point of `api/blobs.ts`'s `toBlobIdHex`, from the other side.
    ///
    /// This app's lineage used to `bs58::encode` a blob id before storing it.
    /// Base58 of 32 bytes is ~44 characters from a wider alphabet, so it is
    /// non-empty and looks like an id — and the node refuses it. Pinning the
    /// refusal here means a reintroduction fails in `cargo test` rather than as
    /// a 404 three layers away.
    #[test]
    fn parse_blob_id_rejects_a_base58_spelling_of_a_real_id() {
        let id = BlobId::from([0x42u8; 32]);
        let as_base58 = bs58::encode(*id.as_ref()).into_string();
        assert_ne!(as_base58, id.to_string());
        assert!(as_base58.parse::<BlobId>().is_err(), "base58: {as_base58}");
    }

    #[test]
    fn parse_blob_id_wrong_length() {
        // Hex, and every character legal — only the length is wrong, so this
        // cannot pass for the wrong reason.
        assert!("01020304".parse::<BlobId>().is_err());
        assert!("a".repeat(63).parse::<BlobId>().is_err());
        assert!("a".repeat(65).parse::<BlobId>().is_err());
    }

    #[test]
    fn parse_blob_id_empty_string() {
        assert!("".parse::<BlobId>().is_err());
    }

    // ── Draft key format ────────────────────────────────────────────────────

    #[test]
    fn draft_key_contains_user_and_channel() {
        assert_eq!(
            draft_key("SomeBase58UserId", "general"),
            "SomeBase58UserId:general"
        );
    }

    #[test]
    fn draft_key_separator_is_colon() {
        let key = draft_key("abc", "my-channel");
        let parts: Vec<&str> = key.splitn(2, ':').collect();
        assert_eq!(parts, ["abc", "my-channel"]);
    }

    #[test]
    fn draft_key_with_real_base58_user_id() {
        let user_b58 = BlobId::from([0x01u8; 32]).to_string();
        let key = draft_key(&user_b58, "announcements");
        assert!(key.starts_with(&user_b58));
        assert!(key.ends_with(":announcements"));
    }

    #[test]
    fn draft_key_different_users_produce_different_keys() {
        let a = BlobId::from([0x01u8; 32]).to_string();
        let b = BlobId::from([0x02u8; 32]).to_string();
        assert_ne!(draft_key(&a, "general"), draft_key(&b, "general"));
    }

    #[test]
    fn draft_key_same_user_different_channels_produce_different_keys() {
        let user = BlobId::from([0xaau8; 32]).to_string();
        assert_ne!(draft_key(&user, "general"), draft_key(&user, "random"));
    }

    #[test]
    fn draft_key_channel_name_with_colon_is_preserved() {
        let key = draft_key("user123", "chan:with:colons");
        let parts: Vec<&str> = key.splitn(2, ':').collect();
        assert_eq!(parts[1], "chan:with:colons");
    }

    #[test]
    fn draft_key_empty_channel_name() {
        assert_eq!(draft_key("userXYZ", ""), "userXYZ:");
    }

    #[test]
    fn draft_key_is_deterministic() {
        let user = BlobId::from([0x55u8; 32]).to_string();
        assert_eq!(draft_key(&user, "stable"), draft_key(&user, "stable"));
    }
}
