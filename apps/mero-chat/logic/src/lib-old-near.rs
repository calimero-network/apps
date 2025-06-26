use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{unordered_map::Entry, UnorderedMap, UnorderedSet, Vector};
use near_sdk::{env, near_bindgen, require, AccountId, PanicOnDefault, PublicKey};

use std::collections::{HashMap, HashSet};
use std::fmt::Write;

type MessageId = String;

const ACTIVE_MS_THRESHOLD: u64 = 30 * 1000;
const MENTION_PRESENT: &str = "here";
const MENTION_ALL: &str = "everyone";

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Clone,
)]
#[serde(crate = "near_sdk::serde")]
pub struct Channel {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct PublicChannel {
    pub name: String,
    pub channel_type: ChannelType,
    pub read_only: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct UserInfo {
    pub id: AccountId,
    pub active: bool,
    pub moderator: bool,
    pub read_only: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct File {
    name: Option<String>,
    ipfs_cid: String,
}

#[derive(BorshDeserialize, BorshSerialize)]
struct Message {
    pub timestamp: u64,
    pub sender: AccountId,
    pub id: MessageId,
    pub text: Vec<u8>,
    pub files: Vec<File>,
    pub images: Vec<File>,
    pub nonce: [u8; 16],
    pub edited_on: Option<u64>,
    pub mentions: UnorderedMap<String, u32>,
}

impl Clone for Message {
    fn clone(&self) -> Self {
        Message {
            timestamp: self.timestamp,
            sender: self.sender.clone(),
            id: self.id.clone(),
            text: self.text.clone(),
            files: self.files.clone(),
            images: self.images.clone(),
            nonce: self.nonce.clone(),
            edited_on: self.edited_on.clone(),
            mentions: UnorderedMap::new(b"empty map".to_vec()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct MessageWithReactions {
    pub id: MessageId,
    pub text: String,
    pub nonce: String,
    pub timestamp: u64,
    pub sender: AccountId,
    pub reactions: Option<HashMap<String, Vec<AccountId>>>,
    pub edited_on: Option<u64>,
    pub files: Vec<File>,
    pub images: Vec<File>,
    pub thread_count: u32,
    pub thread_last_timestamp: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct FullMessageResponse {
    pub total_count: u32,
    pub messages: Vec<MessageWithReactions>,
    pub start_position: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct UnreadMessage {
    pub count: u32,
    pub mentions: u32,
    #[serde(rename = "lastSeen")]
    pub last_seen: Option<MessageId>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PublicInfo {
    pub members: u32,
    pub name: String,
    pub assets: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct UnreadMessageInfo {
    pub channels: HashMap<String, UnreadMessage>,
    pub chats: HashMap<AccountId, UnreadMessage>,
    pub threads: HashMap<MessageId, UnreadMessage>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
struct ChannelMetadata {
    pub created_at: u64,
    pub created_by: AccountId,
    pub read_only: HashSet<AccountId>,
    pub moderators: HashSet<AccountId>,
    pub attachments_allowed: bool,
    pub links_allowed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct PublicChannelMetadata {
    pub created_at: u64,
    pub created_by: AccountId,
    pub attachments_allowed: bool,
    pub links_allowed: bool,
    pub read_only: bool,
    pub channel_type: ChannelType,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(crate = "near_sdk::serde")]
pub enum ChannelType {
    Public,
    Private,
    Default,
}

#[derive(BorshDeserialize, BorshSerialize)]
struct ChannelInfo {
    pub messages: Vector<Message>,
    pub channel_type: ChannelType,
    pub read_only: bool,
    pub meta: ChannelMetadata,
    pub last_read: UnorderedMap<AccountId, MessageId>,
}

#[derive(BorshDeserialize, BorshSerialize)]
struct ThreadInfo {
    pub messages: Vector<Message>,
    pub last_read: UnorderedMap<AccountId, MessageId>,
}

#[derive(BorshDeserialize, BorshSerialize, PartialEq, Eq, PartialOrd, Ord, Clone)]
struct ChatMembers(Vec<AccountId>);

impl ChatMembers {
    fn order_accounts(account: AccountId, other_account: AccountId) -> (AccountId, AccountId) {
        if account.as_str() < other_account.as_str() {
            (account, other_account)
        } else {
            (other_account, account)
        }
    }

    pub fn get_other_account(&self, account: &AccountId) -> AccountId {
        if self.get(0) == account {
            self.get(1).clone()
        } else if self.get(1) == account {
            self.get(0).clone()
        } else {
            panic!("No such account")
        }
    }

    pub fn get(&self, idx: usize) -> &AccountId {
        self.0.get(idx).unwrap()
    }

    pub fn contains(&self, account: &AccountId) -> bool {
        self.0.contains(account)
    }
}

impl From<(AccountId, AccountId)> for ChatMembers {
    fn from(item: (AccountId, AccountId)) -> Self {
        let item = ChatMembers::order_accounts(item.0, item.1);
        let mut members = vec![];
        members.push(item.0);
        members.push(item.1);
        Self(members)
    }
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Curb {
    name: String,

    owner: AccountId,
    created_at: u64,

    members: UnorderedMap<AccountId, u64>,
    member_keys: UnorderedMap<AccountId, UnorderedSet<PublicKey>>,

    channels: UnorderedMap<Channel, ChannelInfo>,
    channel_members: UnorderedMap<Channel, UnorderedSet<AccountId>>,
    member_channels: UnorderedMap<AccountId, UnorderedSet<Channel>>,

    chats: UnorderedMap<ChatMembers, ChannelInfo>,

    threads: UnorderedMap<MessageId, ThreadInfo>,

    reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<AccountId>>>,

    default_groups: Vec<Channel>,

    channel_creators: UnorderedSet<AccountId>,

    banned_users: UnorderedSet<AccountId>,

    assets: String,
}

#[near_bindgen]
impl Curb {
    #[init]
    pub fn new(
        name: String,
        owner: AccountId,
        default_groups: HashMap<String, (AccountId, bool)>,
        channel_creators: Option<Vec<AccountId>>,
        assets: String,
    ) -> Self {
        let mut creators = UnorderedSet::new(b"a_".to_vec());
        for creator in channel_creators.unwrap_or_else(Vec::new) {
            creators.insert(creator);
        }
        let mut contract = Self {
            name,
            owner,
            created_at: env::block_timestamp_ms(),
            members: UnorderedMap::new(b"m_".to_vec()),
            member_keys: UnorderedMap::new(b"k_".to_vec()),
            channels: UnorderedMap::new(b"n_".to_vec()),
            channel_members: UnorderedMap::new(b"c_".to_vec()),
            member_channels: UnorderedMap::new(b"e_".to_vec()),
            chats: UnorderedMap::new(b"t_".to_vec()),
            threads: UnorderedMap::new(b"h_".to_vec()),
            reactions: UnorderedMap::new(b"r_".to_vec()),
            default_groups: default_groups
                .keys()
                .map(|n| Channel { name: n.clone() })
                .collect(),
            channel_creators: creators,
            banned_users: UnorderedSet::new(b"b_".to_vec()),
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
        channel_creators: Option<Vec<AccountId>>,
        assets: String,
    ) {
        require!(env::predecessor_account_id() == self.owner);
        self.channel_creators.clear();
        for creator in channel_creators.unwrap_or_else(Vec::new) {
            self.channel_creators.insert(creator);
        }
        self.assets = assets;
        self.name = name;
    }

    pub fn ping(&mut self) {
        if self.members.contains_key(&env::predecessor_account_id()) {
            let member_key = self
                .member_keys
                .entry(env::predecessor_account_id())
                .or_insert_with(|| {
                    UnorderedSet::new(env::sha256(env::predecessor_account_id().as_bytes()))
                });
            member_key.insert(env::signer_account_pk());
        }
    }

    #[payable]
    pub fn join(&mut self) {
        // TODO handle storage payments
        require!(
            !self.members.contains_key(&env::predecessor_account_id()),
            "Already a member"
        );
        require!(
            !self.banned_users.contains(&env::predecessor_account_id()),
            "Banned user"
        );

        // Add the user to members
        self.members
            .insert(env::predecessor_account_id(), env::block_timestamp_ms());

        self.ping();
        self.member_channels.insert(
            env::predecessor_account_id(),
            UnorderedSet::new(env::predecessor_account_id().as_bytes()),
        );
    }

    #[payable]
    pub fn create_group(
        &mut self,
        group: Channel,
        channel_type: Option<ChannelType>,
        read_only: Option<bool>,
        creator: Option<AccountId>,
    ) {
        // TODO handle storage payments
        let (creator, membership_required) = if channel_type == Some(ChannelType::Default) {
            require!(
                env::predecessor_account_id() == self.owner,
                "Only owner can create default channels"
            );
            self.default_groups.push(group.clone());
            match creator {
                Some(account) => (account, false),
                _ => panic!("Account creator must be provided when creating default channel"),
            }
        } else {
            (env::predecessor_account_id(), true)
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
        require!(name.len() > 0, "Group name too short!");
        require!(name.len() < 20, "Group name too long!");
        require!(!name.contains("#"), "Group name can not contain #");
        require!(!name.contains("!"), "Group name can not contain !");
        require!(!name.contains(" "), "Group name can not contain space");
    }

    fn internal_create_group(
        &mut self,
        group: &Channel,
        creator: AccountId,
        membership_required: bool,
        channel_type: ChannelType,
        read_only: bool,
    ) {
        Curb::validate_group_name(&group.name);
        require!(!self.channels.contains_key(group), "Group already exists");
        require!(
            !membership_required || self.members.contains_key(&creator),
            "Not a member"
        );
        require!(
            !membership_required
                || self.channel_creators.is_empty()
                || self.channel_creators.contains(&creator),
            "Not a Channel Creator"
        );
        self.channels.insert(
            group.clone(),
            ChannelInfo {
                messages: Vector::new(env::sha256(format!("m {}", group.name).as_bytes())),
                channel_type,
                read_only,
                meta: ChannelMetadata {
                    created_at: env::block_timestamp_ms(),
                    created_by: creator,
                    attachments_allowed: true,
                    links_allowed: true,
                    moderators: HashSet::new(),
                    read_only: HashSet::new(),
                },
                last_read: UnorderedMap::new(env::sha256(group.name.as_bytes())),
            },
        );
        self.channel_members
            .insert(group.clone(), UnorderedSet::new(group.name.as_bytes()));
        if membership_required {
            self.group_invite(group.clone(), env::predecessor_account_id(), Some(true));
        }
    }

    #[payable]
    pub fn delete_group(&mut self, group: Channel) {
        require!(self.channels.contains_key(&group), "Group does not exist");
        let is_owner = env::predecessor_account_id() == self.owner;
        let account = env::predecessor_account_id();
        require!(
            self.members.contains_key(&account) || is_owner,
            "Not a member"
        );
        let channel_info = self.channels.get(&group).unwrap();
        let channel_meta = &channel_info.meta;
        require!(
            channel_meta.created_by == env::predecessor_account_id() || is_owner,
            "Admin only action"
        );

        let channel_type = &self.channels.get(&group).unwrap().channel_type;
        if channel_type == &ChannelType::Default {
            // TODO remove from default list
            return;
        }

        self.channels.remove(&group);
        for member in self.channel_members.get(&group).unwrap() {
            self.member_channels
                .get_mut(&member)
                .unwrap()
                .remove(&group);
        }
        self.channel_members.remove(&group);
        self.ping();
    }

    #[payable]
    pub fn leave_group(&mut self, group: Channel, account: Option<AccountId>) {
        // TODO handle storage payments
        require!(self.channels.contains_key(&group), "Group does not exist");

        let account = account.unwrap_or(env::predecessor_account_id());
        require!(self.members.contains_key(&account), "Not a member");

        let channel_info = &self.channels.get(&group).unwrap();
        let channel_meta = &channel_info.meta;
        require!(
            &channel_info.channel_type != &ChannelType::Default,
            "Predefined channel"
        );

        let is_allowed = if account == env::predecessor_account_id() {
            channel_meta.created_by != env::predecessor_account_id()
        } else {
            env::predecessor_account_id() == channel_meta.created_by
                || (channel_meta
                    .moderators
                    .contains(&env::predecessor_account_id())
                    && channel_meta.created_by != account)
        };
        require!(is_allowed, format!("{} can not leave channel", account));

        self.channel_members
            .get_mut(&group)
            .unwrap()
            .remove(&account);
        self.member_channels
            .get_mut(&account)
            .unwrap()
            .remove(&group);

        let is_default_channel = self.default_groups.iter().any(|channel| channel == &group);

        if self.channel_members.get(&group).unwrap().is_empty() && !is_default_channel {
            self.channel_members.remove(&group);
            self.channels.remove(&group);
        }
        self.ping();
    }

    #[payable]
    pub fn group_invite(&mut self, group: Channel, account: AccountId, self_join: Option<bool>) {
        // TODO handle storage payments
        require!(self.channels.contains_key(&group), "Group does not exist");
        require!(self.members.contains_key(&account), "Not a member");

        let self_join = self_join.unwrap_or(false);
        let channel_type = &self.channels.get(&group).unwrap().channel_type;
        if channel_type == &ChannelType::Default {
            // joined by default
            return;
        }
        let channel_admin = &self.channels.get(&group).unwrap().meta.created_by;

        if self_join {
            require!(account == env::predecessor_account_id());
            require!(
                channel_type == &ChannelType::Public || &account == channel_admin,
                "Can not join"
            );
        } else {
            require!(
                self.channel_members
                    .get(&group)
                    .unwrap()
                    .contains(&env::predecessor_account_id()),
                "Not a group member"
            );
        }

        self.channel_members
            .get_mut(&group)
            .unwrap()
            .insert(account.clone());
        self.member_channels
            .get_mut(&account)
            .unwrap()
            .insert(group.clone());
        self.ping();
    }

    pub fn ban_user(&mut self, account: AccountId, is_ban: bool) {
        require!(self.members.contains_key(&account), "Not a member");
        require!(
            env::predecessor_account_id() == self.owner,
            "Owner only action"
        );

        if is_ban {
            for c in self.member_channels.get(&account).unwrap().iter() {
                self.channel_members.get_mut(&c).unwrap().remove(&account);
            }
            self.member_channels.remove(&account);
            self.member_keys.remove(&account);
            self.members.remove(&account);
            self.banned_users.insert(account);
        } else {
            self.banned_users.remove(&account);
        }
    }

    fn get_message_id(
        account: &AccountId,
        other_account: &Option<AccountId>,
        group: &Option<Channel>,
        message: &String,
        timestamp: u64,
    ) -> MessageId {
        let target_bytes: &[u8];
        if let Some(acc) = other_account {
            target_bytes = acc.as_bytes();
        } else {
            target_bytes = group.as_ref().unwrap().name.as_bytes();
        }

        let bytes: &[u8] = &env::sha256(
            &[
                target_bytes,
                account.as_bytes(),
                message.as_bytes(),
                &timestamp.to_be_bytes(),
            ]
            .concat(),
        );

        let mut s = MessageId::with_capacity(bytes.len() * 2);
        for &b in bytes {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        format!("{}_{}", s, timestamp)
    }

    fn extract_timestamp(message_id: &MessageId) -> u64 {
        let parts: Vec<&str> = message_id.split("_").collect();
        parts[1].parse().unwrap()
    }

    fn from_base64(s: &str) -> Vec<u8> {
        near_sdk::base64::decode(s).unwrap()
    }

    fn to_base64(input: &Vec<u8>) -> String {
        near_sdk::base64::encode(&input)
    }

    fn from_hex(chars: &str) -> Vec<u8> {
        (0..chars.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&chars[i..i + 2], 16).unwrap())
            .collect()
    }

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            write!(&mut s, "{:02x}", b).unwrap();
        }
        s
    }

    fn find_first_occurence(messages: &Vector<Message>, timestamp: u64) -> u32 {
        if messages.is_empty() {
            return 0;
        }
        let n = messages.len();
        let mut lo = 0;
        let mut hi = n - 1;

        while lo <= hi {
            let mid = lo + (hi - lo) / 2;
            if (mid == 0 || (mid > 1 && messages[mid - 1].timestamp < timestamp))
                && messages[mid].timestamp == timestamp
            {
                return mid;
            } else if timestamp > messages[mid].timestamp {
                lo = mid + 1;
            } else {
                if mid == 0 {
                    return 0;
                }
                hi = mid - 1;
            }
        }

        0
    }

    fn find_last_occurence(messages: &Vector<Message>, timestamp: u64) -> u32 {
        if messages.is_empty() {
            return 0;
        }
        let n = messages.len();
        let mut lo = 0;
        let mut hi = n - 1;

        while lo <= hi {
            let mid = lo + (hi - lo) / 2;
            if (mid == n - 1 || messages[mid + 1].timestamp > timestamp)
                && messages[mid].timestamp == timestamp
            {
                return mid;
            } else if timestamp < messages[mid].timestamp {
                if mid == 0 {
                    return 0;
                }
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }

        0
    }

    fn find_message_pos<'a>(
        messages: &'a Vector<Message>,
        message_id: &MessageId,
    ) -> Option<(u32, &'a Message)> {
        let timestamp = Curb::extract_timestamp(message_id);

        let low = Curb::find_first_occurence(messages, timestamp);
        let high = Curb::find_last_occurence(messages, timestamp);

        for i in low..=high {
            if messages[i].id == *message_id {
                return Some((i, &messages[i]));
            }
        }

        None
    }

    fn inner_message_delete(
        container: &mut Vector<Message>,
        moderators: &HashSet<AccountId>,
        admin: Option<&AccountId>,
        message_id: MessageId,
    ) -> Option<u32> {
        let (idx, message) = match Curb::find_message_pos(container, &message_id) {
            Some(optional_pos) => optional_pos,
            None => return None,
        };

        let is_sender = message.sender == env::predecessor_account_id();
        let is_moderator = moderators.contains(&env::predecessor_account_id());
        let is_admin = if let Some(acc) = admin {
            &env::predecessor_account_id() == acc
        } else {
            false
        };
        if is_sender || is_moderator || is_admin {
            container[idx].text = vec![];
            container[idx].files = vec![];
            container[idx].images = vec![];
            container[idx].edited_on = Some(env::block_timestamp_ms());
            Some(idx)
        } else {
            None
        }
    }

    #[payable]
    pub fn delete_message(
        &mut self,
        account: Option<AccountId>,
        group: Option<Channel>,
        message_id: MessageId,
        parent_message: Option<MessageId>,
    ) {
        // TODO handle storage payments
        let success = if let Some(parent_id) = parent_message {
            match self.threads.entry(parent_id) {
                Entry::Occupied(mut e) => {
                    let empty_set: HashSet<AccountId> = HashSet::new();
                    let (moderators, admin) = if let Some(channel) = group {
                        let channel = self.channels.get(&channel).unwrap();
                        (&channel.meta.moderators, Some(&channel.meta.created_by))
                    } else {
                        (&empty_set, None)
                    };
                    let thread = e.get_mut();
                    Curb::inner_message_delete(&mut thread.messages, moderators, admin, message_id)
                        .is_some()
                }
                Entry::Vacant(_) => false,
            }
        } else if let Some(other) = account {
            let key = ChatMembers::from((env::predecessor_account_id(), other.clone()));
            match self.chats.entry(key) {
                Entry::Occupied(mut e) => {
                    let channel = e.get_mut();
                    if let Some(old_idx) = Curb::inner_message_delete(
                        &mut channel.messages,
                        &HashSet::new(),
                        None,
                        message_id,
                    ) {
                        if old_idx > 0 {
                            Curb::internal_read_message(
                                channel,
                                channel.messages[old_idx - 1].id.clone(),
                            )
                        } else {
                            channel.last_read.remove(&env::predecessor_account_id());
                        }
                        true
                    } else {
                        false
                    }
                }
                Entry::Vacant(_) => false,
            }
        } else if let Some(channel) = group {
            match self.channels.entry(channel) {
                Entry::Occupied(mut e) => {
                    let channel = e.get_mut();
                    if let Some(old_idx) = Curb::inner_message_delete(
                        &mut channel.messages,
                        &channel.meta.moderators,
                        Some(&channel.meta.created_by),
                        message_id,
                    ) {
                        if old_idx > 0 {
                            Curb::internal_read_message(
                                channel,
                                channel.messages[old_idx - 1].id.clone(),
                            )
                        } else {
                            channel.last_read.remove(&env::predecessor_account_id());
                        }
                        true
                    } else {
                        false
                    }
                }
                Entry::Vacant(_) => false,
            }
        } else {
            panic!("Either account or group need to be provided");
        };
        require!(success, "Uneditable");
    }

    fn inner_message_edit(
        container: &mut Vector<Message>,
        message_id: MessageId,
        new_message: String,
        files: Vec<File>,
        images: Vec<File>,
    ) -> Option<Message> {
        let (idx, message) = match Curb::find_message_pos(container, &message_id) {
            Some(optional_pos) => optional_pos,
            None => return None,
        };

        if message.sender == env::predecessor_account_id() {
            container[idx].text = Curb::from_base64(&new_message);
            container[idx].files = files;
            container[idx].images = images;
            container[idx].edited_on = Some(env::block_timestamp_ms());
            Some(container[idx].clone())
        } else {
            None
        }
    }

    #[payable]
    pub fn edit_message(
        &mut self,
        account: Option<AccountId>,
        group: Option<Channel>,
        message_id: MessageId,
        new_message: String,
        parent_message: Option<MessageId>,
        files: Vec<File>,
        images: Vec<File>,
    ) -> MessageWithReactions {
        // TODO handle storage payments
        let message = if let Some(parent_id) = parent_message {
            match self.threads.entry(parent_id) {
                Entry::Occupied(mut e) => Curb::inner_message_edit(
                    &mut e.get_mut().messages,
                    message_id,
                    new_message,
                    files,
                    images,
                ),
                Entry::Vacant(_) => None,
            }
        } else if let Some(other) = account {
            let key = ChatMembers::from((env::predecessor_account_id(), other.clone()));
            match self.chats.entry(key) {
                Entry::Occupied(mut e) => Curb::inner_message_edit(
                    &mut e.get_mut().messages,
                    message_id,
                    new_message,
                    files,
                    images,
                ),
                Entry::Vacant(_) => None,
            }
        } else if let Some(channel) = group {
            match self.channels.entry(channel) {
                Entry::Occupied(mut e) => Curb::inner_message_edit(
                    &mut e.get_mut().messages,
                    message_id,
                    new_message,
                    files,
                    images,
                ),
                Entry::Vacant(_) => None,
            }
        } else {
            panic!("Either account or group need to be provided");
        };
        match message {
            Some(message) => self.add_reactions_to_message(&message),
            None => panic!("Uneditable"),
        }
    }

    fn find_last_seen_pos(&self, channel_info: &ChannelInfo, account: &AccountId) -> u32 {
        match channel_info.last_read.get(&account) {
            Some(message_id) => {
                Curb::find_message_pos(&channel_info.messages, message_id)
                    .unwrap()
                    .0
                    + 1
            }
            _ => 0,
        }
    }

    fn place_message(
        messages: &mut Vector<Message>,
        mut message: Message,
        mentions: Option<Vec<String>>,
    ) -> Message {
        let mentions = mentions.unwrap_or(vec![]);
        if messages.is_empty() {
            for mention in mentions {
                message.mentions.insert(mention, 1);
            }
            messages.push(message);

            messages.get(0).unwrap().clone()
        } else {
            for i in (0..messages.len()).rev() {
                if messages[i].timestamp < message.timestamp {
                    // i is now last non changed position

                    let old_mentions = &messages[i].mentions;
                    for (k, cnt) in old_mentions {
                        message.mentions.insert(k.clone(), *cnt);
                    }
                    for mention in mentions {
                        let entry = message.mentions.entry(mention).or_insert(0);
                        *entry += 1;
                    }

                    let mut insert_pos = i + 1;
                    let mut current_message = message;
                    while insert_pos < messages.len() {
                        current_message = messages.replace(insert_pos, current_message);
                        insert_pos += 1
                    }
                    messages.push(current_message);
                    return messages.get(i + 1).unwrap().clone();
                }
            }

            panic!("not inserted message");
        }
    }

    #[payable]
    pub fn send_message(
        &mut self,
        account: Option<AccountId>,
        group: Option<Channel>,
        message: String,
        nonce: String,
        timestamp: u64,
        parent_message: Option<MessageId>,
        files: Option<Vec<File>>,
        images: Option<Vec<File>>,
        mentions: Option<Vec<String>>,
    ) -> MessageWithReactions {
        // TODO handle storage payments
        require!(
            self.members.contains_key(&env::predecessor_account_id()),
            "Not a member"
        );
        self.ping();
        // TODO require biggest difference in message and current timestamp allowed
        let message_id = Curb::get_message_id(
            &env::predecessor_account_id(),
            &account,
            &group,
            &message,
            timestamp,
        );
        let message = Message {
            id: message_id.clone(),
            text: Curb::from_base64(&message),
            files: files.unwrap_or_else(Vec::new),
            images: images.unwrap_or_else(Vec::new),
            nonce: Curb::from_hex(&nonce).try_into().unwrap(),
            sender: env::predecessor_account_id(),
            timestamp: timestamp,
            edited_on: None,
            mentions: UnorderedMap::new(format!("mentions {} prefix", message_id).as_bytes()),
        };
        let inserted_message: Message;
        if let Some(other) = account {
            require!(
                self.members.contains_key(&other),
                "Other account is not a member"
            );

            let key = ChatMembers::from((env::predecessor_account_id(), other.clone()));

            if let Some(parent_id) = parent_message {
                let container = self.threads.entry(parent_id.clone()).or_insert(ThreadInfo {
                    messages: Vector::new(format!("m {}", parent_id).as_bytes()),
                    last_read: UnorderedMap::new(format!("prid {}", parent_id).as_bytes()),
                });
                inserted_message = Curb::place_message(&mut container.messages, message, mentions);
            } else {
                let chat = self.chats.entry(key.clone()).or_insert(ChannelInfo {
                    messages: Vector::new(format!("m {}#{}", key.get(0), key.get(1)).as_bytes()),
                    channel_type: ChannelType::Public,
                    read_only: false,
                    meta: ChannelMetadata {
                        created_at: env::block_timestamp_ms(),
                        created_by: env::predecessor_account_id(),
                        attachments_allowed: true,
                        links_allowed: true,
                        moderators: HashSet::new(),
                        read_only: HashSet::new(),
                    },
                    last_read: UnorderedMap::new(
                        format!("{}#{}", key.get(0), key.get(1)).as_bytes(),
                    ),
                });
                inserted_message = Curb::place_message(&mut chat.messages, message, mentions);

                self.read_message(Some(other.clone()), None, message_id);
            }
        } else if let Some(channel) = group {
            require!(self.channels.contains_key(&channel), "Group does not exist");
            let is_member = match self.channel_members.get(&channel) {
                Some(cm) => cm.contains(&env::predecessor_account_id()),
                None => false,
            };
            let channel_info = self.channels.get(&channel).unwrap();
            let is_default_channel = channel_info.channel_type == ChannelType::Default;
            require!(is_member || is_default_channel, "Not a group member");
            let is_read_only_channel = channel_info.read_only;
            let is_read_only_member = channel_info
                .meta
                .read_only
                .contains(&env::predecessor_account_id())
                || (is_read_only_channel
                    && channel_info.meta.created_by != env::predecessor_account_id()
                    && !channel_info
                        .meta
                        .moderators
                        .contains(&env::predecessor_account_id()));
            require!(!is_read_only_member, "Read only member");

            if let Some(parent_id) = parent_message {
                let container = self.threads.entry(parent_id.clone()).or_insert(ThreadInfo {
                    messages: Vector::new(format!("m {}", parent_id).as_bytes()),
                    last_read: UnorderedMap::new(format!("prid {}", parent_id).as_bytes()),
                });
                inserted_message = Curb::place_message(&mut container.messages, message, None);
            } else {
                let messages = &mut self.channels.get_mut(&channel).unwrap().messages;
                inserted_message = Curb::place_message(messages, message, None);

                self.read_message(None, Some(channel.clone()), message_id);
            }
        } else {
            panic!("Either account or group need to be provided");
        }

        self.add_reactions_to_message(&inserted_message)
    }

    fn internal_read_message(info: &mut ChannelInfo, message_id: MessageId) {
        let container = &info.messages;

        if let Some((p, _)) = Curb::find_message_pos(&container, &message_id) {
            let should_insert =
                if let Some(last_id) = info.last_read.get(&env::predecessor_account_id()) {
                    match Curb::find_message_pos(&container, last_id) {
                        Some((p2, _)) => p2 < p,
                        _ => true,
                    }
                } else {
                    true
                };
            if should_insert {
                info.last_read
                    .insert(env::predecessor_account_id(), message_id);
            }
        }
    }

    #[payable]
    pub fn read_message(
        &mut self,
        account: Option<AccountId>,
        group: Option<Channel>,
        message_id: MessageId,
    ) {
        self.ping();
        if let Some(other) = account {
            let key = ChatMembers::from((env::predecessor_account_id(), other.clone()));
            Curb::internal_read_message(self.chats.get_mut(&key).unwrap(), message_id);
        } else if let Some(channel) = group {
            Curb::internal_read_message(self.channels.get_mut(&channel).unwrap(), message_id);
        } else {
            panic!("Either account or group need to be provided");
        }
    }

    #[payable]
    pub fn toggle_reaction(&mut self, message_id: MessageId, reaction: String) {
        // TODO handle storage payments
        let reactions = self
            .reactions
            .entry(message_id.clone())
            .or_insert(UnorderedMap::new(message_id.as_bytes()));
        let tracker = &mut reactions
            .entry(reaction.clone())
            .or_insert(UnorderedSet::new(
                format!("{} {}", message_id, reaction).as_bytes(),
            ));
        if tracker.contains(&env::predecessor_account_id()) {
            tracker.remove(&env::predecessor_account_id());
        } else {
            tracker.insert(env::predecessor_account_id());
        }
        self.ping();
    }

    fn count_unread(&self, info: &ChannelInfo, account: &AccountId) -> u32 {
        let len = info.messages.len();
        let last_seen = self.find_last_seen_pos(&info, &account);

        if len < last_seen {
            0
        } else {
            len - last_seen
        }
    }

    // TODO spead up this method, consider having mentions as prefix sums
    fn count_mentions(&self, info: &ChannelInfo, account: &AccountId) -> u32 {
        let len = info.messages.len();
        let last_seen = self.find_last_seen_pos(&info, &account);

        // case when channel was just joined, can not have been mentioned before
        if last_seen == 0 {
            return 0;
        }

        let mention_counter = |msg_idx, mention| {
            info.messages
                .get(msg_idx - 1)
                .unwrap()
                .mentions
                .get(&mention)
                .unwrap_or(&0)
        };

        let ls_account = mention_counter(last_seen, account.to_string());
        let current_account = mention_counter(len, account.to_string());

        let ls_here = mention_counter(last_seen, MENTION_PRESENT.to_string());
        let current_here = mention_counter(len, MENTION_PRESENT.to_string());

        let ls_everyone = mention_counter(last_seen, MENTION_ALL.to_string());
        let current_everyone = mention_counter(len, MENTION_ALL.to_string());

        let last_seen_val = ls_account + ls_here + ls_everyone;
        let current_val = current_account + current_here + current_everyone;

        if current_val < last_seen_val {
            0
        } else {
            current_val - last_seen_val
        }
    }

    pub fn unread_messages(&self, account: AccountId) -> UnreadMessageInfo {
        let mut unread_info = UnreadMessageInfo {
            channels: HashMap::new(),
            chats: HashMap::new(),
            threads: HashMap::new(),
        };
        for channel in self.get_groups(Some(account.clone())) {
            let info = self
                .channels
                .get(&Channel {
                    name: channel.name.clone(),
                })
                .unwrap();
            let last_seen = info.last_read.get(&account);
            unread_info.channels.insert(
                channel.name.clone(),
                UnreadMessage {
                    count: self.count_unread(&info, &account),
                    mentions: self.count_mentions(&info, &account),
                    last_seen: last_seen.cloned(),
                },
            );
        }

        for other_account in self.get_direct_messages(account.clone(), None, None) {
            let info = self
                .chats
                .get(&ChatMembers::from((account.clone(), other_account.clone())))
                .unwrap();

            let last_seen = info.last_read.get(&account);
            let unread_messages = self.count_unread(&info, &account);
            unread_info.chats.insert(
                other_account.clone(),
                UnreadMessage {
                    count: unread_messages,
                    // For DM consider every messages as mention
                    mentions: unread_messages,
                    last_seen: last_seen.cloned(),
                },
            );
        }

        // TODO add unread info for threads

        unread_info
    }

    fn add_reactions_to_message(&self, message: &Message) -> MessageWithReactions {
        let (thread_count, thread_last_timestamp) = match self.threads.get(&message.id) {
            Some(thread) => {
                if thread.messages.is_empty() {
                    (0, 0)
                } else {
                    let thread_last_timestamp = thread
                        .messages
                        .get(thread.messages.len() - 1)
                        .unwrap()
                        .timestamp;
                    (thread.messages.len(), thread_last_timestamp)
                }
            }
            _ => (0, 0),
        };
        let mut message_with_reactions = MessageWithReactions {
            id: message.id.clone(),
            text: Curb::to_base64(&message.text),
            timestamp: message.timestamp,
            sender: message.sender.clone(),
            nonce: Curb::to_hex(&message.nonce),
            reactions: None,
            edited_on: message.edited_on,
            files: message.files.clone(),
            images: message.images.clone(),
            thread_count: thread_count,
            thread_last_timestamp: thread_last_timestamp,
        };

        let mut reactions: HashMap<String, Vec<AccountId>> = HashMap::new();

        if let Some(r) = self.reactions.get(&message.id) {
            for (k, v) in r.iter() {
                reactions.insert(k.clone(), v.iter().map(|a| a.clone()).collect());
            }
            message_with_reactions.reactions = Some(reactions);
        }

        message_with_reactions
    }

    pub fn get_messages(
        &self,
        accounts: Option<(AccountId, AccountId)>,
        group: Option<Channel>,
        parent_message: Option<MessageId>,
        before_id: Option<MessageId>,
        after_id: Option<MessageId>,
        limit: u32,
    ) -> FullMessageResponse {
        require!(
            before_id.is_none() || after_id.is_none(),
            "before_id and after_id can not be provided together"
        );

        let info = if let Some(accounts) = accounts {
            let key = ChatMembers::from(accounts);
            match self.chats.get(&key) {
                Some(info) => info,
                _ => return FullMessageResponse::default(),
            }
        } else if let Some(channel) = group {
            match self.channels.get(&channel) {
                Some(info) => info,
                _ => return FullMessageResponse::default(),
            }
        } else {
            panic!("Either account or group need to be provided");
        };
        let empty_thread: Vector<Message> = Vector::new(b"empty thread".to_vec());
        let messages = if let Some(parent_message) = parent_message {
            match self.threads.get(&parent_message) {
                Some(thread) => &thread.messages,
                _ => &empty_thread,
            }
        } else {
            &info.messages
        };

        let bounds = if let Some(message_id) = before_id {
            let pos = Curb::find_message_pos(messages, &message_id)
                .map(|o| o.0)
                .unwrap_or(limit.min(messages.len()));
            (pos.saturating_sub(limit), pos)
        } else if let Some(message_id) = after_id {
            let pos = Curb::find_message_pos(messages, &message_id)
                .map(|o| o.0)
                .unwrap_or(messages.len().saturating_sub(limit));
            (pos, info.messages.len().min(pos + limit))
        } else {
            (messages.len().saturating_sub(limit), messages.len())
        };

        let count = messages.len();
        let mut selected_messages: Vec<&Message> = vec![];
        for i in bounds.0..bounds.1 {
            selected_messages.push(&messages[i]);
        }
        let selected_messages: Vec<MessageWithReactions> = selected_messages
            .into_iter()
            .map(|m| self.add_reactions_to_message(&m))
            .collect();

        FullMessageResponse {
            total_count: count,
            messages: selected_messages,
            start_position: bounds.0,
        }
    }

    pub fn get_members(
        &self,
        group: Option<Channel>,
        name_prefix: Option<String>,
        limit: Option<usize>,
        exclude: Option<bool>,
    ) -> Vec<UserInfo> {
        let prefix = name_prefix.unwrap_or("".to_string());
        let exclude = exclude.unwrap_or(false);
        let mut result: Vec<UserInfo> = if let Some(group) = group {
            let group_info = self.channels.get(&group).unwrap();
            if !self.default_groups.contains(&group) {
                if exclude {
                    match self.channel_members.get(&group) {
                        Some(cm) => self
                            .members
                            .iter()
                            .filter(|(m, _)| !cm.contains(m))
                            .filter(|(m, _)| m.as_str().starts_with(&prefix))
                            .map(|(m, timestamp)| UserInfo {
                                id: m.clone(),
                                active: self.is_active(*timestamp),
                                moderator: group_info.meta.moderators.contains(&m),
                                read_only: group_info.meta.read_only.contains(&m),
                            })
                            .collect(),
                        None => return vec![],
                    }
                } else {
                    match self.channel_members.get(&group) {
                        Some(cm) => cm
                            .iter()
                            .filter(|m| m.as_str().starts_with(&prefix))
                            .map(|m| UserInfo {
                                id: m.clone(),
                                active: self.is_active(*self.members.get(&m).unwrap()),
                                moderator: group_info.meta.moderators.contains(&m),
                                read_only: group_info.meta.read_only.contains(&m),
                            })
                            .collect(),
                        None => return vec![],
                    }
                }
            } else {
                if exclude {
                    return vec![];
                } else {
                    self.members
                        .iter()
                        .filter(|(m, _)| m.as_str().starts_with(&prefix))
                        .map(|(m, timestamp)| UserInfo {
                            id: m.clone(),
                            active: self.is_active(*timestamp),
                            moderator: group_info.meta.moderators.contains(&m),
                            read_only: group_info.meta.read_only.contains(&m),
                        })
                        .collect()
                }
            }
        } else {
            if exclude {
                return vec![];
            } else {
                self.members
                    .iter()
                    .filter(|(m, _)| m.as_str().starts_with(&prefix))
                    .map(|(m, timestamp)| UserInfo {
                        id: m.clone(),
                        active: self.is_active(*timestamp),
                        moderator: false,
                        read_only: false,
                    })
                    .collect()
            }
        };
        if let Some(limit) = limit {
            let items_count = limit.min(result.len());
            result.drain(0..items_count).collect()
        } else {
            result
        }
    }

    fn is_active(&self, timestamp: u64) -> bool {
        env::block_timestamp_ms() - timestamp < ACTIVE_MS_THRESHOLD
    }

    pub fn get_direct_messages(
        &self,
        account: AccountId,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Vec<AccountId> {
        let mut res = vec![];
        for other in self.members.keys() {
            let key = ChatMembers::from((account.clone(), other.clone()));
            if self.chats.contains_key(&key) {
                res.push(key.get_other_account(&account));
            }
        }
        let mut results: &[AccountId] = &res[..];

        if let Some(offset) = offset {
            results = &results[offset..];
        }
        if let Some(limit) = limit {
            results = &results[0..limit.min(results.len())];
        }

        results.to_vec()
    }

    pub fn get_groups(&self, account: Option<AccountId>) -> Vec<PublicChannel> {
        if let Some(account) = account {
            let mut res = match self.member_channels.get(&account) {
                Some(mc) => mc
                    .iter()
                    .map(|c| {
                        let info = self.channels.get(&c);
                        // handle case when member_channels contains channel that was deleted
                        match info {
                            Some(info) => Some(PublicChannel {
                                name: c.name.clone(),
                                channel_type: info.channel_type.clone(),
                                read_only: info.read_only.clone(),
                            }),
                            None => None,
                        }
                    })
                    .flatten()
                    .collect(),
                None => vec![],
            };
            let mut default: Vec<PublicChannel> = self
                .default_groups
                .iter()
                .map(|c| {
                    let info = self.channels.get(&c).unwrap();
                    PublicChannel {
                        name: c.name.clone(),
                        channel_type: info.channel_type.clone(),
                        read_only: info.read_only.clone(),
                    }
                })
                .collect();
            default.append(&mut res);

            default
        } else {
            let mut channels = vec![];
            for (channel, info) in self.channels.iter() {
                if info.channel_type != ChannelType::Private {
                    channels.push(PublicChannel {
                        name: channel.name.clone(),
                        channel_type: info.channel_type.clone(),
                        read_only: info.read_only.clone(),
                    });
                }
            }

            channels
        }
    }

    #[payable]
    pub fn set_group_moderator(&mut self, group: Channel, moderator: AccountId, is_add: bool) {
        require!(self.channels.contains_key(&group), "Group does not exist");
        let is_member = match self.channel_members.get(&group) {
            Some(cm) => cm.contains(&moderator),
            None => false,
        };
        let info = self.channels.get_mut(&group).unwrap();

        require!(is_member || info.channel_type == ChannelType::Default, "Not a group member");
        require!(
            env::predecessor_account_id() == info.meta.created_by,
            "Only admin can set moderators"
        );

        if is_add {
            info.meta.moderators.insert(moderator);
        } else {
            info.meta.moderators.remove(&moderator);
        }
    }
    #[payable]
    pub fn set_group_only_watcher(&mut self, group: Channel, watcher: AccountId, is_add: bool) {
        require!(self.channels.contains_key(&group), "Group does not exist");
        let is_member = match self.channel_members.get(&group) {
            Some(cm) => cm.contains(&watcher),
            None => false,
        };
        let info = self.channels.get_mut(&group).unwrap();
        
        require!(is_member || info.channel_type == ChannelType::Default, "Not a group member");
        require!(
            env::predecessor_account_id() == info.meta.created_by
                || info
                    .meta
                    .moderators
                    .contains(&env::predecessor_account_id()),
            "Only moderators can set readOnly accounts"
        );

        if is_add {
            info.meta.read_only.insert(watcher);
        } else {
            info.meta.read_only.remove(&watcher);
        }
    }
    #[payable]
    pub fn set_group_permissions(
        &mut self,
        group: Channel,
        links_allowed: bool,
        files_allowed: bool,
    ) {
        require!(self.channels.contains_key(&group), "Group does not exist");
        let info = self.channels.get_mut(&group).unwrap();
        require!(
            env::predecessor_account_id() == info.meta.created_by,
            "Only admin action"
        );
        info.meta.links_allowed = links_allowed;
        info.meta.attachments_allowed = files_allowed;
    }

    pub fn get_keys(&self, account: AccountId) -> Vec<&PublicKey> {
        match self.member_keys.get(&account) {
            Some(keys) => keys.iter().collect(),
            None => vec![],
        }
    }

    pub fn channel_info(&self, group: Channel) -> Option<PublicChannelMetadata> {
        self.channels.get(&group).map(|c| PublicChannelMetadata {
            created_at: c.meta.created_at,
            created_by: c.meta.created_by.clone(),
            attachments_allowed: c.meta.attachments_allowed,
            links_allowed: c.meta.links_allowed,
            read_only: c.read_only,
            channel_type: c.channel_type.clone(),
        })
    }

    pub fn public_info(&self) -> PublicInfo {
        PublicInfo {
            members: self.members.len(),
            name: self.name.clone(),
            assets: self.assets.clone(),
            created_at: self.created_at,
        }
    }

    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        #[derive(BorshDeserialize, BorshSerialize)]
        struct OldMessage {
            pub timestamp: u64,
            pub sender: AccountId,
            pub id: MessageId,
            pub text: Vec<u8>,
            pub files: Vec<File>,
            pub images: Vec<File>,
            pub nonce: [u8; 16],
            pub edited_on: Option<u64>,
            pub mentions: Vector<String>,
        }
        #[derive(BorshDeserialize, BorshSerialize)]
        struct OldChannelInfo {
            pub messages: Vec<OldMessage>,
            pub channel_type: ChannelType,
            pub read_only: bool,
            pub meta: ChannelMetadata,
            pub last_read: UnorderedMap<AccountId, MessageId>,
        }
        #[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
        pub struct OldCurb {
            name: String,

            owner: AccountId,
            created_at: u64,

            members: UnorderedMap<AccountId, u64>,
            member_keys: UnorderedMap<AccountId, UnorderedSet<PublicKey>>,

            channels: UnorderedMap<Channel, OldChannelInfo>,
            channel_members: UnorderedMap<Channel, UnorderedSet<AccountId>>,
            member_channels: UnorderedMap<AccountId, UnorderedSet<Channel>>,

            chats: UnorderedMap<ChatMembers, OldChannelInfo>,

            threads: UnorderedMap<MessageId, Vec<OldMessage>>,

            reactions: UnorderedMap<MessageId, UnorderedMap<String, UnorderedSet<AccountId>>>,

            default_groups: Vec<Channel>,

            channel_creators: UnorderedSet<AccountId>,

            banned_users: UnorderedSet<AccountId>,

            assets: String,
        }

        let OldCurb {
            name,
            owner,
            created_at,
            members,
            member_keys,
            mut channels,
            channel_members,
            member_channels,
            mut chats,
            mut threads,
            reactions,
            default_groups,
            channel_creators,
            banned_users,
            assets,
        } = env::state_read().unwrap();

        let mut new_channels: UnorderedMap<Channel, ChannelInfo> =
            UnorderedMap::new(b"migrated_channels-2710".to_vec());
        for (c, info) in channels.iter_mut() {
            let mut new_messages = Vector::new(format!("migrated m {}", c.name).as_bytes());
            for m in info.messages.drain(..) {
                new_messages.push(Message {
                    timestamp: m.timestamp,
                    sender: m.sender,
                    id: m.id.clone(),
                    text: m.text,
                    files: m.files,
                    images: m.images,
                    nonce: m.nonce,
                    edited_on: m.edited_on,
                    mentions: UnorderedMap::new(format!("migrated mentions {}", m.id).as_bytes()),
                });
            }
            let mut new_last_read: UnorderedMap<AccountId, MessageId> =
                UnorderedMap::new(format!("migrated channel lr {}", c.name).as_bytes());
            for (k, v) in info.last_read.drain() {
                new_last_read.insert(k, v);
            }
            new_channels.insert(
                c.clone(),
                ChannelInfo {
                    messages: new_messages,
                    channel_type: info.channel_type.clone(),
                    read_only: info.read_only.clone(),
                    meta: info.meta.clone(),
                    last_read: new_last_read,
                },
            );
        }

        let mut new_chats: UnorderedMap<ChatMembers, ChannelInfo> =
            UnorderedMap::new(b"migrated_chats-2710".to_vec());
        for (c, info) in chats.iter_mut() {
            let mut new_messages =
                Vector::new(format!("migrated m {} {}", c.get(0), c.get(1)).as_bytes());
            for m in info.messages.drain(..) {
                new_messages.push(Message {
                    timestamp: m.timestamp,
                    sender: m.sender,
                    id: m.id.clone(),
                    text: m.text,
                    files: m.files,
                    images: m.images,
                    nonce: m.nonce,
                    edited_on: m.edited_on,
                    mentions: UnorderedMap::new(format!("migrated mentions {}", m.id).as_bytes()),
                });
            }
            let mut new_last_read: UnorderedMap<AccountId, MessageId> =
                UnorderedMap::new(format!("migrated chat lr {} {}", c.get(0), c.get(1)).as_bytes());
            for (k, v) in info.last_read.drain() {
                new_last_read.insert(k, v);
            }
            new_chats.insert(
                c.clone(),
                ChannelInfo {
                    messages: new_messages,
                    channel_type: info.channel_type.clone(),
                    read_only: info.read_only.clone(),
                    meta: info.meta.clone(),
                    last_read: new_last_read,
                },
            );
        }

        let mut new_threads: UnorderedMap<MessageId, ThreadInfo> =
            UnorderedMap::new(b"migrated_threads-2710".to_vec());
        for (t, messages) in threads.iter_mut() {
            let mut new_messages = Vector::new(format!("migrated m {}", t).as_bytes());
            for m in messages.drain(..) {
                new_messages.push(Message {
                    timestamp: m.timestamp,
                    sender: m.sender,
                    id: m.id.clone(),
                    text: m.text,
                    files: m.files,
                    images: m.images,
                    nonce: m.nonce,
                    edited_on: m.edited_on,
                    mentions: UnorderedMap::new(format!("migrated mentions {}", m.id).as_bytes()),
                });
            }
            new_threads.insert(
                t.clone(),
                ThreadInfo {
                    messages: new_messages,
                    last_read: UnorderedMap::new(format!("migrated prid {}", t).as_bytes()),
                },
            );
        }

        Self {
            name,
            owner,
            created_at,
            members,
            member_keys,
            channels: new_channels,
            channel_members,
            member_channels,
            chats: new_chats,
            threads: new_threads,
            reactions,
            default_groups,
            channel_creators,
            banned_users,
            assets,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_empty_curb(owner: Option<AccountId>) -> Curb {
        let mut map = HashMap::new();
        map.insert("general".to_string(), ("bob.near".parse().unwrap(), false));
        map.insert(
            "default".to_string(),
            ("alice.near".parse().unwrap(), false),
        );
        let mut curb = Curb::new(
            "test_curb".to_string(),
            owner.unwrap_or("alice.near".parse().unwrap()),
            map,
            None,
            "W10=".to_string(),
        );
        curb.join();
        curb
    }

    fn message_factory(timestamp: u64) -> Message {
        let sender = if timestamp % 2 == 0 {
            "alice.near"
        } else {
            "bob.near"
        };

        Message {
            timestamp,
            sender: sender.parse().unwrap(),
            id: format!("msg_{}", timestamp),
            text: vec![timestamp as u8],
            files: vec![],
            images: vec![],
            nonce: [0; 16],
            edited_on: None,
            mentions: UnorderedMap::new(b"mentions".to_vec()),
        }
    }

    fn internal_setup_populated_curb(
        owner: Option<AccountId>,
        group_creator: Option<AccountId>,
        sequential_messages: bool,
        test_channel_creator: AccountId,
    ) -> Curb {
        // Returns a curb with 5 messages in a channel called "test_channel" and timestamps from 1 to 5
        let mut curb = setup_empty_curb(owner);

        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let mut messages: Vector<Message> = Vector::new(b"testing messages".to_vec());
        if sequential_messages {
            (1..=5).map(message_factory).for_each(|m| messages.push(m))
        } else {
            (1..=5)
                .map(|x| x * 2)
                .map(message_factory)
                .for_each(|m| messages.push(m))
        };

        curb.channels.insert(
            channel.clone(),
            ChannelInfo {
                messages,
                channel_type: ChannelType::Public,
                read_only: false,
                meta: ChannelMetadata {
                    created_at: 0,
                    created_by: group_creator.unwrap_or(test_channel_creator),
                    attachments_allowed: true,
                    links_allowed: true,
                    moderators: HashSet::new(),
                    read_only: HashSet::new(),
                },
                last_read: UnorderedMap::new(b"l".to_vec()),
            },
        );
        curb.channel_members
            .insert(channel.clone(), UnorderedSet::new(channel.name.as_bytes()));
        let account = "bob.near".parse().unwrap();
        curb.group_invite(channel.clone(), account, Some(true));

        curb
    }

    fn setup_populated_curb(owner: Option<AccountId>, group_creator: Option<AccountId>) -> Curb {
        internal_setup_populated_curb(owner, group_creator, true, "bob.near".parse().unwrap())
    }

    fn setup_populated_curb_with_non_sequential_messages(
        owner: Option<AccountId>,
        group_creator: Option<AccountId>,
    ) -> Curb {
        internal_setup_populated_curb(owner, group_creator, false, "alice.near".parse().unwrap())
    }

    #[test]
    fn test_init() {
        let mut curb = setup_populated_curb(None, None);
        let test_channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.group_invite(
            test_channel.clone(),
            "bob.near".parse().unwrap(),
            Some(true),
        );
        assert_eq!(curb.get_groups(None).len(), 3);
        assert_eq!(curb.get_groups(Some("bob.near".parse().unwrap())).len(), 3);
        assert_eq!(
            curb.get_groups(Some("alice.near".parse().unwrap())).len(),
            2
        );
        assert_eq!(curb.get_members(None, None, None, None).len(), 1);
        assert_eq!(
            curb.get_members(None, Some("b".to_string()), None, None)
                .len(),
            1
        );
        assert_eq!(
            curb.get_members(
                Some(test_channel.clone()),
                Some("b".to_string()),
                None,
                Some(true)
            )
            .len(),
            0
        );
        assert_eq!(
            curb.get_members(
                Some(test_channel.clone()),
                Some("b".to_string()),
                None,
                Some(false)
            )
            .len(),
            1
        );
        assert_eq!(
            curb.get_members(None, Some("a".to_string()), None, None)
                .len(),
            0
        );
    }

    #[test]
    fn test_timestamp_exact_match_with_limit_bigger_than_results() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                Some("msg_2".to_string()),
                None,
                2,
            )
            .messages;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].timestamp, 1);
    }

    #[test]
    fn test_timestamp_exact_match_with_limit_smaller_than_results() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                Some("msg_4".to_string()),
                None,
                2,
            )
            .messages;
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].timestamp, 2);
        assert_eq!(result[1].timestamp, 3);
    }

    #[test]
    fn test_limit_zero() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                None,
                None,
                0,
            )
            .messages;
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_before_id_does_not_exist() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                Some("msg_0".to_string()),
                None,
                10,
            )
            .messages;
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_timestamp_larger_than_latest() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                Some("msg_6".to_string()),
                None,
                10,
            )
            .messages;
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_large_limit() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                None,
                None,
                100,
            )
            .messages;
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_nonexistent_channel() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "non_existing".to_string(),
                }),
                None,
                None,
                None,
                10,
            )
            .messages;
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_limit_less_than_messages() {
        let curb = setup_populated_curb(None, None);
        let result = curb
            .get_messages(
                None,
                Some(Channel {
                    name: "test_channel".to_string(),
                }),
                None,
                None,
                None,
                3,
            )
            .messages;
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].timestamp, 3);
        assert_eq!(result[1].timestamp, 4);
        assert_eq!(result[2].timestamp, 5);
    }

    #[test]
    fn test_edit_message_in_group() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.edit_message(
            None,
            Some(channel.clone()),
            "msg_3".to_string(),
            "RURJVA==".to_string(),
            None,
            vec![],
            vec![],
        );

        let messages = curb
            .get_messages(None, Some(channel), None, None, None, 20)
            .messages;
        assert_eq!(messages.len(), 5);
        assert_eq!(messages[2].text, "RURJVA==");
        assert_ne!(messages[2].edited_on, None);
    }

    #[test]
    fn test_delete_message_in_group() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.delete_message(None, Some(channel.clone()), "msg_3".to_string(), None);

        let messages = curb
            .get_messages(None, Some(channel.clone()), None, None, None, 20)
            .messages;
        assert_ne!(messages[0].text, "");
        assert_ne!(messages[1].text, "");
        assert_eq!(messages[2].text, "");
        assert_ne!(messages[3].text, "");
        assert_ne!(messages[4].text, "");

        curb.delete_message(None, Some(channel.clone()), "msg_2".to_string(), None);

        let messages = curb
            .get_messages(None, Some(channel), None, None, None, 20)
            .messages;
        assert_ne!(messages[0].text, "");
        assert_eq!(messages[1].text, "");
        assert_eq!(messages[2].text, "");
        assert_ne!(messages[3].text, "");
        assert_ne!(messages[4].text, "");
    }

    #[test]
    fn test_delete_group_by_chat_owner() {
        let mut curb = setup_populated_curb(Some("bob.near".parse().unwrap()), None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.delete_group(channel);
    }

    #[test]
    fn test_delete_group_by_group_owner() {
        let mut curb = setup_populated_curb(
            Some("alice.near".parse().unwrap()),
            Some("bob.near".parse().unwrap()),
        );
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.delete_group(channel);
    }

    #[test]
    #[should_panic(expected = "Admin only action")]
    fn test_cannot_delete_group_by_chat_owner() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.delete_group(channel);
    }

    #[test]
    #[should_panic(expected = "Group name too short!")]
    fn test_group_name_too_short() {
        let mut map = HashMap::new();
        map.insert("".to_string(), ("bob.near".parse().unwrap(), false));
        Curb::new(
            "test_curb".to_string(),
            "alice.near".parse().unwrap(),
            map,
            None,
            "W10=".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Group name too long!")]
    fn test_group_name_too_long() {
        let mut map = HashMap::new();
        map.insert(
            "this-is-very-long-group-name-that-is-too-long".to_string(),
            ("bob.near".parse().unwrap(), false),
        );
        Curb::new(
            "test_curb".to_string(),
            "alice.near".parse().unwrap(),
            map,
            None,
            "W10=".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Group name can not contain #")]
    fn test_group_name_contains_hash() {
        let mut map = HashMap::new();
        map.insert("#general".to_string(), ("bob.near".parse().unwrap(), false));
        Curb::new(
            "test_curb".to_string(),
            "alice.near".parse().unwrap(),
            map,
            None,
            "W10=".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Group name can not contain space")]
    fn test_group_name_contains_space() {
        let mut map = HashMap::new();
        map.insert(
            "group name".to_string(),
            ("bob.near".parse().unwrap(), false),
        );
        Curb::new(
            "test_curb".to_string(),
            "alice.near".parse().unwrap(),
            map,
            None,
            "W10=".to_string(),
        );
    }

    #[test]
    fn test_read_message_last() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_5".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_5".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 0);
    }

    #[test]
    fn test_read_message_not_last() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_3".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_3".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 2);
    }

    #[test]
    fn test_read_message_out_of_order() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_4".to_string());

        curb.read_message(None, Some(channel.clone()), "msg_3".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_4".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 1);
    }

    #[test]
    fn test_read_message_in_order() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_3".to_string());

        curb.read_message(None, Some(channel.clone()), "msg_4".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_4".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 1);
    }

    #[test]
    fn test_read_message_last_non_sequential() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_10".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_10".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 0);
    }

    #[test]
    fn test_read_message_not_last_non_sequential() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_6".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_6".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 2);
    }

    #[test]
    fn test_read_message_out_of_order_non_sequential() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_8".to_string());

        curb.read_message(None, Some(channel.clone()), "msg_6".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_8".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 1);
    }

    #[test]
    fn test_read_message_in_order_non_sequential() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        let account = "bob.near".parse().unwrap();
        curb.read_message(None, Some(channel.clone()), "msg_6".to_string());

        curb.read_message(None, Some(channel.clone()), "msg_8".to_string());

        let unread = curb.unread_messages(account);
        assert_eq!(
            unread.channels.get(&channel.name).unwrap().last_seen,
            Some("msg_8".to_string())
        );
        assert_eq!(unread.channels.get(&channel.name).unwrap().count, 1);
    }

    #[test]
    fn test_create_private_channel() {
        let mut curb = setup_populated_curb_with_non_sequential_messages(None, None);
        let channel = Channel {
            name: "private-channel".to_string(),
        };
        curb.create_group(channel, Some(ChannelType::Private), None, None);
    }

    #[test]
    fn test_send_out_of_order() {
        let mut curb = setup_populated_curb(None, None);
        let channel = Channel {
            name: "test_channel".to_string(),
        };
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            20,
            None,
            None,
            None,
            None,
        );
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            21,
            None,
            None,
            None,
            None,
        );
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            18,
            None,
            None,
            None,
            None,
        );
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            15,
            None,
            None,
            None,
            None,
        );
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            16,
            None,
            None,
            None,
            None,
        );
        curb.send_message(
            None,
            Some(channel.clone()),
            "RURJVA==".to_string(),
            "ffffffffffffffffffffffffffffffff".to_string(),
            17,
            None,
            None,
            None,
            None,
        );
        let messages = curb
            .get_messages(None, Some(channel.clone()), None, None, None, 20)
            .messages;
        assert_eq!(messages.len(), 11);
        assert_eq!(messages[0].timestamp, 1);
        assert_eq!(messages[1].timestamp, 2);
        assert_eq!(messages[2].timestamp, 3);
        assert_eq!(messages[3].timestamp, 4);
        assert_eq!(messages[4].timestamp, 5);
        assert_eq!(messages[5].timestamp, 15);
        assert_eq!(messages[6].timestamp, 16);
        assert_eq!(messages[7].timestamp, 17);
        assert_eq!(messages[8].timestamp, 18);
        assert_eq!(messages[9].timestamp, 20);
        assert_eq!(messages[10].timestamp, 21);
    }
}
