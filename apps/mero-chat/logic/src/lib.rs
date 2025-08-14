use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::{UnorderedMap, UnorderedSet, Vector};
use types::id;
mod types;
use std::collections::HashMap;
use std::fmt::Write;

id::define!(pub UserId<32, 44>);
type MessageId = String;

#[app::event]
pub enum Event {
    ChatInitialized(String),
    ChannelCreated(String),
    ChannelInvited(String),
    ChannelLeft(String),
    MessageSent(Message),
    MessageReceived(String),
    ChannelJoined(String),
    DMCreated(String),
    ReactionUpdated(String),
    NewIdentityUpdated(String),
    InvitationPayloadUpdated(String),
    InvitationAccepted(String),
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Message {
    pub timestamp: u64,
    pub sender: UserId,
    pub sender_username: String,
    pub id: MessageId,
    pub text: String,
    pub edited_on: Option<u64>,
    pub deleted: Option<bool>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MessageWithReactions {
    pub timestamp: u64,
    pub sender: UserId,
    pub sender_username: String,
    pub id: MessageId,
    pub text: String,
    pub edited_on: Option<u64>,
    pub reactions: Option<HashMap<String, Vec<UserId>>>,
    pub deleted: Option<bool>,
    pub thread_count: u32,
    pub thread_last_timestamp: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum ChannelType {
    Public,
    Private,
    Default,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Clone,
    Hash,
)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Channel {
    pub name: String,
}

impl AsRef<[u8]> for Channel {
    fn as_ref(&self) -> &[u8] {
        self.name.as_bytes()
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ChannelMetadata {
    pub created_at: u64,
    pub created_by: UserId,
    pub created_by_username: Option<String>,
    pub read_only: UnorderedSet<UserId>,
    pub moderators: UnorderedSet<UserId>,
    pub links_allowed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PublicChannelMetadata {
    pub created_at: u64,
    pub created_by: UserId,
    pub created_by_username: String,
    pub links_allowed: bool,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ChannelInfo {
    pub messages: Vector<Message>,
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub meta: ChannelMetadata,
    pub last_read: UnorderedMap<UserId, MessageId>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageWithReactions>,
    pub start_position: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PublicChannelInfo {
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub created_at: u64,
    pub created_by_username: String,
    pub created_by: UserId,
    pub links_allowed: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DMChatInfo {
    pub created_at: u64,
    pub context_id: String,
    pub channel_type: ChannelType,

    // inviter - old chat identity
    pub created_by: UserId,
    // own identity - new dm identity
    pub own_identity_old: UserId,
    pub own_identity: Option<UserId>,
    pub own_username: String,

    // other identity - new dm identity
    pub other_identity_old: UserId,
    pub other_identity_new: Option<UserId>,
    pub other_username: String,

    pub did_join: bool,
    pub invitation_payload: String,
}

#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CurbChat {
    owner: UserId,
    name: String,
    created_at: u64,
    members: UnorderedSet<UserId>,
    member_usernames: UnorderedMap<UserId, String>,
    channels: UnorderedMap<Channel, ChannelInfo>,
    threads: UnorderedMap<MessageId, Vector<Message>>,
    channel_members: UnorderedMap<Channel, UnorderedSet<UserId>>,
    moderators: UnorderedSet<UserId>,
    dm_chats: UnorderedMap<UserId, Vec<DMChatInfo>>,
    is_dm: bool,
    reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<UserId>>>,
}

#[app::logic]
impl CurbChat {
    #[app::init]
    pub fn init(
        name: String,
        default_channels: Vec<Channel>,
        created_at: u64,
        is_dm: bool,
        invitee: Option<UserId>,
        owner_username: Option<String>,
        invitee_username: Option<String>,
    ) -> CurbChat {
        let executor_id = UserId::new(env::executor_id());

        let mut channels: UnorderedMap<Channel, ChannelInfo> = UnorderedMap::new();
        let mut members: UnorderedSet<UserId> = UnorderedSet::new();
        let mut channel_members: UnorderedMap<Channel, UnorderedSet<UserId>> = UnorderedMap::new();
        let mut moderators: UnorderedSet<UserId> = UnorderedSet::new();
        let mut member_usernames: UnorderedMap<UserId, String> = UnorderedMap::new();

        let _ = members.insert(executor_id);

        if let Some(owner_username) = owner_username.clone() {
            let _ = member_usernames.insert(executor_id, owner_username);
        }

        if is_dm {
            if let Some(invitee_id) = invitee {
                let _ = members.insert(invitee_id);

                if let Some(invitee_username) = invitee_username {
                    let _ = member_usernames.insert(invitee_id, invitee_username);
                }
            }
           
        }

        for c in default_channels {
            let channel_info = ChannelInfo {
                messages: Vector::new(),
                channel_type: ChannelType::Default,
                read_only: false,
                meta: ChannelMetadata {
                    created_at: created_at,
                    created_by: executor_id,
                    created_by_username: owner_username.clone(),
                    read_only: UnorderedSet::new(),
                    moderators: UnorderedSet::new(),
                    links_allowed: true,
                },
                last_read: UnorderedMap::new(),
            };
            let _ = channels.insert(c.clone(), channel_info);
            let mut new_members = UnorderedSet::new();
            let _ = new_members.insert(executor_id);
            
            if is_dm {
                if let Some(invitee_id) = &invitee {
                    let _ = new_members.insert(invitee_id.clone());
                }
            }
            
            let _ = channel_members.insert(c.clone(), new_members);
            let _ = moderators.insert(executor_id);
        }

        app::emit!(Event::ChatInitialized(name.clone()));

        CurbChat {
            owner: executor_id,
            name,
            created_at,
            members,
            member_usernames,
            channels,
            threads: UnorderedMap::new(),
            channel_members,
            moderators: moderators,
            dm_chats: UnorderedMap::new(),
            is_dm,
            reactions: UnorderedMap::new(),
        }
    }

    pub fn join_chat(&mut self, username: String) -> app::Result<String, String> {
        let executor_id = self.get_executor_id();

        if self.members.contains(&executor_id).unwrap_or(false) {
            return Err("Already a member of the chat".to_string());
        }

        let _ = self.members.insert(executor_id);
        let _ = self.member_usernames.insert(executor_id, username);

        if let Ok(entries) = self.channels.entries() {
            for (channel, channel_info) in entries {
                if channel_info.channel_type == ChannelType::Default {
                    let mut channel_members = match self.channel_members.get(&channel) {
                        Ok(Some(members)) => members,
                        _ => continue,
                    };

                    let _ = channel_members.insert(executor_id);
                    let _ = self.channel_members.insert(channel, channel_members);
                }
            }
        }

        Ok("Successfully joined the chat".to_string())
    }

    fn get_executor_id(&self) -> UserId {
        UserId::new(env::executor_id())
    }

    pub fn get_chat_name(&self) -> String {
        self.name.clone()
    }

    pub fn create_channel(
        &mut self,
        channel: Channel,
        channel_type: ChannelType,
        read_only: bool,
        moderators: Vec<UserId>,
        links_allowed: bool,
        created_at: u64,
    ) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot create channels in a DM chat".to_string());
        }

        if self.channels.contains(&channel).unwrap_or(false) {
            return Err("Channel already exists".to_string());
        }

        let executor_id = self.get_executor_id();

        // Create a copy of moderators for the metadata
        let mut moderators_copy = UnorderedSet::new();
        for moderator in &moderators {
            let _ = moderators_copy.insert(moderator.clone());
        }

        let channel_info = ChannelInfo {
            messages: Vector::new(),
            channel_type: channel_type,
            read_only: read_only,
            meta: ChannelMetadata {
                created_at: created_at,
                created_by: executor_id,
                created_by_username: self.member_usernames.get(&executor_id).unwrap_or(None),
                read_only: UnorderedSet::new(),
                moderators: moderators_copy,
                links_allowed: links_allowed,
            },
            last_read: UnorderedMap::new(),
        };

        let _ = self.channels.insert(channel.clone(), channel_info);
        let mut initial_members = UnorderedSet::new();
        // Copy moderators to initial_members
        for moderator in &moderators {
            let _ = initial_members.insert(moderator.clone());
        }
        let _ = initial_members.insert(executor_id);
        let _ = self
            .channel_members
            .insert(channel.clone(), initial_members);

        app::emit!(Event::ChannelCreated(channel.name.clone()));
        Ok("Channel created".to_string())
    }

    pub fn get_chat_usernames(&self) -> HashMap<UserId, String> {
        let mut usernames = HashMap::new();
        if let Ok(entries) = self.member_usernames.entries() {
            for (user_id, username) in entries {
                usernames.insert(user_id.clone(), username.clone());
            }
        }
        usernames
    }

    pub fn get_username(&self, user_id: UserId) -> String {
        self.member_usernames.get(&user_id).unwrap().unwrap()
    }

    pub fn get_chat_members(&self) -> Vec<UserId> {
        let executor_id = self.get_executor_id();
        let mut members = Vec::new();
        if let Ok(iter) = self.members.iter() {
            for member in iter {
                if member != executor_id {
                    members.push(member.clone());
                }
            }
        }
        members
    }

    pub fn get_channels(&self) -> HashMap<String, PublicChannelInfo> {
        let mut channels = HashMap::new();
        let executor_id = self.get_executor_id();

        if let Ok(entries) = self.channels.entries() {
            for (channel, channel_info) in entries {
                if let Ok(Some(members)) = self.channel_members.get(&channel) {
                    if members.contains(&executor_id).unwrap_or(false) {
                        let public_info = PublicChannelInfo {
                            channel_type: channel_info.channel_type,
                            read_only: channel_info.read_only,
                            created_at: channel_info.meta.created_at,
                            created_by: channel_info.meta.created_by,
                            created_by_username: self.member_usernames.get(&channel_info.meta.created_by).unwrap().unwrap(),
                            links_allowed: channel_info.meta.links_allowed,
                        };
                        channels.insert(channel.name, public_info);
                    }
                }
            }
        }
        channels
    }

    pub fn get_all_channels(&self) -> HashMap<String, PublicChannelInfo> {
        let mut channels = HashMap::new();
        let executor_id = self.get_executor_id();

        if let Ok(entries) = self.channels.entries() {
            for (channel, channel_info) in entries {
                let should_include = match channel_info.channel_type {
                    ChannelType::Public | ChannelType::Default => true,
                    ChannelType::Private => {
                        // Only include private channels if user is a member
                        if let Ok(Some(members)) = self.channel_members.get(&channel) {
                            members.contains(&executor_id).unwrap_or(false)
                        } else {
                            false
                        }
                    }
                };

                if should_include {
                    let created_by_username = self.member_usernames.get(&channel_info.meta.created_by).unwrap().unwrap();
                    let public_info = PublicChannelInfo {
                        channel_type: channel_info.channel_type,
                        read_only: channel_info.read_only,
                        created_at: channel_info.meta.created_at,
                        created_by_username: created_by_username,
                        created_by: channel_info.meta.created_by,
                        links_allowed: channel_info.meta.links_allowed,
                    };
                    channels.insert(channel.name, public_info);
                }
            }
        }
        channels
    }

    pub fn get_channel_members(&self, channel: Channel) -> app::Result<HashMap<UserId, String>, String> {
        let executor_id = self.get_executor_id();
        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

        let mut members_map = HashMap::new();

        if let Ok(iter) = members.iter() {
            for member in iter {
                let username = self.member_usernames.get(&member).unwrap().unwrap();
                members_map.insert(member.clone(), username.clone());
            }
        }

        Ok(members_map)
    }

    pub fn get_channel_info(&self, channel: Channel) -> app::Result<PublicChannelMetadata, String> {
        let channel_info = match self.channels.get(&channel) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };
        Ok(PublicChannelMetadata {
            created_at: channel_info.meta.created_at,
            created_by: channel_info.meta.created_by,
            created_by_username: self.member_usernames.get(&channel_info.meta.created_by).unwrap().unwrap(),
            links_allowed: channel_info.meta.links_allowed,
        })
    }

    pub fn invite_to_channel(
        &mut self,
        channel: Channel,
        user: UserId,
    ) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot invite to a DM chat".to_string());
        }

        let executor_id = self.get_executor_id();

        match self.channels.get(&channel) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };

        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

        if members.contains(&user).unwrap_or(false) {
            return Err("User is already a member of this channel".to_string());
        }

        if !self.members.contains(&user).unwrap_or(false) {
            return Err("User is not a member of the chat".to_string());
        }

        let mut updated_members = UnorderedSet::new();
        if let Ok(iter) = members.iter() {
            for member in iter {
                let _ = updated_members.insert(member.clone());
            }
        }
        let _ = updated_members.insert(user.clone());
        let _ = self
            .channel_members
            .insert(channel.clone(), updated_members);

        app::emit!(Event::ChannelInvited(channel.name.clone()));
        Ok("User invited to channel".to_string())
    }

    pub fn get_non_member_users(&self, channel: Channel) -> app::Result<HashMap<UserId, String>, String> {
        if self.is_dm {
            return Err("Cannot create channels in a DM chat".to_string());
        }

        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        let mut non_member_users = HashMap::new();
        if let Ok(iter) = self.members.iter() {
            for member in iter {
                if !members.contains(&member).unwrap_or(false) {
                    let username = self.member_usernames.get(&member).unwrap().unwrap();
                    non_member_users.insert(member.clone(), username.clone());
                }
            }
        }

        Ok(non_member_users)
    }

    pub fn join_channel(&mut self, channel: Channel) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot create channels in a DM chat".to_string());
        }
        let executor_id = self.get_executor_id();

        let channel_info = match self.channels.get(&channel) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };

