use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::abi::AbiType;
use calimero_sdk::{app, env, AccountId, BlobId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{
    AccessControl, AuthoredMap, AuthoredVector, LwwRegister, Mergeable as MergeableTrait,
    UnorderedMap, UnorderedSet, Vector,
};
use types::id;
mod types;
use std::collections::HashMap;
use std::fmt::Write;

id::define!(pub UserId<32, 44>);
type MessageId = String;
// Type alias prevents the #[app::state] macro from mis-identifying
// UnorderedMap<MessageId, ThreadVec> as an AuthoredVector field.
type ThreadVec = AuthoredVector<Message>;

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
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.uploaded_at > self.uploaded_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// `Mergeable` requires `RekeyTarget` (rc.8+). `Attachment` holds only leaf
// fields (no nested collections), so re-keying is a no-op.
impl RekeyTarget for Attachment {
    fn rekey_relative_to(&mut self, _parent_id: calimero_storage::address::Id) {}
}

impl Attachment {
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
    ProfileUpdated(String),
    InfoUpdated(),
    /// Payload: target identity (base58) whose role just changed.
    RoleUpdated(String),
}

/// "channel" or "dm" — stored in app state so it's mutable (supports renames).
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum ContextType {
    Channel,
    Dm,
}

/// In-context moderation role. App-level enforcement: every state-mutating
/// method checks the caller is not Banned before applying the change. This
/// is a workaround for kick/leave being absent on rc.35 — banned users stay
/// in the underlying group but the WASM rejects their writes.
///
/// - `User`     default for everyone except the creator
/// - `Mod`      can flip a User to Banned (and back)
/// - `Admin`    can change anyone's role; creator starts here
/// - `Banned`   cannot perform any state-mutating action
#[derive(Debug, Clone, Copy, PartialEq, Eq,
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Role {
    User,
    Mod,
    Admin,
    Banned,
}

impl Default for Role {
    fn default() -> Self {
        Role::User
    }
}

/// Named role inside `AccessControl` for moderators. `Admin` is the admin tier
/// (writer set) and `Banned` is a separate exclusion set, so `"mod"` is the only
/// named role the registry stores.
const ROLE_MOD: &str = "mod";

#[derive(BorshDeserialize, BorshSerialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Message {
    pub timestamp: LwwRegister<u64>,
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

// `Mergeable` requires `RekeyTarget` (rc.8+). Mirrors what `#[derive(Mergeable)]`
// would emit: deterministically re-key each field's nested collection ids under
// a field-namespaced child of the entry id, so replicas converge. The
// autoref-dispatching macro re-keys collection fields (`UnorderedSet`, `Vector`)
// and no-ops on leaf fields (`LwwRegister`, `Option<..>`, `UserId`).
impl RekeyTarget for Message {
    fn rekey_relative_to(&mut self, parent_id: calimero_storage::address::Id) {
        use calimero_storage::collections::rekey::field_child_id;
        calimero_storage::rekey_field_if_supported!(
            &mut self.timestamp,
            field_child_id(parent_id, "timestamp")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.mentions,
            field_child_id(parent_id, "mentions")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.mentions_usernames,
            field_child_id(parent_id, "mentions_usernames")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.files,
            field_child_id(parent_id, "files")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.images,
            field_child_id(parent_id, "images")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.id,
            field_child_id(parent_id, "id")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.text,
            field_child_id(parent_id, "text")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.edited_on,
            field_child_id(parent_id, "edited_on")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.deleted,
            field_child_id(parent_id, "deleted")
        );
    }

    fn register_nested_value_types() {
        // `Attachment` is the only custom struct nested through this type's
        // collections (`files`/`images: Vector<Attachment>`); register it so it
        // is re-keyed when stored, not last-writer-wins'd.
        calimero_storage::register_rekey_if_supported!(Attachment);
    }
}

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

// `Mergeable` requires `RekeyTarget` (rc.8+). `StoredProfile` holds only
// `LwwRegister` leaves, so every field re-key dispatches to the no-op arm.
impl RekeyTarget for StoredProfile {
    fn rekey_relative_to(&mut self, parent_id: calimero_storage::address::Id) {
        use calimero_storage::collections::rekey::field_child_id;
        calimero_storage::rekey_field_if_supported!(
            &mut self.username,
            field_child_id(parent_id, "username")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.avatar,
            field_child_id(parent_id, "avatar")
        );
    }
}

/// One context = one conversation (channel or DM).
/// Messages, threads, reactions, profiles, and metadata live here.
#[app::state(emits = Event)]
pub struct MeroChat {
    name: LwwRegister<String>,
    context_type: LwwRegister<ContextType>,
    description: LwwRegister<String>,
    created_at: LwwRegister<u64>,
    creator: LwwRegister<String>,
    messages: AuthoredVector<Message>,
    threads: UnorderedMap<MessageId, ThreadVec>,
    reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<UserId>>>,
    profiles: AuthoredMap<UserId, StoredProfile>,
    /// Per-context moderation roles, backed by a writer-set-guarded registry.
    /// The admin tier IS the writer set, so a non-admin's forged `grant`/
    /// `grant_admin` delta is rejected at merge — not merely by the fail-fast
    /// API guard a plain `UnorderedMap` would leave bypassable. `Admin` maps to
    /// the admin tier; `Mod` to the `"mod"` named role. `Banned` is tracked
    /// separately (see `banned`) because it is an *exclusion* a moderator must
    /// be able to set, not a positive admin-granted role.
    roles: AccessControl,
    /// Soft-ban exclusion set. Missing/`false` entry = not banned. Kept outside
    /// `AccessControl` because moderators (not just admins) may ban/unban, which
    /// the admin-gated `grant` API cannot express. Gated by `can_change_role`
    /// app logic (same authority model as before).
    banned: UnorderedMap<UserId, LwwRegister<bool>>,
    /// Per-user last-read timestamp. Enables cross-device unread tracking
    /// without localStorage — the CRDT replicates read position to all nodes.
    read_receipts: UnorderedMap<UserId, LwwRegister<u64>>,
    /// Authoritative set of soft-deleted message IDs.
    /// Written by delete_message regardless of AuthoredVector ownership, so
    /// admins/mods can delete messages they didn't author.
    deleted_messages: UnorderedSet<String>,
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

        // The context creator is the sole initial admin (the writer set). Other
        // admins/mods are granted at runtime by an existing admin.
        let roles = AccessControl::new(env::account_id().into());

        // Pre-seed the creator's profile so get_profiles returns their name
        // immediately after context state gossip, without waiting for an
        // explicit set_profile call from the creator.
        let mut profiles = AuthoredMap::new();
        if !creator_username.trim().is_empty() {
            let _ = profiles.insert(
                UserId::new(env::account_id()),
                StoredProfile {
                    username: LwwRegister::new(creator_username),
                    avatar: None,
                },
            );
        }

        MeroChat {
            name: LwwRegister::new(name),
            context_type: LwwRegister::new(context_type),
            description: LwwRegister::new(description),
            created_at: LwwRegister::new(created_at),
            creator: LwwRegister::new(creator),
            messages: AuthoredVector::new(),
            threads: UnorderedMap::new(),
            reactions: UnorderedMap::new(),
            profiles,
            roles,
            banned: UnorderedMap::new(),
            read_receipts: UnorderedMap::new(),
            deleted_messages: UnorderedSet::new(),
        }
    }

    pub fn get_info(&self) -> ContextInfo {
        ContextInfo {
            name: self.name.get().clone(),
            context_type: self.context_type.get().clone(),
            description: self.description.get().clone(),
            created_at: *self.created_at,
            creator: self.creator.get().clone(),
        }
    }

    /// Alias for `get_info` — satisfies frontends that call `get_channel_info`.
    /// The legacy `channel` argument is accepted but ignored.
    pub fn get_channel_info(&self, _channel: Option<String>) -> ContextInfo {
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
        let caller = Self::executor_id();
        let _ = self.read_receipts.insert(caller, LwwRegister::new(timestamp));
        Ok("ok".to_string())
    }

    /// Count messages newer than the caller's last-read timestamp, excluding
    /// messages sent by the caller and soft-deleted messages.
    pub fn get_unread_count(&self) -> u32 {
        let caller = Self::executor_id();
        let last_read = self
            .read_receipts
            .get(&caller)
            .ok()
            .flatten()
            .map(|r| *r.get())
            .unwrap_or(0);

        let mut count = 0u32;
        if let Ok(iter) = self.messages.iter() {
            for msg in iter {
                if *msg.timestamp <= last_read {
                    continue;
                }
                if msg.sender == caller {
                    continue;
                }
                let deleted = msg.deleted.as_ref().map(|r| **r).unwrap_or(false)
                    || self.deleted_messages.contains(msg.id.get()).unwrap_or(false);
                if deleted {
                    continue;
                }
                count += 1;
            }
        }
        count
    }

    /// Count unread messages that mention the caller directly (@username),
    /// or use a broadcast mention (@everyone / @here).
    pub fn get_unread_mentions(&self) -> u32 {
        let caller = Self::executor_id();
        let last_read = self
            .read_receipts
            .get(&caller)
            .ok()
            .flatten()
            .map(|r| *r.get())
            .unwrap_or(0);

        let mut count = 0u32;
        if let Ok(iter) = self.messages.iter() {
            for msg in iter {
                if *msg.timestamp <= last_read {
                    continue;
                }
                if msg.sender == caller {
                    continue;
                }
                let deleted = msg.deleted.as_ref().map(|r| **r).unwrap_or(false)
                    || self.deleted_messages.contains(msg.id.get()).unwrap_or(false);
                if deleted {
                    continue;
                }

                // Broadcast mentions (@everyone / @here) always count.
                let is_broadcast = if let Ok(mut unames) = msg.mentions_usernames.iter() {
                    unames.any(|r| {
                        let s = r.get().as_str();
                        s == "everyone" || s == "here"
                    })
                } else {
                    false
                };

                if is_broadcast {
                    count += 1;
                    continue;
                }

                // Direct mention: caller's UserId is in the message's mentions set.
                if let Ok(mut mentions) = msg.mentions.iter() {
                    if mentions.any(|uid| uid == caller) {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    pub fn update_info(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<String> {
        self.require_not_banned()?;
        if let Some(n) = name {
            self.name.set(n);
        }
        if let Some(d) = description {
            self.description.set(d);
        }
        app::emit!(Event::InfoUpdated());
        Ok("Info updated".to_string())
    }

    /// Set or update this user's profile in the current context.
    ///
    /// Username is **write-once**: once a profile exists for an identity,
    /// the `username` field is preserved on subsequent calls — only the
    /// avatar can be changed. This freezes a member's handle to whatever
    /// they registered at first profile creation (typically on join), so
    /// other members keep seeing a stable identity even if the user later
    /// rotates their local `chat-username` from a different device.
    ///
    /// Caveat: enforcement is per-node-state at write time, not at the
    /// CRDT merge layer. Two nodes that each see a freshly-empty profile
    /// for the same identity and write different usernames concurrently
    /// will still converge via `LwwRegister` semantics. In practice the
    /// initial set happens on one device, so this is rare.
    pub fn set_profile(
        &mut self,
        username: String,
        avatar: Option<String>,
    ) -> app::Result<String> {
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
            let blob_id: BlobId = blob_id_str.parse().map_err(|e| app::err!("Invalid avatar blob ID: {e}"))?;
            if !env::blob_announce_to_context(blob_id.as_ref(), &env::context_id()) {
                app::log!("Warning: failed to announce avatar blob {} to context", blob_id_str);
            }
            Some(LwwRegister::new(blob_id_str.clone()))
        } else {
            None
        };

        if self.profiles.contains(&executor_id).unwrap_or(false) {
            // Preserve the frozen username; only the avatar is mutable.
            // If no new avatar is provided (caller passed null), keep the existing one.
            if let Ok(Some(existing)) = self.profiles.get(&executor_id) {
                let frozen_username = existing.username.get().clone();
                let new_profile = StoredProfile {
                    username: LwwRegister::new(frozen_username),
                    avatar: avatar_register.or(existing.avatar),
                };
                let _ = self.profiles.update(&executor_id, new_profile);
            }
        } else {
            let profile = StoredProfile {
                username: LwwRegister::new(username),
                avatar: avatar_register,
            };
            let _ = self.profiles.insert(executor_id, profile);
        }

        app::emit!(Event::ProfileUpdated(executor_id.to_string()));
        Ok("Profile set".to_string())
    }

    pub fn get_profiles(&self) -> Vec<UserProfile> {
        let mut result = Vec::new();
        if let Ok(entries) = self.profiles.entries() {
            for (user_id, profile) in entries {
                result.push(UserProfile {
                    identity: user_id,
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
        // Collect candidate ids from the three sources, deduped with Banned >
        // Admin > Mod precedence (the order we push in). `role_of` then assigns
        // the authoritative role for each.
        let mut ids: Vec<UserId> = Vec::new();
        if let Ok(entries) = self.banned.entries() {
            for (id, flag) in entries {
                if *flag.get() && !ids.contains(&id) { ids.push(id); }
            }
        }
        for who in self.roles.admins() {
            let id = UserId::new(*who.as_bytes());
            if !ids.contains(&id) { ids.push(id); }
        }
        if let Ok(mods) = self.roles.members_of(ROLE_MOD) {
            for who in mods {
                let id = UserId::new(*who.as_bytes());
                if !ids.contains(&id) { ids.push(id); }
            }
        }
        ids.into_iter()
            .map(|id| { let r = self.role_of(&id); (id, r) })
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
    /// merge if forged). Ban/unban writes the separate `banned` set so a
    /// moderator — who is not an admin — can still moderate; that path performs
    /// no admin-gated `AccessControl` call.
    pub fn set_member_role(
        &mut self,
        target: UserId,
        role: Role,
    ) -> app::Result<String> {
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
        // membership, NOT the display role — `role_of` reports `Banned` whenever
        // the ban flag is set, which would otherwise mask (and leave behind) an
        // underlying admin/mod grant if the ban map and `AccessControl` diverged
        // across a merge. Only an admin may revoke; a moderator's sole permitted
        // transition is User<->Banned on a plain User, which holds no grants.
        let has_mod   = self.roles.has_role(ROLE_MOD, &who).unwrap_or(false);
        let has_admin = self.roles.is_admin(&who);
        match role {
            Role::Admin => {
                if has_mod { self.revoke_mod(&who)?; }
                self.set_banned(&target, false);
                self.roles
                    .grant_admin(who)
                    .map_err(|e| app::err!("grant admin failed: {e}"))?;
            }
            Role::Mod => {
                if has_admin { self.revoke_admin_member(&who)?; }
                self.set_banned(&target, false);
                self.roles
                    .grant(ROLE_MOD, who)
                    .map_err(|e| app::err!("grant mod failed: {e}"))?;
            }
            Role::Banned => {
                if actor_is_admin {
                    if has_mod   { self.revoke_mod(&who)?; }
                    if has_admin { self.revoke_admin_member(&who)?; }
                }
                self.set_banned(&target, true);
            }
            Role::User => {
                if actor_is_admin {
                    if has_mod   { self.revoke_mod(&who)?; }
                    if has_admin { self.revoke_admin_member(&who)?; }
                }
                self.set_banned(&target, false);
            }
        }

        app::emit!(Event::RoleUpdated(target.to_string()));
        Ok("Role updated".to_string())
    }

    fn role_of(&self, user: &UserId) -> Role {
        if self.is_banned(user) {
            return Role::Banned;
        }
        let who = Self::to_account(user);
        if self.roles.is_admin(&who) {
            Role::Admin
        } else if self.roles.has_role(ROLE_MOD, &who).unwrap_or(false) {
            Role::Mod
        } else {
            Role::User
        }
    }

    fn is_banned(&self, user: &UserId) -> bool {
        matches!(self.banned.get(user), Ok(Some(flag)) if *flag.get())
    }

    fn set_banned(&mut self, user: &UserId, banned: bool) {
        let _ = self.banned.insert(*user, LwwRegister::new(banned));
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

    /// Map a curb `UserId` (32-byte key) to the `AccountId` the access-control
    /// components key on.
    fn to_account(user: &UserId) -> AccountId {
        let slice: &[u8] = user.as_ref();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(slice);
        AccountId::from(arr)
    }

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

    fn executor_id() -> UserId {
        UserId::new(env::account_id())
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
    /// message: they key `threads`, `reactions` and `deleted_messages`, they
    /// travel in events, and they are what any "link to this message" feature
    /// would put in a URL — where the plaintext would then reach every client,
    /// proxy log, scanner and chat history that touched the link.
    ///
    /// The digest covers the same four fields, so ids stay unique for the same
    /// reasons they were before: the counter separates two identical messages
    /// sent by the same account in the same millisecond.
    fn get_message_id(
        &self,
        account: &UserId,
        message: &str,
        timestamp: u64,
    ) -> MessageId {
        use sha2::{Digest, Sha256};

        let message_counter = self.messages.len().unwrap_or(0) as u64 + 1;

        let mut hasher = Sha256::new();
        hasher.update(account.as_ref());
        hasher.update(message.as_bytes());
        hasher.update(timestamp.to_be_bytes());
        hasher.update(message_counter.to_be_bytes());
        let digest = hasher.finalize();

        let mut s = MessageId::with_capacity(digest.len() * 2);
        for &b in &digest {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        // The timestamp suffix is kept: it is already public in the message it
        // names, and it keeps ids roughly time-ordered for debugging.
        format!("{}_{}", s, timestamp)
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
            let mut entry = self.threads.entry(parent_id)?.or_insert(AuthoredVector::new())?;
            let _ = entry.push(msg.clone());
            drop(entry);

            app::emit!(Event::MessageSentThread(MessageSentEvent {
                message_id: message_id.clone(),
            }));
        } else {
            let _ = self.messages.push(msg.clone());

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
            let thread_messages = match self.threads.get(&parent_id) {
                Ok(Some(messages)) => messages,
                _ => {
                    return Ok(FullMessageResponse {
                        total_count: 0,
                        messages: Vec::new(),
                        start_position: 0,
                    })
                }
            };

            if normalized_search.is_none() {
                return Ok(self.page_unfiltered(&thread_messages, limit, offset, false));
            }

            let filtered = self.collect_messages_with_reactions(
                &thread_messages,
                normalized_search.as_deref(),
                false,
            );
            return Ok(Self::paginate(filtered, limit, offset));
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
            if let Ok(Some(message)) = self.messages.get(idx) {
                page.push(self.message_to_public(&message, true, idx as u64));
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

        if let Ok(entries) = self.threads.entries() {
            for (parent_id, thread) in entries {
                let mut thread_results =
                    self.collect_messages_with_reactions(&thread, Some(term), false);
                for msg in thread_results.iter_mut() {
                    msg.parent_message_id = Some(parent_id.clone());
                }
                all.extend(thread_results);
            }
        }

        all.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(Self::paginate(all, limit, offset))
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
                result.push(self.message_to_public(&message, include_threads, index as u64));
            }
        }
        result
    }

    /// One stored message rendered for the API.
    ///
    /// Split out of the scan above so the scanning path and the windowed path
    /// below cannot drift in what they return.
    fn message_to_public(
        &self,
        message: &Message,
        include_threads: bool,
        index: u64,
    ) -> MessageWithReactions {
        let reactions = self.get_reactions_for_message(message.id.get());

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
        let mentions_usernames_vec: Vec<String> = if let Ok(iter) = message.mentions_usernames.iter()
        {
            iter.map(|r| r.get().clone()).collect()
        } else {
            Vec::new()
        };

        let msg_id = message.id.get().clone();
        let is_deleted = message.deleted.as_ref().map(|r| **r).unwrap_or(false)
            || self.deleted_messages.contains(&msg_id).unwrap_or(false);
        let text = if is_deleted {
            String::new()
        } else {
            message.text.get().clone()
        };

        MessageWithReactions {
            index,
            timestamp: *message.timestamp,
            sender: message.sender,
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
            if let Ok(Some(message)) = messages.get(idx) {
                page.push(self.message_to_public(&message, include_threads, idx as u64));
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
    /// on reactions already given rather than only on new ones.
    fn get_reactions_for_message(
        &self,
        message_id: &str,
    ) -> Option<HashMap<String, Vec<UserId>>> {
        match self.reactions.get(message_id) {
            Ok(Some(reactions)) => {
                let mut hashmap = HashMap::new();
                if let Ok(entries) = reactions.entries() {
                    for (emoji, users) in entries {
                        let mut user_vec = Vec::new();
                        if let Ok(iter) = users.iter() {
                            for user in iter {
                                user_vec.push(user.clone());
                            }
                        }
                        hashmap.insert(emoji, user_vec);
                    }
                }
                Some(hashmap)
            }
            _ => None,
        }
    }

    fn get_thread_info(&self, message_id: &str) -> (u32, u64) {
        match self.threads.get(message_id) {
            Ok(Some(thread)) => {
                let count = thread.len().unwrap_or(0);
                let last_ts = if count > 0 {
                    thread
                        .get(count - 1)
                        .ok()
                        .flatten()
                        .map(|m| *m.timestamp)
                        .unwrap_or(0)
                } else {
                    0
                };
                (count as u32, last_ts)
            }
            _ => (0, 0),
        }
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

    /// Add or remove the CALLER's reaction to a message.
    ///
    /// Reactions are keyed by ACCOUNT. They used to be keyed by display name,
    /// which is wrong in both directions: renaming split your own reaction into
    /// two, and two members who chose the same name shared one — each able to
    /// remove the other's. A name is also caller-supplied, so it was forgeable
    /// through the plain public ABI: anyone could react as someone else, or
    /// pass `add: false` to take theirs away.
    ///
    /// The client resolves accounts to names for display.
    pub fn update_reaction(
        &mut self,
        message_id: MessageId,
        emoji: String,
        add: bool,
    ) -> app::Result<String> {
        self.require_not_banned()?;
        let action = if add { "added" } else { "removed" };

        let executor_id = Self::executor_id();

        let mut reactions_entry = self.reactions.entry(message_id.clone())?.or_insert(UnorderedMap::new())?;
        let mut emoji_entry = reactions_entry.entry(emoji.clone())?.or_insert(UnorderedSet::new())?;
        if add {
            let _ = emoji_entry.insert(executor_id);
        } else {
            let _ = emoji_entry.remove(&executor_id);
        }
        let emoji_now_empty = !add && emoji_entry.is_empty()?;
        drop(emoji_entry);

        // Removing the last reaction of a kind removes the KIND, not just the
        // account. `or_insert` created the set on the way in, so without this a
        // reaction that has been added and taken away again reads back as
        // `{"👍": []}` — a pill with a count of zero, indistinguishable to a
        // client from one nobody has pressed yet. The reader should not have to
        // know that an empty set means absent.
        if emoji_now_empty {
            let _ = reactions_entry.remove(&emoji)?;
        }

        // Same reasoning one level up: a message whose last reaction is gone
        // holds an empty map, and that is not the same as never having been
        // reacted to. `get_messages` returns the map as-is, so leaving it
        // behind makes "no reactions" arrive in two different shapes.
        let message_now_empty = !add && reactions_entry.is_empty()?;
        drop(reactions_entry);

        if message_now_empty {
            let _ = self.reactions.remove(&message_id)?;
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
        let executor_id = Self::executor_id();

        if let Some(parent_message_id) = parent_id {
            let Some(mut thread_entry) = self.threads.get_mut(&parent_message_id)? else {
                app::bail!("Thread not found")
            };
            let updated = Self::find_and_edit(
                &mut *thread_entry,
                &message_id,
                &new_message,
                timestamp,
                &executor_id,
            )?;
            drop(thread_entry);

            app::emit!(Event::MessageSentThread(MessageSentEvent {
                message_id: updated.id.get().clone(),
            }));
            Ok(updated)
        } else {
            let updated = Self::find_and_edit(
                &mut self.messages,
                &message_id,
                &new_message,
                timestamp,
                &executor_id,
            )?;

            app::emit!(Event::MessageSent(MessageSentEvent {
                message_id: updated.id.get().clone(),
            }));
            Ok(updated)
        }
    }

    fn find_and_edit(
        messages: &mut AuthoredVector<Message>,
        message_id: &str,
        new_text: &str,
        timestamp: u64,
        executor_id: &UserId,
    ) -> app::Result<Message> {
        let mut target_index: Option<usize> = None;

        if let Ok(iter) = messages.iter() {
            for (index, message) in iter.enumerate() {
                if *message.id == *message_id {
                    if message.sender != *executor_id {
                        app::bail!("You can only edit your own messages");
                    }
                    target_index = Some(index);
                    break;
                }
            }
        }

        let index = target_index.ok_or_else(|| app::err!("Message not found"))?;

        let original = messages
            .get(index)
            .map_err(|_| app::err!("Failed to read message"))?
            .ok_or_else(|| app::err!("Message not found"))?;

        let mut updated = original.clone();
        updated.text.set(new_text.to_string());
        updated.edited_on = Some(LwwRegister::new(timestamp));

        let _ = messages.update(index, updated.clone());
        Ok(updated)
    }

    pub fn delete_message(
        &mut self,
        message_id: MessageId,
        parent_id: Option<MessageId>,
    ) -> app::Result<String> {
        self.require_not_banned()?;
        let executor_id = Self::executor_id();
        let actor_role = self.role_of(&executor_id);

        if let Some(parent_message_id) = parent_id {
            let Some(mut thread_entry) = self.threads.get_mut(&parent_message_id)? else {
                app::bail!("Thread not found")
            };
            Self::find_and_delete(&mut *thread_entry, &message_id, &executor_id, actor_role)?;
            drop(thread_entry);

            let _ = self.deleted_messages.insert(message_id.clone());
            let _ = self.reactions.remove(&message_id);

            app::emit!(Event::MessageSentThread(MessageSentEvent {
                message_id: message_id.clone(),
            }));
            Ok("Thread message deleted successfully".to_string())
        } else {
            Self::find_and_delete(&mut self.messages, &message_id, &executor_id, actor_role)?;
            let _ = self.deleted_messages.insert(message_id.clone());
            let _ = self.reactions.remove(&message_id);

            app::emit!(Event::MessageSent(MessageSentEvent {
                message_id: message_id.clone(),
            }));
            Ok("Message deleted successfully".to_string())
        }
    }

    fn find_and_delete(
        messages: &mut AuthoredVector<Message>,
        message_id: &str,
        executor_id: &UserId,
        actor_role: Role,
    ) -> app::Result<()> {
        let mut target_index: Option<usize> = None;

        if let Ok(iter) = messages.iter() {
            for (index, message) in iter.enumerate() {
                if *message.id == *message_id {
                    // Admins and Mods can delete any message; regular users only their own.
                    let can_delete = message.sender == *executor_id
                        || actor_role == Role::Admin
                        || actor_role == Role::Mod;
                    if !can_delete {
                        app::bail!("You don't have permission to delete this message");
                    }
                    target_index = Some(index);
                    break;
                }
            }
        }

        let index = target_index.ok_or_else(|| app::err!("Message not found"))?;

        let original = messages
            .get(index)
            .map_err(|_| app::err!("Failed to read message"))?
            .ok_or_else(|| app::err!("Message not found"))?;

        let mut deleted = original.clone();
        deleted.text.set(String::new());
        deleted.deleted = Some(LwwRegister::new(true));

        let _ = messages.update(index, deleted);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;
    use calimero_sdk::BlobId;

    use super::{draft_key, ContextType, MeroChat, Role, UserId, MAX_SEARCH_TERM_LEN};

    // ── AccessControl-backed roles (TestHost) ──────────────────────────────────

    const MODR: [u8; 32] = [0x22; 32];
    const USER: [u8; 32] = [0x33; 32];

    fn new_chat() -> TestHost<MeroChat> {
        // init runs as the default test executor, who becomes the sole admin.
        TestHost::new(|| {
            MeroChat::init(
                "ctx".to_owned(),
                ContextType::Channel,
                "desc".to_owned(),
                0,
                "creator".to_owned(),
            )
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
            .call(|c| {
                c.send_message(
                    "hello".to_owned(),
                    vec![],
                    vec![],
                    None,
                    0,
                    None,
                    None,
                )
            })
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
            .find(|m| m.id.to_string() == id)
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
            .find(|m| m.id.to_string() == id)
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
        app.call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::Banned)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(user)), Role::Banned);

        // …but may not escalate a user to Admin.
        assert!(app.call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::Admin)).is_err());

        // …and may unban (Banned → User).
        app.call_as_account(MODR, MODR, |s| s.set_member_role(user, Role::User)).unwrap();
        assert_eq!(app.view(|s| s.get_member_role(user)), Role::User);
    }

    #[test]
    fn banned_member_is_blocked_from_mutations() {
        let mut app = new_chat();
        let user = UserId::new(USER);
        app.call(|s| s.set_member_role(user, Role::Banned)).unwrap();
        // A banned caller's state-mutating action is rejected by the ban gate.
        let r = app.call_as_account(USER, USER, |s| s.save_draft("general".to_owned(), "hi".to_owned()));
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

        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction("msg-1".to_owned(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();

        let reactors = app
            .view(|s| s.get_reactions_for_message(&"msg-1".to_owned()))
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

        let name = "Xabi".to_owned();
        app.call_as_account(MODR, MODR, |s| s.set_profile(name.clone(), None))
            .unwrap();
        app.call_as_account(USER, USER, |s| s.set_profile(name.clone(), None))
            .unwrap();

        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction("msg-1".to_owned(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();
        app.call_as_account(USER, USER, |s| {
            s.update_reaction("msg-1".to_owned(), "\u{1f44d}".to_owned(), true)
        })
        .unwrap();

        let reactors = app
            .view(|s| s.get_reactions_for_message(&"msg-1".to_owned()))
            .unwrap_or_default();
        let mut thumbs = reactors.get("\u{1f44d}").cloned().unwrap_or_default();
        thumbs.sort();
        let mut want = vec![UserId::new(MODR), UserId::new(USER)];
        want.sort();

        assert_eq!(thumbs, want, "each account holds its own reaction");

        // And one removing does not take the other's with it.
        app.call_as_account(MODR, MODR, |s| {
            s.update_reaction("msg-1".to_owned(), "\u{1f44d}".to_owned(), false)
        })
        .unwrap();
        let after = app
            .view(|s| s.get_reactions_for_message(&"msg-1".to_owned()))
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
            s.send_message("hello".to_owned(), Vec::new(), Vec::new(), None, 1, None, None)
        })
        .unwrap();

        let huge = "x".repeat(MAX_SEARCH_TERM_LEN + 1);

        assert!(
            app.view(|s| s.search_all_messages(huge.clone(), None, None)).is_err(),
            "search_all_messages accepted an oversized term",
        );
        assert!(
            app.view(|s| s.get_messages(None, None, None, Some(huge))).is_err(),
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
                s.send_message(
                    format!("m{n}"),
                    Vec::new(),
                    Vec::new(),
                    None,
                    n,
                    None,
                    None,
                )
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

    // ── Role-based delete permission logic ─────────────────────────────────────

    fn can_delete(sender: [u8; 32], executor: [u8; 32], actor_role: Role) -> bool {
        sender == executor || actor_role == Role::Admin || actor_role == Role::Mod
    }

    #[test]
    fn user_can_delete_own_message() {
        let identity = [1u8; 32];
        assert!(can_delete(identity, identity, Role::User));
    }

    #[test]
    fn user_cannot_delete_others_message() {
        assert!(!can_delete([1u8; 32], [2u8; 32], Role::User));
    }

    #[test]
    fn admin_can_delete_any_message() {
        assert!(can_delete([1u8; 32], [2u8; 32], Role::Admin));
    }

    #[test]
    fn mod_can_delete_any_message() {
        assert!(can_delete([1u8; 32], [2u8; 32], Role::Mod));
    }

    #[test]
    fn banned_user_cannot_delete_others_message() {
        assert!(!can_delete([1u8; 32], [2u8; 32], Role::Banned));
    }

    // ── BlobId roundtrip ───────────────────────────────────────────────────────

    #[test]
    fn blob_id_roundtrip_typical() {
        let original = BlobId::from([
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
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

    #[test]
    fn blob_id_encoded_is_non_empty_string() {
        let encoded = BlobId::from([0x42u8; 32]).to_string();
        assert!(!encoded.is_empty());
        assert!(!encoded.contains('0'));
        assert!(!encoded.contains('O'));
        assert!(!encoded.contains('I'));
        assert!(!encoded.contains('l'));
    }

    #[test]
    fn parse_blob_id_invalid_base58_chars() {
        assert!("not-valid-base58!!!!-/-".parse::<BlobId>().is_err());
    }

    #[test]
    fn parse_blob_id_wrong_byte_length() {
        // Valid base58 but encodes fewer than 32 bytes
        let short = bs58::encode(vec![1u8, 2, 3, 4]).into_string();
        assert!(short.parse::<BlobId>().is_err());
    }

    #[test]
    fn parse_blob_id_empty_string() {
        assert!("".parse::<BlobId>().is_err());
    }

    // ── Draft key format ────────────────────────────────────────────────────

    #[test]
    fn draft_key_contains_user_and_channel() {
        assert_eq!(draft_key("SomeBase58UserId", "general"), "SomeBase58UserId:general");
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
