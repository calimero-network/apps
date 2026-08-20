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
//! - **Sorted Collections**: `SortedMap`/`SortedSet` — key-ordered storage
//!   driven through the WASM host's ordered-index path (range seeks, `last`)
//! - **RGA Document**: ReplicatedGrowableArray for text editing
//! - **Authored Map**: Shared keyspace with per-entry ownership; any member inserts, only owner mutates
//! - **Shared Storage**: Group-writable single value with rotatable writer set
//! - **Workspace Registry**: An app-level directory of channels (contexts),
//!   groups and member roles, plus a cross-context `xcall` ping
//! - **Access Control**: Named roles projected onto per-account capability masks
//! - **Ownable**: Single-owner storage with authenticated ownership transfer
//!
//! Each feature area is organized into its own method group with clear prefixes.

#![allow(clippy::len_without_is_empty)]

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_sdk::{app, env, AccountId, ContextId};
use calimero_storage::collections::{
    AccessControl, AuthoredMap, AuthoredVector, Counter, FrozenStorage, GCounter, LwwRegister,
    Mergeable, Ownable, ReplicatedGrowableArray, SharedStorage, SortedMap, SortedSet, UnorderedMap,
    UnorderedSet, UserStorage, Vector,
};
use calimero_storage::entities::OpMask;
use sha2::{Digest, Sha256};
use thiserror::Error;

// CONSTANTS

const BLOB_ID_SIZE: usize = 32;
const BASE58_ENCODED_MAX_SIZE: usize = 44;

/// Workspace roles. Kept in lockstep with the frontend's `ROLES` in
/// `sections/ContextMembers.tsx` — the contract is the authority, and an
/// unknown role is rejected rather than stored.
const ROLE_ADMIN: &str = "admin";
const ROLE_MEMBER: &str = "member";
const ROLE_READ_ONLY: &str = "read-only";
const WS_ROLES: [&str; 3] = [ROLE_ADMIN, ROLE_MEMBER, ROLE_READ_ONLY];
/// The demo roles, and the capability each confers on `acl_doc`.
///
/// `AccessControl` does not enumerate role names — a role only exists as
/// `role\0member` keys in its registry — so the set of roles an app recognises
/// has to live in the app. Keeping it as a constant is also what lets
/// `acl_project` stay a zero-argument call: the projection needs every
/// (role, mask) pair at once, and a caller passing a partial list would silently
/// strip capabilities from the roles it omitted.
const ACL_ROLES: [(&str, OpMask); 2] = [
    ("editor", OpMask::WRITE),
    ("moderator", OpMask::WRITE.union(OpMask::DELETE)),
];

// HELPER TYPES

/// Nested map type for user storage.
#[derive(AbiType, Debug, BorshSerialize, BorshDeserialize, Default, Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
struct NestedMap {
    map: UnorderedMap<String, LwwRegister<String>>,
}

/// What `whoami` returns — see that method for why both halves exist.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Identity {
    /// This installation, base58.
    pub device_id: String,
    /// The person, 64 hex characters. The writer-set key.
    pub account_id: String,
}

/// File record for blob metadata. Atomic whole-record LWW by `uploaded_at`
/// (see `impl_atomic_lww_leaf!`); not a struct of CRDT fields, so no `Mergeable`
/// derive.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
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

calimero_storage::impl_atomic_lww_leaf!(FileRecord, uploaded_at);

/// A channel in the workspace directory: another Calimero **context**, made
/// discoverable by registering its id here.
///
/// `registered_at` exists for the same reason `FileRecord::uploaded_at` does —
/// `impl_atomic_lww_leaf!` needs a field to order concurrent writes by, and
/// this is a whole-record value, not a struct of independently mergeable CRDT
/// fields. Two members registering the same context id concurrently converge on
/// the later write rather than on a field-by-field mixture of the two.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ChannelRecord {
    /// The target context, base58. The map key as well as a field, so a
    /// listing needs no zip with its keys.
    pub context_id: String,
    pub name: String,
    pub topic: String,
    /// The ACCOUNT that registered it, 64 hex — see `caller_account`.
    pub created_by: String,
    pub registered_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(ChannelRecord, registered_at);

/// A group in the workspace directory — the app-level mirror of a node subgroup.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WsGroupRecord {
    pub group_id: String,
    pub name: String,
    pub description: String,
    pub created_by: String,
    pub registered_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(WsGroupRecord, registered_at);

/// A workspace member and the role the app grants them.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberRecord {
    /// Whatever the caller passed to `ws_set_member_role`. Free-form on
    /// purpose: see `ws_set_member_role` for why this is NOT an `AccountId`.
    pub identity: String,
    pub role: String,
}