        if channel_info.channel_type != ChannelType::Public {
            return Err("Can only join public channels".to_string());
        }

        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if members.contains(&executor_id).unwrap_or(false) {
            return Err("Already a member of this channel".to_string());
        }

        let mut updated_members = UnorderedSet::new();
        if let Ok(iter) = members.iter() {
            for member in iter {
                let _ = updated_members.insert(member.clone());
            }
        }
        let _ = updated_members.insert(executor_id);
        let _ = self
            .channel_members
            .insert(channel.clone(), updated_members);

        app::emit!(Event::ChannelJoined(channel.name.clone()));
        Ok("Joined channel".to_string())
    }

    pub fn leave_channel(&mut self, channel: Channel) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot leave a DM chat".to_string());
        }
        let executor_id = self.get_executor_id();

        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

        let mut updated_members = UnorderedSet::new();
        if let Ok(iter) = members.iter() {
            for member in iter {
                let _ = updated_members.insert(member.clone());
            }
        }
        let _ = updated_members.remove(&executor_id);
        let _ = self
            .channel_members
            .insert(channel.clone(), updated_members);

        app::emit!(Event::ChannelLeft(channel.name.clone()));
        Ok("Left channel".to_string())
    }

    fn get_message_id(
        &self,
        account: &UserId,
        group: &Channel,
        message: &String,
        timestamp: u64,
    ) -> MessageId {
        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(group.as_ref());
        hash_input.extend_from_slice(message.as_bytes());
        hash_input.extend_from_slice(account.as_ref());
        hash_input.extend_from_slice(&timestamp.to_be_bytes());

        let message_counter = self.get_message_counter(group);
        hash_input.extend_from_slice(&message_counter.to_be_bytes());

        let mut s = MessageId::with_capacity(hash_input.len() * 2);
        for &b in &hash_input {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        format!("{}_{}", s, timestamp)
    }

    fn get_message_counter(&self, group: &Channel) -> u64 {
        match self.channels.get(group) {
            Ok(Some(channel_info)) => channel_info.messages.len().unwrap_or(0) as u64 + 1,
            _ => 1,
        }
    }

    pub fn send_message(
        &mut self,
        group: Channel,
        message: String,
        parent_message: Option<MessageId>,
        timestamp: u64,
        sender_username: String,
    ) -> app::Result<Message, String> {
        let executor_id = self.get_executor_id();
        let sender_username = match self.member_usernames.get(&executor_id) {
            Ok(Some(username)) => username,
            _ => sender_username,
        };
        let message_id = self.get_message_id(&executor_id, &group, &message, timestamp);

        let message = Message {
            timestamp: timestamp,
            sender: executor_id,
            sender_username: sender_username,
            id: message_id,
            text: message,
            deleted: None,
            edited_on: None,
        };

        let mut channel_info = match self.channels.get(&group) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };
        if let Some(parent_message) = parent_message {
            let mut thread_messages = match self.threads.get(&parent_message) {
                Ok(Some(messages)) => messages,
                _ => Vector::new(),
            };
            let _ = thread_messages.push(message.clone());
            let _ = self.threads.insert(parent_message, thread_messages);
        } else {
            let _ = channel_info.messages.push(message.clone());
            let _ = self.channels.insert(group, channel_info);
        }

        app::emit!(Event::MessageSent(message.clone()));

        Ok(message)
    }

    pub fn get_messages(
        &self,
        group: Channel,
        parent_message: Option<MessageId>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> app::Result<FullMessageResponse, String> {
        let executor_id = self.get_executor_id();

        let members = match self.channel_members.get(&group) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

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

            let total_messages = thread_messages.len().unwrap_or(0);
            let limit = limit.unwrap_or(total_messages);
            let offset = offset.unwrap_or(0);

            if total_messages == 0 {
                return Ok(FullMessageResponse {
                    total_count: 0,
                    messages: Vec::new(),
                    start_position: 0,
                });
            }

            let mut messages: Vec<MessageWithReactions> = Vec::new();
            if let Ok(iter) = thread_messages.iter() {
                let all_messages: Vec<_> = iter.collect();

                if !all_messages.is_empty() {
                    let total_len = all_messages.len();
                    if offset >= total_len {
                        return Ok(FullMessageResponse {
                            total_count: total_messages as u32,
                            messages: Vec::new(),
                            start_position: offset as u32,
                        });
                    }

                    let end_idx = total_len - offset;
                    let start_idx = if end_idx > limit { end_idx - limit } else { 0 };

                    for i in start_idx..end_idx {
                        let message = &all_messages[i];
                        let message_reactions = self.reactions.get(&message.id);

                        let reactions = match message_reactions {
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
                        };

                        messages.push(MessageWithReactions {
                            timestamp: message.timestamp,
                            sender: message.sender.clone(),
                            sender_username: message.sender_username.clone(),
                            id: message.id.clone(),
                            text: message.text.clone(),
                            reactions,
                            deleted: message.deleted,
                            edited_on: message.edited_on,
                            thread_count: 0,
                            thread_last_timestamp: 0,
                        });
                    }
                }
            }

            app::emit!(Event::MessageReceived(group.name.clone()));

            return Ok(FullMessageResponse {
                total_count: total_messages as u32,
                messages: messages,
                start_position: offset as u32,
            });
        }

        let channel_info = match self.channels.get(&group) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };

        let total_messages = channel_info.messages.len().unwrap_or(0);
        let limit = limit.unwrap_or(total_messages);
        let offset = offset.unwrap_or(0);

        if total_messages == 0 {
            return Ok(FullMessageResponse {
                total_count: 0,
                messages: Vec::new(),
                start_position: 0,
            });
        }

        let mut messages: Vec<MessageWithReactions> = Vec::new();
        if let Ok(iter) = channel_info.messages.iter() {
            let all_messages: Vec<_> = iter.collect();

            if !all_messages.is_empty() {
                let total_len = all_messages.len();
                if offset >= total_len {
                    return Ok(FullMessageResponse {
                        total_count: total_messages as u32,
                        messages: Vec::new(),
                        start_position: offset as u32,
                    });
                }

                let end_idx = total_len - offset;
                let start_idx = if end_idx > limit { end_idx - limit } else { 0 };

                for i in start_idx..end_idx {
                    let message = &all_messages[i];
                    let message_reactions = self.reactions.get(&message.id);

                    let reactions = match message_reactions {
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
                    };

                    let threads_count = match self.threads.get(&message.id) {
                        Ok(Some(messages)) => messages.len().unwrap_or(0),
                        _ => 0,
                    };

                    let last_timestamp = match self.threads.get(&message.id) {
                        Ok(Some(messages)) => {
                            if threads_count > 0 {
                                if let Ok(Some(last_message)) = messages.get(threads_count - 1) {
                                    last_message.timestamp
                                } else {
                                    0
                                }
                            } else {
                                0
                            }
                        }
                        _ => 0,
                    };

                    messages.push(MessageWithReactions {
                        timestamp: message.timestamp,
                        sender: message.sender.clone(),
                        sender_username: message.sender_username.clone(),
                        id: message.id.clone(),
                        text: message.text.clone(),
                        reactions,
                        deleted: message.deleted,
                        edited_on: message.edited_on,
                        thread_count: threads_count as u32,
                        thread_last_timestamp: last_timestamp,
                    });
                }
            }
        }

        app::emit!(Event::MessageReceived(group.name.clone()));

        Ok(FullMessageResponse {
            total_count: total_messages as u32,
            messages: messages,
            start_position: offset as u32,
        })
    }

    pub fn update_reaction(
        &mut self,
        message_id: MessageId,
        emoji: String,
        user: UserId,
        add: bool,
    ) -> app::Result<String, String> {
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
        let _ = self.reactions.insert(message_id, reactions);

        let action = if add { "added" } else { "removed" };
        app::emit!(Event::ReactionUpdated(format!(
            "Reaction {} successfully",
            action
        )));
        Ok(format!("Reaction {} successfully", action))
    }

    pub fn edit_message(
        &mut self,
        group: Channel,
        message_id: MessageId,
        new_message: String,
        timestamp: u64,
        parent_id: Option<MessageId>,
    ) -> app::Result<Message, String> {
        // TODO: performance on this is critical, optimization requires lot of changes not supported now
        // Reset message storage for large channels (~1K messages cap)
        let executor_id = self.get_executor_id();

        let members = match self.channel_members.get(&group) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

        if let Some(parent_message_id) = parent_id {
            let mut thread_messages = match self.threads.get(&parent_message_id) {
                Ok(Some(messages)) => messages,
                _ => return Err("Thread not found".to_string()),
            };

            let mut message_index: Option<usize> = None;
            let mut updated_message: Option<Message> = None;

            if let Ok(iter) = thread_messages.iter() {
                for (index, message) in iter.enumerate() {
                    if message.id == message_id {
                        if message.sender != executor_id {
                            return Err("You can only edit your own messages".to_string());
                        }

                        message_index = Some(index);
                        break;
                    }
                }
            }

            if let Some(index) = message_index {
                if let Ok(Some(original_message)) = thread_messages.get(index) {
                    let mut updated_msg = original_message.clone();
                    updated_msg.text = new_message.clone();
                    updated_msg.edited_on = Some(timestamp);

                    let _ = thread_messages.update(index, updated_msg.clone());
                    updated_message = Some(updated_msg);
                }
            } else {
                return Err("Message not found in thread".to_string());
            }

            let _ = self.threads.insert(parent_message_id, thread_messages);

            match updated_message {
                Some(msg) => {
                    app::emit!(Event::MessageSent(msg.clone()));
                    Ok(msg)
                }
                None => Err("Failed to update thread message".to_string()),
            }
        } else {
            let mut channel_info = match self.channels.get(&group) {
                Ok(Some(info)) => info,
                _ => return Err("Channel not found".to_string()),
            };

            let mut message_index: Option<usize> = None;
            let mut updated_message: Option<Message> = None;

            if let Ok(iter) = channel_info.messages.iter() {
                for (index, message) in iter.enumerate() {
                    if message.id == message_id {
                        if message.sender != executor_id {
                            return Err("You can only edit your own messages".to_string());
                        }

                        message_index = Some(index);
                        break;
                    }
                }
            }

            if let Some(index) = message_index {
                if let Ok(Some(original_message)) = channel_info.messages.get(index) {
                    let mut updated_msg = original_message.clone();
                    updated_msg.text = new_message.clone();
                    updated_msg.edited_on = Some(timestamp);

                    let _ = channel_info.messages.update(index, updated_msg.clone());
                    updated_message = Some(updated_msg);
                }
            } else {
                return Err("Message not found".to_string());
            }
            let _ = self.channels.insert(group, channel_info);

            match updated_message {
                Some(msg) => {
                    app::emit!(Event::MessageSent(msg.clone()));
                    Ok(msg)
                }
                None => Err("Failed to update message".to_string()),
            }
        }
    }

    pub fn delete_message(
        &mut self,
        group: Channel,
        message_id: MessageId,
        parent_id: Option<MessageId>,
    ) -> app::Result<String, String> {
        let executor_id = self.get_executor_id();

        if let Some(parent_message_id) = parent_id {
            let mut thread_messages = match self.threads.get(&parent_message_id) {
                Ok(Some(messages)) => messages,
                _ => return Err("Thread not found".to_string()),
            };

            let mut message_index: Option<usize> = None;
            let mut target_message: Option<Message> = None;

            if let Ok(iter) = thread_messages.iter() {
                for (index, message) in iter.enumerate() {
                    if message.id == message_id {
                        message_index = Some(index);
                        target_message = Some(message.clone());
                        break;
                    }
                }
            }

            if message_index.is_none() {
                return Err("Message not found in thread".to_string());
            }

            let message = target_message.unwrap();

            let is_message_owner = message.sender == executor_id;
            let is_moderator = self.moderators.contains(&executor_id).unwrap_or(false);
            let is_owner = self.owner == executor_id;

            if !is_message_owner && !is_moderator && !is_owner {
                return Err("You don't have permission to delete this message".to_string());
            }

            if let Some(index) = message_index {
                let mut deleted_message = message.clone();
                deleted_message.text = "".to_string();
                deleted_message.deleted = Some(true);

                let _ = thread_messages.update(index, deleted_message);
            }

            let _ = self.reactions.remove(&message_id);

            let _ = self.threads.insert(parent_message_id, thread_messages);

            app::emit!(Event::MessageSent(message.clone()));
            Ok("Thread message deleted successfully".to_string())
        } else {
            let mut channel_info = match self.channels.get(&group) {
                Ok(Some(info)) => info,
                _ => return Err("Channel not found".to_string()),
            };

            let mut message_index: Option<usize> = None;
            let mut target_message: Option<Message> = None;

            if let Ok(iter) = channel_info.messages.iter() {
                for (index, message) in iter.enumerate() {
                    if message.id == message_id {
                        message_index = Some(index);
                        target_message = Some(message.clone());
                        break;
                    }
                }
            }

            if message_index.is_none() {
                return Err("Message not found".to_string());
            }

            let message = target_message.unwrap();

            let is_message_owner = message.sender == executor_id;
            let is_moderator = self.moderators.contains(&executor_id).unwrap_or(false);
            let is_owner = self.owner == executor_id;

            if !is_message_owner && !is_moderator && !is_owner {
                return Err("You don't have permission to delete this message".to_string());
            }

            if let Some(index) = message_index {
                let mut deleted_message = message.clone();
                deleted_message.text = "".to_string();
                deleted_message.deleted = Some(true);

                let _ = channel_info.messages.update(index, deleted_message);
            }

            let _ = self.reactions.remove(&message_id);

            let _ = self.channels.insert(group, channel_info);

            app::emit!(Event::MessageSent(message.clone()));
            Ok("Message deleted successfully".to_string())
        }
    }

    // STEP1
    // Create DM chat - new Context with created old and new identity and invitee old identity
    // Each of them have new objects for DM chat
    pub fn create_dm_chat(
        &mut self,
        context_id: String,
        creator: UserId,
        creator_new_identity: UserId,
        invitee: UserId,
        timestamp: u64,
    ) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot create DMs in a DM chat".to_string());
        }

        let executor_id = self.get_executor_id();

        if creator != executor_id {
            return Err("You are not the inviter".to_string());
        }

        if !self.members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of the chat".to_string());
        }
        if !self.members.contains(&invitee).unwrap_or(false) {
            return Err("Invitee user is not a member of the chat".to_string());
        }

        if executor_id == invitee {
            return Err("Cannot create DM with yourself".to_string());
        }

        if self.dm_exists(&executor_id, &invitee) {
            return Err("DM already exists".to_string());
        }

        let own_username = self.member_usernames.get(&executor_id).unwrap().unwrap();
        let other_username = self.member_usernames.get(&invitee).unwrap().unwrap();

        let context_id_for_user = context_id.clone();
        // CREATOR
        let dm_chat_info = DMChatInfo {
            context_id: context_id.clone(),
            channel_type: ChannelType::Private,
            created_at: timestamp,
            // user A - inviter
            created_by: executor_id,
            own_identity_old: creator.clone(),
            own_identity: Some(creator_new_identity.clone()),
            own_username: own_username.clone(),
            // user B - invitee
            other_identity_old: invitee.clone(),
            other_identity_new: None,
            other_username: other_username.clone(),
            invitation_payload: "".to_string(),
            did_join: true,
        };

        self.add_dm_to_user(&executor_id, dm_chat_info);
        // INVITEE
        self.add_dm_to_user(
            &invitee,
            DMChatInfo {
                context_id: context_id_for_user,
                channel_type: ChannelType::Private,
                created_at: timestamp,
                // user A - inviter
                created_by: executor_id,
                other_identity_old: creator.clone(),
                other_identity_new: Some(creator_new_identity.clone()),
                // user B - invitee
                own_identity_old: invitee.clone(),
                own_identity: None,
                own_username: other_username.clone(),
                other_username: own_username.clone(),
                invitation_payload: "".to_string(),
                did_join: false,
            },
        );

        app::emit!(Event::DMCreated("Private DM created!".to_string()));
        Ok(context_id)
    }

    // STEP2
    // User updates his new identity he will be invited with
    pub fn update_new_identity(
        &mut self,
        other_user: UserId,
        new_identity: UserId,
    ) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot update new identity in a DM chat".to_string());
        }

        let executor_id = self.get_executor_id();

        if !self.members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of the chat".to_string());
        }

        if !self.dm_exists(&executor_id, &other_user) {
            return Err("DM does not exist".to_string());
        }

        if let Ok(Some(mut dms)) = self.dm_chats.get(&executor_id) {
            // He calls for himself - he is not the owner he has it like this
            for dm in dms.iter_mut() {
                if dm.other_identity_old == other_user {
                    dm.own_identity = Some(new_identity.clone());
                    break;
                }
            }
            let _ = self.dm_chats.insert(executor_id.clone(), dms);
        }

        if let Ok(Some(mut dms)) = self.dm_chats.get(&other_user) {
            // He calls for the creator
            for dm in dms.iter_mut() {
                if dm.other_identity_old == executor_id {
                    dm.other_identity_new = Some(new_identity.clone());
                    break;
                }
            }
            let _ = self.dm_chats.insert(other_user.clone(), dms);
        }

        app::emit!(Event::NewIdentityUpdated(
            "New identity updated!".to_string()
        ));
        Ok("Identity updated successfully".to_string())
    }

    // STEP3
    // Inviter uses the new identity of invitee to create new invitation and save payload
    pub fn update_invitation_payload(
        &mut self,
        other_user: UserId,
        invitation_payload: String,
    ) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot update invitation payload in a DM chat".to_string());
        }

        let executor_id = self.get_executor_id();

        if !self.members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of the chat".to_string());
        }

        if !self.dm_exists(&executor_id, &other_user) {
            return Err("DM does not exist".to_string());
        }

        if let Ok(Some(mut dms)) = self.dm_chats.get(&executor_id) {
            for dm in dms.iter_mut() {
                if dm.other_identity_old == other_user {
                    dm.invitation_payload = invitation_payload.clone();
                    break;
                }
            }
            let _ = self.dm_chats.insert(executor_id.clone(), dms);
        }

        if let Ok(Some(mut dms)) = self.dm_chats.get(&other_user) {
            for dm in dms.iter_mut() {
                if dm.other_identity_old == executor_id {
                    dm.invitation_payload = invitation_payload.clone();
                    break;
                }
            }
            let _ = self.dm_chats.insert(other_user.clone(), dms);
        }

        app::emit!(Event::InvitationPayloadUpdated(
            "Invitation payload updated!".to_string()
        ));
        Ok("Invitation payload updated successfully".to_string())
    }

    // STEP4
    // Invitee accepts invitation and updates "is joined" to be true so we know the process is done
    pub fn accept_invitation(&mut self, other_user: UserId) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot accept invitation in a DM chat".to_string());
        }

        let executor_id = self.get_executor_id();

        if !self.members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of the chat".to_string());
        }

        if !self.dm_exists(&executor_id, &other_user) {
            return Err("DM does not exist".to_string());
        }

        if let Ok(Some(mut dms)) = self.dm_chats.get(&executor_id) {
            for dm in dms.iter_mut() {
                if dm.other_identity_old == other_user {
                    dm.did_join = true;
                    break;
                }
            }
            let _ = self.dm_chats.insert(executor_id.clone(), dms);
        }

        app::emit!(Event::InvitationAccepted(
            "Invitation accepted!".to_string()
        ));
        Ok("Invitation accepted successfully".to_string())
    }

    pub fn get_dms(&self) -> app::Result<Vec<DMChatInfo>, String> {
        if self.is_dm {
            return Err("Cannot get DMs in a DM chat".to_string());
        }
        let executor_id = self.get_executor_id();
        match self.dm_chats.get(&executor_id) {
            Ok(Some(dms)) => {
                let mut dm_list = Vec::new();
                for dm in dms.iter() {
                    dm_list.push(DMChatInfo {
                        channel_type: dm.channel_type.clone(),
                        created_at: dm.created_at,
                        created_by: dm.created_by.clone(),
                        context_id: dm.context_id.clone(),
                        own_identity_old: dm.own_identity_old.clone(),
                        own_identity: dm.own_identity.clone(),
                        other_identity_old: dm.other_identity_old.clone(),
                        other_identity_new: dm.other_identity_new.clone(),
                        own_username: dm.own_username.clone(),
                        other_username: dm.other_username.clone(),
                        did_join: dm.did_join,
                        invitation_payload: dm.invitation_payload.clone(),
                    });
                }
                Ok(dm_list)
            }
            Ok(None) => Ok(Vec::new()),
            Err(_) => Err("Failed to retrieve DMs".to_string()),
        }
    }

    pub fn delete_dm(&mut self, other_user: UserId) -> app::Result<String, String> {
        if self.is_dm {
            return Err("Cannot delete DMs in a DM chat".to_string());
        }
        let executor_id = self.get_executor_id();

        self.remove_dm_from_user(&executor_id, &other_user);
        self.remove_dm_from_user(&other_user, &executor_id);

        let dm_channel = Channel { name: other_user.to_string() };
        let _ = self.channels.remove(&dm_channel);

        let _ = self.channel_members.remove(&dm_channel);

        app::emit!(Event::DMCreated("DM deleted successfully".to_string()));
        Ok("DM deleted successfully".to_string())
    }

    fn dm_exists(&self, user1: &UserId, user2: &UserId) -> bool {
        if let Ok(Some(dms)) = self.dm_chats.get(user1) {
            for dm in dms.iter() {
                if dm.other_identity_old == *user2 {
                    return true;
                }
            }
        }
        false
    }

    fn add_dm_to_user(&mut self, user: &UserId, dm_info: DMChatInfo) {
        let mut dms = match self.dm_chats.get(user) {
            Ok(Some(existing_dms)) => existing_dms,
            _ => Vec::new(),
        };
        dms.push(dm_info);
        let _ = self.dm_chats.insert(user.clone(), dms);
    }

    fn remove_dm_from_user(&mut self, user: &UserId, other_user: &UserId) {
        if let Ok(Some(mut dms)) = self.dm_chats.get(user) {
            dms.retain(|dm| dm.other_identity_old != *other_user);
            let _ = self.dm_chats.insert(user.clone(), dms);
        }
    }
}
