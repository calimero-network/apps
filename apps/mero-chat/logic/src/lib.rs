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
    MessageSent(Message),
    MessageReceived(String),
    ChannelJoined(String),
    ChannelLeft(String),
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Message {
    pub timestamp: u64,
    pub sender: UserId,
    pub id: MessageId,
    pub text: String,
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
    pub read_only: UnorderedSet<UserId>,
    pub moderators: UnorderedSet<UserId>,
    pub links_allowed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PublicChannelMetadata {
    pub created_at: u64,
    pub created_by: UserId,
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
    pub messages: Vec<Message>,
    pub start_position: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PublicChannelInfo {
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub created_at: u64,
    pub created_by: UserId,
    pub links_allowed: bool,
}

#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CurbChat {
    owner: UserId,
    name: String,
    created_at: u64,
    members: UnorderedSet<UserId>,
    channels: UnorderedMap<Channel, ChannelInfo>,
    channel_members: UnorderedMap<Channel, UnorderedSet<UserId>>,
}

#[app::logic]
impl CurbChat {
    #[app::init]
    pub fn init(
        name: String,
        default_channels: Vec<Channel>,
        created_at: u64,
    ) -> CurbChat {
        let executor_id = UserId::new(env::executor_id());

        let mut channels: UnorderedMap<Channel, ChannelInfo> = UnorderedMap::new();
        let mut members: UnorderedSet<UserId> = UnorderedSet::new();
        let mut channel_members: UnorderedMap<Channel, UnorderedSet<UserId>> = UnorderedMap::new();

        for c in default_channels {
            let channel_info = ChannelInfo {
                messages: Vector::new(),
                channel_type: ChannelType::Default,
                read_only: false,
                meta: ChannelMetadata {
                    created_at: created_at,
                    created_by: executor_id,
                    read_only: UnorderedSet::new(),
                    moderators: UnorderedSet::new(),
                    links_allowed: true,
                },
                last_read: UnorderedMap::new(),
            };
            let _ = channels.insert(c.clone(), channel_info);
            let _ = members.insert(executor_id);
            let mut new_members = UnorderedSet::new();
            let _ = new_members.insert(executor_id);
            let _ = channel_members.insert(c.clone(), new_members);
        }

        app::emit!(Event::ChatInitialized(name.clone()));

        CurbChat {
            owner: executor_id,
            name: name,
            created_at: created_at,
            members: members,
            channels: channels,
            channel_members: channel_members,
        }
    }


    pub fn join_chat(&mut self) -> app::Result<String, String> {
        let executor_id = self.get_executor_id();

        if self.members.contains(&executor_id).unwrap_or(false) {
            return Err("Already a member of the chat".to_string());
        }

        let _ = self.members.insert(executor_id);

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
                    let public_info = PublicChannelInfo {
                        channel_type: channel_info.channel_type,
                        read_only: channel_info.read_only,
                        created_at: channel_info.meta.created_at,
                        created_by: channel_info.meta.created_by,
                        links_allowed: channel_info.meta.links_allowed,
                    };
                    channels.insert(channel.name, public_info);
                }
            }
        }
        channels
    }

    pub fn get_channel_members(&self, channel: Channel) -> app::Result<Vec<UserId>, String> {
        let executor_id = self.get_executor_id();
        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        if !members.contains(&executor_id).unwrap_or(false) {
            return Err("You are not a member of this channel".to_string());
        }

        let mut member_list = Vec::new();
        if let Ok(iter) = members.iter() {
            for member in iter {
                member_list.push(member.clone());
            }
        }

        Ok(member_list)
    }

    pub fn get_channel_info(&self, channel: Channel) -> app::Result<PublicChannelMetadata, String> {
        let channel_info = match self.channels.get(&channel) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };
        Ok(PublicChannelMetadata {
            created_at: channel_info.meta.created_at,
            created_by: channel_info.meta.created_by,
            links_allowed: channel_info.meta.links_allowed,
        })
    }

    pub fn invite_to_channel(&mut self, channel: Channel, user: UserId) -> app::Result<String, String> {
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

    pub fn get_non_member_users(&self, channel: Channel) -> app::Result<Vec<UserId>, String> {
        let members = match self.channel_members.get(&channel) {
            Ok(Some(members)) => members,
            _ => return Err("Channel not found".to_string()),
        };

        let mut non_member_users = Vec::new();
        if let Ok(iter) = self.members.iter() {
            for member in iter {
                if !members.contains(&member).unwrap_or(false) {
                    non_member_users.push(member.clone());
                }
            }
        }

        Ok(non_member_users)
    }

    pub fn join_channel(&mut self, channel: Channel) -> app::Result<String, String> {
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
            Ok(Some(channel_info)) => {
                channel_info.messages.len().unwrap_or(0) as u64 + 1
            }
            _ => 1
        }
    }

    pub fn send_message(
        &mut self,
        group: Channel,
        message: String,
        timestamp: u64,
    ) -> app::Result<Message, String> {
        let executor_id = self.get_executor_id();
        let message_id = self.get_message_id(&executor_id, &group, &message, timestamp);

        let message = Message {
            timestamp: timestamp,
            sender: executor_id,
            id: message_id,
            text: message,
        };

        let mut channel_info = match self.channels.get(&group) {
            Ok(Some(info)) => info,
            _ => return Err("Channel not found".to_string()),
        };

        let _ = channel_info.messages.push(message.clone());
        let _ = self.channels.insert(group, channel_info);

        app::emit!(Event::MessageSent(message.clone()));

        Ok(message)
    }

    pub fn get_messages(
        &self,
        group: Channel,
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

        let mut messages = Vec::new();
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
                let start_idx = if end_idx > limit {
                    end_idx - limit
                } else {
                    0
                };

                for i in start_idx..end_idx {
                    messages.push(all_messages[i].clone());
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
}
