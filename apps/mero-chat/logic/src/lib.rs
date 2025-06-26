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
    pub text: Vector<u8>,
    pub files: Vector<File>,
    pub images: Vector<File>,
    pub nonce: [u8; 16],
    pub edited_on: Option<u64>,
    pub mentions: UnorderedMap<String, u32>,
}

impl Clone for Message {
    fn clone(&self) -> Self {
        // Create new Vectors with appropriate prefixes
        let mut text_vec = Vector::new();
        let mut files_vec = Vector::new();
        let mut images_vec = Vector::new();
        
        // Copy data from existing vectors
        if let Ok(iter) = self.text.iter() {
            for item in iter {
                text_vec.push(item);
            }
        }
        
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
            text: text_vec,
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
    pub members: u32,
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

    pub fn late_setup(
        &mut self,
        name: String,
        channel_creators: Option<Vec<UserId>>,
        assets: String,
    ) {
        // TODO: Replace with proper Calimero SDK equivalent
        // require!(env::predecessor_account_id() == self.owner);
        self.channel_creators.clear();
        for creator in channel_creators.unwrap_or_else(Vec::new) {
            self.channel_creators.insert(creator);
        }
        self.assets = assets;
        self.name = name;
    }

    pub fn ping(&mut self) {
        // TODO: Replace with proper Calimero SDK equivalent
        // if self.members.contains_key(&env::predecessor_account_id()) {
        //     let member_key = self
        //         .member_keys
        //         .entry(env::predecessor_account_id())
        //         .or_insert_with(|| {
        //             UnorderedSet::new(env::sha256(env::predecessor_account_id().as_bytes()))
        //         });
        //     member_key.insert(env::signer_account_pk());
        // }
    }

    pub fn join(&mut self) {
        // TODO: Replace with proper Calimero SDK equivalent
        // require!(
        //     !self.members.contains_key(&env::predecessor_account_id()),
        //     "Already a member"
        // );
        // require!(
        //     !self.banned_users.contains(&env::predecessor_account_id()),
        //     "Banned user"
        // );

        // Add the user to members
        // self.members
        //     .insert(env::predecessor_account_id(), env::block_timestamp_ms());

        self.ping();
        // self.member_channels.insert(
        //     env::predecessor_account_id(),
        //     UnorderedSet::new(env::predecessor_account_id().as_bytes()),
        // );
    }

    pub fn create_group(
        &mut self,
        group: Channel,
        channel_type: Option<ChannelType>,
        read_only: Option<bool>,
        creator: Option<UserId>,
    ) {
        // TODO: Replace with proper Calimero SDK equivalent
        // let (creator, membership_required) = if channel_type == Some(ChannelType::Default) {
        //     require!(
        //         env::predecessor_account_id() == self.owner,
        //         "Only owner can create default channels"
        //     );
        //     self.default_groups.push(group.clone());
        //     match creator {
        //         Some(account) => (account, false),
        //         _ => panic!("Account creator must be provided when creating default channel"),
        //     }
        // } else {
        //     (env::predecessor_account_id(), true)
        // };

        // self.internal_create_group(
        //     &group,
        //     creator,
        //     membership_required,
        //     channel_type.unwrap_or(ChannelType::Public),
        //     read_only.unwrap_or(false),
        // );
        // self.ping();
    }

    fn validate_group_name(name: &String) {
        // TODO: Replace with proper Calimero SDK equivalent
        // require!(name.len() > 0, "Group name too short!");
        // require!(name.len() < 20, "Group name too long!");
        // require!(!name.contains("#"), "Group name can not contain #");
        // require!(!name.contains("!"), "Group name can not contain !");
        // require!(!name.contains(" "), "Group name can not contain space");
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
        // TODO: Replace with proper Calimero SDK equivalent
        // require!(!self.channels.contains_key(group), "Group already exists");
        // require!(
        //     !membership_required || self.members.contains_key(&creator),
        //     "Not a member"
        // );
        // require!(
        //     !membership_required
        //         || self.channel_creators.is_empty()
        //         || self.channel_creators.contains(&creator),
        //     "Not a Channel Creator"
        // );
        self.channels.insert(
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
        self.channel_members.insert(group.clone(), UnorderedSet::new());
        if membership_required {
            // self.group_invite(group.clone(), env::predecessor_account_id(), Some(true));
        }
    }
}
