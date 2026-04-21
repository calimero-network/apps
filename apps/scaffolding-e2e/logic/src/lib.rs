//! # Consolidated E2E KV Store
//!
//! A comprehensive test application that consolidates all backend E2E coverage
//! into a single app. This app exercises:
//!
//! - **KV Operations**: Basic CRUD with CRDT replication
//! - **Event Handlers**: Event-driven handlers with execution tracking
//! - **User Storage**: Per-user isolated storage (simple and nested)
//! - **Frozen Storage**: Content-addressed immutable storage
//! - **Private Storage**: Node-local private state vs replicated public state
//! - **Blob API**: Blob upload, announce, and discovery
//! - **Context Admin**: Member management
//! - **Nested CRDTs**: Complex nested CRDT compositions
//! - **RGA Document**: ReplicatedGrowableArray for text editing
//!
//! Each feature area is organized into its own method group with clear prefixes.

#![allow(clippy::len_without_is_empty)]

use std::collections::BTreeMap;

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_sdk::{app, env, PublicKey};
use calimero_storage::collections::{
    Counter, FrozenStorage, GCounter, LwwRegister, Mergeable, PNCounter, ReplicatedGrowableArray,
    UnorderedMap, UnorderedSet, UserStorage, Vector,
};
use sha2::{Digest, Sha256};
use thiserror::Error;

// CONSTANTS

const BLOB_ID_SIZE: usize = 32;
const BASE58_ENCODED_MAX_SIZE: usize = 44;

// HELPER TYPES

/// Nested map type for user storage
#[derive(Debug, BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
struct NestedMap {
    map: UnorderedMap<String, LwwRegister<String>>,
}

impl Mergeable for NestedMap {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        self.map.merge(&other.map)
    }
}

/// File record for blob metadata
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FileRecord {
    pub id: String,
    pub name: String,
    #[serde(serialize_with = "serialize_blob_id_bytes")]
    pub blob_id: [u8; 32],
    pub size: u64,
    pub mime_type: String,
    pub uploaded_by: String,
    pub uploaded_at: u64,
}

impl Mergeable for FileRecord {
    fn merge(
        &mut self,
        other: &Self,
    ) -> Result<(), calimero_storage::collections::crdt_meta::MergeError> {
        if other.uploaded_at > self.uploaded_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// WORKSPACE MANAGER TYPES

/// A named channel — tracks a context as a logical channel/room in the workspace.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ChannelRecord {
    pub context_id: String,
    pub name: String,
    pub topic: String,
    pub created_by: String,
}

/// A sub-group within the workspace.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WsGroupRecord {
    pub group_id: String,
    pub name: String,
    pub description: String,
    pub created_by: String,
}

/// Workspace summary returned by ws_get_info.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WorkspaceInfo {
    pub name: String,
    pub admin: String,
    pub channel_count: usize,
    pub group_count: usize,
    pub member_count: usize,
}

/// Member identity + app-level role.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberRecord {
    pub identity: String,
    pub role: String,
}

// PRIVATE STATE (Node-local, NOT synchronized)

#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[app::private]
pub struct PrivateSecrets {
    secrets: UnorderedMap<String, String>,
}

impl Default for PrivateSecrets {
    fn default() -> Self {
        Self {
            secrets: UnorderedMap::new(),
        }
    }
}

// MAIN STATE

#[app::state(emits = for<'a> Event<'a>)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct E2eKvStore {
    // --- KV Storage ---
    /// Public replicated KV map
    kv_items: UnorderedMap<String, LwwRegister<String>>,

    // --- Handler Tracking ---
    /// Counter for handler executions (CRDT G-Counter - grow only)
    handler_counter: Counter,

    // --- User Storage ---
    /// Simple user-owned data (e.g., profile name)
    user_items_simple: UserStorage<LwwRegister<String>>,
    /// Nested user-owned data (e.g., user's private KV store)
    user_items_nested: UserStorage<NestedMap>,

    // --- Frozen Storage ---
    /// Content-addressed immutable storage
    frozen_items: FrozenStorage<String>,

    // --- Private Game (public hash tracking) ---
    /// Maps game_id -> SHA256(secret) hex
    games: UnorderedMap<String, LwwRegister<String>>,

    // --- Blob Storage ---
    /// File metadata records
    files: UnorderedMap<String, FileRecord>,
    /// Counter for generating file IDs
    file_counter: LwwRegister<u64>,
    /// Owner of the file share context
    file_owner: LwwRegister<String>,

    // --- Nested CRDTs ---
    /// Map of G-Counters (grow-only, concurrent increments should sum)
    /// Counter<false> = GCounter (default)
    crdt_counters: UnorderedMap<String, Counter>,
    /// Map of PN-Counters (supports decrement, concurrent inc/dec should merge correctly)
    /// Counter<true> = PNCounter (allows decrement)
    crdt_pn_counters: UnorderedMap<String, Counter<true>>,
    /// Map of LWW registers (latest timestamp wins)
    crdt_registers: UnorderedMap<String, LwwRegister<String>>,
    /// Nested maps (field-level merge)
    crdt_metadata: UnorderedMap<String, UnorderedMap<String, LwwRegister<String>>>,
    /// Vector of G-Counters (element-wise merge)
    crdt_metrics: Vector<Counter>,
    /// Map of sets (union merge)
    crdt_tags: UnorderedMap<String, UnorderedSet<String>>,

    // --- RGA Document ---
    /// Collaborative text document
    rga_document: ReplicatedGrowableArray,
    /// Edit count for document (G-Counter)
    rga_edit_count: Counter,
    /// Document metadata (title, owner)
    rga_metadata: UnorderedMap<String, LwwRegister<String>>,

    // --- Workspace Manager ---
    /// Workspace display name
    ws_name: LwwRegister<String>,
    /// Admin public key (base58). Set once by ws_init.
    ws_admin: LwwRegister<String>,
    /// Channel registry: context_id (base58) → ChannelRecord
    ws_channels: UnorderedMap<String, LwwRegister<ChannelRecord>>,
    /// Sub-group registry: group_id (hex) → WsGroupRecord
    ws_groups: UnorderedMap<String, LwwRegister<WsGroupRecord>>,
    /// App-level member roles: identity (base58) → "admin" | "member" | "read-only"
    ws_member_roles: UnorderedMap<String, LwwRegister<String>>,
}

