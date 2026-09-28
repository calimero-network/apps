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
//! - **Host Logging**: the SDK's `tracing` subscriber, and `set_log_level`
//!   retuning the filter mid-execution
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
    Mergeable, Moderated, Ownable, ReplicatedGrowableArray, SharedStorage, SortedMap, SortedSet,
    UnorderedMap, UnorderedSet, UserStorage, Vector,
};
use calimero_storage::entities::OpMask;
use sha2::{Digest, Sha256};
use thiserror::Error;

// CONSTANTS

const BLOB_ID_SIZE: usize = 32;

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

/// The workspace claim: its name and the account that made it. Written once,
/// by `ws_init`, into a writer-set cell whose writers are the admins.
#[derive(AbiType, Debug, Clone, Default, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct WsClaim {
    /// Empty is the "not claimed" sentinel — `ws_init` rejects an empty name.
    name: String,
    /// The account that ran `ws_init`, 64 hex.
    admin: String,
}

/// What `whoami` returns — see that method for why both halves exist.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Identity {
    /// This installation, 64 hex characters.
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
    #[abi(as = String)]
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
    /// The target context, 64 hex characters. The map key as well as a field,
    /// so a listing needs no zip with its keys.
    pub context_id: String,
    pub name: String,
    pub topic: String,
    /// The ACCOUNT that registered it, 64 hex. Listings fill it from the
    /// entry's owner stamp, never from the stored bytes, which the writer
    /// chose.
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
    /// As `ChannelRecord::created_by`: read from the owner stamp.
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
    /// Per-owner keyspace (core rc.57): each account holds its own entry at a
    /// key, and only that account edits or removes it.
    authored_items: AuthoredMap<String, LwwRegister<String>>,

    // --- Authored Vector ---
    /// Append-only vector with per-slot ownership; only the pusher can update/tombstone their slot
    authored_vec: AuthoredVector<LwwRegister<String>>,

    // --- Shared Storage ---
    /// Group-writable single value; writers rotate at runtime
    shared_data: SharedStorage<LwwRegister<String>>,

    // --- Workspace Registry ---
    /// Name and admin. Writers are the workspace admins: the context creator
    /// first, then whoever an admin grants `admin`. Every node checks a write
    /// against them, so a patched member cannot claim or rename it.
    ws_claim: SharedStorage<LwwRegister<WsClaim>>,
    /// identity -> role, in a writer-set cell with the same writers as
    /// `ws_claim`: every entry is guarded by it, so a patched member cannot
    /// grant itself `admin` or demote the real one. `LwwRegister` values so
    /// two admins changing one member's role concurrently converge.
    ws_roles: SharedStorage<UnorderedMap<String, LwwRegister<String>>>,
    /// context_id -> channel. Keyed by the context id so a re-register of the
    /// same context updates rather than duplicates. Each entry is owned by
    /// the account that registered it; the workspace admins moderate, so an
    /// admin may remove anyone's entry and nobody else may.
    ws_channels: Moderated<UnorderedMap<String, ChannelRecord>>,
    /// group_id -> group, owned and moderated as `ws_channels`.
    ws_groups: Moderated<UnorderedMap<String, WsGroupRecord>>,
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
/// storage layer reports back (`owner_of`, `writers()`). Rendering is hex —
/// which since core 0.11.0-rc.27 is the only encoding for any id, so this no
/// longer distinguishes an account from a device key the way it used to.
fn caller_account() -> String {
    AccountId::from(env::account_id()).to_string()
}

/// The entry at `key` of the lowest account holding one, with that account:
/// the same pick on every node when several accounts hold one key.
fn lowest_holder(
    map: &AuthoredMap<String, LwwRegister<String>>,
    key: &String,
) -> app::Result<Option<(AccountId, String)>> {
    Ok(map
        .entries_at(key)?
        .into_iter()
        .min_by_key(|(owner, _)| *owner)
        .map(|(owner, v)| (owner, v.get().clone())))
}

/// Remove the entry at `key` of a moderated directory: the caller's own if
/// they hold one, else every holder's by name (`remove_by`), which storage
/// allows a moderator (a workspace admin) only. A key-only `remove` removes
/// only the caller's own entry. `false` if nobody held `key`.
fn remove_every<V>(map: &mut Moderated<UnorderedMap<String, V>>, key: &String) -> app::Result<bool>
where
    V: BorshSerialize + BorshDeserialize + 'static,
{
    if map.remove(key)?.is_some() {
        return Ok(true);
    }
    let holders = map.entries_at(key)?;
    let found = !holders.is_empty();
    for (owner, _) in holders {
        let _ = map.remove_by(&owner, key)?;
    }
    Ok(found)
}