/// Summary of the workspace, for the header card.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WorkspaceInfo {
    pub name: String,
    /// The ACCOUNT that ran `ws_init`, 64 hex.
    pub admin: String,
    pub channel_count: usize,
    pub group_count: usize,
    pub member_count: usize,
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

    // --- Access Control ---
    /// Named-role registry. Its backing writer set IS the admin tier, so
    /// "who may grant a role" and "who may rotate the admins" are the same
    /// authenticated question — there is no separate admin bookkeeping to drift.
    acl: AccessControl,
    /// Capability-guarded document. Its per-account `OpMask` map is PROJECTED
    /// from `acl`'s roles by `acl_project`; it is deliberately not a second
    /// source of truth, which is why nothing here writes the map directly.
    acl_doc: SharedStorage<LwwRegister<String>>,

    // --- Ownable ---
    /// Single-owner cell. `SharedStorage` above is a flat writer SET; this is
    /// the degenerate case with one writer plus a real transfer operation, and
    /// `Ownable` enforces the at-most-one invariant that `SharedStorage` does
    /// not.
    owned_doc: Ownable<LwwRegister<String>>,

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

    // --- Sorted Collections (key-ordered; range seeks, min/max) ---
    //
    // `UnorderedMap` above and `SortedMap` here are not two flavours of the same
    // thing: only the sorted pair maintains the WASM host's ORDERED INDEX
    // (`storage_index_set`), which is what makes a range seek or a `last()` a
    // seek rather than a full scan. Nothing else in this app exercises that
    // host path, so a regression in it would show up in no test here.
    /// Key-ordered map.
    sorted_items: SortedMap<String, LwwRegister<String>>,
    /// Element-ordered set — the `SortedSet` counterpart of `sorted_items`,
    /// through the same host index path.
    sorted_tags: SortedSet<String>,

    // --- RGA Document ---
    /// Collaborative text document
    rga_document: ReplicatedGrowableArray,
    /// Edit count for document (G-Counter)
    rga_edit_count: Counter,
    /// Document metadata (title, owner)
    rga_metadata: UnorderedMap<String, LwwRegister<String>>,

    // --- Authored Map ---
    /// Shared keyspace map with per-entry ownership
    authored_items: AuthoredMap<String, LwwRegister<String>>,

    // --- Authored Vector ---
    /// Append-only vector with per-slot ownership; only the pusher can update/tombstone their slot
    authored_vec: AuthoredVector<LwwRegister<String>>,

    // --- Shared Storage ---
    /// Group-writable single value; writers rotate at runtime
    shared_data: SharedStorage<LwwRegister<String>>,

    // --- Workspace Registry ---
    /// Workspace name. Empty is the "not initialized" sentinel — a workspace
    /// cannot be named "" (`ws_init` rejects it), so the two states never
    /// collide.
    ws_name: LwwRegister<String>,
    /// The account that ran `ws_init`, 64 hex. Empty until then.
    ws_admin: LwwRegister<String>,
    /// context_id -> channel. Keyed by the context id so a re-register of the
    /// same context updates rather than duplicates.
    ws_channels: UnorderedMap<String, ChannelRecord>,
    /// group_id -> group.
    ws_groups: UnorderedMap<String, WsGroupRecord>,
    /// identity -> role. `LwwRegister` (not a plain `String`) so two admins
    /// changing one member's role concurrently converge instead of one write
    /// being lost.
    ws_roles: UnorderedMap<String, LwwRegister<String>>,
    /// Pongs received via `xcall`. Grow-only: a pong is an event that happened,
    /// and no node can un-happen another node's.
    ws_pings: Counter,
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
        /// The ACCOUNT whose slot was written — `UserStorage` is keyed by
        /// account since rc.21, so a device id here would name a slot nobody
        /// can read back.
        account_id: AccountId,
        value: &'a str,
    },
    UserNestedSet {
        account_id: AccountId,
        key: &'a str,
        value: &'a str,
    },

    // Frozen Storage Events
    FrozenAdded {
        hash: [u8; 32],
        value: &'a str,
    },

    // Access Control Events
    AdminGranted {
        account: String,
        by: String,
    },
    AdminRevoked {
        account: String,
        by: String,
    },
    RoleGranted {
        role: String,
        account: String,
        by: String,
    },
    RoleRevoked {
        role: String,
        account: String,
        by: String,
    },
    /// The role registry was pushed onto `acl_doc`'s capability map. Separate
    /// from the grant events because it is a separate signed action — a grant
    /// that has not been projected yet confers nothing on the document.
    CapabilitiesProjected {
        accounts: usize,
    },

    // Ownable Events
    OwnershipTransferred {
        from: String,
        to: String,
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

    // Authored Map Events
    AuthoredInserted {
        key: String,
        value: String,
        owner: String,
    },
    AuthoredUpdated {
        key: String,
        value: String,
    },
    AuthoredRemoved {
        key: String,
    },

    // Authored Vector Events
    AuthoredVecPushed {
        index: usize,
        value: String,
        owner: String,
    },
    AuthoredVecUpdated {
        index: usize,
        value: String,
    },
    AuthoredVecRemoved {
        index: usize,
    },

    // Shared Storage Events
    SharedSet {
        value: String,
        by: String,
    },
    SharedWriterAdded {
        writer: String,
    },
    /// The writer set was REPLACED. Distinct from `SharedWriterAdded` on
    /// purpose: a rotation can drop writers, and a listener that only ever sees
    /// "added" events would build a set that never shrinks.
    SharedWritersRotated {
        writers: Vec<String>,
    },

    // Workspace Registry Events
    WorkspaceInitialized {
        name: String,
        admin: String,
    },
    ChannelRegistered {
        context_id: String,
        name: String,
        by: String,
    },
    ChannelUnregistered {
        context_id: String,
    },
    GroupRegistered {
        group_id: String,
        name: String,
        by: String,
    },
    GroupUnregistered {
        group_id: String,
    },
    MemberRoleSet {
        identity: String,
        role: String,
        by: String,
    },
    ChannelPinged {
        to_context: ContextId,
        by: String,
    },
    PongReceived {
        from_context: ContextId,
        count: u64,
    },
}