// EVENTS

#[app::event]
pub enum Event<'a> {
    // KV Events
    Inserted {
        key: &'a str,
        value: &'a str,
    },
    Updated {
        key: &'a str,
        value: &'a str,
    },
    Removed {
        key: &'a str,
    },
    Cleared,

    // User Storage Events
    UserSimpleSet {
        executor_id: PublicKey,
        value: &'a str,
    },
    UserNestedSet {
        executor_id: PublicKey,
        key: &'a str,
        value: &'a str,
    },

    // Frozen Storage Events
    FrozenAdded {
        hash: [u8; 32],
        value: &'a str,
    },

    // Private Game Events
    SecretSet {
        game_id: &'a str,
    },
    Guessed {
        game_id: &'a str,
        success: bool,
        by: &'a str,
    },

    // Blob Events
    FileUploaded {
        id: String,
        name: String,
        size: u64,
        uploader: String,
    },
    FileDeleted {
        id: String,
        name: String,
    },

    // Nested CRDT Events
    GCounterIncremented {
        key: String,
        value: u64,
    },
    PnCounterChanged {
        key: String,
        value: i64,
        operation: &'a str,
    },
    RegisterSet {
        key: String,
        value: String,
    },
    MetadataSet {
        outer_key: String,
        inner_key: String,
        value: String,
    },
    MetricPushed {
        value: u64,
    },
    TagAdded {
        key: String,
        tag: String,
    },

    // RGA Events
    DocumentCreated {
        title: String,
        owner: String,
    },
    TextInserted {
        position: usize,
        text: String,
        editor: String,
    },
    TextDeleted {
        start: usize,
        end: usize,
        editor: String,
    },
    TitleChanged {
        old_title: String,
        new_title: String,
        editor: String,
    },

    // Workspace Manager Events
    WsInitialized {
        name: &'a str,
        admin: &'a str,
    },
    WsChannelRegistered {
        context_id: &'a str,
        name: &'a str,
    },
    WsChannelUnregistered {
        context_id: &'a str,
    },
    WsGroupRegistered {
        group_id: &'a str,
        name: &'a str,
    },
    WsGroupUnregistered {
        group_id: &'a str,
    },
    WsMemberRoleSet {
        identity: &'a str,
        role: &'a str,
    },
    WsPingSent {
        to_context: &'a str,
    },
    WsPongReceived {
        from_context: &'a str,
    },
}

