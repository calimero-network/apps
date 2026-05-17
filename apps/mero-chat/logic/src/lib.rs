use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::de::Error as SerdeDeError;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AuthoredMap, AuthoredVector, LwwRegister, Mergeable as MergeableTrait, UnorderedMap,
    UnorderedSet, Vector,
};
use types::id;
mod types;
use std::collections::HashMap;
use std::fmt::Write;

id::define!(pub UserId<32, 44>);
type MessageId = String;

const BLOB_ID_SIZE: usize = 32;
const BASE58_ENCODED_MAX_SIZE: usize = 44;

fn encode_blob_id_base58(blob_id_bytes: &[u8; BLOB_ID_SIZE]) -> String {
    let mut buf = [0u8; BASE58_ENCODED_MAX_SIZE];
    let len = bs58::encode(blob_id_bytes).onto(&mut buf[..]).unwrap();
    std::str::from_utf8(&buf[..len]).unwrap().to_owned()
}

fn parse_blob_id_base58(blob_id_str: &str) -> Result<[u8; BLOB_ID_SIZE], String> {
    match bs58::decode(blob_id_str).into_vec() {
        Ok(bytes) if bytes.len() == BLOB_ID_SIZE => {
            let mut blob_id = [0u8; BLOB_ID_SIZE];
            blob_id.copy_from_slice(&bytes);
            Ok(blob_id)
        }
        Ok(bytes) => Err(format!(
            "Invalid blob ID length: expected {} bytes, got {}",
            BLOB_ID_SIZE,
            bytes.len()
        )),
        Err(e) => Err(format!("Failed to decode blob ID '{blob_id_str}': {e}")),
    }
}

