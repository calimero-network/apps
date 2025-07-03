use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::{UnorderedMap, Vector, UnorderedSet};
use thiserror::Error;
use types::id;
mod types;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use std::fmt::Write;

type MessageId = String;

id::define!(pub UserId<32, 44>);


const ACTIVE_MS_THRESHOLD: u64 = 30 * 1000;
const MENTION_PRESENT: &str = "here";
const MENTION_ALL: &str = "everyone";

fn get_current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Clone,
)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Channel {
    pub name: String,
}

impl std::hash::Hash for Channel {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.name.hash(state);
    }
}

impl AsRef<[u8]> for Channel {
    fn as_ref(&self) -> &[u8] {
        self.name.as_bytes()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde", rename_all = "camelCase")]
pub struct PublicChannel {
    pub name: String,
    pub channel_type: ChannelType,
    pub read_only: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde", rename_all = "camelCase")]
pub struct UserInfo {
    pub id: UserId,
    pub active: bool,
    pub moderator: bool,
    pub read_only: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct File {
    name: Option<String>,
    ipfs_cid: String,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct Message {
    pub timestamp: u64,
    pub sender: UserId,
    pub id: MessageId,
    pub text: String,
    pub files: Vector<File>,
    pub images: Vector<File>,
    pub nonce: [u8; 16],
    pub edited_on: Option<u64>,
    pub mentions: UnorderedMap<String, u32>,
}

impl Clone for Message {
    fn clone(&self) -> Self {
        // Create new Vectors with appropriate prefixes
        let mut files_vec = Vector::new();
        let mut images_vec = Vector::new();
        
        if let Ok(iter) = self.files.iter() {
            for item in iter {
                files_vec.push(item.clone());
            }
        }
        
        if let Ok(iter) = self.images.iter() {
            for item in iter {
                images_vec.push(item.clone());
            }
        }
        
        Message {
            timestamp: self.timestamp,
            sender: self.sender.clone(),
            id: self.id.clone(),
            text: self.text.clone(),
            files: files_vec,
            images: images_vec,
            nonce: self.nonce.clone(),
            edited_on: self.edited_on.clone(),
            mentions: UnorderedMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde", rename_all = "camelCase")]
pub struct MessageWithReactions {
    pub id: MessageId,
    pub text: String,
    pub nonce: String,
    pub timestamp: u64,
    pub sender: UserId,
    pub reactions: Option<HashMap<String, Vec<UserId>>>,
    pub edited_on: Option<u64>,
    pub files: Vec<File>,
    pub images: Vec<File>,
    pub thread_count: u32,
    pub thread_last_timestamp: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(crate = "calimero_sdk::serde", rename_all = "camelCase")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageWithReactions>,
    pub start_position: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UnreadMessage {
    pub count: u32,
    pub mentions: u32,
    #[serde(rename = "lastSeen")]
    pub last_seen: Option<MessageId>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PublicInfo {
    pub members: usize,
    pub name: String,
    pub assets: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UnreadMessageInfo {
    pub channels: HashMap<String, UnreadMessage>,
    pub chats: HashMap<UserId, UnreadMessage>,
    pub threads: HashMap<MessageId, UnreadMessage>,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct ChannelMetadata {
    pub created_at: u64,
    pub created_by: UserId,
    pub read_only: UnorderedSet<UserId>,
    pub moderators: UnorderedSet<UserId>,
    pub attachments_allowed: bool,
    pub links_allowed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde", rename_all = "camelCase")]
pub struct PublicChannelMetadata {
    pub created_at: u64,
    pub created_by: UserId,
    pub attachments_allowed: bool,
    pub links_allowed: bool,
    pub read_only: bool,
    pub channel_type: ChannelType,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(crate = "calimero_sdk::serde")]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum ChannelType {
    Public,
    Private,
    Default,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct ChannelInfo {
    pub messages: Vector<Message>,
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub meta: ChannelMetadata,
    pub last_read: UnorderedMap<UserId, MessageId>,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct ThreadInfo {
    pub messages: Vector<Message>,
    pub last_read: UnorderedMap<UserId, MessageId>,
}

#[derive(BorshDeserialize, BorshSerialize, PartialEq, Eq, PartialOrd, Ord, Clone)]
#[borsh(crate = "calimero_sdk::borsh")]
struct ChatMembers(Vec<UserId>);

impl ChatMembers {
    fn order_accounts(account: UserId, other_account: UserId) -> (UserId, UserId) {
        if account.to_string() < other_account.to_string() {
            (account, other_account)
        } else {
            (other_account, account)
        }
    }

    pub fn get_other_account(&self, account: &UserId) -> UserId {
        if self.get(0) == account {
            self.get(1).clone()
        } else if self.get(1) == account {
            self.get(0).clone()
        } else {
            panic!("No such account")
        }
    }

    pub fn get(&self, idx: usize) -> &UserId {
        self.0.get(idx).unwrap()
    }

    pub fn contains(&self, account: &UserId) -> bool {
        self.0.contains(account)
    }
}

impl From<(UserId, UserId)> for ChatMembers {
    fn from(item: (UserId, UserId)) -> Self {
        let item = ChatMembers::order_accounts(item.0, item.1);
        let mut members = vec![];
        members.push(item.0);
        members.push(item.1);
        Self(members)
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Curb {
    name: String,

    owner: UserId,
    created_at: u64,

    members: UnorderedMap<UserId, u64>,
    member_keys: UnorderedMap<UserId, UnorderedSet<Vec<u8>>>,

    channels: UnorderedMap<Channel, ChannelInfo>,
    channel_members: UnorderedMap<Channel, UnorderedSet<UserId>>,
    member_channels: UnorderedMap<UserId, UnorderedSet<Channel>>,

    chats: UnorderedMap<ChatMembers, ChannelInfo>,

    threads: UnorderedMap<MessageId, ThreadInfo>,

    reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<UserId>>>,

    default_groups: Vec<Channel>,

    channel_creators: UnorderedSet<UserId>,

    banned_users: UnorderedSet<UserId>,

    assets: String,
}

impl Curb {
    pub fn new(
        name: String,
        owner: UserId,
        default_groups: HashMap<String, (UserId, bool)>,
        channel_creators: Option<Vec<UserId>>,
        assets: String,
    ) -> Self {
        let mut creators = UnorderedSet::new();
        for creator in channel_creators.unwrap_or_else(Vec::new) {
            creators.insert(creator);
        }
        let mut contract = Self {
            name,
            owner,
            created_at: get_current_timestamp_ms(),
            members: UnorderedMap::new(),
            member_keys: UnorderedMap::new(),
            channels: UnorderedMap::new(),
            channel_members: UnorderedMap::new(),
            member_channels: UnorderedMap::new(),
            chats: UnorderedMap::new(),
            threads: UnorderedMap::new(),
            reactions: UnorderedMap::new(),
            default_groups: default_groups
                .keys()
                .map(|n| Channel { name: n.clone() })
                .collect(),
            channel_creators: creators,
            banned_users: UnorderedSet::new(),
            assets: assets,
        };

        for (channel, (creator, read_only)) in default_groups {
            contract.internal_create_group(
                &Channel {
                    name: channel.clone(),
                },
                creator,
                false,
                ChannelType::Default,
                read_only,
            );
        }

        contract
    }

    pub fn ping(&mut self) {
        let executor_id = self.get_executor_id();
        if self.members.contains(&executor_id).unwrap_or(false) {
            let _ = self.members.insert(executor_id, get_current_timestamp_ms());
        }
    }

    fn get_executor_id(&self) -> UserId {
        UserId::new(env::executor_id())
    }

    pub fn late_setup(
        &mut self,
        name: String,
        channel_creators: Option<Vec<UserId>>,
        assets: String,
    ) -> Result<(), String> {
        let executor_id = self.get_executor_id();
        if executor_id != self.owner {
            return Err("Only owner can call this function".to_string());
        }
        let _ = self.channel_creators.clear();
        for creator in channel_creators.unwrap_or_else(Vec::new) {
            let _ = self.channel_creators.insert(creator);
        }
        self.assets = assets;
        self.name = name;
        Ok(())
    }

    pub fn join(&mut self) -> Result<(), String> {
        let executor_id = self.get_executor_id();
        if self.members.contains(&executor_id).unwrap_or(false) {
            return Err("Already a member".to_string());
        }
        if self.banned_users.contains(&executor_id).unwrap_or(false) {
            return Err("Banned user".to_string());
        }

        // Add the user to members
        let _ = self.members
            .insert(executor_id, get_current_timestamp_ms());

        self.ping();
        let _ = self.member_channels.insert(
            executor_id,
            UnorderedSet::new(),
        );
        Ok(())
    }

    pub fn create_group(
        &mut self,
        group: Channel,
        channel_type: Option<ChannelType>,
        read_only: Option<bool>,
        creator: Option<UserId>,
    ) {
        let executor_id = self.get_executor_id();
        let (creator, membership_required) = if channel_type == Some(ChannelType::Default) {
            if executor_id != self.owner {
                panic!("Only owner can create default channels");
            }
            self.default_groups.push(group.clone());
            match creator {
                Some(account) => (account, false),
                _ => panic!("Account creator must be provided when creating default channel"),
            }
        } else {
            (executor_id, true)
        };

        self.internal_create_group(
            &group,
            creator,
            membership_required,
            channel_type.unwrap_or(ChannelType::Public),
            read_only.unwrap_or(false),
        );
        self.ping();
    }

    fn validate_group_name(name: &String) {
        if name.len() == 0 {
            panic!("Group name too short!");
        }
        if name.len() >= 20 {
            panic!("Group name too long!");
        }
        if name.contains("#") {
            panic!("Group name can not contain #");
        }
        if name.contains("!") {
            panic!("Group name can not contain !");
        }
        if name.contains(" ") {
            panic!("Group name can not contain space");
        }
    }

    fn internal_create_group(
        &mut self,
        group: &Channel,
        creator: UserId,
        membership_required: bool,
        channel_type: ChannelType,
        read_only: bool,
    ) {
        Curb::validate_group_name(&group.name);
        if self.channels.contains(&group).unwrap_or(false) {
            panic!("Group already exists");
        }
        if membership_required && !self.members.contains(&creator).unwrap_or(false) {
            panic!("Not a member");
        }
        if membership_required && !self.channel_creators.contains(&creator).unwrap_or(false) {
            panic!("Not a Channel Creator");
        }
        let _ = self.channels.insert(
            group.clone(),
            ChannelInfo {
                messages: Vector::new(),
                channel_type,
                read_only,
                meta: ChannelMetadata {
                    created_at: get_current_timestamp_ms(),
                    created_by: creator,
                    attachments_allowed: true,
                    links_allowed: true,
                    moderators: UnorderedSet::new(),
                    read_only: UnorderedSet::new(),
                },
                last_read: UnorderedMap::new(),
            },
        );

        let _ = self.channel_members.insert(group.clone(), UnorderedSet::new());
        if membership_required {
            self.group_invite(group.clone(), self.get_executor_id(), Some(true));
        }
    }

    fn group_invite(&mut self, group: Channel, account: UserId, self_join: Option<bool>) {
        if !self.channels.contains(&group).unwrap_or(false) {
            panic!("Group does not exist");
        }
        if !self.members.contains(&account).unwrap_or(false) {
            panic!("Not a member");
        }

        let self_join = self_join.unwrap_or(false);
        let channel_info = self.channels.get(&group).unwrap().unwrap();
        let channel_type = &channel_info.channel_type;
        if channel_type == &ChannelType::Default {
            return;
        }
        let channel_admin = &channel_info.meta.created_by;

        if self_join {
            if account != self.get_executor_id() {
                panic!("Can not join");
            }
            if channel_type != &ChannelType::Public && &account != channel_admin {
                panic!("Can not join");
            }
        } else {
            if let Ok(Some(members)) = self.channel_members.get(&group) {
                if !members.contains(&self.get_executor_id()).unwrap_or(false) {
                    panic!("Not a group member");
                }
            }
        }

        if let Ok(Some(mut channel_members)) = self.channel_members.get(&group) {
            let _ = channel_members.insert(account.clone());
            let _ = self.channel_members.insert(group.clone(), channel_members);
        }

        if let Ok(Some(mut member_channels)) = self.member_channels.get(&account) {
            let _ = member_channels.insert(group.clone());
            let _ = self.member_channels.insert(account.clone(), member_channels);
        }
        
        self.ping();
    }

    fn get_message_id(
        account: &UserId,
        other_account: &Option<UserId>,
        group: &Option<Channel>,
        message: &String,
        timestamp: u64,
    ) -> MessageId {
        let target_bytes: &[u8];
        if let Some(acc) = other_account {
            target_bytes = acc.as_ref();
        } else {
            target_bytes = group.as_ref().unwrap().name.as_bytes();
        }

        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(target_bytes);
        hash_input.extend_from_slice(account.as_ref());
        hash_input.extend_from_slice(message.as_bytes());
        hash_input.extend_from_slice(&timestamp.to_be_bytes());

        let mut s = MessageId::with_capacity(hash_input.len() * 2);
        for &b in &hash_input {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        format!("{}_{}", s, timestamp)
    }

    fn from_base64(s: &str) -> Vec<u8> {
        STANDARD.decode(s).unwrap_or_default()
    }

    fn to_base64(input: &[u8]) -> String {
        STANDARD.encode(input)
    }

    fn from_hex(chars: &str) -> Vec<u8> {
        (0..chars.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&chars[i..i + 2], 16).unwrap_or(0))
            .collect()
    }

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        s
    }

    // fn place_message(
    //     messages: &mut Vector<Message>,
    //     mut message: Message,
    //     mentions: Option<Vec<String>>,
    // ) -> Message {
    //     let mentions = mentions.unwrap_or(vec![]);
    //     if messages.len().unwrap_or(0) == 0 {
    //         for mention in mentions {
    //             message.mentions.insert(mention, 1);
    //         }
    //         messages.push(message);

    //         message
    //     } else {
    //         if let Ok(len) = messages.len() {
    //             for i in (0..len).rev() {
    //                 if let Ok(Some(msg)) = messages.get(i) {
    //                     if msg.timestamp < message.timestamp {
    //                         for (key, value) in msg.mentions.entries() {
    //                             message.mentions.insert(key, value);
    //                         }

    //                         for mention in mentions {
    //                             let current = message.mentions.get(&mention).unwrap_or(&0);
    //                             message.mentions.insert(mention, current + 1);
    //                         }

    //                         let mut insert_pos = i + 1;
    //                         let mut current_message = message;
                            
    //                         while let Ok(true) = insert_pos.lt(&messages.len()) {
    //                             if let Ok(Some(next_msg)) = messages.get(insert_pos) {
    //                                 let next = next_msg.clone();
    //                                 messages.replace(insert_pos, &current_message);
    //                                 current_message = next;
    //                             }
    //                             insert_pos += 1;
    //                         }
                            
    //                         messages.push(&current_message);
                            
    //                         if let Ok(Some(inserted)) = messages.get(i + 1) {
    //                             return inserted.clone();
    //                         }
    //                     }
    //                 }
    //             }
    //         }

    //         panic!("not inserted message");
    //     }
    // }

    pub fn send_message(
        &mut self,
        account: Option<UserId>,
        group: Option<Channel>,
        message: String,
        nonce: String,
        timestamp: u64,
        parent_message: Option<MessageId>,
        files: Option<Vec<File>>,
        images: Option<Vec<File>>,
        mentions: Option<Vec<String>>,
    ) -> MessageWithReactions {
        let executor_id = self.get_executor_id();
        if !self.members.contains(&executor_id).unwrap_or(false) {
            panic!("Not a member");
        }
        self.ping();
        
        let message_id = Curb::get_message_id(
            &executor_id,
            &account,
            &group,
            &message,
            timestamp,
        );
        
        // Convert Vec<File> to Vector<File>
        let mut files_vec = Vector::new();
        for file in files.clone().unwrap_or_else(Vec::new) {
            files_vec.push(file);
        }
        
        let mut images_vec = Vector::new();
        for image in images.clone().unwrap_or_else(Vec::new) {
            images_vec.push(image);
        }
        
        let message_object = Message {
            id: message_id.clone(),
            text: message.clone(),
            files: files_vec,
            images: images_vec,
            nonce: Curb::from_hex(&nonce).try_into().unwrap(),
            sender: executor_id,
            timestamp: timestamp,
            edited_on: None,
            mentions: UnorderedMap::new(),
        };
        
        let message_with_reactions = MessageWithReactions {
            id: message_id,
            text: message,
            nonce: nonce,
            timestamp: timestamp,
            sender: executor_id,
            reactions: None,
            edited_on: None,
            files: files.unwrap_or_else(Vec::new),
            images: images.unwrap_or_else(Vec::new),
            thread_count: 0,
            thread_last_timestamp: 0,
        };

        if let Some(channel) = group {
            if !self.channels.contains(&channel).unwrap_or(false) {
                panic!("Group does not exist");
            } else {
                let mut channel_info = self.channels.get(&channel).unwrap().unwrap();
                let _ = channel_info.messages.push(message_object);
                let _ =self.channels.insert(channel, channel_info);
            }
        } else {
            panic!("Either account or group need to be provided");

        }
        message_with_reactions
    }

    pub fn get_messages(
        &self,
        group: Channel,
    ) -> FullMessageResponse {
        // Only handle groups for now
        let channel_info = match self.channels.get(&group) {
            Ok(Some(info)) => info,
            _ => return FullMessageResponse::default(),
        };

        let messages = &channel_info.messages;
        let count = messages.len().unwrap_or(0) as u32;
        
        let mut selected_messages: Vec<MessageWithReactions> = vec![];
        
        // Get all messages from the channel
        if let Ok(len) = messages.len() {
            for i in 0..len {
                if let Ok(Some(message)) = messages.get(i) {
                    let message_with_reactions = MessageWithReactions {
                        id: message.id.clone(),
                        text: message.text.clone(),
                        nonce: Curb::to_hex(&message.nonce),
                        timestamp: message.timestamp,
                        sender: message.sender.clone(),
                        reactions: None, // TODO: implement reactions
                        edited_on: message.edited_on,
                        files: {
                            let mut files = Vec::new();
                            if let Ok(iter) = message.files.iter() {
                                for file in iter {
                                    files.push(file.clone());
                                }
                            }
                            files
                        },
                        images: {
                            let mut images = Vec::new();
                            if let Ok(iter) = message.images.iter() {
                                for image in iter {
                                    images.push(image.clone());
                                }
                            }
                            images
                        },
                        thread_count: 0, // TODO: implement thread counting
                        thread_last_timestamp: 0,
                    };
                    selected_messages.push(message_with_reactions);
                }
            }
        }

        FullMessageResponse {
            total_count: count,
            messages: selected_messages,
            start_position: 0,
        }
    }

    // pub fn get_members(
    //     &self,
    //     group: Option<Channel>,
    //     name_prefix: Option<String>,
    //     limit: Option<usize>,
    //     exclude: Option<bool>,
    // ) -> Vec<UserInfo> {
    //     let prefix = name_prefix.unwrap_or("".to_string());
    //     let exclude = exclude.unwrap_or(false);
    //     let mut result: Vec<UserInfo> = if let Some(group) = group {
    //         let group_info = self.channels.get(&group).unwrap();
    //         if !self.default_groups.contains(&group) {
    //             if exclude {
    //                 match self.channel_members.get(&group) {
    //                     Some(cm) => self
    //                         .members
    //                         .iter()
    //                         .filter(|(m, _)| !cm.contains(m))
    //                         .filter(|(m, _)| m.as_str().starts_with(&prefix))
    //                         .map(|(m, timestamp)| UserInfo {
    //                             id: m.clone(),
    //                             active: self.is_active(*timestamp),
    //                             moderator: group_info.meta.moderators.contains(&m),
    //                             read_only: group_info.meta.read_only.contains(&m),
    //                         })
    //                         .collect(),
    //                     None => return vec![],
    //                 }
    //             } else {
    //                 match self.channel_members.get(&group) {
    //                     Some(cm) => cm
    //                         .iter()
    //                         .filter(|m| m.as_str().starts_with(&prefix))
    //                         .map(|m| UserInfo {
    //                             id: m.clone(),
    //                             active: self.is_active(*self.members.get(&m).unwrap()),
    //                             moderator: group_info.meta.moderators.contains(&m),
    //                             read_only: group_info.meta.read_only.contains(&m),
    //                         })
    //                         .collect(),
    //                     None => return vec![],
    //                 }
    //             }
    //         } else {
    //             if exclude {
    //                 return vec![];
    //             } else {
    //                 self.members
    //                     .iter()
    //                     .filter(|(m, _)| m.as_str().starts_with(&prefix))
    //                     .map(|(m, timestamp)| UserInfo {
    //                         id: m.clone(),
    //                         active: self.is_active(*timestamp),
    //                         moderator: group_info.meta.moderators.contains(&m),
    //                         read_only: group_info.meta.read_only.contains(&m),
    //                     })
    //                     .collect()
    //             }
    //         }
    //     } else {
    //         if exclude {
    //             return vec![];
    //         } else {
    //             self.members
    //                 .iter()
    //                 .filter(|(m, _)| m.as_str().starts_with(&prefix))
    //                 .map(|(m, timestamp)| UserInfo {
    //                     id: m.clone(),
    //                     active: self.is_active(*timestamp),
    //                     moderator: false,
    //                     read_only: false,
    //                 })
    //                 .collect()
    //         }
    //     };
    //     if let Some(limit) = limit {
    //         let items_count = limit.min(result.len());
    //         result.drain(0..items_count).collect()
    //     } else {
    //         result
    //     }
    // }

    // fn is_active(&self, timestamp: u64) -> bool {
    //     get_current_timestamp_ms() - timestamp < ACTIVE_MS_THRESHOLD
    // }

    // pub fn get_direct_messages(
    //     &self,
    //     account: UserId,
    //     limit: Option<usize>,
    //     offset: Option<usize>,
    // ) -> Vector<UserId> {
    //     let mut res = vec![];
    //     for other in self.members.keys() {
    //         let key = ChatMembers::from((account.clone(), other.clone()));
    //         if self.chats.contains(&key) {
    //             res.push(key.get_other_account(&account));
    //         }
    //     }
    //     let mut results: &[UserId] = &res[..];

    //     if let Some(offset) = offset {
    //         results = &results[offset..];
    //     }
    //     if let Some(limit) = limit {
    //         results = &results[0..limit.min(results.len())];
    //     }

    //     results.to_vec()
    // }

    // pub fn get_groups(&self, account: Option<UserId>) -> Vec<PublicChannel> {
    //     if let Some(account) = account {
    //         let mut res = match self.member_channels.get(&account) {
    //             Ok(Some(mc)) => mc
    //                 .iter()
    //                 .map(|c| {
    //                     let info = self.channels.get(c);
    //                     match info {
    //                         Ok(Some(info)) => Some(PublicChannel {
    //                             name: c.name.clone(),
    //                             channel_type: info.channel_type.clone(),
    //                             read_only: info.read_only.clone(),
    //                         }),
    //                         _ => None,
    //                     }
    //                 })
    //                 .flatten()
    //                 .collect(),
    //             _ => vec![],
    //         };
    //         let mut default: Vec<PublicChannel> = self
    //             .default_groups
    //             .iter()
    //             .map(|c| {
    //                 if let Ok(Some(info)) = self.channels.get(&c) {
    //                     PublicChannel {
    //                         name: c.name.clone(),
    //                         channel_type: info.channel_type.clone(),
    //                         read_only: info.read_only.clone(),
    //                     }
    //                 } else {
    //                     PublicChannel {
    //                         name: c.name.clone(),
    //                         channel_type: ChannelType::Public,
    //                         read_only: false,
    //                     }
    //                 }
    //             })
    //             .collect();
    //         default.append(&mut res);

    //         default
    //     } else {
    //         let mut channels = vec![];
    //         if let Ok(entries) = self.channels.entries() {
    //             for (channel, info) in entries {
    //                 if info.channel_type != ChannelType::Private {
    //                     channels.push(PublicChannel {
    //                         name: channel.name.clone(),
    //                         channel_type: info.channel_type.clone(),
    //                         read_only: info.read_only.clone(),
    //                     });
    //                 }
    //             }
    //         }

    //         channels
    //     }
    // }

    pub fn channel_info(&self, group: Channel) -> Option<PublicChannelMetadata> {
        if let Ok(Some(c)) = self.channels.get(&group) {
            Some(PublicChannelMetadata {
                created_at: c.meta.created_at,
                created_by: c.meta.created_by.clone(),
                attachments_allowed: c.meta.attachments_allowed,
                links_allowed: c.meta.links_allowed,
                read_only: c.read_only,
                channel_type: c.channel_type.clone(),
            })
        } else {
            None
        }
    }

    pub fn public_info(&self) -> PublicInfo {
        PublicInfo {
            members: self.members.len().unwrap(),
            name: self.name.clone(),
            assets: self.assets.clone(),
            created_at: self.created_at,
        }
    }
}