// ERRORS

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum Error<'a> {
    #[error("key not found: {0}")]
    NotFound(&'a str),
    #[error("user data not found for key: {0}")]
    UserNotFound(PublicKey),
    #[error("frozen data not found for hash: {0}")]
    FrozenNotFound(&'a str),
    #[error("no public hash set yet")]
    NoHash,
    #[error("not workspace admin")]
    NotAdmin,
    #[error("workspace not initialized")]
    WorkspaceNotInitialized,
    #[error("channel not found: {0}")]
    ChannelNotFound(&'a str),
    #[error("group not found: {0}")]
    GroupNotFound(&'a str),
    #[error("invalid input: {0}")]
    InvalidInput(&'a str),
}

// HELPER FUNCTIONS

fn encode_identity(identity: &[u8; 32]) -> String {
    bs58::encode(identity).into_string()
}

fn encode_blob_id_base58(blob_id_bytes: &[u8; BLOB_ID_SIZE]) -> String {
    let mut buf = [0u8; BASE58_ENCODED_MAX_SIZE];
    let len = bs58::encode(blob_id_bytes).onto(&mut buf[..]).unwrap();
    std::str::from_utf8(&buf[..len]).unwrap().to_owned()
}

fn parse_blob_id_base58(blob_id_str: &str) -> Result<[u8; BLOB_ID_SIZE], String> {
    match bs58::decode(blob_id_str).into_vec() {
        Ok(bytes) => {
            if bytes.len() != BLOB_ID_SIZE {
                return Err(format!(
                    "Invalid blob ID length: expected {} bytes, got {}",
                    BLOB_ID_SIZE,
                    bytes.len()
                ));
            }
            let mut blob_id = [0u8; BLOB_ID_SIZE];
            blob_id.copy_from_slice(&bytes);
            Ok(blob_id)
        }
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

// APPLICATION LOGIC

#[app::logic]
impl E2eKvStore {
    // INITIALIZATION

    #[app::init]
    pub fn init() -> E2eKvStore {
        app::log!("Initializing E2E KV Store");

        E2eKvStore {
            // KV
            kv_items: UnorderedMap::new(),
            // Handlers
            handler_counter: Counter::new(),
            // User Storage
            user_items_simple: UserStorage::new(),
            user_items_nested: UserStorage::new(),
            // Frozen Storage
            frozen_items: FrozenStorage::new(),
            // Private Game
            games: UnorderedMap::new(),
            // Blob Storage
            files: UnorderedMap::new(),
            file_counter: LwwRegister::new(0),
            file_owner: LwwRegister::new(String::new()),
            // Nested CRDTs
            crdt_counters: UnorderedMap::new(),
            crdt_pn_counters: UnorderedMap::new(),
            crdt_registers: UnorderedMap::new(),
            crdt_metadata: UnorderedMap::new(),
            crdt_metrics: Vector::new(),
            crdt_tags: UnorderedMap::new(),
            // RGA
            rga_document: ReplicatedGrowableArray::new(),
            rga_edit_count: GCounter::new(),
            rga_metadata: UnorderedMap::new(),
            // Workspace Manager
            ws_name: LwwRegister::new(String::new()),
            ws_admin: LwwRegister::new(String::new()),
            ws_channels: UnorderedMap::new(),
            ws_groups: UnorderedMap::new(),
            ws_member_roles: UnorderedMap::new(),
        }
    }

    // KV OPERATIONS

    /// Basic KV set without handlers
    pub fn set(&mut self, key: String, value: String) -> app::Result<()> {
        app::log!("Setting key: {:?} to value: {:?}", key, value);

        if self.kv_items.contains(&key)? {
            app::emit!(Event::Updated {
                key: &key,
                value: &value
            });
        } else {
            app::emit!(Event::Inserted {
                key: &key,
                value: &value
            });
        }

        self.kv_items.insert(key, value.into())?;
        Ok(())
    }

    /// KV set with handler triggers (for testing event-driven handlers)
    pub fn set_with_handler(&mut self, key: String, value: String) -> app::Result<()> {
        app::log!("Setting key with handler: {:?} to value: {:?}", key, value);

        if self.kv_items.contains(&key)? {
            app::emit!((
                Event::Updated {
                    key: &key,
                    value: &value
                },
                "update_handler"
            ));
        } else {
            app::emit!((
                Event::Inserted {
                    key: &key,
                    value: &value
                },
                "insert_handler"
            ));
        }

        self.kv_items.insert(key, value.into())?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> app::Result<Option<String>> {
        app::log!("Getting key: {:?}", key);
        Ok(self.kv_items.get(key)?.map(|v| v.get().clone()))
    }

    pub fn get_result(&self, key: &str) -> app::Result<String> {
        app::log!("Getting key, possibly failing: {:?}", key);
        let Some(value) = self.get(key)? else {
            app::bail!(Error::NotFound(key));
        };
        Ok(value)
    }

    pub fn entries(&self) -> app::Result<BTreeMap<String, String>> {
        app::log!("Getting all entries");
        Ok(self
            .kv_items
            .entries()?
            .map(|(k, v)| (k, v.get().clone()))
            .collect())
    }

    pub fn len(&self) -> app::Result<usize> {
        app::log!("Getting the number of entries");
        Ok(self.kv_items.len()?)
    }

    pub fn remove(&mut self, key: &str) -> app::Result<Option<String>> {
        app::log!("Removing key: {:?}", key);
        app::emit!(Event::Removed { key });
        Ok(self.kv_items.remove(key)?.map(|v| v.get().clone()))
    }

    pub fn clear(&mut self) -> app::Result<()> {
        app::log!("Clearing all entries");
        app::emit!(Event::Cleared);
        self.kv_items.clear().map_err(Into::into)
    }

    /// Remove with handler trigger (for testing event-driven handlers)
    pub fn remove_with_handler(&mut self, key: &str) -> app::Result<Option<String>> {
        app::log!("Removing key with handler: {:?}", key);
        app::emit!((Event::Removed { key }, "remove_handler"));
        Ok(self.kv_items.remove(key)?.map(|v| v.get().clone()))
    }

    /// Clear with handler trigger (for testing event-driven handlers)
    pub fn clear_with_handler(&mut self) -> app::Result<()> {
        app::log!("Clearing all entries with handler");
        app::emit!((Event::Cleared, "clear_handler"));
        self.kv_items.clear().map_err(Into::into)
    }

    // EVENT HANDLERS

    pub fn insert_handler(&mut self, key: &str, value: &str) -> app::Result<()> {
        app::log!(
            "Handler 'insert_handler' called: key={}, value={}",
            key,
            value
        );
        self.handler_counter.increment()?;
        Ok(())
    }

    pub fn update_handler(&mut self, key: &str, value: &str) -> app::Result<()> {
        app::log!(
            "Handler 'update_handler' called: key={}, value={}",
            key,
            value
        );
        self.handler_counter.increment()?;
        Ok(())
    }

    pub fn remove_handler(&mut self, key: &str) -> app::Result<()> {
        app::log!("Handler 'remove_handler' called: key={}", key);
        self.handler_counter.increment()?;
        Ok(())
    }

    pub fn clear_handler(&mut self) -> app::Result<()> {
        app::log!("Handler 'clear_handler' called: all items cleared");
        self.handler_counter.increment()?;
        Ok(())
    }

    pub fn get_handler_execution_count(&self) -> app::Result<u64> {
        Ok(self.handler_counter.value()?)
    }

    // USER STORAGE - SIMPLE

    pub fn set_user_simple(&mut self, value: String) -> app::Result<()> {
        let executor_id = env::executor_id();
        app::log!(
            "Setting simple value for user {:?}: {:?}",
            executor_id,
            value
        );
        app::emit!(Event::UserSimpleSet {
            executor_id: executor_id.into(),
            value: &value
        });
        self.user_items_simple.insert(value.into())?;
        Ok(())
    }

    pub fn get_user_simple(&self) -> app::Result<Option<String>> {
        let executor_id = env::executor_id();
        app::log!("Getting simple value for user {:?}", executor_id);
        Ok(self.user_items_simple.get()?.map(|v| v.get().clone()))
    }

    pub fn get_user_simple_for(&self, user_key: PublicKey) -> app::Result<Option<String>> {
        app::log!("Getting simple value for specific user {:?}", user_key);
        Ok(self
            .user_items_simple
            .get_for_user(&user_key)?
            .map(|v| v.get().clone()))
    }

    // USER STORAGE - NESTED

    pub fn set_user_nested(&mut self, key: String, value: String) -> app::Result<()> {
        let executor_id = env::executor_id();
        app::log!(
            "Setting nested key {:?} for user {:?}: {:?}",
            key,
            executor_id,
            value
        );

        let mut nested_map = self.user_items_nested.get()?.unwrap_or_default();
        nested_map.map.insert(key.clone(), value.clone().into())?;
        self.user_items_nested.insert(nested_map)?;

        app::emit!(Event::UserNestedSet {
            executor_id: executor_id.into(),
            key: &key,
            value: &value
        });
        Ok(())
    }

    pub fn get_user_nested(&self, key: &str) -> app::Result<Option<String>> {
        let executor_id = env::executor_id();
        app::log!("Getting nested key {:?} for user {:?}", key, executor_id);

        let nested_map = self.user_items_nested.get()?;
        match nested_map {
            Some(map) => Ok(map.map.get(key)?.map(|v| v.get().clone())),
            None => Ok(None),
        }
    }

    // FROZEN STORAGE

    pub fn add_frozen(&mut self, value: String) -> app::Result<String> {
        app::log!("Adding frozen value: {:?}", value);

        let hash = self.frozen_items.insert(value.clone())?;

        app::emit!(Event::FrozenAdded {
            hash,
            value: &value
        });

        let hash_hex = hex::encode(hash);
        Ok(hash_hex)
    }

    pub fn get_frozen(&self, hash_hex: String) -> app::Result<String> {
        app::log!("Getting frozen value for hash {:?}", hash_hex);
        let mut hash = [0u8; 32];
        hex::decode_to_slice(&hash_hex, &mut hash[..])
            .map_err(|_| Error::NotFound("dehex error"))?;

        Ok(self
            .frozen_items
            .get(&hash)?
            .ok_or(Error::FrozenNotFound("Frozen value is not found"))?)
    }

    // PRIVATE STORAGE

    pub fn add_secret(&mut self, game_id: String, secret: String) -> app::Result<()> {
        // Save private secret using private storage
        let mut secrets = PrivateSecrets::private_load_or_default()?;
        let mut secrets_mut = secrets.as_mut();
        secrets_mut
            .secrets
            .insert(game_id.clone(), secret.clone())?;

        // Save public hash for guess verification
        let hash = Sha256::digest(secret.as_bytes());
        let hash_hex = hex::encode(hash);
        self.games.insert(game_id.clone(), hash_hex.into())?;
        app::emit!(Event::SecretSet { game_id: &game_id });
        Ok(())
    }

    pub fn add_guess(&self, game_id: &str, guess: String) -> app::Result<bool> {
        let Some(public_hash_hex) = self.games.get(game_id)?.map(|v| v.get().clone()) else {
            app::bail!(Error::NoHash);
        };
        let guess_hash = Sha256::digest(guess.as_bytes());
        let guess_hash_hex = hex::encode(guess_hash);
        let who_b = env::executor_id();
        let who = bs58::encode(who_b).into_string();
        let success = guess_hash_hex == public_hash_hex;
        app::emit!(Event::Guessed {
            game_id,
            success,
            by: &who
        });
        Ok(success)
    }

    pub fn my_secrets(&self) -> app::Result<BTreeMap<String, String>> {
        let secrets = PrivateSecrets::private_load_or_default()?;
        let map: BTreeMap<_, _> = secrets.secrets.entries()?.collect();
        Ok(map)
    }

    pub fn games(&self) -> app::Result<BTreeMap<String, String>> {
        Ok(self
            .games
            .entries()?
            .map(|(k, v)| (k, v.get().clone()))
            .collect())
    }

    // BLOB API

    pub fn upload_file(
        &mut self,
        name: String,
        blob_id_str: String,
        size: u64,
        mime_type: String,
    ) -> Result<String, String> {
        let blob_id = parse_blob_id_base58(&blob_id_str)?;

        let current_counter = *self.file_counter.get();
        let file_id = format!("file_{}", current_counter);
        self.file_counter.set(current_counter + 1);

        let uploader_id = env::executor_id();
        let uploader = encode_blob_id_base58(&uploader_id);
        let timestamp = env::time_now();

        // Announce blob to network for peer discovery
        let current_context = env::context_id();
        if env::blob_announce_to_context(&blob_id, &current_context) {
            app::log!("Announced blob {} to network", blob_id_str);
        } else {
            app::log!("Warning: Failed to announce blob {}", blob_id_str);
        }

        let file_record = FileRecord {
            id: file_id.clone(),
            name: name.clone(),
            blob_id,
            size,
            mime_type,
            uploaded_by: uploader.clone(),
            uploaded_at: timestamp,
        };

        self.files
            .insert(file_id.clone(), file_record)
            .map_err(|e| format!("Failed to store file record: {e:?}"))?;

        app::emit!(Event::FileUploaded {
            id: file_id.clone(),
            name: name.clone(),
            size,
            uploader,
        });

        app::log!("File uploaded successfully: {} (ID: {})", name, file_id);
        Ok(file_id)
    }

    pub fn delete_file(&mut self, file_id: String) -> Result<(), String> {
        let file_record = self
            .files
            .get(&file_id)
            .map_err(|e| format!("Failed to access file: {e:?}"))?
            .ok_or_else(|| format!("File not found: {file_id}"))?;

        let file_name = file_record.name.clone();

        self.files
            .remove(&file_id)
            .map_err(|e| format!("Failed to delete file: {e:?}"))?;

        app::emit!(Event::FileDeleted {
            id: file_id.clone(),
            name: file_name.clone(),
        });

        app::log!("File deleted: {} (ID: {})", file_name, file_id);
        Ok(())
    }

    pub fn list_files(&self) -> Result<Vec<FileRecord>, String> {
        let mut files = Vec::new();
        if let Ok(entries) = self.files.entries() {
            for (_, file_record) in entries {
                files.push(file_record.clone());
            }
        }
        app::log!("Listed {} files", files.len());
        Ok(files)
    }

    pub fn get_file(&self, file_id: String) -> Result<FileRecord, String> {
        match self.files.get(&file_id) {
            Ok(Some(file_record)) => Ok(file_record.clone()),
            Ok(None) => Err(format!("File not found: {file_id}")),
            Err(e) => Err(format!("Failed to retrieve file: {e:?}")),
        }
    }

    pub fn get_blob_id_b58(&self, file_id: String) -> Result<String, String> {
        let file_record = self.get_file(file_id)?;
        Ok(encode_blob_id_base58(&file_record.blob_id))
    }

    pub fn search_files(&self, query: String) -> Result<Vec<FileRecord>, String> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        if let Ok(entries) = self.files.entries() {
            for (_, file_record) in entries {
                if file_record.name.to_lowercase().contains(&query_lower) {
                    results.push(file_record.clone());
                }
            }
        }

        app::log!("Search for '{}' found {} results", query, results.len());
        Ok(results)
    }

    // NESTED CRDT - COUNTERS

    // --- G-COUNTER (grow-only) ---

    pub fn increment_g_counter(&mut self, key: String) -> Result<u64, String> {
        let mut counter = self
            .crdt_counters
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .unwrap_or_else(GCounter::new);

        counter
            .increment()
            .map_err(|e| format!("Increment failed: {:?}", e))?;

        let value = counter
            .value()
            .map_err(|e| format!("Value failed: {:?}", e))?;

        drop(
            self.crdt_counters
                .insert(key.clone(), counter)
                .map_err(|e| format!("Insert failed: {:?}", e))?,
        );

        app::emit!(Event::GCounterIncremented { key, value });
        Ok(value)
    }

    pub fn get_g_counter(&self, key: String) -> Result<u64, String> {
        self.crdt_counters
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .map(|c| c.value().unwrap_or(0))
            .ok_or_else(|| "GCounter not found".to_owned())
    }

    // --- PN-COUNTER (supports increment AND decrement) ---

    pub fn increment_pn_counter(&mut self, key: String) -> Result<i64, String> {
        let mut counter = self
            .crdt_pn_counters
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .unwrap_or_else(PNCounter::new);

        counter
            .increment()
            .map_err(|e| format!("Increment failed: {:?}", e))?;

        let value = counter
            .value()
            .map_err(|e| format!("Value failed: {:?}", e))?;

        drop(
            self.crdt_pn_counters
                .insert(key.clone(), counter)
                .map_err(|e| format!("Insert failed: {:?}", e))?,
        );

        app::emit!(Event::PnCounterChanged {
            key,
            value,
            operation: "increment"
        });
        Ok(value)
    }

    pub fn decrement_pn_counter(&mut self, key: String) -> Result<i64, String> {
        let mut counter = self
            .crdt_pn_counters
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .unwrap_or_else(PNCounter::new);

        counter
            .decrement()
            .map_err(|e| format!("Decrement failed: {:?}", e))?;

        let value = counter
            .value()
            .map_err(|e| format!("Value failed: {:?}", e))?;

        drop(
            self.crdt_pn_counters
                .insert(key.clone(), counter)
                .map_err(|e| format!("Insert failed: {:?}", e))?,
        );

        app::emit!(Event::PnCounterChanged {
            key,
            value,
            operation: "decrement"
        });
        Ok(value)
    }

    pub fn get_pn_counter(&self, key: String) -> Result<i64, String> {
        self.crdt_pn_counters
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .map(|c| c.value().unwrap_or(0))
            .ok_or_else(|| "PNCounter not found".to_owned())
    }

    // Legacy alias for backward compatibility
    pub fn increment_counter(&mut self, key: String) -> Result<u64, String> {
        self.increment_g_counter(key)
    }

    pub fn get_counter(&self, key: String) -> Result<u64, String> {
        self.get_g_counter(key)
    }

    // NESTED CRDT - REGISTERS

    pub fn set_register(&mut self, key: String, value: String) -> Result<(), String> {
        let register = LwwRegister::new(value.clone());

        drop(
            self.crdt_registers
                .insert(key.clone(), register)
                .map_err(|e| format!("Insert failed: {:?}", e))?,
        );

        app::emit!(Event::RegisterSet { key, value });
        Ok(())
    }

    pub fn get_register(&self, key: String) -> Result<String, String> {
        self.crdt_registers
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .map(|r| r.get().clone())
            .ok_or_else(|| "Register not found".to_owned())
    }

    // NESTED CRDT - METADATA

    pub fn set_metadata(
        &mut self,
        outer_key: String,
        inner_key: String,
        value: String,
    ) -> Result<(), String> {
        let mut inner_map = self
            .crdt_metadata
            .get(&outer_key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .unwrap_or_else(UnorderedMap::new);

        drop(
            inner_map
                .insert(inner_key.clone(), value.clone().into())
                .map_err(|e| format!("Inner insert failed: {:?}", e))?,
        );

        drop(
            self.crdt_metadata
                .insert(outer_key.clone(), inner_map)
                .map_err(|e| format!("Outer insert failed: {:?}", e))?,
        );

        app::emit!(Event::MetadataSet {
            outer_key,
            inner_key,
            value,
        });
        Ok(())
    }

    pub fn get_metadata(&self, outer_key: String, inner_key: String) -> Result<String, String> {
        self.crdt_metadata
            .get(&outer_key)
            .map_err(|e| format!("Outer get failed: {:?}", e))?
            .ok_or_else(|| "Outer key not found".to_owned())?
            .get(&inner_key)
            .map_err(|e| format!("Inner get failed: {:?}", e))?
            .ok_or_else(|| "Inner key not found".to_owned())
            .map(|v| v.get().clone())
    }

    // NESTED CRDT - METRICS VECTOR

    pub fn push_metric(&mut self, value: u64) -> Result<usize, String> {
        let mut counter = GCounter::new();
        for _ in 0..value {
            counter
                .increment()
                .map_err(|e| format!("Increment failed: {:?}", e))?;
        }

        self.crdt_metrics
            .push(counter)
            .map_err(|e| format!("Push failed: {:?}", e))?;

        let len = self
            .crdt_metrics
            .len()
            .map_err(|e| format!("Len failed: {:?}", e))?;

        app::emit!(Event::MetricPushed { value });
        Ok(len)
    }

    pub fn get_metric(&self, index: usize) -> Result<u64, String> {
        self.crdt_metrics
            .get(index)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .ok_or_else(|| "Index out of bounds".to_owned())?
            .value()
            .map_err(|e| format!("Value failed: {:?}", e))
    }

    pub fn metrics_len(&self) -> Result<usize, String> {
        self.crdt_metrics
            .len()
            .map_err(|e| format!("Len failed: {:?}", e))
    }

    // NESTED CRDT - TAGS SET

    pub fn add_tag(&mut self, key: String, tag: String) -> Result<(), String> {
        let mut set = self
            .crdt_tags
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .unwrap_or_else(UnorderedSet::new);

        let _ = set
            .insert(tag.clone())
            .map_err(|e| format!("Insert failed: {:?}", e))?;

        drop(
            self.crdt_tags
                .insert(key.clone(), set)
                .map_err(|e| format!("Insert failed: {:?}", e))?,
        );

        app::emit!(Event::TagAdded { key, tag });
        Ok(())
    }

    pub fn has_tag(&self, key: String, tag: String) -> Result<bool, String> {
        self.crdt_tags
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .map(|set| set.contains(&tag).unwrap_or(false))
            .ok_or_else(|| "Key not found".to_owned())
    }

    pub fn get_tag_count(&self, key: String) -> Result<u64, String> {
        let count = self
            .crdt_tags
            .get(&key)
            .map_err(|e| format!("Get failed: {:?}", e))?
            .ok_or_else(|| "Key not found".to_owned())?
            .iter()
            .map_err(|e| format!("Iter failed: {:?}", e))?
            .count();

        Ok(count as u64)
    }

    // RGA DOCUMENT (from collaborative-editor)

    pub fn rga_insert_text(&mut self, position: usize, text: String) -> Result<(), String> {
        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);

        app::log!(
            "Inserting '{}' at position {} by {}",
            text,
            position,
            editor
        );

        self.rga_document
            .insert_str(position, &text)
            .map_err(|e| format!("Failed to insert text: {:?}", e))?;

        self.rga_edit_count
            .increment()
            .map_err(|e| format!("Failed to increment edit count: {:?}", e))?;

        app::emit!(Event::TextInserted {
            position,
            text: text.clone(),
            editor,
        });

        Ok(())
    }

    pub fn rga_delete_text(&mut self, start: usize, end: usize) -> Result<(), String> {
        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);

        app::log!("Deleting text from {} to {} by {}", start, end, editor);

        self.rga_document
            .delete_range(start, end)
            .map_err(|e| format!("Failed to delete text: {:?}", e))?;

        self.rga_edit_count
            .increment()
            .map_err(|e| format!("Failed to increment edit count: {:?}", e))?;

        app::emit!(Event::TextDeleted { start, end, editor });

        Ok(())
    }

    pub fn rga_get_text(&self) -> Result<String, String> {
        self.rga_document
            .get_text()
            .map_err(|e| format!("Failed to get text: {:?}", e))
    }

    pub fn rga_get_length(&self) -> Result<usize, String> {
        self.rga_document
            .len()
            .map_err(|e| format!("Failed to get length: {:?}", e))
    }

    pub fn rga_is_empty(&self) -> Result<bool, String> {
        self.rga_document
            .is_empty()
            .map_err(|e| format!("Failed to check if empty: {:?}", e))
    }

    pub fn rga_set_title(&mut self, new_title: String) -> Result<(), String> {
        if new_title.is_empty() {
            return Err("Title cannot be empty".to_string());
        }

        let editor_id = env::executor_id();
        let editor = encode_identity(&editor_id);

        let old_title = self.rga_get_title();

        self.rga_metadata
            .insert("title".to_string(), new_title.clone().into())
            .map_err(|e| format!("Failed to update title: {:?}", e))?;

        app::log!(
            "Title changed from '{}' to '{}' by {}",
            old_title,
            new_title,
            editor
        );

        app::emit!(Event::TitleChanged {
            old_title,
            new_title,
            editor,
        });

        Ok(())
    }

    pub fn rga_get_title(&self) -> String {
        self.rga_metadata
            .get("title")
            .ok()
            .flatten()
            .map(|v| v.get().clone())
            .unwrap_or_else(|| "Untitled Document".to_string())
    }

    pub fn rga_append_text(&mut self, text: String) -> Result<(), String> {
        let length = self.rga_get_length()?;
        self.rga_insert_text(length, text)
    }

    pub fn rga_clear(&mut self) -> Result<(), String> {
        let length = self.rga_get_length()?;
        if length > 0 {
            self.rga_delete_text(0, length)?;
        }
        Ok(())
    }

    // WORKSPACE MANAGER
    //
    // This context acts as the "namespace" root — one admin, multiple channels
    // (each channel is another context), and sub-groups. Members are tracked
    // at the app level with roles: "admin" | "member" | "read-only".

    /// Initialize the workspace. Can only be called once (admin must be empty).
    /// Caller becomes the admin.
    pub fn ws_init(&mut self, name: String) -> Result<(), String> {
        if !self.ws_admin.get().is_empty() {
            return Err("Workspace already initialized".into());
        }
        if name.is_empty() {
            return Err(Error::InvalidInput("name cannot be empty").to_string());
        }
        let admin = encode_identity(&env::executor_id());
        self.ws_name.set(name.clone());
        self.ws_admin.set(admin.clone());
        // Give admin the "admin" role in the member-role map too
        self.ws_member_roles
            .insert(admin.clone(), LwwRegister::new("admin".to_owned()))
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsInitialized {
            name: &name,
            admin: &admin,
        });
        app::log!("Workspace '{}' initialized by {}", name, admin);
        Ok(())
    }

    /// Return high-level workspace summary.
    pub fn ws_get_info(&self) -> Result<WorkspaceInfo, String> {
        if self.ws_admin.get().is_empty() {
            return Err(Error::WorkspaceNotInitialized.to_string());
        }
        let channel_count = self.ws_channels.len().map_err(|e| format!("{e:?}"))?;
        let group_count = self.ws_groups.len().map_err(|e| format!("{e:?}"))?;
        let member_count = self.ws_member_roles.len().map_err(|e| format!("{e:?}"))?;
        Ok(WorkspaceInfo {
            name: self.ws_name.get().clone(),
            admin: self.ws_admin.get().clone(),
            channel_count,
            group_count,
            member_count,
        })
    }

    /// Register a context as a named channel.
    pub fn ws_register_channel(
        &mut self,
        context_id: String,
        name: String,
        topic: String,
    ) -> Result<(), String> {
        self.require_admin()?;
        if context_id.is_empty() || name.is_empty() {
            return Err(Error::InvalidInput("context_id and name are required").to_string());
        }
        let record = ChannelRecord {
            context_id: context_id.clone(),
            name: name.clone(),
            topic,
            created_by: encode_identity(&env::executor_id()),
        };
        self.ws_channels
            .insert(context_id.clone(), LwwRegister::new(record))
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsChannelRegistered {
            context_id: &context_id,
            name: &name,
        });
        app::log!("Channel '{}' registered (context {})", name, context_id);
        Ok(())
    }

    /// Remove a channel from the registry.
    pub fn ws_unregister_channel(&mut self, context_id: String) -> Result<(), String> {
        self.require_admin()?;
        self.ws_channels
            .remove(&context_id)
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsChannelUnregistered {
            context_id: &context_id,
        });
        app::log!("Channel {} unregistered", context_id);
        Ok(())
    }

    /// List all registered channels.
    pub fn ws_list_channels(&self) -> Result<Vec<ChannelRecord>, String> {
        let mut channels = Vec::new();
        if let Ok(entries) = self.ws_channels.entries() {
            for (_, reg) in entries {
                channels.push(reg.get().clone());
            }
        }
        Ok(channels)
    }

    /// Register a sub-group (a Calimero group ID) under this workspace.
    pub fn ws_register_group(
        &mut self,
        group_id: String,
        name: String,
        description: String,
    ) -> Result<(), String> {
        self.require_admin()?;
        if group_id.is_empty() || name.is_empty() {
            return Err(Error::InvalidInput("group_id and name are required").to_string());
        }
        let record = WsGroupRecord {
            group_id: group_id.clone(),
            name: name.clone(),
            description,
            created_by: encode_identity(&env::executor_id()),
        };
        self.ws_groups
            .insert(group_id.clone(), LwwRegister::new(record))
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsGroupRegistered {
            group_id: &group_id,
            name: &name,
        });
        app::log!("Group '{}' registered ({})", name, group_id);
        Ok(())
    }

    /// Remove a group from the registry.
    pub fn ws_unregister_group(&mut self, group_id: String) -> Result<(), String> {
        self.require_admin()?;
        self.ws_groups
            .remove(&group_id)
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsGroupUnregistered {
            group_id: &group_id,
        });
        app::log!("Group {} unregistered", group_id);
        Ok(())
    }

    /// List all registered groups.
    pub fn ws_list_groups(&self) -> Result<Vec<WsGroupRecord>, String> {
        let mut groups = Vec::new();
        if let Ok(entries) = self.ws_groups.entries() {
            for (_, reg) in entries {
                groups.push(reg.get().clone());
            }
        }
        Ok(groups)
    }

    /// Set app-level role for a member identity.
    /// Admin can set any role; members can only be set by admin.
    pub fn ws_set_member_role(&mut self, identity: String, role: String) -> Result<(), String> {
        self.require_admin()?;
        let allowed = ["admin", "member", "read-only"];
        if !allowed.contains(&role.as_str()) {
            return Err(
                Error::InvalidInput("role must be admin, member, or read-only").to_string(),
            );
        }
        // Insert a new LwwRegister — LWW timestamp ensures the latest wins on merge
        self.ws_member_roles
            .insert(identity.clone(), LwwRegister::new(role.clone()))
            .map_err(|e| format!("{e:?}"))?;
        app::emit!(Event::WsMemberRoleSet {
            identity: &identity,
            role: &role,
        });
        Ok(())
    }

    /// Get role for a given identity.
    pub fn ws_get_member_role(&self, identity: String) -> Result<String, String> {
        self.ws_member_roles
            .get(&identity)
            .map_err(|e| format!("{e:?}"))?
            .map(|reg| reg.get().clone())
            .ok_or_else(|| format!("No role set for {identity}"))
    }

    /// Get your own role.
    pub fn ws_my_role(&self) -> Result<String, String> {
        let me = encode_identity(&env::executor_id());
        self.ws_get_member_role(me)
    }

    /// List all members with roles.
    pub fn ws_list_members(&self) -> Result<Vec<MemberRecord>, String> {
        let mut members = Vec::new();
        if let Ok(entries) = self.ws_member_roles.entries() {
            for (identity, reg) in entries {
                members.push(MemberRecord {
                    identity,
                    role: reg.get().clone(),
                });
            }
        }
        Ok(members)
    }

    /// Send a cross-context ping to a channel context.
    /// Fire-and-forget — the target context must implement ws_pong.
    pub fn ws_ping_channel(&mut self, target_context_id_b58: String) -> Result<(), String> {
        if self.ws_admin.get().is_empty() {
            return Err(Error::WorkspaceNotInitialized.to_string());
        }
        // Decode base58 → 32-byte context ID
        let bytes = bs58::decode(&target_context_id_b58)
            .into_vec()
            .map_err(|e| format!("Invalid context ID: {e}"))?;
        if bytes.len() != 32 {
            return Err("Context ID must be 32 bytes".into());
        }
        let mut ctx_id = [0u8; 32];
        ctx_id.copy_from_slice(&bytes);
        // xcall params: empty JSON object
        env::xcall(&ctx_id, "ws_pong", b"{}");
        app::emit!(Event::WsPingSent {
            to_context: &target_context_id_b58,
        });
        app::log!("Ping sent to context {}", target_context_id_b58);
        Ok(())
    }

    /// Called by another context's xcall — records the pong.
    pub fn ws_pong(&mut self) -> Result<(), String> {
        let from = encode_identity(&env::context_id());
        app::emit!(Event::WsPongReceived {
            from_context: &from,
        });
        app::log!("Pong received from context {}", from);
        Ok(())
    }
}

// WORKSPACE ADMIN HELPER (private)

impl E2eKvStore {
    fn require_admin(&self) -> Result<(), String> {
        let me = encode_identity(&env::executor_id());
        let admin = self.ws_admin.get();
        if admin.is_empty() {
            return Err(Error::WorkspaceNotInitialized.to_string());
        }
        if &me != admin {
            return Err(Error::NotAdmin.to_string());
        }
        Ok(())
    }
}