/// Parse a 64-hex account id, with a message that says which of the two id
/// kinds was expected.
///
/// Every authorization subject in this contract is an ACCOUNT. Passing a DEVICE
/// key here is the recurring mistake, and it has to fail loudly — as a `String`
/// argument it would otherwise be stored as an account nobody holds.
///
/// ⚠️ core 0.11.0-rc.27 removed base58 (core#3691), so a device key and an
/// account id are now BOTH 64 hex characters. The shape tell that used to catch
/// this mistake on sight is gone; length validation cannot separate them and
/// neither can a human reading a log. Only provenance does — `whoami` says
/// which is which, and nothing on the wire maps one to the other.
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

fn encode_blob_id_hex(blob_id_bytes: &[u8; BLOB_ID_SIZE]) -> String {
    hex::encode(blob_id_bytes)
}

fn parse_blob_id_hex(blob_id_str: &str) -> app::Result<[u8; BLOB_ID_SIZE]> {
    let bytes = hex::decode(blob_id_str)
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
    let safe_string = encode_blob_id_hex(blob_id_bytes);
    serializer.serialize_str(&safe_string)
}

// APPLICATION LOGIC

#[app::logic]
impl E2eKvStore {
    // INITIALIZATION

    #[app::init]
    pub fn init() -> E2eKvStore {
        app::log!("Initializing E2E KV Store");

        // The workspace admin set, four times over: both directories'
        // moderators and both writer-set cells' writers. Seeded from the one
        // set the directories were created with so they agree by construction.
        let ws_channels: Moderated<UnorderedMap<String, ChannelRecord>> = Moderated::new();
        let ws_admins = ws_channels.moderators();

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
            // Workspace Registry — the context creator's ACCOUNT is the sole
            // initial admin: of the role cell (its writer set) and of the two
            // directories (their moderators). The claim itself is still made
            // later, by `ws_init`, but only an admin can make it. "First caller
            // wins" is not something storage can hold against a patched node;
            // a writer set is.
            ws_claim: SharedStorage::new(ws_admins.clone(), false),
            ws_roles: SharedStorage::new(ws_admins, false),
            ws_channels,
            ws_groups: Moderated::new(),
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
    ///   node's group-membership listing calls `identity`. 64 hex characters,
    ///   like every other id since core 0.11.0-rc.27 removed base58.
    /// * `account_id` — the person. The only authorization subject: the
    ///   `shared_*` writer set is keyed by it. 64 hex characters.
    ///
    /// Nothing on the wire maps one to the other, so a writer-set grant cannot
    /// be built from a membership listing alone — the account holder has to
    /// hand over the value this method returns.
    pub fn whoami(&self) -> Identity {
        Identity {
            device_id: hex::encode(env::device_id()),
            account_id: AccountId::from(env::account_id()).to_string(),
        }
    }

    /// This node's account on its own, hex-encoded.
    ///
    /// `whoami` already returns this value as one half of an `Identity`, and a
    /// merobox workflow can capture it directly (`result.output.account_id` —
    /// `sorted-collections.yml` does exactly that), so this method adds no
    /// capability. It exists for one reason: **it is the name core's own copy
    /// of this scaffold uses** (`apps/scaffolding-e2e`).
    ///
    /// The two scaffolds have drifted apart once already. Keeping the account
    /// accessor spelled the same in both is what lets a scenario written
    /// against one run unchanged against the other, which is the only cheap
    /// defence against drifting again.
    ///
    /// Keep both names. `whoami` is the better call — one round trip for both
    /// halves of an identity — and nothing here should be rewritten to use
    /// this one.
    pub fn my_account(&self) -> app::Result<String> {
        Ok(AccountId::from(env::account_id()).to_string())
    }

    // KV OPERATIONS

    /// Drives the host-backed `tracing` subscriber, and reports what came back.
    ///
    /// `app::log!` reaches the execution outcome on its own. The `tracing`
    /// macros do not, unless the SDK's `tracing` feature is on — it installs a
    /// subscriber that forwards them to the same host log. That feature is off
    /// by default because the subscriber costs wasm size, so whether it is
    /// wired up is a per-app build decision, and this is the call that proves
    /// this build made it.
    ///
    /// Three things are being tested at once, which is why the KV insert is
    /// here and not incidental:
    ///
    /// * this crate's own `tracing::info!`/`warn!` arrive;
    /// * `calimero-storage`'s internal instrumentation arrives too — the insert
    ///   is what makes the storage crate emit, and it only shows up if the
    ///   subscriber is process-wide rather than scoped to this crate;
    /// * `set_log_level` actually retunes the filter at runtime.
    ///
    /// ⚠️ The SDK's default level is **WARN**, not INFO — deliberately, because
    /// `calimero_storage` logs routine operations at INFO and an INFO default
    /// floods every execution. So at the default level this emits the WARN line
    /// only: the info AND debug lines are both filtered out inside the guest and
    /// never reach the outcome at all. With `debug = true` the debug line
    /// appears, and so does the storage crate's own output. That difference is
    /// the assertion; a probe that only ever ran at one level could not tell a
    /// working filter from a subscriber that was never installed.
    ///
    /// ⚠️ WHERE THE LINES GO. Not into this call's response. The node collects
    /// them into the execution outcome and writes them to ITS OWN log
    /// (`crates/server/src/execute.rs`: `info!("execution log {i}| {}", log)`);
    /// the JSON-RPC reply carries the return value and nothing else. So no RPC
    /// client — not the frontend, not merobox's `result.logs` — can observe
    /// them. Grep the node's log for `execution log`.
    pub fn tracing_probe(&mut self, debug: bool) -> app::Result<()> {
        if debug {
            env::set_log_level(env::LevelFilter::DEBUG);
        }

        tracing::info!(probe = true, "tracing_probe: info line");
        tracing::debug!(probe = true, "tracing_probe: debug line");
        tracing::warn!("tracing_probe: warn line");

        // Mutating storage is what drives `calimero-storage`'s own `tracing`
        // output (`Interface::apply_action`, `commit_root`), so this is part of
        // the assertion rather than a side effect.
        self.kv_items
            .insert("probe_key".to_owned(), "probe_value".to_owned().into())?;

        Ok(())
    }

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
        // Only emit `Removed` when a value was actually present — emitting for
        // an absent key would broadcast a change that never happened.
        let removed = self.kv_items.remove(key)?.map(|v| v.get().clone());
        if removed.is_some() {
            app::emit!(Event::Removed { key });
        }
        Ok(removed)
    }