fn serialize_blob_id_bytes<S>(
    blob_id_bytes: &[u8; BLOB_ID_SIZE],
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: calimero_sdk::serde::Serializer,
{
    let safe_string = encode_blob_id_base58(blob_id_bytes);
    serializer.serialize_str(&safe_string)
}

fn deserialize_blob_id_bytes<'de, D>(deserializer: D) -> Result<[u8; BLOB_ID_SIZE], D::Error>
where
    D: calimero_sdk::serde::Deserializer<'de>,
{
    let blob_id_str = <String as calimero_sdk::serde::Deserialize>::deserialize(deserializer)?;
    match bs58::decode(&blob_id_str).into_vec() {
        Ok(bytes) if bytes.len() == BLOB_ID_SIZE => {
            let mut blob_id = [0u8; BLOB_ID_SIZE];
            blob_id.copy_from_slice(&bytes);
            Ok(blob_id)
        }
        Ok(bytes) => Err(SerdeDeError::custom(format!(
            "Invalid blob ID length: expected {} bytes, got {}",
            BLOB_ID_SIZE,
            bytes.len()
        ))),
        Err(e) => Err(SerdeDeError::custom(format!(
            "Failed to decode blob ID '{}': {}",
            blob_id_str, e
        ))),
    }
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MessageSentEvent {
    pub message_id: String,
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Attachment {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    #[serde(
        serialize_with = "serialize_blob_id_bytes",
        deserialize_with = "deserialize_blob_id_bytes"
    )]
    pub blob_id: [u8; BLOB_ID_SIZE],
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

impl Attachment {
    fn to_public(&self) -> AttachmentPublic {
        AttachmentPublic {
            name: self.name.clone(),
            mime_type: self.mime_type.clone(),
            size: self.size,
            blob_id: encode_blob_id_base58(&self.blob_id),
            uploaded_at: self.uploaded_at,
        }
    }
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AttachmentPublic {
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub blob_id: String,
    pub uploaded_at: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
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
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone)]
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
    BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
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

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Message {
    pub timestamp: LwwRegister<u64>,
    pub sender: UserId,
    pub sender_username: LwwRegister<String>,
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
        MergeableTrait::merge(&mut self.sender_username, &other.sender_username)?;
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

impl Clone for Message {
    fn clone(&self) -> Self {
        Message {
            timestamp: self.timestamp.clone(),
            sender: self.sender,
            sender_username: self.sender_username.clone(),
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
        let mut state = serializer.serialize_struct("Message", 11)?;
        state.serialize_field("timestamp", &*self.timestamp)?;
        state.serialize_field("sender", &self.sender)?;
        state.serialize_field("sender_username", self.sender_username.get())?;

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

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MessageWithReactions {
    pub timestamp: u64,
    pub sender: UserId,
    pub sender_username: String,
    pub mentions: Vec<UserId>,
    pub mentions_usernames: Vec<String>,
    pub files: Vec<AttachmentPublic>,
    pub images: Vec<AttachmentPublic>,
    pub id: MessageId,
    pub text: String,
    pub edited_on: Option<u64>,
    pub reactions: Option<HashMap<String, Vec<String>>>,
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
) -> Result<Vector<Attachment>, String> {
    let mut vector = Vector::new();

    if let Some(attachment_inputs) = inputs {
        for attachment_input in attachment_inputs {
            let blob_id = parse_blob_id_base58(&attachment_input.blob_id_str)?;

            if !env::blob_announce_to_context(&blob_id, context_id) {
                let context_b58 = encode_blob_id_base58(context_id);
                app::log!(
                    "Warning: failed to announce blob {} to context {}",
                    attachment_input.blob_id_str,
                    context_b58
                );
            }

            let attachment = Attachment {
                name: attachment_input.name,
                mime_type: attachment_input.mime_type,
                size: attachment_input.size,
                blob_id,
                uploaded_at: env::time_now(),
            };

            let _ = vector.push(attachment);
        }
    }

    Ok(vector)
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageWithReactions>,
    pub start_position: u32,
}

/// Per-context metadata returned by `get_info` / `get_channel_info`.
#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContextInfo {
    pub name: String,
    pub context_type: ContextType,
    pub description: String,
    pub created_at: u64,
    pub creator: String,
}

/// Per-context user profile returned by `get_profiles`.
#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UserProfile {
    pub identity: UserId,
    pub username: String,
    pub avatar: Option<String>,
}

/// Per-context profile stored in CRDT state.
#[derive(BorshDeserialize, BorshSerialize)]
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

/// One context = one conversation (channel or DM).
/// Messages, threads, reactions, profiles, and metadata live here.
#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroChat {
    name: LwwRegister<String>,
    context_type: LwwRegister<ContextType>,
    description: LwwRegister<String>,
    created_at: LwwRegister<u64>,
    creator: LwwRegister<String>,
    messages: AuthoredVector<Message>,
    threads: UnorderedMap<MessageId, AuthoredVector<Message>>,
    reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<String>>>,
    profiles: AuthoredMap<UserId, StoredProfile>,
    /// Per-context moderation roles. Missing entry = Role::User (default).
    /// LwwRegister-wrapped so the storage layer has merge semantics.
    roles: UnorderedMap<UserId, LwwRegister<Role>>,
    /// Per-user last-read timestamp. Enables cross-device unread tracking
    /// without localStorage — the CRDT replicates read position to all nodes.
    read_receipts: UnorderedMap<UserId, LwwRegister<u64>>,
    /// Authoritative set of soft-deleted message IDs.
    /// Written by delete_message regardless of AuthoredVector ownership, so
    /// admins/mods can delete messages they didn't author.
    deleted_messages: UnorderedSet<String>,
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

        let creator = encode_blob_id_base58(&env::executor_id());

        let mut roles = UnorderedMap::new();
        let _ = roles.insert(UserId::new(env::executor_id()), LwwRegister::new(Role::Admin));

        // Pre-seed the creator's profile so get_profiles returns their name
        // immediately after context state gossip, without waiting for an
        // explicit set_profile call from the creator.
        let mut profiles = AuthoredMap::new();
        if !creator_username.trim().is_empty() {
            let _ = profiles.insert(
                UserId::new(env::executor_id()),
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
    ) -> app::Result<String, String> {
        Ok("ok".to_string())
    }

    /// Persist the caller's last-read position. No event is emitted so this
    /// is a silent CRDT write — it gossips to other nodes but does not trigger
    /// an SSE notification on any subscriber.
    pub fn mark_as_read(&mut self, timestamp: u64) -> app::Result<String, String> {
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
    ) -> app::Result<String, String> {
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
    ) -> app::Result<String, String> {
        self.require_not_banned()?;
        if username.trim().is_empty() {
            return Err("Username cannot be empty".to_string());
        }
        if username.len() > 50 {
            return Err("Username cannot be longer than 50 characters".to_string());
        }

        let executor_id = Self::executor_id();

        if self.profiles.contains(&executor_id).unwrap_or(false) {
            // Preserve the frozen username; only the avatar is mutable.
            if let Ok(Some(existing)) = self.profiles.get(&executor_id) {
                let frozen_username = existing.username.get().clone();
                let new_profile = StoredProfile {
                    username: LwwRegister::new(frozen_username),
                    avatar: avatar.map(LwwRegister::new),
                };
                let _ = self.profiles.update(&executor_id, new_profile);
            }
        } else {
            let profile = StoredProfile {
                username: LwwRegister::new(username),
                avatar: avatar.map(LwwRegister::new),
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

    // ── Moderation: roles + ban gate ───────────────────────────────────────

    /// Read the current role of `identity`. Defaults to `User` when the
    /// identity has no explicit entry (i.e. anyone who joined and never
    /// had their role changed).
    pub fn get_member_role(&self, identity: UserId) -> Role {
        self.role_of(&identity)
    }

    /// All members with a non-default role. Members with the default
    /// `User` role are not returned (they're inferred).
    pub fn list_roles(&self) -> Vec<(UserId, Role)> {
        let mut out = Vec::new();
        if let Ok(entries) = self.roles.entries() {
            for (id, role) in entries {
                out.push((id, *role.get()));
            }
        }
        out
    }

    /// Change a member's role. Authorisation:
    /// - `Admin` may change anyone's role to anything.
    /// - `Mod`   may only flip a `User` to `Banned` (or back).
    /// - `User`/`Banned` may not call this.
    /// An admin cannot demote themselves below `Admin` (lockout-prevention).
    /// Bootstrap: if no admin exists yet, any member may claim Admin for themselves.
    pub fn set_member_role(
        &mut self,
        target: UserId,
        role: Role,
    ) -> app::Result<String, String> {
        let me = Self::executor_id();
        let actor_role = self.role_of(&me);
        let target_role = self.role_of(&target);

        // Bootstrap: no admin exists yet → anyone may set themselves to Admin.
        let no_admin_exists = match self.roles.entries() {
            Ok(mut entries) => !entries.any(|(_, r)| *r.get() == Role::Admin),
            Err(_) => true,
        };
        let is_bootstrap = no_admin_exists && me == target && role == Role::Admin;

        if me == target && actor_role == Role::Admin && role != Role::Admin {
            return Err("An admin cannot demote themselves below Admin".to_string());
        }
        if !is_bootstrap && !Self::can_change_role(actor_role, target_role, role) {
            return Err("You don't have permission to change this member's role".to_string());
        }

        // User is the implicit default — keep the map small by removing the
        // entry instead of storing the default.
        if role == Role::User {
            let _ = self.roles.remove(&target);
        } else {
            let _ = self.roles.insert(target, LwwRegister::new(role));
        }

        app::emit!(Event::RoleUpdated(target.to_string()));
        Ok("Role updated".to_string())
    }

    fn role_of(&self, user: &UserId) -> Role {
        match self.roles.get(user) {
            Ok(Some(r)) => *r.get(),
            _ => Role::default(),
        }
    }

    fn require_not_banned(&self) -> app::Result<(), String> {
        let me = Self::executor_id();
        if self.role_of(&me) == Role::Banned {
            return Err("You are banned from this context".to_string());
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
        UserId::new(env::executor_id())
    }

    fn get_message_id(
        &self,
        account: &UserId,
        message: &str,
        timestamp: u64,
    ) -> MessageId {
        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(account.as_ref());
        hash_input.extend_from_slice(message.as_bytes());
        hash_input.extend_from_slice(&timestamp.to_be_bytes());

        let message_counter = self.messages.len().unwrap_or(0) as u64 + 1;
        hash_input.extend_from_slice(&message_counter.to_be_bytes());

        let mut s = MessageId::with_capacity(hash_input.len() * 2);
        for &b in &hash_input {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        format!("{}_{}", s, timestamp)
    }

    fn message_matches_search(message: &Message, search_term: Option<&str>) -> bool {
        match search_term {
            Some(term) => {
                let message_text = message.text.get();
                if message_text.to_lowercase().contains(term) {
                    return true;
                }
                message.sender_username.get().to_lowercase().contains(term)
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
        sender_username: String,
        files: Option<Vec<AttachmentInput>>,
        images: Option<Vec<AttachmentInput>>,
    ) -> app::Result<Message, String> {
        self.require_not_banned()?;
        let executor_id = Self::executor_id();

        let sender_username = match self.profiles.get(&executor_id) {
            Ok(Some(profile)) => profile.username.get().clone(),
            _ => sender_username,
        };

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
            sender_username: LwwRegister::new(sender_username),
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
            let mut thread_messages = match self.threads.get(&parent_id) {
                Ok(Some(messages)) => messages,
                _ => AuthoredVector::new(),
            };
            let _ = thread_messages.push(msg.clone());
            let _ = self.threads.insert(parent_id, thread_messages);

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
    ) -> app::Result<FullMessageResponse, String> {
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

            let filtered = self.collect_messages_with_reactions(
                &thread_messages,
                normalized_search.as_deref(),
                false,
            );
            return Ok(Self::paginate(filtered, limit, offset));
        }

        let filtered = self.collect_messages_with_reactions(
            &self.messages,
            normalized_search.as_deref(),
            true,
        );
        Ok(Self::paginate(filtered, limit, offset))
    }

    pub fn search_all_messages(
        &self,
        search_term: String,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> app::Result<FullMessageResponse, String> {
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
            for message in iter {
                if !Self::message_matches_search(&message, search_term) {
                    continue;
                }

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
                let mentions_usernames_vec: Vec<String> =
                    if let Ok(iter) = message.mentions_usernames.iter() {
                        iter.map(|r| r.get().clone()).collect()
                    } else {
                        Vec::new()
                    };

                let msg_id = message.id.get().clone();
                let is_deleted = message.deleted.as_ref().map(|r| **r).unwrap_or(false)
                    || self
                        .deleted_messages
                        .contains(&msg_id)
                        .unwrap_or(false);
                let text = if is_deleted {
                    String::new()
                } else {
                    message.text.get().clone()
                };

                result.push(MessageWithReactions {
                    timestamp: *message.timestamp,
                    sender: message.sender,
                    sender_username: message.sender_username.get().clone(),
                    id: msg_id,
                    text,
                    mentions: mentions_vec,
                    mentions_usernames: mentions_usernames_vec,
                    files: attachments_vector_to_public(&message.files),
                    images: attachments_vector_to_public(&message.images),
                    reactions,
                    deleted: if is_deleted { Some(true) } else { message.deleted.as_ref().map(|r| **r) },
                    edited_on: message.edited_on.as_ref().map(|r| **r),
                    thread_count,
                    thread_last_timestamp,
                    parent_message_id: None,
                });
            }
        }
        result
    }

    fn get_reactions_for_message(
        &self,
        message_id: &str,
    ) -> Option<HashMap<String, Vec<String>>> {
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

    pub fn update_reaction(
        &mut self,
        message_id: MessageId,
        emoji: String,
        user: String,
        add: bool,
    ) -> app::Result<String, String> {
        self.require_not_banned()?;
        let mut reactions = match self.reactions.get(&message_id) {
            Ok(Some(reactions)) => reactions,
            _ => UnorderedMap::new(),
        };

        let mut emoji_reactions = match reactions.get(&emoji) {
            Ok(Some(users)) => users,
            _ => UnorderedSet::new(),
        };

        if add {
            let _ = emoji_reactions.insert(user);
        } else {
            let _ = emoji_reactions.remove(&user);
        }

        let _ = reactions.insert(emoji, emoji_reactions);
        let _ = self.reactions.insert(message_id.clone(), reactions);

        let action = if add { "added" } else { "removed" };
        app::emit!(Event::ReactionUpdated(message_id.to_string()));
        Ok(format!("Reaction {} successfully", action))
    }

    pub fn edit_message(
        &mut self,
        message_id: MessageId,
        new_message: String,
        timestamp: u64,
        parent_id: Option<MessageId>,
    ) -> app::Result<Message, String> {
        self.require_not_banned()?;
        let executor_id = Self::executor_id();

        if let Some(parent_message_id) = parent_id {
            let mut thread_messages = match self.threads.get(&parent_message_id) {
                Ok(Some(messages)) => messages,
                _ => return Err("Thread not found".to_string()),
            };

            let updated = Self::find_and_edit(
                &mut thread_messages,
                &message_id,
                &new_message,
                timestamp,
                &executor_id,
            )?;

            let _ = self.threads.insert(parent_message_id, thread_messages);

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
    ) -> Result<Message, String> {
        let mut target_index: Option<usize> = None;

        if let Ok(iter) = messages.iter() {
            for (index, message) in iter.enumerate() {
                if *message.id == *message_id {
                    if message.sender != *executor_id {
                        return Err("You can only edit your own messages".to_string());
                    }
                    target_index = Some(index);
                    break;
                }
            }
        }

        let index = target_index.ok_or_else(|| "Message not found".to_string())?;

        let original = messages
            .get(index)
            .map_err(|_| "Failed to read message".to_string())?
            .ok_or_else(|| "Message not found".to_string())?;

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
    ) -> app::Result<String, String> {
        self.require_not_banned()?;
        let executor_id = Self::executor_id();
        let actor_role = self.role_of(&executor_id);

        if let Some(parent_message_id) = parent_id {
            let mut thread_messages = match self.threads.get(&parent_message_id) {
                Ok(Some(messages)) => messages,
                _ => return Err("Thread not found".to_string()),
            };

            Self::find_and_delete(&mut thread_messages, &message_id, &executor_id, actor_role)?;
            let _ = self.deleted_messages.insert(message_id.clone());
            let _ = self.reactions.remove(&message_id);
            let _ = self.threads.insert(parent_message_id, thread_messages);

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
    ) -> Result<(), String> {
        let mut target_index: Option<usize> = None;

        if let Ok(iter) = messages.iter() {
            for (index, message) in iter.enumerate() {
                if *message.id == *message_id {
                    // Admins and Mods can delete any message; regular users only their own.
                    let can_delete = message.sender == *executor_id
                        || actor_role == Role::Admin
                        || actor_role == Role::Mod;
                    if !can_delete {
                        return Err("You don't have permission to delete this message".to_string());
                    }
                    target_index = Some(index);
                    break;
                }
            }
        }

        let index = target_index.ok_or_else(|| "Message not found".to_string())?;

        let original = messages
            .get(index)
            .map_err(|_| "Failed to read message".to_string())?
            .ok_or_else(|| "Message not found".to_string())?;

        let mut deleted = original.clone();
        deleted.text.set(String::new());
        deleted.deleted = Some(LwwRegister::new(true));

        let _ = messages.update(index, deleted);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_blob_id_base58, parse_blob_id_base58, Role, BLOB_ID_SIZE};

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
        let sender = [1u8; 32];
        let other = [2u8; 32];
        assert!(!can_delete(sender, other, Role::User));
    }

    #[test]
    fn admin_can_delete_any_message() {
        let sender = [1u8; 32];
        let admin = [2u8; 32];
        assert!(can_delete(sender, admin, Role::Admin));
    }

    #[test]
    fn mod_can_delete_any_message() {
        let sender = [1u8; 32];
        let moderator = [2u8; 32];
        assert!(can_delete(sender, moderator, Role::Mod));
    }

    #[test]
    fn banned_user_cannot_delete_others_message() {
        let sender = [1u8; 32];
        let banned = [2u8; 32];
        assert!(!can_delete(sender, banned, Role::Banned));
    }

    #[test]
    fn blob_id_roundtrip_typical() {
        let original: [u8; BLOB_ID_SIZE] = [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
        ];
        let encoded = encode_blob_id_base58(&original);
        let decoded = parse_blob_id_base58(&encoded).expect("roundtrip should succeed");
        assert_eq!(original, decoded);
    }

    #[test]
    fn blob_id_roundtrip_all_zeros() {
        let zeros = [0u8; BLOB_ID_SIZE];
        let encoded = encode_blob_id_base58(&zeros);
        let decoded = parse_blob_id_base58(&encoded).expect("all-zeros roundtrip");
        assert_eq!(zeros, decoded);
    }

    #[test]
    fn blob_id_roundtrip_all_max() {
        let ones = [0xffu8; BLOB_ID_SIZE];
        let encoded = encode_blob_id_base58(&ones);
        let decoded = parse_blob_id_base58(&encoded).expect("all-0xFF roundtrip");
        assert_eq!(ones, decoded);
    }

    #[test]
    fn blob_id_encoded_is_non_empty_string() {
        let bytes = [0x42u8; BLOB_ID_SIZE];
        let encoded = encode_blob_id_base58(&bytes);
        assert!(!encoded.is_empty());
        // Base58 output should only contain valid base58 characters (no 0, O, I, l)
        assert!(!encoded.contains('0'));
        assert!(!encoded.contains('O'));
        assert!(!encoded.contains('I'));
        assert!(!encoded.contains('l'));
    }

    #[test]
    fn parse_blob_id_invalid_base58_chars() {
        let result = parse_blob_id_base58("not-valid-base58!!!!-/-");
        assert!(result.is_err());
    }

    #[test]
    fn parse_blob_id_wrong_byte_length() {
        // Valid base58 but encodes fewer than 32 bytes
        let short = bs58::encode(vec![1u8, 2, 3, 4]).into_string();
        let result = parse_blob_id_base58(&short);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Invalid blob ID length"), "got: {err}");
    }

    #[test]
    fn parse_blob_id_empty_string() {
        let result = parse_blob_id_base58("");
        assert!(result.is_err());
    }

    #[test]
    fn blob_id_size_constant_matches_32() {
        assert_eq!(BLOB_ID_SIZE, 32);
    }
}