// ERRORS

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum Error<'a> {
    #[error("key not found: {0}")]
    NotFound(&'a str),
    #[error("user data not found for account: {0}")]
    UserNotFound(AccountId),
    #[error("frozen data not found for hash: {0}")]
    FrozenNotFound(&'a str),
    #[error("no public hash set yet")]
    NoHash,
}

// HELPER FUNCTIONS

/// The caller's ACCOUNT as 64 hex characters.
///
/// Every "who did this" field in this contract is an account, because that is
/// the only authorization subject core 0.11 recognises and the only thing the
/// storage layer reports back (`owner_of`, `writers()`). Rendering is hex, not
/// base58 — core writes ids as hex precisely so an id is never mistaken for a
/// key, and a base58 value here would never compare equal to what a query
/// returns.
fn caller_account() -> String {
    AccountId::from(env::account_id()).to_string()
}

/// Parse a 64-hex account id, with a message that says which of the two id
/// kinds was expected.
///
/// Every authorization subject in this contract is an ACCOUNT. Passing a base58
/// DEVICE key here is the recurring mistake, and it has to fail loudly — as a
/// `String` argument it would otherwise be stored as an account nobody holds.
fn parse_account(account_hex: &str) -> app::Result<AccountId> {
    account_hex
        .parse()
        .map_err(|e| app::err!("not an account id (expected 64 hex chars): {e}"))
}

/// A capability mask as the operation names a client can display.
fn describe_mask(mask: OpMask) -> Vec<String> {
    let mut ops = Vec::new();
    for (bit, name) in [
        (OpMask::WRITE, "write"),
        (OpMask::DELETE, "delete"),
        (OpMask::ADMIN, "admin"),
    ] {
        if mask.contains(bit) {
            ops.push(name.to_owned());
        }
    }
    ops
}

/// Reject a role this app does not define.
///
/// `AccessControl` accepts any name, so without this a typo becomes a real role
/// with one member that `acl_project` never projects — a grant that looks
/// applied and confers nothing.
fn check_known_role(role: &str) -> app::Result<()> {
    if !ACL_ROLES.iter().any(|(known, _)| *known == role) {
        app::bail!(
            "unknown role '{role}' (this app defines: {})",
            ACL_ROLES
                .iter()
                .map(|(r, _)| *r)
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(())
}

fn encode_blob_id_base58(blob_id_bytes: &[u8; BLOB_ID_SIZE]) -> String {
    let mut buf = [0u8; BASE58_ENCODED_MAX_SIZE];
    // Both unwraps are infallible for this input: a 32-byte value base58-encodes
    // to at most 44 chars (== BASE58_ENCODED_MAX_SIZE), so `onto` never overflows
    // the buffer, and the base58 alphabet is ASCII, so the bytes are always UTF-8.
    let len = bs58::encode(blob_id_bytes).onto(&mut buf[..]).unwrap();
    std::str::from_utf8(&buf[..len]).unwrap().to_owned()
}

fn parse_blob_id_base58(blob_id_str: &str) -> app::Result<[u8; BLOB_ID_SIZE]> {
    let bytes = bs58::decode(blob_id_str)
        .into_vec()
        .map_err(|e| app::err!("Failed to decode blob ID '{blob_id_str}': {e}"))?;

    if bytes.len() != BLOB_ID_SIZE {
        app::bail!(
            "Invalid blob ID length: expected {} bytes, got {}",
            BLOB_ID_SIZE,
            bytes.len()
        );
    }

    let mut blob_id = [0u8; BLOB_ID_SIZE];
    blob_id.copy_from_slice(&bytes);
    Ok(blob_id)
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
            // Access Control — the init caller is the sole initial admin.
            //
            // ⚠️ Sole, and that is not a simplification: seeding two admins here
            // would need both account ids to be known to whoever runs `init`,
            // and every node deriving the SAME set, which nothing in `init`
            // guarantees. The second admin arrives through `acl_grant_admin`,
            // which is an authenticated rotation. This is the gap that blocks
            // migrations needing a pre-seeded multi-admin state.
            acl: AccessControl::new_admin_caller(),
            acl_doc: SharedStorage::new(
                std::iter::once(AccountId::from(env::account_id())).collect(),
                false,
            ),
            // Ownable — `new_owned_by_caller` exists here and NOT on
            // `SharedStorage`, so the owner case is spelled once rather than
            // hand-rolled as a one-element writer set.
            owned_doc: Ownable::new_owned_by_caller(),
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
            // Sorted Collections
            sorted_items: SortedMap::new(),
            sorted_tags: SortedSet::new(),
            // RGA
            rga_document: ReplicatedGrowableArray::new(),
            rga_edit_count: GCounter::new(),
            rga_metadata: UnorderedMap::new(),
            // Authored Map
            authored_items: AuthoredMap::new(),
            // Authored Vector
            authored_vec: AuthoredVector::<LwwRegister<String>>::new(),
            // Shared Storage — the init caller's ACCOUNT becomes the sole
            // initial writer. `account_id()`, not `device_id()`: core 0.11 keys
            // the writer set by account. Both are `[u8; 32]` and `AccountId`
            // is `From<[u8; 32]>`, so seeding it with the device key still
            // compiles — it just stores an account id that no caller can ever
            // present, locking the cell against everyone including its creator.
            shared_data: SharedStorage::new(
                std::iter::once(AccountId::from(env::account_id())).collect(),
                false,
            ),
            // Workspace Registry — deliberately NOT seeded with the deployer as
            // admin. `init` runs once per context, and the workspace is claimed
            // later by whoever calls `ws_init`; seeding it here would make the
            // context creator the permanent admin of a workspace that may not
            // exist yet.
            ws_name: LwwRegister::new(String::new()),
            ws_admin: LwwRegister::new(String::new()),
            ws_channels: UnorderedMap::new(),
            ws_groups: UnorderedMap::new(),
            ws_roles: UnorderedMap::new(),
            ws_pings: Counter::new(),
        }
    }

    // IDENTITY

    /// Both halves of the caller's identity, as the rest of this API spells
    /// them.
    ///
    /// core 0.11 split one `executor_id` into two things, and app code has to
    /// know which one it is holding:
    ///
    /// * `device_id` — this installation. The CRDT replica id, and what the
    ///   node's group-membership listing calls `identity`. Base58, like
    ///   everywhere else a key appears.
    /// * `account_id` — the person. The only authorization subject: the
    ///   `shared_*` writer set is keyed by it. 64 hex characters.
    ///
    /// Nothing on the wire maps one to the other, so a writer-set grant cannot
    /// be built from a membership listing alone — the account holder has to
    /// hand over the value this method returns.
    pub fn whoami(&self) -> Identity {
        Identity {
            device_id: bs58::encode(env::device_id()).into_string(),
            account_id: AccountId::from(env::account_id()).to_string(),
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
        let account = AccountId::from(env::account_id());
        app::log!("Setting simple value for user {:?}: {:?}", account, value);
        app::emit!(Event::UserSimpleSet {
            account_id: account,
            value: &value
        });
        self.user_items_simple.insert(value.into())?;
        Ok(())
    }

    pub fn get_user_simple(&self) -> app::Result<Option<String>> {
        app::log!(
            "Getting simple value for user {:?}",
            AccountId::from(env::account_id())
        );
        Ok(self.user_items_simple.get()?.map(|v| v.get().clone()))
    }

    /// Read another user's slot of `UserStorage`, addressed by ACCOUNT.
    ///
    /// Takes 64-hex, not the base58 device key: rc.21 rekeyed `UserStorage`
    /// from `UnorderedMap<PublicKey, T>` to `UnorderedMap<AccountId, T>`, so a
    /// device key now names a slot nobody writes to and this would answer
    /// `None` forever rather than failing. Get the value from `whoami`, the
    /// same way `shared_add_writer` does.
    pub fn get_user_simple_for(&self, account_hex: String) -> app::Result<Option<String>> {
        let account: AccountId = account_hex
            .parse()
            .map_err(|e| app::err!("not an account id (expected 64 hex chars): {e}"))?;
        app::log!("Getting simple value for specific user {:?}", account);
        Ok(self
            .user_items_simple
            .get_for_user(&account)?
            .map(|v| v.get().clone()))
    }

    // USER STORAGE - NESTED

    pub fn set_user_nested(&mut self, key: String, value: String) -> app::Result<()> {
        let account = AccountId::from(env::account_id());
        app::log!(
            "Setting nested key {:?} for user {:?}: {:?}",
            key,
            account,
            value
        );

        let mut nested_map = self.user_items_nested.get()?.unwrap_or_default();
        nested_map.map.insert(key.clone(), value.clone().into())?;
        self.user_items_nested.insert(nested_map)?;

        app::emit!(Event::UserNestedSet {
            account_id: account,
            key: &key,
            value: &value
        });
        Ok(())
    }

    pub fn get_user_nested(&self, key: &str) -> app::Result<Option<String>> {
        app::log!(
            "Getting nested key {:?} for user {:?}",
            key,
            AccountId::from(env::account_id())
        );

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

    // ACCESS CONTROL
    //
    // Two layers that look alike and are not:
    //
    //   * `acl` is a REGISTRY of named roles. Granting a role writes an entry;
    //     it confers nothing by itself.
    //   * `acl_doc`'s capability map is what the merge check actually reads. It
    //     is PROJECTED from the registry by `acl_project`, as a separate signed
    //     action.
    //
    // So a grant is only in force once it has been projected. That is not a
    // security hole — merge always enforces whatever the map currently says, so
    // the window is "not yet permitted", never "wrongly permitted" — but it is
    // the thing to check first when a grant appears not to work.
    //
    // Admins are exactly the writer set of the registry's backing storage, so
    // "who may grant" needs no separate bookkeeping and cannot drift out of sync
    // with itself.

    /// Whether `account_hex` is an admin.
    pub fn acl_is_admin(&self, account_hex: String) -> app::Result<bool> {
        Ok(self.acl.is_admin(&parse_account(&account_hex)?))
    }

    /// Every admin, as 64-hex account ids.
    pub fn acl_admins(&self) -> app::Result<Vec<String>> {
        Ok(self.acl.admins().iter().map(ToString::to_string).collect())
    }

    /// Add an admin. Admin-only, and enforced at merge as a writer-set rotation
    /// rather than by the fail-fast guard alone.
    pub fn acl_grant_admin(&mut self, account_hex: String) -> app::Result<()> {
        let account = parse_account(&account_hex)?;
        self.acl.grant_admin(account)?;
        app::emit!(Event::AdminGranted {
            account: account_hex,
            by: caller_account(),
        });

        // ⚠️ Projecting here is not a convenience, it closes a chicken-and-egg.
        //
        // Admin-ness lives on the REGISTRY. `acl_project` writes the guarded
        // DOCUMENT, and `set_capabilities` guards `Op::Admin` against that
        // document's own capability map. A newly granted admin is not in that
        // map yet, so it cannot run the projection that would put it there:
        // `Action not allowed: Executor is not authorised for this operation`.
        // Somebody who already holds the mask has to project first, and the only
        // caller guaranteed to hold it is the one making the grant — right here.
        //
        // Role grants deliberately do NOT self-project: "a grant confers nothing
        // until it is projected" is a real property worth seeing. Admin grants
        // are the one case where leaving it unprojected has no upside and locks
        // the new admin out.
        let _accounts = self.acl_project()?;
        Ok(())
    }

    /// Remove an admin.
    ///
    /// Removing yourself is permitted and is not reversible from your side —
    /// there is no separate owner above this tier to appeal to. Emptying the set
    /// entirely would leave the registry unwritable forever, so that is refused.
    pub fn acl_revoke_admin(&mut self, account_hex: String) -> app::Result<()> {
        let account = parse_account(&account_hex)?;
        if self.acl.admins().len() <= 1 && self.acl.is_admin(&account) {
            app::bail!("refusing to revoke the last admin — the registry would be frozen");
        }
        self.acl.revoke_admin(&account)?;
        app::emit!(Event::AdminRevoked {
            account: account_hex,
            by: caller_account(),
        });

        // Symmetrically: a revoked admin has to lose `FULL` on the document too,
        // or the grant is revoked in name only. The caller still holds the mask
        // at this point — `set_capabilities` guards against the PRE-rotation map
        // — so this succeeds even when revoking yourself, and the resulting map
        // correctly excludes you.
        let _accounts = self.acl_project()?;
        Ok(())
    }

    /// The roles this app recognises, and the capability each confers.
    ///
    /// `AccessControl` stores a role only as `role\0member` keys, so it cannot
    /// enumerate role names — the list is app state, and this method is how a
    /// client learns it instead of hard-coding it.
    pub fn acl_roles(&self) -> app::Result<BTreeMap<String, Vec<String>>> {
        Ok(ACL_ROLES
            .iter()
            .map(|(role, mask)| ((*role).to_owned(), describe_mask(*mask)))
            .collect())
    }

    pub fn acl_grant(&mut self, role: String, account_hex: String) -> app::Result<()> {
        let account = parse_account(&account_hex)?;
        check_known_role(&role)?;
        self.acl.grant(&role, account)?;
        app::emit!(Event::RoleGranted {
            role,
            account: account_hex,
            by: caller_account(),
        });
        Ok(())
    }

    /// Revoke a role.
    ///
    /// A revoke stores `false` rather than deleting the entry, so membership
    /// stays a plain last-writer-wins boolean with no tombstone — which is why
    /// re-granting after a revoke converges, unlike the set-tombstone case.
    pub fn acl_revoke(&mut self, role: String, account_hex: String) -> app::Result<()> {
        let account = parse_account(&account_hex)?;
        check_known_role(&role)?;
        self.acl.revoke(&role, &account)?;
        app::emit!(Event::RoleRevoked {
            role,
            account: account_hex,
            by: caller_account(),
        });
        Ok(())
    }

    pub fn acl_has_role(&self, role: String, account_hex: String) -> app::Result<bool> {
        Ok(self.acl.has_role(&role, &parse_account(&account_hex)?)?)
    }

    pub fn acl_members_of(&self, role: String) -> app::Result<Vec<String>> {
        Ok(self
            .acl
            .members_of(&role)?
            .iter()
            .map(ToString::to_string)
            .collect())
    }

    /// The CALLER's roles, resolved by account.
    pub fn acl_my_roles(&self) -> app::Result<Vec<String>> {
        let me = AccountId::from(env::account_id());
        let mut mine = Vec::new();
        for (role, _) in &ACL_ROLES {
            if self.acl.has_role(role, &me)? {
                mine.push((*role).to_owned());
            }
        }
        Ok(mine)
    }

    /// Push the role registry onto `acl_doc`'s capability map.
    ///
    /// Must be re-run after ANY grant, revoke, or admin change: the registry
    /// write and this projection are separate signed actions, and only the map
    /// is consulted at merge. Admins are always given `FULL` by `project_onto`
    /// so a projection can never lock them out of the document they administer.
    pub fn acl_project(&mut self) -> app::Result<usize> {
        // ⚠️ The count is computed from the REGISTRY, not read back from
        // `acl_doc.capabilities()` after the rotation.
        //
        // Reading it back in the same execution does not reflect the rotation:
        // projecting {n1} -> {n1, n2} answered 2, and then projecting
        // {n1, n2} -> {n1} answered 2 again. Both are what you get if the
        // in-execution read unions the staged set with the persisted one instead
        // of replacing it. A separate later call reads the correct set — the e2e
        // asserts exactly that — so this is a same-execution visibility rule, not
        // a lost write.
        //
        // Counting the registry sidesteps it and cannot drift from what
        // `project_onto` does, because it walks the same two inputs: the members
        // of each role, plus the admins (whom `project_onto` always grants
        // `FULL`).
        let mut covered: BTreeSet<AccountId> = BTreeSet::new();
        for (role, _) in &ACL_ROLES {
            covered.extend(self.acl.members_of(role)?);
        }
        covered.extend(self.acl.admins());

        let masks: Vec<(&str, OpMask)> = ACL_ROLES.to_vec();
        self.acl.project_onto(&masks, &mut self.acl_doc)?;

        let accounts = covered.len();
        app::emit!(Event::CapabilitiesProjected { accounts });
        Ok(accounts)
    }

    /// The projected map: account -> the operations it may perform on `acl_doc`.
    ///
    /// This, not `acl_members_of`, is what a merge check reads. Comparing the
    /// two is how you see an un-projected grant.
    pub fn acl_capabilities(&self) -> app::Result<BTreeMap<String, Vec<String>>> {
        Ok(self
            .acl_doc
            .capabilities()
            .into_iter()
            .map(|(account, mask)| (account.to_string(), describe_mask(mask)))
            .collect())
    }

    /// Write the guarded document. Requires `WRITE` in the PROJECTED map.
    pub fn acl_doc_set(&mut self, value: String) -> app::Result<()> {
        self.acl_doc.insert(LwwRegister::new(value))?;
        Ok(())
    }

    pub fn acl_doc_get(&self) -> app::Result<String> {
        Ok(self.acl_doc.get()?.get().clone())
    }

    // OWNABLE

    /// The owner, or `None`.
    ///
    /// `Ownable` holds at most one writer by construction. A malformed
    /// multi-writer cell answers `None` rather than picking one, so this can
    /// never report a non-deterministic owner.
    pub fn owned_owner(&self) -> app::Result<Option<String>> {
        Ok(self.owned_doc.owner().map(|o| o.to_string()))
    }

    pub fn owned_is_owner(&self, account_hex: String) -> app::Result<bool> {
        Ok(self.owned_doc.is_owner(&parse_account(&account_hex)?))
    }

    pub fn owned_set(&mut self, value: String) -> app::Result<()> {
        self.owned_doc.insert(LwwRegister::new(value))?;
        Ok(())
    }

    pub fn owned_get(&self) -> app::Result<String> {
        Ok(self.owned_doc.get()?.get().clone())
    }

    /// Hand ownership to `account_hex`. Owner-only, and one-way: the previous
    /// owner is no longer a writer once this lands, so there is no undo.
    pub fn owned_transfer(&mut self, account_hex: String) -> app::Result<()> {
        let from = self
            .owned_doc
            .owner()
            .map_or_else(String::new, |o| o.to_string());
        self.owned_doc
            .transfer_ownership(parse_account(&account_hex)?)?;
        app::emit!(Event::OwnershipTransferred {
            from,
            to: account_hex,
        });
        Ok(())
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
        let who = caller_account();
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
    ) -> app::Result<String> {
        let blob_id = parse_blob_id_base58(&blob_id_str)?;

        let current_counter = *self.file_counter.get();
        let file_id = format!("file_{current_counter}");
        self.file_counter.set(current_counter + 1);

        let uploader = caller_account();
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

        self.files.insert(file_id.clone(), file_record)?;

        app::emit!(Event::FileUploaded {
            id: file_id.clone(),
            name: name.clone(),
            size,
            uploader,
        });

        app::log!("File uploaded successfully: {} (ID: {})", name, file_id);
        Ok(file_id)
    }

    pub fn delete_file(&mut self, file_id: String) -> app::Result<()> {
        let file_record = self
            .files
            .get(&file_id)?
            .ok_or_else(|| app::err!("File not found: {file_id}"))?;

        let file_name = file_record.name.clone();

        self.files.remove(&file_id)?;

        app::emit!(Event::FileDeleted {
            id: file_id.clone(),
            name: file_name.clone(),
        });

        app::log!("File deleted: {} (ID: {})", file_name, file_id);
        Ok(())
    }

    pub fn list_files(&self) -> app::Result<Vec<FileRecord>> {
        let mut files = Vec::new();
        for (_, file_record) in self.files.entries()? {
            files.push(file_record.clone());
        }
        app::log!("Listed {} files", files.len());
        Ok(files)
    }

    pub fn get_file(&self, file_id: String) -> app::Result<FileRecord> {
        let Some(file_record) = self.files.get(&file_id)? else {
            app::bail!("File not found: {file_id}");
        };

        Ok(file_record.clone())
    }

    pub fn get_blob_id_b58(&self, file_id: String) -> app::Result<String> {
        let file_record = self.get_file(file_id)?;
        Ok(encode_blob_id_base58(&file_record.blob_id))
    }

    pub fn search_files(&self, query: String) -> app::Result<Vec<FileRecord>> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        for (_, file_record) in self.files.entries()? {
            if file_record.name.to_lowercase().contains(&query_lower) {
                results.push(file_record.clone());
            }
        }

        app::log!("Search for '{}' found {} results", query, results.len());
        Ok(results)
    }

    // NESTED CRDT - COUNTERS

    // --- G-COUNTER (grow-only) ---

    pub fn increment_g_counter(&mut self, key: String) -> app::Result<u64> {
        let mut counter = self.crdt_counters.entry(key.clone())?.or_default()?;

        counter.increment()?;

        let value = counter.value()?;

        app::emit!(Event::GCounterIncremented { key, value });
        Ok(value)
    }

    pub fn get_g_counter(&self, key: String) -> app::Result<u64> {
        let Some(counter) = self.crdt_counters.get(&key)? else {
            app::bail!("GCounter not found");
        };

        Ok(counter.value()?)
    }

    // --- PN-COUNTER (supports increment AND decrement) ---

    pub fn increment_pn_counter(&mut self, key: String) -> app::Result<i64> {
        let mut counter = self.crdt_pn_counters.entry(key.clone())?.or_default()?;

        counter.increment()?;

        let value = counter.value()?;

        app::emit!(Event::PnCounterChanged {
            key,
            value,
            operation: "increment"
        });
        Ok(value)
    }

    pub fn decrement_pn_counter(&mut self, key: String) -> app::Result<i64> {
        let mut counter = self.crdt_pn_counters.entry(key.clone())?.or_default()?;

        counter.decrement()?;

        let value = counter.value()?;

        app::emit!(Event::PnCounterChanged {
            key,
            value,
            operation: "decrement"
        });
        Ok(value)
    }

    pub fn get_pn_counter(&self, key: String) -> app::Result<i64> {
        let Some(counter) = self.crdt_pn_counters.get(&key)? else {
            app::bail!("PNCounter not found");
        };

        Ok(counter.value()?)
    }

    // Legacy alias for backward compatibility
    pub fn increment_counter(&mut self, key: String) -> app::Result<u64> {
        self.increment_g_counter(key)
    }

    pub fn get_counter(&self, key: String) -> app::Result<u64> {
        self.get_g_counter(key)
    }

    // NESTED CRDT - REGISTERS

    pub fn set_register(&mut self, key: String, value: String) -> app::Result<()> {
        let register = LwwRegister::new(value.clone());

        self.crdt_registers.insert(key.clone(), register)?;

        app::emit!(Event::RegisterSet { key, value });
        Ok(())
    }

    pub fn get_register(&self, key: String) -> app::Result<String> {
        self.crdt_registers
            .get(&key)?
            .map(|r| r.get().clone())
            .ok_or_else(|| app::err!("Register not found"))
    }

    // NESTED CRDT - METADATA

    pub fn set_metadata(
        &mut self,
        outer_key: String,
        inner_key: String,
        value: String,
    ) -> app::Result<()> {
        let mut inner_map = self.crdt_metadata.entry(outer_key.clone())?.or_default()?;

        inner_map.insert(inner_key.clone(), value.clone().into())?;

        app::emit!(Event::MetadataSet {
            outer_key,
            inner_key,
            value,
        });
        Ok(())
    }

    pub fn get_metadata(&self, outer_key: String, inner_key: String) -> app::Result<String> {
        self.crdt_metadata
            .get(&outer_key)?
            .ok_or_else(|| app::err!("Outer key not found"))?
            .get(&inner_key)?
            .ok_or_else(|| app::err!("Inner key not found"))
            .map(|v| v.get().clone())
    }

    // NESTED CRDT - METRICS VECTOR

    pub fn push_metric(&mut self, value: u64) -> app::Result<usize> {
        let mut counter = GCounter::new();
        for _ in 0..value {
            counter.increment()?;
        }

        self.crdt_metrics.push(counter)?;

        let len = self.crdt_metrics.len()?;

        app::emit!(Event::MetricPushed { value });
        Ok(len)
    }

    pub fn get_metric(&self, index: usize) -> app::Result<u64> {
        self.crdt_metrics
            .get(index)?
            .ok_or_else(|| app::err!("Index out of bounds"))?
            .value()
            .map_err(Into::into)
    }

    pub fn metrics_len(&self) -> app::Result<usize> {
        self.crdt_metrics.len().map_err(Into::into)
    }

    // NESTED CRDT - TAGS SET

    pub fn add_tag(&mut self, key: String, tag: String) -> app::Result<()> {
        let mut set = self.crdt_tags.entry(key.clone())?.or_default()?;

        set.insert(tag.clone())?;

        app::emit!(Event::TagAdded { key, tag });
        Ok(())
    }

    pub fn has_tag(&self, key: String, tag: String) -> app::Result<bool> {
        let Some(set) = self.crdt_tags.get(&key)? else {
            app::bail!("Key not found");
        };

        Ok(set.contains(&tag)?)
    }

    pub fn get_tag_count(&self, key: String) -> app::Result<u64> {
        let count = self
            .crdt_tags
            .get(&key)?
            .ok_or_else(|| app::err!("Key not found"))?
            .iter()?
            .count();

        Ok(count as u64)
    }

    // SORTED COLLECTIONS
    //
    // The unordered collections above are enough for "store this and read it
    // back". These are what a client needs to PAGE: keys in ascending order, a
    // half-open range seek, and the largest key without reading the rest. They
    // are also the only methods in this app that drive the WASM host's ordered
    // index — `sorted_set` maintains it via `storage_index_set`, and
    // `sorted_keys`/`sorted_range` read it back via `storage_index_scan` — so
    // they are load-bearing coverage, not a second way to do a map.
    //
    // Ported from core's `apps/scaffolding-e2e`, which had grown these while
    // this repo had not.

    // --- SortedMap (key-ordered) ---

    pub fn sorted_set(&mut self, key: String, value: String) -> app::Result<()> {
        self.sorted_items.insert(key, LwwRegister::new(value))?;
        Ok(())
    }

    pub fn sorted_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.sorted_items.get(&key)?.map(|v| v.get().clone()))
    }

    /// All keys in ascending order (index-backed).
    pub fn sorted_keys(&self) -> app::Result<Vec<String>> {
        Ok(self.sorted_items.keys()?.collect())
    }

    /// Entries whose keys fall in `[start, end)`, ascending. Half-open, like
    /// every Rust range — `end` is NOT returned.
    pub fn sorted_range(
        &self,
        start: String,
        end: String,
    ) -> app::Result<BTreeMap<String, String>> {
        Ok(self
            .sorted_items
            .range(start..end)?
            .map(|(k, v)| (k, v.get().clone()))
            .collect())
    }

    /// The largest key (a reverse seek, not a scan).
    pub fn sorted_last_key(&self) -> app::Result<Option<String>> {
        Ok(self.sorted_items.last()?.map(|(k, _)| k))
    }

    pub fn sorted_remove(&mut self, key: String) -> app::Result<bool> {
        Ok(self.sorted_items.remove(&key)?.is_some())
    }

    pub fn sorted_len(&self) -> app::Result<usize> {
        self.sorted_items.len().map_err(Into::into)
    }

    // --- SortedSet (element-ordered) ---

    /// Insert `tag`; `true` if it was newly added.
    pub fn sorted_tag_add(&mut self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.insert(tag)?)
    }

    /// Remove `tag`; `true` if it was present.
    ///
    /// ⚠️ `UnorderedSet` used to never converge on insert-after-remove; that was
    /// fixed in rc.10, and the sorted variant shares the tombstone machinery.
    /// The e2e re-adds a removed tag for exactly that reason.
    pub fn sorted_tag_remove(&mut self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.remove(&tag)?)
    }

    pub fn sorted_tag_contains(&self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.contains(&tag)?)
    }

    /// All elements in ascending order (index-backed).
    pub fn sorted_tags_all(&self) -> app::Result<Vec<String>> {
        Ok(self.sorted_tags.iter()?.collect())
    }

    /// Elements in `[start, end)`, ascending.
    pub fn sorted_tags_range(&self, start: String, end: String) -> app::Result<Vec<String>> {
        Ok(self.sorted_tags.range(start..end)?.collect())
    }

    /// The largest element (a reverse seek).
    pub fn sorted_tags_last(&self) -> app::Result<Option<String>> {
        self.sorted_tags.last().map_err(Into::into)
    }

    // RGA DOCUMENT (from collaborative-editor)

    pub fn rga_insert_text(&mut self, position: usize, text: String) -> app::Result<()> {
        let editor = caller_account();

        app::log!(
            "Inserting '{}' at position {} by {}",
            text,
            position,
            editor
        );

        self.rga_document.insert_str(position, &text)?;

        self.rga_edit_count.increment()?;

        app::emit!(Event::TextInserted {
            position,
            text: text.clone(),
            editor,
        });

        Ok(())
    }

    pub fn rga_delete_text(&mut self, start: usize, end: usize) -> app::Result<()> {
        let editor = caller_account();

        app::log!("Deleting text from {} to {} by {}", start, end, editor);

        self.rga_document.delete_range(start, end)?;

        self.rga_edit_count.increment()?;

        app::emit!(Event::TextDeleted { start, end, editor });

        Ok(())
    }

    pub fn rga_get_text(&self) -> app::Result<String> {
        self.rga_document.get_text().map_err(Into::into)
    }

    pub fn rga_get_length(&self) -> app::Result<usize> {
        self.rga_document.len().map_err(Into::into)
    }

    pub fn rga_is_empty(&self) -> app::Result<bool> {
        self.rga_document.is_empty().map_err(Into::into)
    }

    pub fn rga_set_title(&mut self, new_title: String) -> app::Result<()> {
        if new_title.is_empty() {
            app::bail!("Title cannot be empty");
        }

        let editor = caller_account();

        let old_title = self.rga_get_title();

        self.rga_metadata
            .insert("title".to_string(), new_title.clone().into())?;

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

    pub fn rga_append_text(&mut self, text: String) -> app::Result<()> {
        let length = self.rga_get_length()?;
        self.rga_insert_text(length, text)
    }

    pub fn rga_clear(&mut self) -> app::Result<()> {
        let length = self.rga_get_length()?;
        if length > 0 {
            self.rga_delete_text(0, length)?;
        }
        Ok(())
    }

    // AUTHORED MAP

    pub fn authored_insert(&mut self, key: String, value: String) -> app::Result<()> {
        let owner = caller_account();
        self.authored_items
            .insert(key.clone(), value.clone().into())?;
        app::emit!(Event::AuthoredInserted {
            key: key.clone(),
            value: value.clone(),
            owner: owner.clone(),
        });
        Ok(())
    }

    pub fn authored_update(&mut self, key: String, value: String) -> app::Result<()> {
        self.authored_items.update(&key, value.clone().into())?;
        app::emit!(Event::AuthoredUpdated {
            key: key.clone(),
            value: value.clone(),
        });
        Ok(())
    }

    pub fn authored_remove(&mut self, key: String) -> app::Result<Option<String>> {
        let result = self.authored_items.remove(&key)?.map(|v| v.get().clone());
        if result.is_some() {
            app::emit!(Event::AuthoredRemoved { key: key.clone() });
        }
        Ok(result)
    }

    pub fn authored_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.authored_items.get(&key)?.map(|v| v.get().clone()))
    }

    pub fn authored_entries(&self) -> app::Result<BTreeMap<String, String>> {
        Ok(self
            .authored_items
            .entries()?
            .map(|(k, v)| (k, v.get().clone()))
            .collect())
    }

    pub fn authored_get_owner(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.authored_items.owner_of(&key)?.map(|pk| pk.to_string()))
    }

    pub fn authored_len(&self) -> app::Result<usize> {
        self.authored_items.len().map_err(Into::into)
    }

    // SHARED STORAGE

    pub fn shared_set(&mut self, value: String) -> app::Result<()> {
        let by = caller_account();
        self.shared_data.insert(LwwRegister::new(value.clone()))?;
        app::emit!(Event::SharedSet {
            value: value.clone(),
            by: by.clone(),
        });
        Ok(())
    }

    pub fn shared_get(&self) -> app::Result<String> {
        Ok(self.shared_data.get()?.get().clone())
    }

    /// The writer set, as 64-hex-character account ids.
    ///
    /// These are `AccountId`s (people), NOT the base58 device keys the rest of
    /// this contract reports — core 0.11 made the account the only
    /// authorization subject. `whoami` returns the caller's own, which is what
    /// you feed back into `shared_add_writer`.
    pub fn shared_get_writers(&self) -> app::Result<Vec<String>> {
        Ok(self
            .shared_data
            .writers()
            .iter()
            .map(|account| account.to_string())
            .collect())
    }

    pub fn shared_add_writer(&mut self, account_hex: String) -> app::Result<()> {
        let new_writer: AccountId = account_hex
            .parse()
            .map_err(|e| app::err!("not an account id (expected 64 hex chars): {e}"))?;
        let mut new_writers = self.shared_data.writers().clone();
        new_writers.insert(new_writer);
        self.shared_data.rotate_writers(new_writers)?;
        app::emit!(Event::SharedWriterAdded {
            writer: account_hex.clone(),
        });
        Ok(())
    }

    /// Replace the whole writer set in one rotation.
    ///
    /// `shared_add_writer` can only ever union a key in, so nothing in this app
    /// could REMOVE a writer — which left the interesting half of the writer set
    /// untested: retroactive revocation, and two nodes rotating concurrently to
    /// sets that disagree on membership.
    ///
    /// The caller must be a current writer, and passing a set that excludes
    /// themselves is allowed and permanent as far as this method is concerned —
    /// it is how revocation is tested, and there is no way back in.
    pub fn shared_rotate_writers(&mut self, account_hexes: Vec<String>) -> app::Result<()> {
        let mut new_writers = BTreeSet::new();
        for account_hex in &account_hexes {
            let account: AccountId = account_hex
                .parse()
                .map_err(|e| app::err!("not an account id (expected 64 hex chars): {e}"))?;
            let _inserted = new_writers.insert(account);
        }
        if new_writers.is_empty() {
            app::bail!("refusing to rotate to an empty writer set — the cell would be unwritable");
        }

        self.shared_data.rotate_writers(new_writers)?;
        app::emit!(Event::SharedWritersRotated {
            writers: account_hexes,
        });
        Ok(())
    }

    pub fn shared_is_writer(&self, account_hex: String) -> app::Result<bool> {
        let account: AccountId = account_hex
            .parse()
            .map_err(|e| app::err!("not an account id (expected 64 hex chars): {e}"))?;
        Ok(self.shared_data.writers().contains(&account))
    }

    pub fn shared_is_frozen(&self) -> app::Result<bool> {
        Ok(self.shared_data.is_frozen())
    }

    // AUTHORED VECTOR

    pub fn authored_vec_push(&mut self, value: String) -> app::Result<usize> {
        let index = self.authored_vec.push(LwwRegister::new(value.clone()))?;
        let owner = caller_account();
        app::emit!(Event::AuthoredVecPushed {
            index,
            value,
            owner,
        });
        Ok(index)
    }

    pub fn authored_vec_get(&self, index: usize) -> app::Result<Option<String>> {
        Ok(self.authored_vec.get(index)?.map(|r| r.get().clone()))
    }

    pub fn authored_vec_update(&mut self, index: usize, value: String) -> app::Result<()> {
        self.authored_vec
            .update(index, LwwRegister::new(value.clone()))?;
        app::emit!(Event::AuthoredVecUpdated { index, value });
        Ok(())
    }

    pub fn authored_vec_remove(&mut self, index: usize) -> app::Result<()> {
        self.authored_vec.tombstone(index)?;
        app::emit!(Event::AuthoredVecRemoved { index });
        Ok(())
    }

    pub fn authored_vec_get_owner(&self, index: usize) -> app::Result<Option<String>> {
        Ok(self.authored_vec.owner_of(index)?.map(|pk| pk.to_string()))
    }

    pub fn authored_vec_entries(&self) -> app::Result<Vec<String>> {
        Ok(self.authored_vec.iter()?.map(|r| r.get().clone()).collect())
    }

    pub fn authored_vec_len(&self) -> app::Result<usize> {
        self.authored_vec.len().map_err(Into::into)
    }

    // WORKSPACE REGISTRY
    //
    // An app-level directory sitting *above* the node's own namespaces,
    // subgroups and contexts. The node knows which contexts exist and who is a
    // member; it does not know that context X is "#general" or that account Y is
    // an admin of this particular workspace. That is app state, and this is the
    // shape real apps (curb, mero-chat) give it.
    //
    // Two membership layers meet here, and conflating them is the classic bug:
    //
    //   * NODE membership — who can execute against this context at all. Core
    //     enforces it; nothing below can widen it.
    //   * WORKSPACE role — what the app lets a member do. Enforced here, and
    //     only meaningful for callers the node already admitted.

    /// Claim the workspace and become its admin.
    ///
    /// Not seeded in `init`: a context can exist before anyone decides to run a
    /// workspace in it, and the claim is what makes `caller_account()` the
    /// admin. First caller wins, and there is no transfer — this is a scaffold,
    /// and a role-transfer flow would be the interesting part of a different
    /// example.
    pub fn ws_init(&mut self, name: String) -> app::Result<()> {
        if !self.ws_name.get().is_empty() {
            app::bail!(
                "workspace already initialized as '{}' by {}",
                self.ws_name.get(),
                self.ws_admin.get()
            );
        }
        if name.trim().is_empty() {
            app::bail!("workspace name cannot be empty");
        }

        let admin = caller_account();
        self.ws_name.set(name.clone());
        self.ws_admin.set(admin.clone());
        self.ws_roles
            .insert(admin.clone(), LwwRegister::new(ROLE_ADMIN.to_owned()))?;

        app::emit!(Event::WorkspaceInitialized {
            name: name.clone(),
            admin: admin.clone(),
        });
        app::log!("Workspace '{}' initialized by {}", name, admin);
        Ok(())
    }

    /// Name, admin and the three counts behind the header card.
    ///
    /// Errors — rather than returning an empty summary — while unclaimed, so a
    /// caller cannot mistake "no workspace here" for "an empty workspace".
    pub fn ws_get_info(&self) -> app::Result<WorkspaceInfo> {
        let name = self.ws_name.get().clone();
        if name.is_empty() {
            app::bail!("workspace not initialized: call ws_init first");
        }
        Ok(WorkspaceInfo {
            name,
            admin: self.ws_admin.get().clone(),
            channel_count: self.ws_channels.len()?,
            group_count: self.ws_groups.len()?,
            member_count: self.ws_roles.len()?,
        })
    }

    /// Add a context to the directory, or update the entry for one already in
    /// it. Any member may register; `read-only` may not.
    pub fn ws_register_channel(
        &mut self,
        context_id: String,
        name: String,
        topic: String,
    ) -> app::Result<()> {
        let by = self.require_writer()?;
        if context_id.trim().is_empty() {
            app::bail!("context_id cannot be empty");
        }

        self.ws_channels.insert(
            context_id.clone(),
            ChannelRecord {
                context_id: context_id.clone(),
                name: name.clone(),
                topic,
                created_by: by.clone(),
                registered_at: env::time_now(),
            },
        )?;

        app::emit!(Event::ChannelRegistered {
            context_id: context_id.clone(),
            name,
            by,
        });
        Ok(())
    }

    pub fn ws_unregister_channel(&mut self, context_id: String) -> app::Result<()> {
        let _by = self.require_writer()?;
        if self.ws_channels.remove(&context_id)?.is_none() {
            app::bail!("no channel registered for context {context_id}");
        }
        app::emit!(Event::ChannelUnregistered {
            context_id: context_id.clone(),
        });
        Ok(())
    }

    /// The directory. Readable by anyone the node admitted, member or not —
    /// a listing is how a new member finds out what to join.
    pub fn ws_list_channels(&self) -> app::Result<Vec<ChannelRecord>> {
        let mut channels = Vec::new();
        for (_, record) in self.ws_channels.entries()? {
            channels.push(record.clone());
        }
        // `UnorderedMap` iteration order is not part of its contract, so sort
        // for a stable listing — two nodes must render the same table.
        channels.sort_by(|a, b| a.context_id.cmp(&b.context_id));
        Ok(channels)
    }

    pub fn ws_register_group(
        &mut self,
        group_id: String,
        name: String,
        description: String,
    ) -> app::Result<()> {
        let by = self.require_writer()?;
        if group_id.trim().is_empty() {
            app::bail!("group_id cannot be empty");
        }

        self.ws_groups.insert(
            group_id.clone(),
            WsGroupRecord {
                group_id: group_id.clone(),
                name: name.clone(),
                description,
                created_by: by.clone(),
                registered_at: env::time_now(),
            },
        )?;

        app::emit!(Event::GroupRegistered {
            group_id: group_id.clone(),
            name,
            by,
        });
        Ok(())
    }

    pub fn ws_unregister_group(&mut self, group_id: String) -> app::Result<()> {
        let _by = self.require_writer()?;
        if self.ws_groups.remove(&group_id)?.is_none() {
            app::bail!("no group registered with id {group_id}");
        }
        app::emit!(Event::GroupUnregistered {
            group_id: group_id.clone(),
        });
        Ok(())
    }

    pub fn ws_list_groups(&self) -> app::Result<Vec<WsGroupRecord>> {
        let mut groups = Vec::new();
        for (_, record) in self.ws_groups.entries()? {
            groups.push(record.clone());
        }
        groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
        Ok(groups)
    }

    /// Grant `identity` a workspace role. Admin only.
    ///
    /// `identity` is a free-form `String`, not an `AccountId`, and that is not
    /// laziness: the UI grants roles to node identities it read from the admin
    /// API's group-membership listing, which reports base58 DEVICE keys, while
    /// `caller_account()` is a 64-hex ACCOUNT. Nothing on the wire maps one to
    /// the other (see `whoami`), so this map has to hold whichever of the two
    /// the operator pasted. The consequence is explicit rather than hidden:
    /// **only a role granted under the caller's own `account_id` is a role that
    /// `ws_my_role` will ever return** — everything else is a directory entry.
    /// This is the app-level mirror of the writer-set trap in `shared_*`.
    pub fn ws_set_member_role(&mut self, identity: String, role: String) -> app::Result<()> {
        let by = self.require_admin()?;
        if identity.trim().is_empty() {
            app::bail!("identity cannot be empty");
        }
        if !WS_ROLES.contains(&role.as_str()) {
            app::bail!(
                "unknown role '{role}' (expected one of: {})",
                WS_ROLES.join(", ")
            );
        }
        if identity == by && role != ROLE_ADMIN {
            app::bail!("an admin cannot demote themselves — the workspace would have none");
        }

        let mut entry = self.ws_roles.entry(identity.clone())?.or_default()?;
        entry.set(role.clone());

        app::emit!(Event::MemberRoleSet {
            identity: identity.clone(),
            role: role.clone(),
            by,
        });
        Ok(())
    }

    /// `identity`'s role, or the empty string if they have none.
    pub fn ws_get_member_role(&self, identity: String) -> app::Result<String> {
        Ok(self
            .ws_roles
            .get(&identity)?
            .map_or_else(String::new, |role| role.get().clone()))
    }

    /// The CALLER's role, resolved by account. Empty string if they have none —
    /// including the case where a role was granted under their device key
    /// instead; see `ws_set_member_role`.
    pub fn ws_my_role(&self) -> app::Result<String> {
        self.ws_get_member_role(caller_account())
    }

    pub fn ws_list_members(&self) -> app::Result<Vec<MemberRecord>> {
        let mut members = Vec::new();
        for (identity, role) in self.ws_roles.entries()? {
            members.push(MemberRecord {
                identity,
                role: role.get().clone(),
            });
        }
        members.sort_by(|a, b| a.identity.cmp(&b.identity));
        Ok(members)
    }

    /// Ping another context in the directory, via `xcall` to its `ws_pong`.
    ///
    /// Fire-and-forget by design: `env::xcall` only QUEUES the call, so a
    /// successful return here means "queued", never "delivered". Whether the
    /// node then dispatches it or denies it is invisible from inside the
    /// contract — watch `ws_ping_count` on the target, not the result of this.
    ///
    /// The parameter is named `target_context_id_b58` because that is what the
    /// frontend sends. The TYPE is `ContextId`, so the SDK does the base58
    /// decode and a malformed id fails at the boundary rather than here.
    pub fn ws_ping_channel(&mut self, target_context_id_b58: ContextId) -> app::Result<()> {
        let by = self.require_writer()?;

        #[derive(calimero_sdk::serde::Serialize)]
        #[serde(crate = "calimero_sdk::serde")]
        struct PongParams {
            from_context: ContextId,
        }

        let params = calimero_sdk::serde_json::to_vec(&PongParams {
            from_context: ContextId::from(env::context_id()),
        })?;

        env::xcall(target_context_id_b58.as_ref(), "ws_pong", &params);

        app::log!("queued ws_pong xcall to {}", target_context_id_b58);
        app::emit!(Event::ChannelPinged {
            to_context: target_context_id_b58,
            by,
        });
        Ok(())
    }

    /// Receive a ping from another context.
    ///
    /// `#[app::xcall(from_same_app)]` is the trust boundary and the node
    /// enforces it: a context running a DIFFERENT application is rejected
    /// before this body runs. The checks below are what is left over for the
    /// app — rejecting a direct call (which carries no origin) and refusing a
    /// caller whose self-reported `from_context` disagrees with the origin the
    /// node set.
    ///
    /// Not in the frontend's API surface, and it cannot be: a direct call is
    /// exactly what this rejects.
    #[app::xcall(from_same_app)]
    pub fn ws_pong(&mut self, from_context: ContextId) -> app::Result<()> {
        let Some(origin) = env::xcall_origin().map(ContextId::from) else {
            app::bail!("ws_pong is xcall-only: no cross-context origin (direct call rejected)");
        };
        if origin != from_context {
            app::bail!(
                "xcall provenance mismatch: node-set origin {origin} != claimed from_context {from_context}"
            );
        }

        self.ws_pings.increment()?;
        let count = self.ws_pings.value()?;

        app::emit!(Event::PongReceived {
            from_context,
            count,
        });
        app::log!(
            "ws_pong from {} accepted; count now {}",
            from_context,
            count
        );
        Ok(())
    }

    /// Pongs received. The only way to observe that a `ws_ping_channel`
    /// actually landed.
    pub fn ws_ping_count(&self) -> app::Result<u64> {
        Ok(self.ws_pings.value()?)
    }

    /// The caller's account, if the workspace is claimed and they may write to
    /// the directory. `read-only` and non-members are refused.
    fn require_writer(&self) -> app::Result<String> {
        let me = self.require_member()?;
        let role = self.ws_get_member_role(me.clone())?;
        if role == ROLE_READ_ONLY {
            app::bail!("role '{ROLE_READ_ONLY}' cannot modify the workspace directory");
        }
        Ok(me)
    }

    /// The caller's account, if the workspace is claimed and they hold any role.
    fn require_member(&self) -> app::Result<String> {
        if self.ws_name.get().is_empty() {
            app::bail!("workspace not initialized: call ws_init first");
        }
        let me = caller_account();
        if self.ws_get_member_role(me.clone())?.is_empty() {
            app::bail!(
                "account {me} has no workspace role — an admin must grant one with ws_set_member_role"
            );
        }
        Ok(me)
    }

    /// The caller's account, if they are an admin.
    fn require_admin(&self) -> app::Result<String> {
        let me = self.require_member()?;
        let role = self.ws_get_member_role(me.clone())?;
        if role != ROLE_ADMIN {
            app::bail!("role '{role}' cannot manage members; '{ROLE_ADMIN}' required");
        }
        Ok(me)
    }
}