    pub fn clear(&mut self) -> app::Result<()> {
        app::log!("Clearing all entries");
        // Only emit `Cleared` when there was something to clear, and only
        // after the clear succeeds.
        let was_non_empty = !self.kv_items.is_empty()?;
        self.kv_items.clear()?;
        if was_non_empty {
            app::emit!(Event::Cleared);
        }
        Ok(())
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
    /// Takes the ACCOUNT id, not the device key: rc.21 rekeyed `UserStorage`
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
        let blob_id = parse_blob_id_hex(&blob_id_str)?;

        let uploader = caller_account();
        let timestamp = env::time_now();
        // Unique without coordination: a shared counter read by two nodes at
        // once hands both the same id, and the whole-record LWW then drops one
        // upload silently. A device runs one execution at a time, so its id
        // plus its clock separates every upload.
        let device = hex::encode(env::device_id());
        let file_id = format!("file_{}_{timestamp}", &device[..16]);

        // `blob_announce_to_context` returns once the announce is SCHEDULED, not
        // once it is delivered — and since rc.39 it feeds availability-node
        // prefetch only, never discovery (peers find blobs by probe now). A
        // `false` here is therefore not a failure worth warning about, and the
        // old "Failed to announce" line was a false alarm in every e2e log.
        let current_context = env::context_id();
        if !env::blob_announce_to_context(&blob_id, &current_context) {
            app::log!(
                "Announce not scheduled for blob {} (prefetch only)",
                blob_id_str
            );
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

    pub fn get_blob_id_hex(&self, file_id: String) -> app::Result<String> {
        let file_record = self.get_file(file_id)?;
        Ok(encode_blob_id_hex(&file_record.blob_id))
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

    /// Removes the CALLER's own entry at `key`: keys are per owner, so
    /// another account's entry at the same key is theirs and stays.
    pub fn authored_remove(&mut self, key: String) -> app::Result<Option<String>> {
        let result = self.authored_items.remove(&key)?.map(|v| v.get().clone());
        if result.is_some() {
            app::emit!(Event::AuthoredRemoved { key: key.clone() });
        }
        Ok(result)
    }

    /// The value at `key` of whoever holds it: the lowest account's, if
    /// several do, the same pick on every node. Keys are per owner, so a
    /// key-only `get` would read the CALLER's own entry only.
    pub fn authored_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(lowest_holder(&self.authored_items, &key)?.map(|(_, v)| v))
    }

    /// `owner`'s own value at `key` (`owner` is a 64-hex account id).
    pub fn authored_get_by(&self, owner: String, key: String) -> app::Result<Option<String>> {
        let owner = parse_account(&owner)?;
        Ok(self
            .authored_items
            .get_by(&owner, &key)?
            .map(|v| v.get().clone()))
    }

    /// Every account holding an entry at `key`, ascending.
    pub fn authored_owners(&self, key: String) -> app::Result<Vec<String>> {
        let mut owners: Vec<AccountId> = self
            .authored_items
            .entries_at(&key)?
            .into_iter()
            .map(|(owner, _)| owner)
            .collect();
        owners.sort();
        Ok(owners.into_iter().map(|o| o.to_string()).collect())
    }

    pub fn authored_entries(&self) -> app::Result<BTreeMap<String, String>> {
        Ok(self
            .authored_items
            .entries()?
            .map(|(k, v)| (k, v.get().clone()))
            .collect())
    }

    /// The account `authored_get` reads `key` from: the lowest holder.
    pub fn authored_get_owner(&self, key: String) -> app::Result<Option<String>> {
        Ok(lowest_holder(&self.authored_items, &key)?.map(|(owner, _)| owner.to_string()))
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
    /// These are `AccountId`s (people), NOT the device keys the rest of this
    /// contract reports — core 0.11 made the account the only authorization
    /// subject. `whoami` returns the caller's own, which is what you feed back
    /// into `shared_add_writer`.
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
        // rc.26 changed `AuthoredVector::push` to return the entry's stable
        // `Id` instead of a positional index, deliberately: "an index describes
        // where an entry currently sits in a set other replicas insert into, so
        // a remote insert ahead of it silently renumbers it".
        //
        // The index is recovered from `len()` here rather than surfacing the
        // `Id`, so this method's ABI — and therefore the generated client, the
        // frontend section and the two workflows that assert on it — is
        // unchanged by the migration. Adopting the `Id` is the right end state
        // and is a follow-up: it is an interface change to a public contract
        // method, which is not something a repository move should smuggle in.
        let _id = self.authored_vec.push(LwwRegister::new(value.clone()))?;
        let index = self.authored_vec.len()?.saturating_sub(1);
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

    /// Claim the workspace: name it and record the caller as its admin.
    ///
    /// Only a workspace admin may — initially the context creator, the sole
    /// writer of `ws_claim` from `init`. A claim by anyone else is refused by
    /// storage, on every node, rather than by the check below: "first caller
    /// wins" read off a public register is a race a patched node always wins.
    /// There is no transfer — this is a scaffold, and a role-transfer flow
    /// would be the interesting part of a different example.
    pub fn ws_init(&mut self, name: String) -> app::Result<()> {
        let current = self.ws_claim.get()?.get().clone();
        if !current.name.is_empty() {
            app::bail!(
                "workspace already initialized as '{}' by {}",
                current.name,
                current.admin
            );
        }
        if name.trim().is_empty() {
            app::bail!("workspace name cannot be empty");
        }

        let admin = caller_account();
        let _previous = self.ws_claim.insert(LwwRegister::new(WsClaim {
            name: name.clone(),
            admin: admin.clone(),
        }))?;
        let _prior = self
            .ws_roles
            .get_mut()?
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
        let claim = self.ws_claim.get()?.get().clone();
        if claim.name.is_empty() {
            app::bail!("workspace not initialized: call ws_init first");
        }
        Ok(WorkspaceInfo {
            name: claim.name,
            admin: claim.admin,
            channel_count: self.ws_channels.len()?,
            group_count: self.ws_groups.len()?,
            member_count: self.ws_roles.get()?.len()?,
        })
    }

    /// Add a context to the directory, or update the entry for one the caller
    /// registered. Any member may register; `read-only` may not (an app-level
    /// check). A context someone else registered is theirs: storage refuses
    /// the overwrite, so it can only be removed by them or an admin.
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

        let record = ChannelRecord {
            context_id: context_id.clone(),
            name: name.clone(),
            topic,
            created_by: by.clone(),
            registered_at: env::time_now(),
        };
        // Keys are per owner: `contains` asks about the caller's own entry.
        // Another account's registration of this context is refused rather
        // than duplicated alongside it.
        if self.ws_channels.contains(&context_id)? {
            self.ws_channels.update(&context_id, record)?;
        } else if !self.ws_channels.entries_at(&context_id)?.is_empty() {
            app::bail!("context {context_id} is registered by another account");
        } else {
            self.ws_channels.insert(context_id.clone(), record)?;
        }

        app::emit!(Event::ChannelRegistered {
            context_id: context_id.clone(),
            name,
            by,
        });
        Ok(())
    }

    /// Remove a channel: its registrant or a workspace admin (a moderator of
    /// the directory) may, and storage refuses anyone else.
    pub fn ws_unregister_channel(&mut self, context_id: String) -> app::Result<()> {
        let _by = self.require_writer()?;
        if !remove_every(&mut self.ws_channels, &context_id)? {
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
        // With owners: keys are per owner, so a key-only `owner_of` would
        // name only the caller.
        for (owner, _, mut record) in self.ws_channels.entries_with_owners()? {
            record.created_by = owner.to_string();
            channels.push(record);
        }
        // `UnorderedMap` iteration order is not part of its contract, so sort
        // for a stable listing — two nodes must render the same table.
        channels.sort_by(|a, b| a.context_id.cmp(&b.context_id));
        Ok(channels)
    }

    /// Add or update a group; ownership as `ws_register_channel`.
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

        let record = WsGroupRecord {
            group_id: group_id.clone(),
            name: name.clone(),
            description,
            created_by: by.clone(),
            registered_at: env::time_now(),
        };
        // As `ws_register_channel`: another account's registration is refused.
        if self.ws_groups.contains(&group_id)? {
            self.ws_groups.update(&group_id, record)?;
        } else if !self.ws_groups.entries_at(&group_id)?.is_empty() {
            app::bail!("group {group_id} is registered by another account");
        } else {
            self.ws_groups.insert(group_id.clone(), record)?;
        }

        app::emit!(Event::GroupRegistered {
            group_id: group_id.clone(),
            name,
            by,
        });
        Ok(())
    }

    pub fn ws_unregister_group(&mut self, group_id: String) -> app::Result<()> {
        let _by = self.require_writer()?;
        if !remove_every(&mut self.ws_groups, &group_id)? {
            app::bail!("no group registered with id {group_id}");
        }
        app::emit!(Event::GroupUnregistered {
            group_id: group_id.clone(),
        });
        Ok(())
    }

    pub fn ws_list_groups(&self) -> app::Result<Vec<WsGroupRecord>> {
        let mut groups = Vec::new();
        for (owner, _, mut record) in self.ws_groups.entries_with_owners()? {
            record.created_by = owner.to_string();
            groups.push(record);
        }
        groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
        Ok(groups)
    }

    /// Grant `identity` a workspace role. Admin only — and enforced by
    /// storage: `ws_roles`' writers are the admins.
    ///
    /// `identity` is a free-form `String`, not an `AccountId`, and that is not
    /// laziness: the UI grants roles to node identities it read from the admin
    /// API's group-membership listing, which reports DEVICE keys, while
    /// `caller_account()` is an ACCOUNT. Since rc.27 both render as 64 hex
    /// characters, not even a shape check can tell them apart. Nothing on the
    /// wire maps one to the other (see `whoami`), so this map has to hold
    /// whichever of the two the operator pasted. The consequence is explicit
    /// rather than hidden:
    /// **only a role granted under the caller's own `account_id` is a role that
    /// `ws_my_role` will ever return** — everything else is a directory entry.
    /// This is the app-level mirror of the writer-set trap in `shared_*`.
    ///
    /// Granting or taking away `admin` also rotates the admin set — the
    /// writers of `ws_claim` and `ws_roles`, and both directories' moderators
    /// — for an identity that parses as an account. That set, not the role
    /// string, is what storage enforces.
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

        {
            let mut entry = self
                .ws_roles
                .get_mut()?
                .entry(identity.clone())?
                .or_default()?;
            entry.set(role.clone());
        }

        if let Ok(account) = identity.parse::<AccountId>() {
            let mut admins = self.ws_roles.writers();
            let changed = if role == ROLE_ADMIN {
                admins.insert(account)
            } else {
                admins.remove(&account)
            };
            if changed {
                self.ws_claim.rotate_writers(admins.clone())?;
                self.ws_roles.rotate_writers(admins.clone())?;
                self.ws_channels.set_moderators(admins.clone())?;
                self.ws_groups.set_moderators(admins)?;
            }
        }

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
            .get()?
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
        for (identity, role) in self.ws_roles.get()?.entries()? {
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
    /// The TYPE is `ContextId`, not `String`, so the SDK does the decode and a
    /// malformed id fails at the boundary rather than here. It was called
    /// `target_context_id_b58` until rc.27 removed base58; the suffix named an
    /// encoding that no longer exists, and a parameter name is part of the ABI,
    /// so leaving it would have every caller spell out the wrong one forever.
    pub fn ws_ping_channel(&mut self, target_context_id: ContextId) -> app::Result<()> {
        let by = self.require_writer()?;

        #[derive(calimero_sdk::serde::Serialize)]
        #[serde(crate = "calimero_sdk::serde")]
        struct PongParams {
            from_context: ContextId,
        }

        let params = calimero_sdk::serde_json::to_vec(&PongParams {
            from_context: ContextId::from(env::context_id()),
        })?;

        env::xcall(target_context_id.as_ref(), "ws_pong", &params);

        app::log!("queued ws_pong xcall to {}", target_context_id);
        app::emit!(Event::ChannelPinged {
            to_context: target_context_id,
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
        if self.ws_claim.get()?.get().name.is_empty() {
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

    /// The caller's account, if they are an admin. A fail-fast check only:
    /// storage refuses a non-admin's write to `ws_roles` regardless.
    fn require_admin(&self) -> app::Result<String> {
        let me = self.require_member()?;
        let role = self.ws_get_member_role(me.clone())?;
        if role != ROLE_ADMIN {
            app::bail!("role '{role}' cannot manage members; '{ROLE_ADMIN}' required");
        }
        Ok(me)
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const ALICE: [u8; 32] = [0xA1; 32];
    const BOB: [u8; 32] = [0xB0; 32];

    fn hex_of(account: [u8; 32]) -> String {
        AccountId::from(account).to_string()
    }

    /// The account that ran `init`, as storage recorded it: the first admin
    /// of the workspace (and of `acl`).
    fn creator(app: &TestHost<E2eKvStore>) -> [u8; 32] {
        let admins = app.view(|s| s.acl_admins()).expect("admins");
        let bytes = hex::decode(&admins[0]).expect("hex");
        bytes.try_into().expect("an account is 32 bytes")
    }

    /// A claimed workspace with ALICE and BOB as plain members.
    fn workspace() -> (TestHost<E2eKvStore>, [u8; 32]) {
        let mut app = TestHost::new(E2eKvStore::init);
        let admin = creator(&app);
        app.call_as_account(admin, admin, |s| s.ws_init("Team".to_owned()))
            .expect("the creator claims");
        for who in [ALICE, BOB] {
            app.call_as_account(admin, admin, |s| {
                s.ws_set_member_role(hex_of(who), ROLE_MEMBER.to_owned())
            })
            .expect("grant member");
        }
        (app, admin)
    }

    fn channel(context_id: &str) -> ChannelRecord {
        ChannelRecord {
            context_id: context_id.to_owned(),
            name: "#forged".to_owned(),
            topic: String::new(),
            created_by: "someone-else".to_owned(),
            registered_at: 0,
        }
    }

    #[test]
    fn only_an_admin_can_claim_the_workspace() {
        let mut app = TestHost::new(E2eKvStore::init);
        assert!(app
            .call_as_account(ALICE, ALICE, |s| s.ws_init("Mine".to_owned()))
            .is_err());
        let admin = creator(&app);
        app.call_as_account(admin, admin, |s| s.ws_init("Team".to_owned()))
            .expect("the creator claims");
        let info = app.view(|s| s.ws_get_info()).expect("info");
        assert_eq!((info.name.as_str(), info.admin), ("Team", hex_of(admin)));
    }

    /// A member cannot promote itself through the API, nor — the patched-node
    /// path, skipping `require_admin` — rewrite the claim cell, which storage
    /// refuses outright. A direct write into the role map is stamped a member
    /// of the admins' cell and refused by every peer on apply (core's
    /// `a_writer_set_guards_the_second_level_too`); the mock host has one
    /// replica, so that half is core's to test.
    #[test]
    fn a_member_cannot_grant_itself_admin() {
        let (mut app, admin) = workspace();
        assert!(app
            .call_as_account(ALICE, ALICE, |s| {
                s.ws_set_member_role(hex_of(ALICE), ROLE_ADMIN.to_owned())
            })
            .is_err());
        let forged_claim = app.call_as_account(ALICE, ALICE, |s| -> app::Result<()> {
            let _ = s.ws_claim.insert(LwwRegister::new(WsClaim {
                name: "Hijacked".to_owned(),
                admin: hex_of(ALICE),
            }))?;
            Ok(())
        });
        assert!(forged_claim.is_err(), "nor may it rewrite the claim");
        assert_eq!(
            app.call_as_account(ALICE, ALICE, |s| s.ws_my_role())
                .expect("role"),
            ROLE_MEMBER
        );
        assert_eq!(
            app.view(|s| s.ws_roles.writers()),
            [AccountId::from(admin)].into_iter().collect(),
            "the admin set is unchanged"
        );
    }

    /// A member's channel is theirs: another member can neither overwrite nor
    /// remove it, the owner can update it, and an admin (a moderator) can
    /// remove it.
    #[test]
    fn a_channel_belongs_to_its_registrant_and_admins_moderate() {
        let (mut app, admin) = workspace();
        app.call_as_account(ALICE, ALICE, |s| {
            s.ws_register_channel("ctx".to_owned(), "#a".to_owned(), String::new())
        })
        .expect("register");
        assert!(app
            .call_as_account(BOB, BOB, |s| {
                s.ws_register_channel("ctx".to_owned(), "#b".to_owned(), String::new())
            })
            .is_err());
        assert!(app
            .call_as_account(BOB, BOB, |s| s.ws_unregister_channel("ctx".to_owned()))
            .is_err());
        app.call_as_account(ALICE, ALICE, |s| {
            s.ws_register_channel("ctx".to_owned(), "#a2".to_owned(), String::new())
        })
        .expect("the registrant updates");
        let listed = app.view(|s| s.ws_list_channels()).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "#a2");

        app.call_as_account(admin, admin, |s| s.ws_unregister_channel("ctx".to_owned()))
            .expect("an admin moderates");
        assert!(app.view(|s| s.ws_list_channels()).expect("list").is_empty());
    }

    /// Keys are per owner: two accounts inserting one key hold two entries,
    /// each read by name, and each removes only its own.
    #[test]
    fn one_authored_key_two_owners_are_two_entries() {
        let mut app = TestHost::new(E2eKvStore::init);
        for (who, value) in [(ALICE, "alice's"), (BOB, "bob's")] {
            app.call_as_account(who, who, |s| {
                s.authored_insert("k".to_owned(), value.to_owned())
            })
            .expect("each inserts its own");
        }
        let mut both = vec![hex_of(ALICE), hex_of(BOB)];
        both.sort();
        assert_eq!(
            app.view(|s| s.authored_owners("k".to_owned())).unwrap(),
            both
        );
        assert_eq!(
            app.call_as_account(BOB, BOB, |s| s
                .authored_get_by(hex_of(ALICE), "k".to_owned()))
                .unwrap(),
            Some("alice's".to_owned())
        );
        // The deterministic pick is the lowest holder, from any caller.
        let lowest = both[0].clone();
        assert_eq!(
            app.call_as_account(ALICE, ALICE, |s| s.authored_get_owner("k".to_owned()))
                .unwrap(),
            Some(lowest)
        );
        assert_eq!(app.view(|s| s.authored_len()).unwrap(), 2);

        app.call_as_account(ALICE, ALICE, |s| s.authored_remove("k".to_owned()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.authored_owners("k".to_owned())).unwrap(),
            vec![hex_of(BOB)]
        );
        assert_eq!(
            app.view(|s| s.authored_get("k".to_owned())).unwrap(),
            Some("bob's".to_owned())
        );
    }

    /// `created_by` in a listing is the owner stamp, not the stored bytes.
    #[test]
    fn a_listing_reports_the_owner_stamp_not_the_stored_author() {
        let (mut app, _admin) = workspace();
        app.call_as_account(ALICE, ALICE, |s| -> app::Result<()> {
            s.ws_channels.insert("ctx".to_owned(), channel("ctx"))?;
            Ok(())
        })
        .expect("insert");
        let listed = app.view(|s| s.ws_list_channels()).expect("list");
        assert_eq!(listed[0].created_by, hex_of(ALICE));
    }

    /// Granting `admin` rotates the admin set, so the new admin can moderate
    /// and manage members; demoting them takes both away again.
    #[test]
    fn granting_admin_hands_over_moderation_and_demoting_takes_it_back() {
        let (mut app, admin) = workspace();
        app.call_as_account(ALICE, ALICE, |s| {
            s.ws_register_group("g".to_owned(), "G".to_owned(), String::new())
        })
        .expect("register");
        app.call_as_account(admin, admin, |s| {
            s.ws_set_member_role(hex_of(BOB), ROLE_ADMIN.to_owned())
        })
        .expect("promote");
        app.call_as_account(BOB, BOB, |s| s.ws_unregister_group("g".to_owned()))
            .expect("a promoted admin moderates");

        app.call_as_account(admin, admin, |s| {
            s.ws_set_member_role(hex_of(BOB), ROLE_MEMBER.to_owned())
        })
        .expect("demote");
        assert!(!app
            .view(|s| s.ws_roles.writers())
            .contains(&AccountId::from(BOB)));
        assert!(!app.view(|s| s.ws_channels.is_moderator(&AccountId::from(BOB))));
        app.call_as_account(ALICE, ALICE, |s| {
            s.ws_register_group("h".to_owned(), "H".to_owned(), String::new())
        })
        .expect("register");
        assert!(
            app.call_as_account(BOB, BOB, |s| s.ws_unregister_group("h".to_owned()))
                .is_err(),
            "a demoted admin no longer moderates"
        );
    }

    /// Two devices uploading at once no longer mint the same id.
    #[test]
    fn concurrent_uploads_get_distinct_ids() {
        let mut app = TestHost::new(E2eKvStore::init);
        let blob = hex::encode([7u8; 32]);
        let a = app
            .call_as([1; 32], |s| {
                s.upload_file("a".into(), blob.clone(), 1, "text/plain".into())
            })
            .expect("upload");
        let b = app
            .call_as([2; 32], |s| {
                s.upload_file("b".into(), blob.clone(), 1, "text/plain".into())
            })
            .expect("upload");
        assert_ne!(a, b);
        assert_eq!(app.view(|s| s.list_files()).expect("list").len(), 2);
    }

    /// The map nested in a `UserStorage` slot is the slot owner's.
    #[test]
    fn another_account_cannot_write_into_my_nested_user_map() {
        let mut app = TestHost::new(E2eKvStore::init);
        app.call_as_account(ALICE, ALICE, |s| {
            s.set_user_nested("k".to_owned(), "mine".to_owned())
        })
        .expect("set");
        let forged = app.call_as_account(BOB, BOB, |s| -> app::Result<()> {
            let Some(mut alices) = s.user_items_nested.get_for_user(&AccountId::from(ALICE))?
            else {
                app::bail!("alice has a slot");
            };
            let _ = alices
                .map
                .insert("k".to_owned(), "forged".to_owned().into())?;
            Ok(())
        });
        assert!(forged.is_err());
        assert_eq!(
            app.call_as_account(ALICE, ALICE, |s| s.get_user_nested("k"))
                .expect("get")
                .as_deref(),
            Some("mine")
        );
    }

    #[test]
    fn removing_an_absent_key_or_clearing_nothing_emits_nothing() {
        let mut app = TestHost::new(E2eKvStore::init);
        let _ = app.take_events();
        assert_eq!(app.call(|s| s.remove("missing")).expect("remove"), None);
        app.call(|s| s.clear()).expect("clear");
        assert!(app.events().is_empty());
    }
}
