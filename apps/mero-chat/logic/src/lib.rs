use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::{UnorderedMap, UnorderedSet, Vector};
use thiserror::Error;
use types::id;
mod types;
use std::collections::HashMap;
use std::f32::consts::E;
use std::fmt::Write;
use std::time::{SystemTime, UNIX_EPOCH};

fn get_current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

id::define!(pub UserId<32, 44>);
type MessageId = String;

#[app::event]
pub enum Event {
    ChatInitialized(String),
    ChannelCreated(String),
    MessageSent(String),
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
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
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Clone,
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

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ChannelInfo {
    pub messages: Vector<Message>,
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub meta: ChannelMetadata,
    pub last_read: UnorderedMap<UserId, MessageId>,
}

#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CurbChat {
    owner: Option<UserId>,
    name: String,
    created_at: u64,
    members: UnorderedSet<UserId>,
    channels: UnorderedMap<Channel, ChannelInfo>,
    channel_members: UnorderedMap<Channel, UnorderedSet<UserId>>,
}

#[app::logic]
impl CurbChat {
    #[app::init]
    pub fn init() -> CurbChat {
        CurbChat {
            owner: None,
            name: "".to_string(),
            created_at: 0,
            members: UnorderedSet::new(),
            channels: UnorderedMap::new(),
            channel_members: UnorderedMap::new(),
        }
    }

    fn get_executor_id(&self) -> UserId {
        UserId::new(env::executor_id())
    }

    pub fn create_default(
        &mut self,
        name: String,
        default_channels: Vec<Channel>,
    ) -> Result<String, String> {
        if (self.owner.is_some()) {
            return Err("Chat already initialized".to_string());
        }

        let executor_id = self.get_executor_id();

        self.owner = Some(executor_id);
        self.name = name;
        self.created_at = get_current_timestamp_ms();
        let _ = self.members.insert(executor_id);

        for c in default_channels {
            let channel_info = ChannelInfo {
                messages: Vector::new(),
                channel_type: ChannelType::Default,
                read_only: false,
                meta: ChannelMetadata {
                    created_at: get_current_timestamp_ms(),
                    created_by: executor_id,
                    read_only: UnorderedSet::new(),
                    moderators: UnorderedSet::new(),
                    links_allowed: true,
                },
                last_read: UnorderedMap::new(),
            };
            let _ = self.channels.insert(c.clone(), channel_info);
            let mut initial_members = UnorderedSet::new();
            let _ = initial_members.insert(executor_id);
            let _ = self.channel_members.insert(c.clone(), initial_members);
        }

        Ok("Chat initialized".to_string())
    }

    pub fn create_channel(
        &mut self,
        channel: Channel,
        channel_type: ChannelType,
        read_only: bool,
        moderators: UnorderedSet<UserId>,
        links_allowed: bool,
    ) -> Result<String, String> {
        if self.owner.is_none() {
            return Err("Chat not initialized".to_string());
        }

        if self.channels.contains(&channel).unwrap_or(false) {
            return Err("Channel already exists".to_string());
        }

        let executor_id = self.get_executor_id();

        // Create a copy of moderators for the metadata
        let mut moderators_copy = UnorderedSet::new();
        if let Ok(iter) = moderators.iter() {
            for moderator in iter {
                let _ = moderators_copy.insert(moderator.clone());
            }
        }

        let channel_info = ChannelInfo {
            messages: Vector::new(),
            channel_type: channel_type,
            read_only: read_only,
            meta: ChannelMetadata {
                created_at: get_current_timestamp_ms(),
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
        if let Ok(iter) = moderators.iter() {
            for moderator in iter {
                let _ = initial_members.insert(moderator.clone());
            }
        }
        let _ = initial_members.insert(executor_id);
        let _ = self
            .channel_members
            .insert(channel.clone(), initial_members);

        Ok("Channel created".to_string())
    }

    pub fn get_channels(&self) -> UnorderedMap<Channel, ChannelInfo> {
        let mut channels = UnorderedMap::new();
        let executor_id = self.get_executor_id();

        if let Ok(entries) = self.channels.entries() {
            for (channel, channel_info) in entries {
                if let Ok(Some(members)) = self.channel_members.get(&channel) {
                    if members.contains(&executor_id).unwrap_or(false) {
                        let _ = channels.insert(channel, channel_info);
                    }
                }
            }
        }
        channels
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

        let mut s = MessageId::with_capacity(hash_input.len() * 2);
        for &b in &hash_input {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        format!("{}_{}", s, timestamp)
    }

    pub fn send_message(
        &mut self,
        group: Channel,
        message: String,
        timestamp: u64,
    ) -> Result<Message, String> {
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

        Ok(message)
    }

    pub fn get_messages(&self, group: Channel, limit: Option<usize>, offset: Option<usize>) -> Result<Vec<Message>, String> {
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
            return Ok(Vec::new());
        }
        
        let mut messages = Vec::new();
        if let Ok(iter) = channel_info.messages.iter() {
            let all_messages: Vec<_> = iter.collect();
            
            if !all_messages.is_empty() {
                let start_idx = if offset >= all_messages.len() {
                    return Ok(Vec::new());
                } else {
                    all_messages.len() - 1 - offset
                };
                
                let end_idx = if offset + limit >= all_messages.len() {
                    0
                } else {
                    all_messages.len() - 1 - offset - limit + 1
                };
                
                for i in (end_idx..=start_idx).rev() {
                    messages.push(all_messages[i].clone());
                }
            }
        }
        
        Ok(messages)
    }
}
