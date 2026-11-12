//! # Scaffolding E2E: the SDK test bench
//!
//! One app that exercises the component SDK's surface (`calimero-sdk`), so
//! a frontend and a suite of scenarios can call every piece of it against a
//! node. It is the v1 scaffold's method set, method for method, on core's
//! component runtime.
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log. So the state is plain data structures, and v1's CRDT types
//! become the collection that stores the same thing:
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `UnorderedMap<K, LwwRegister<V>>` | `UnorderedMap<K, V>` |
//! | `Counter` / `GCounter` / `Counter<true>` (PN) in a map | `UnorderedMap<String, u64>` / `UnorderedMap<String, i64>` |
//! | `UserStorage<LwwRegister<String>>` | `PerUser<String>` |
//! | `UserStorage<NestedMap>` | `UnorderedMap<(account, key), String>` |
//! | `FrozenStorage<String>` | `Frozen<String>` |
//! | `UnorderedMap<K, UnorderedMap<K2, V>>` | `UnorderedMap<(K, K2), V>` |
//! | `UnorderedMap<K, UnorderedSet<T>>` | `Set<(K, T)>` plus a count per key |
//! | `Vector<Counter>` | `Vector<u64>` |
//! | `SortedMap` / `SortedSet` | `UnorderedMap` / `Set` (every map reads in key order) |
//! | `ReplicatedGrowableArray` | `Text` (Fugue) |
//! | `AuthoredMap<K, V>` | `UnorderedMap<(K, owner), V>` |
//! | `AuthoredVector<V>` | `Vector<AuthoredSlot>` (owner stored in the slot) |
//! | `SharedStorage`, `Ownable`, `AccessControl`, `Moderated` | a `Cell` plus a writer `Set`, an owner `Cell`, an admin `Set` and a role `Set`; every rule an explicit check against `env::caller()` |
//! | `#[app::private]` node-local secrets | `UnorderedMap<(account, game), String>`, read back only by its setter |
//! | `#[app::handler]` handlers run by the receivers of an event | the handler methods, run inline by the `*_with_handler` calls |
//! | `env::xcall` (`ws_ping_channel`) and `#[app::xcall]` (`ws_pong`) | not in core `1.0.0-rc.7`: the ping is recorded but not sent; `ws_pong` accepts app callers only |
//! | `env::blob_announce_to_context` | not in core `1.0.0-rc.7`: blobs are uploaded to the app through the node's blob API and the record keeps their id |
//!
//! Everything a client sees differently (camelCase names, 64-bit integers as
//! decimal strings, typed errors, the identity, the capability model) is in
//! `apps/scaffolding-e2e/README.md`, "What changed in the port".
//!
//! # Who may do what
//!
//! The organization decides who reaches the app: its owner, admins, members and
//! guests. Beyond that, the rules v1 kept in storage are checks here, made in
//! the method before anything is written, and each one answers `Forbidden`:
//!
//! - `shared*` writes: a writer of the shared cell (the app's owner first);
//! - `owned*` writes: the owner of the owned cell (the app's owner first);
//! - `acl*` grants and `aclProject`: an ACL admin (the app's owner first);
//!   `aclDocSet`: an account the projected capabilities give `write`;
//! - `authored*` and `authoredVec*` edits: the entry's owner;
//! - `ws*` directory writes: a workspace member that is not `read-only`;
//!   member roles and `wsInit`: a workspace admin (the app's owner first).

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The most entries one listing returns: one page of a collection.
const PAGE: u32 = 1000;

/// Workspace roles. Kept in lockstep with the frontend's `ROLES` in
/// `sections/ContextMembers.tsx`; an unknown role is refused, not stored.
const ROLE_ADMIN: &str = "admin";
const ROLE_MEMBER: &str = "member";
const ROLE_READ_ONLY: &str = "read-only";
const WS_ROLES: [&str; 3] = [ROLE_ADMIN, ROLE_MEMBER, ROLE_READ_ONLY];

/// The capability bits `aclProject` writes, v1's `OpMask`.
const OP_WRITE: u8 = 1;
const OP_DELETE: u8 = 2;
const OP_ADMIN: u8 = 4;
const OP_FULL: u8 = OP_WRITE | OP_DELETE | OP_ADMIN;

/// The demo roles, and the capability each confers on `aclDoc`. The roles an
/// app recognises live in the app, which is what lets `aclProject` take no
/// arguments: it needs every (role, mask) pair at once.
const ACL_ROLES: [(&str, u8); 2] = [("editor", OP_WRITE), ("moderator", OP_WRITE | OP_DELETE)];

// ── stored values and results ────────────────────────────────────────────────

/// Both halves of the caller's identity, as v1 spelled them.
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    /// v1's installation key. 1.0 has no per-device identity in an app run:
    /// the node acts for the account, so this is the account again (or the
    /// API key's id when the caller is one).
    pub device_id: String,
    /// The account. Every writer set, owner and role here is keyed by it.
    pub account_id: String,
}

/// A file's metadata. The bytes live in the app's blob store on the node
/// (`client.uploadBlob`); this record keeps the blob's id.
#[derive(Clone, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub id: String,
    pub name: String,
    /// The blob's id, 64 hex characters.
    pub blob_id: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub size: u64,
    pub mime_type: String,
    /// The uploader's account.
    pub uploaded_by: String,
    /// Unix milliseconds (the log entry's time); a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub uploaded_at: u64,
}

/// A channel in the workspace directory: another app instance (v1: another
/// context), made discoverable by registering its id here.
#[derive(Clone, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub context_id: String,
    pub name: String,
    pub topic: String,
    /// The account that registered it. Only they or a workspace admin remove it.
    pub created_by: String,
    /// Unix milliseconds; a decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub registered_at: u64,
}

/// A group in the workspace directory (v1: the app-level mirror of a subgroup;
/// 1.0: of a team).
#[derive(Clone, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct WsGroupRecord {
    pub group_id: String,
    pub name: String,
    pub description: String,
    pub created_by: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub registered_at: u64,
}

/// A workspace member and the role the app grants them.
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MemberRecord {
    pub identity: String,
    pub role: String,
}

/// Summary of the workspace, for the header card. Counts are decimal strings.
#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub name: String,
    pub admin: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub channel_count: u64,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub group_count: u64,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub member_count: u64,
}

/// The workspace claim: its name and the account that made it.
#[derive(Clone, Serialize, Deserialize)]
pub struct WsClaim {
    pub name: String,
    pub admin: String,
}

/// One slot of the authored vector: who pushed it and its value, `None` once
/// its owner removed it (v1's tombstone, so positions never shift).
#[derive(Clone, Serialize, Deserialize)]
pub struct AuthoredSlot {
    pub owner: String,
    pub value: Option<String>,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The bench.
#[app::state(version = 1)]
pub struct E2eKvStore {
    // --- KV ---
    /// Every value by key, in key order.
    kv_items: UnorderedMap<String, String>,
    /// Handler runs (`insertHandler` & co.).
    handler_counter: Counter,

    // --- per-user storage ---
    /// Each account's own value.
    user_items_simple: PerUser<String>,
    /// (account, key) → value: each account's own map.
    user_items_nested: UnorderedMap<(String, String), String>,

    // --- frozen storage ---
    /// Content-addressed, immutable values.
    frozen_items: Frozen<String>,

    // --- access control ---
    /// The ACL admins: who may grant roles, change admins and project.
    acl_admins: Set<String>,
    /// (role, account): the role registry. A grant confers nothing until
    /// `aclProject` writes it onto `aclCaps`.
    acl_roles: Set<(String, String)>,
    /// account → capability bits on `aclDoc`, PROJECTED from the registry.
    acl_caps: UnorderedMap<String, u8>,
    /// The capability-guarded document.
    acl_doc: Cell<String>,

    // --- ownable ---
    /// The owned cell's single owner.
    owned_owner: Cell<String>,
    owned_doc: Cell<String>,

    // --- secrets game ---
    /// game id → SHA-256(secret), hex.
    games: UnorderedMap<String, String>,
    /// (account, game id) → secret: only `mySecrets` of that account reads it.
    secrets: UnorderedMap<(String, String), String>,

    // --- files ---
    files: UnorderedMap<String, FileRecord>,

    // --- "nested CRDTs" ---
    g_counters: UnorderedMap<String, u64>,
    pn_counters: UnorderedMap<String, i64>,
    registers: UnorderedMap<String, String>,
    /// (outer, inner) → value.
    metadata: UnorderedMap<(String, String), String>,
    metrics: Vector<u64>,
    /// (key, tag).
    tags: Set<(String, String)>,
    /// key → how many tags it holds. A key with no tag yet is absent.
    tag_counts: UnorderedMap<String, u64>,

    // --- sorted collections ---
    sorted_items: UnorderedMap<String, String>,
    sorted_tags: Set<String>,

    // --- text document ---
    rga_document: Text,
    rga_edit_count: Counter,
    /// "title" → the document's title.
    rga_metadata: UnorderedMap<String, String>,

    // --- authored ---
    /// (key, owner) → value: each account holds its own entry at a key.
    authored_items: UnorderedMap<(String, String), String>,
    authored_vec: Vector<AuthoredSlot>,

    // --- shared storage ---
    shared_writers: Set<String>,
    shared_data: Cell<String>,

    // --- workspace registry ---
    /// The workspace admins: who may claim it and set roles. The app owner first.
    ws_admins: Set<String>,
    ws_claim: Cell<WsClaim>,
    /// identity → role.
    ws_roles: UnorderedMap<String, String>,
    ws_channels: UnorderedMap<String, ChannelRecord>,
    ws_groups: UnorderedMap<String, WsGroupRecord>,
    /// Pongs received.
    ws_pings: Counter,
}

#[app::logic]
#[allow(clippy::len_without_is_empty)]
impl E2eKvStore {
    /// The empty bench. The app's owner is the first ACL admin (with full
    /// capabilities on `aclDoc`), the owner of the owned cell, the writer of
    /// the shared cell, and the first workspace admin, as v1's context creator
    /// was.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut s = Self::load();
        let owner = env::app_owner();
        let _ = s.acl_admins.insert(&owner)?;
        let _ = s.acl_caps.insert(&owner, &OP_FULL)?;
        s.owned_owner.set(&owner)?;
        let _ = s.shared_writers.insert(&owner)?;
        let _ = s.ws_admins.insert(&owner)?;
        env::log("Initializing E2E KV Store");
        Ok(s)
    }

    // ── identity ─────────────────────────────────────────────────────────────

    /// The caller's identity. `deviceId` is the account too (an API key's id
    /// for an API-key caller): 1.0 runs a method for the account, not for an
    /// installation.
    #[app::view]
    pub fn whoami(&self) -> app::Result<Identity> {
        let (device_id, account_id) = match env::caller() {
            Caller::Account(a) => (a.clone(), a),
            Caller::ApiKey { key_id, account } => (key_id, account),
            _ => return Err(AppError::login_required()),
        };
        Ok(Identity {
            device_id,
            account_id,
        })
    }

    /// The caller's account on its own: the name core's copy of this scaffold
    /// uses, so a scenario runs against either.
    #[app::view]
    pub fn my_account(&self) -> app::Result<String> {
        account()
    }

    // ── host logging ─────────────────────────────────────────────────────────

    /// Writes to the run's log, and stores `probe_key` so the run has a write.
    ///
    /// v1 drove the SDK's `tracing` subscriber with `set_log_level`. The
    /// component SDK has `env::log` only (the host keeps 64 KiB a run), so the
    /// level filter is done here: the warn line always, the info and debug
    /// lines only with `debug`. The lines go to the node's log, never into the
    /// call's answer.
    pub fn tracing_probe(&mut self, debug: bool) -> app::Result<()> {
        if debug {
            env::log("INFO tracing_probe: info line probe=true");
            env::log("DEBUG tracing_probe: debug line probe=true");
        }
        env::log("WARN tracing_probe: warn line");
        let _ = self
            .kv_items
            .insert(&"probe_key".to_owned(), &"probe_value".to_owned())?;
        Ok(())
    }

    // ── KV ───────────────────────────────────────────────────────────────────

    /// Stores `value` under `key`. Emits `Inserted` for a new key, `Updated`
    /// for an existing one.
    pub fn set(&mut self, key: String, value: String) -> app::Result<()> {
        env::log(&format!("Setting key: {key:?} to value: {value:?}"));
        let event = match self.kv_items.insert(&key, &value)? {
            Some(_) => Event::Updated { key, value },
            None => Event::Inserted { key, value },
        };
        env::emit(event, Audience::All)?;
        Ok(())
    }

    /// `set`, then the handler v1 named with the event (`insertHandler` or
    /// `updateHandler`), run in the same call. v1 ran it on every node that
    /// received the event; one log runs it once.
    pub fn set_with_handler(&mut self, key: String, value: String) -> app::Result<()> {
        env::log(&format!(
            "Setting key with handler: {key:?} to value: {value:?}"
        ));
        let existed = self.kv_items.insert(&key, &value)?.is_some();
        if existed {
            env::emit(
                Event::Updated {
                    key: key.clone(),
                    value: value.clone(),
                },
                Audience::All,
            )?;
            self.update_handler(key, value)
        } else {
            env::emit(
                Event::Inserted {
                    key: key.clone(),
                    value: value.clone(),
                },
                Audience::All,
            )?;
            self.insert_handler(key, value)
        }
    }

    /// The value under `key`, or `null`.
    #[app::view]
    pub fn get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.kv_items.get(&key)?)
    }

    /// The value under `key`; `NotFound { key }` when absent.
    #[app::view]
    pub fn get_result(&self, key: String) -> app::Result<String> {
        match self.kv_items.get(&key)? {
            Some(v) => Ok(v),
            None => Err(not_found(key)),
        }
    }

    /// Every key with its value, in key order. At most 1,000 keys: one page.
    #[app::view]
    pub fn entries(&self) -> app::Result<BTreeMap<String, String>> {
        let page = self.kv_items.page(FindOpts::default().limit(PAGE))?;
        Ok(page.items.into_iter().collect())
    }

    /// How many keys are stored (a stored count).
    #[app::view]
    pub fn len(&self) -> app::Result<u64> {
        Ok(self.kv_items.len()?)
    }

    /// Removes `key` and returns its value. Emits `Removed` only when a value
    /// was removed.
    pub fn remove(&mut self, key: String) -> app::Result<Option<String>> {
        let removed = self.kv_items.remove(&key)?;
        if removed.is_some() {
            env::emit(Event::Removed { key }, Audience::All)?;
        }
        Ok(removed)
    }

    /// Removes every key. Emits `Cleared` only when there was something to clear.
    pub fn clear(&mut self) -> app::Result<()> {
        if self.kv_items.clear()? > 0 {
            env::emit(Event::Cleared, Audience::All)?;
        }
        Ok(())
    }

    /// `remove`, then `removeHandler` in the same call. As in v1, `Removed` is
    /// emitted (and the handler runs) whether or not the key existed.
    pub fn remove_with_handler(&mut self, key: String) -> app::Result<Option<String>> {
        let removed = self.kv_items.remove(&key)?;
        env::emit(Event::Removed { key: key.clone() }, Audience::All)?;
        self.remove_handler(key)?;
        Ok(removed)
    }

    /// `clear`, then `clearHandler` in the same call; always emits `Cleared`.
    pub fn clear_with_handler(&mut self) -> app::Result<()> {
        let _ = self.kv_items.clear()?;
        env::emit(Event::Cleared, Audience::All)?;
        self.clear_handler()
    }

    // ── handlers ─────────────────────────────────────────────────────────────

    /// Counts one handler run. Callable directly too, as v1's handlers were.
    pub fn insert_handler(&mut self, key: String, value: String) -> app::Result<()> {
        env::log(&format!(
            "Handler 'insert_handler' called: key={key}, value={value}"
        ));
        let _ = self.handler_counter.increment()?;
        Ok(())
    }

    /// Counts one handler run.
    pub fn update_handler(&mut self, key: String, value: String) -> app::Result<()> {
        env::log(&format!(
            "Handler 'update_handler' called: key={key}, value={value}"
        ));
        let _ = self.handler_counter.increment()?;
        Ok(())
    }

    /// Counts one handler run.
    pub fn remove_handler(&mut self, key: String) -> app::Result<()> {
        env::log(&format!("Handler 'remove_handler' called: key={key}"));
        let _ = self.handler_counter.increment()?;
        Ok(())
    }

    /// Counts one handler run.
    pub fn clear_handler(&mut self) -> app::Result<()> {
        env::log("Handler 'clear_handler' called: all items cleared");
        let _ = self.handler_counter.increment()?;
        Ok(())
    }

    /// How many handler runs there have been.
    #[app::view]
    pub fn get_handler_execution_count(&self) -> app::Result<u64> {
        Ok(self.handler_counter.get()?)
    }

    // ── per-user storage ─────────────────────────────────────────────────────

    /// Sets the caller's own value. Emits `UserSimpleSet`.
    pub fn set_user_simple(&mut self, value: String) -> app::Result<()> {
        let account_id = self.user_items_simple.set(&value)?;
        env::emit(Event::UserSimpleSet { account_id, value }, Audience::All)?;
        Ok(())
    }

    /// The caller's own value, or `null`.
    #[app::view]
    pub fn get_user_simple(&self) -> app::Result<Option<String>> {
        self.user_items_simple.get()
    }

    /// `accountHex`'s value, or `null`. Any account id the node uses.
    #[app::view]
    pub fn get_user_simple_for(&self, account_hex: String) -> app::Result<Option<String>> {
        Ok(self.user_items_simple.get_for(&account_hex)?)
    }

    /// Sets `key` in the caller's own map. Emits `UserNestedSet`.
    pub fn set_user_nested(&mut self, key: String, value: String) -> app::Result<()> {
        let account_id = account()?;
        let _ = self
            .user_items_nested
            .insert(&(account_id.clone(), key.clone()), &value)?;
        env::emit(
            Event::UserNestedSet {
                account_id,
                key,
                value,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// `key` in the caller's own map, or `null`.
    #[app::view]
    pub fn get_user_nested(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.user_items_nested.get(&(account()?, key))?)
    }

    // ── frozen storage ───────────────────────────────────────────────────────

    /// Stores `value` immutably and returns its address: the hex SHA-256 of the
    /// stored (CBOR) value. The same value twice is one entry. Emits `FrozenAdded`.
    pub fn add_frozen(&mut self, value: String) -> app::Result<String> {
        let (hash, _new) = self.frozen_items.insert(&value)?;
        env::emit(
            Event::FrozenAdded {
                hash: hash.clone(),
                value,
            },
            Audience::All,
        )?;
        Ok(hash)
    }

    /// The value at `hashHex`. Not 64 hex characters: `NotFound { key: "dehex
    /// error" }`; no such value: `FrozenNotFound`.
    #[app::view]
    pub fn get_frozen(&self, hash_hex: String) -> app::Result<String> {
        if hash_hex.len() != 64 || !hash_hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(not_found("dehex error"));
        }
        self.frozen_items
            .get(&hash_hex.to_ascii_lowercase())?
            .ok_or_else(|| {
                Error::FrozenNotFound {
                    hash: hash_hex.clone(),
                }
                .into()
            })
    }

    // ── access control ───────────────────────────────────────────────────────
    //
    // Two layers, as in v1: `aclRoles` is a REGISTRY of named roles, and
    // `aclCaps` is the per-account capability map that `aclDocSet` checks. The
    // map is PROJECTED from the registry by `aclProject`, a separate call, so a
    // grant confers nothing until it is projected.

    /// Whether `accountHex` is an ACL admin.
    #[app::view]
    pub fn acl_is_admin(&self, account_hex: String) -> app::Result<bool> {
        Ok(self.acl_admins.contains(&account_hex)?)
    }

    /// Every ACL admin, in key order.
    #[app::view]
    pub fn acl_admins(&self) -> app::Result<Vec<String>> {
        Ok(self.acl_admins.page(FindOpts::default().limit(PAGE))?.items)
    }

    /// Adds an admin (ACL admins only; the account must be the app's owner or
    /// in its org) and projects, so the new admin holds the full mask at once.
    pub fn acl_grant_admin(&mut self, account_hex: String) -> app::Result<()> {
        let by = self.require_acl_admin()?;
        check_known_account(&account_hex)?;
        let _ = self.acl_admins.insert(&account_hex)?;
        env::emit(
            Event::AdminGranted {
                account: account_hex,
                by,
            },
            Audience::All,
        )?;
        let _ = self.project()?;
        Ok(())
    }

    /// Removes an admin (ACL admins only), refusing the last one, then projects.
    pub fn acl_revoke_admin(&mut self, account_hex: String) -> app::Result<()> {
        let by = self.require_acl_admin()?;
        if self.acl_admins.len()? <= 1 && self.acl_admins.contains(&account_hex)? {
            return Err(invalid(
                "refusing to revoke the last admin — the registry would be frozen",
            ));
        }
        let _ = self.acl_admins.remove(&account_hex)?;
        env::emit(
            Event::AdminRevoked {
                account: account_hex,
                by,
            },
            Audience::All,
        )?;
        let _ = self.project()?;
        Ok(())
    }

    /// The roles this app defines, and the operations each confers.
    #[app::view]
    pub fn acl_roles(&self) -> app::Result<BTreeMap<String, Vec<String>>> {
        Ok(ACL_ROLES
            .iter()
            .map(|(role, mask)| ((*role).to_owned(), describe_mask(*mask)))
            .collect())
    }

    /// Grants `role` (ACL admins only). Unknown roles are `Invalid`.
    pub fn acl_grant(&mut self, role: String, account_hex: String) -> app::Result<()> {
        let by = self.require_acl_admin()?;
        check_known_role(&role)?;
        check_known_account(&account_hex)?;
        let _ = self
            .acl_roles
            .insert(&(role.clone(), account_hex.clone()))?;
        env::emit(
            Event::RoleGranted {
                role,
                account: account_hex,
                by,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Revokes `role` (ACL admins only).
    pub fn acl_revoke(&mut self, role: String, account_hex: String) -> app::Result<()> {
        let by = self.require_acl_admin()?;
        check_known_role(&role)?;
        let _ = self
            .acl_roles
            .remove(&(role.clone(), account_hex.clone()))?;
        env::emit(
            Event::RoleRevoked {
                role,
                account: account_hex,
                by,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Whether `accountHex` holds `role` in the registry.
    #[app::view]
    pub fn acl_has_role(&self, role: String, account_hex: String) -> app::Result<bool> {
        Ok(self.acl_roles.contains(&(role, account_hex))?)
    }

    /// The holders of `role`, in key order (at most 1,000).
    #[app::view]
    pub fn acl_members_of(&self, role: String) -> app::Result<Vec<String>> {
        self.members_of(&role)
    }

    /// The caller's roles.
    #[app::view]
    pub fn acl_my_roles(&self) -> app::Result<Vec<String>> {
        let me = account()?;
        let mut mine = Vec::new();
        for (role, _) in &ACL_ROLES {
            if self.acl_roles.contains(&((*role).to_owned(), me.clone()))? {
                mine.push((*role).to_owned());
            }
        }
        Ok(mine)
    }

    /// Rewrites `aclCaps` from the registry (ACL admins only): each role
    /// holder gets its roles' operations, each admin the full mask. Returns
    /// how many accounts the map now covers. Emits `CapabilitiesProjected`.
    pub fn acl_project(&mut self) -> app::Result<u64> {
        let _ = self.require_acl_admin()?;
        self.project()
    }

    /// The projected map: account → the operations it may perform on `aclDoc`.
    #[app::view]
    pub fn acl_capabilities(&self) -> app::Result<BTreeMap<String, Vec<String>>> {
        Ok(self
            .acl_caps
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(account, mask)| (account, describe_mask(mask)))
            .collect())
    }

    /// Writes the guarded document: the caller needs `write` in `aclCaps`.
    pub fn acl_doc_set(&mut self, value: String) -> app::Result<()> {
        let me = account()?;
        let mask = self.acl_caps.get(&me)?.unwrap_or(0);
        if mask & OP_WRITE == 0 {
            return Err(forbidden(
                "Executor is not authorised for this operation: write on aclDoc",
            ));
        }
        self.acl_doc.set(&value)?;
        Ok(())
    }

    /// The guarded document; `""` before the first write.
    #[app::view]
    pub fn acl_doc_get(&self) -> app::Result<String> {
        Ok(self.acl_doc.get()?.unwrap_or_default())
    }

    // ── ownable ──────────────────────────────────────────────────────────────

    /// The owner of the owned cell.
    #[app::view]
    pub fn owned_owner(&self) -> app::Result<Option<String>> {
        Ok(self.owned_owner.get()?)
    }

    /// Whether `accountHex` owns the owned cell.
    #[app::view]
    pub fn owned_is_owner(&self, account_hex: String) -> app::Result<bool> {
        Ok(self.owned_owner.get()?.as_deref() == Some(account_hex.as_str()))
    }

    /// Writes the owned cell (its owner only).
    pub fn owned_set(&mut self, value: String) -> app::Result<()> {
        let _ = self.require_owned_owner()?;
        self.owned_doc.set(&value)?;
        Ok(())
    }

    /// The owned cell; `""` before the first write.
    #[app::view]
    pub fn owned_get(&self) -> app::Result<String> {
        Ok(self.owned_doc.get()?.unwrap_or_default())
    }

    /// Hands the cell to `accountHex` (its owner only; the app's owner or an
    /// org account). One way: the previous owner can no longer write.
    pub fn owned_transfer(&mut self, account_hex: String) -> app::Result<()> {
        let from = self.require_owned_owner()?;
        check_known_account(&account_hex)?;
        self.owned_owner.set(&account_hex)?;
        env::emit(
            Event::OwnershipTransferred {
                from,
                to: account_hex,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── secrets game ─────────────────────────────────────────────────────────

    /// Keeps `secret` for the caller and publishes its SHA-256 for guesses.
    /// v1 kept the secret node-local; here it is the caller's entry in the
    /// app's state, which only `mySecrets` of the same account returns.
    pub fn add_secret(&mut self, game_id: String, secret: String) -> app::Result<()> {
        let me = account()?;
        let _ = self.secrets.insert(&(me, game_id.clone()), &secret)?;
        let hash = hex(&Sha256::digest(secret.as_bytes()));
        let _ = self.games.insert(&game_id, &hash)?;
        env::emit(Event::SecretSet { game_id }, Audience::All)?;
        Ok(())
    }

    /// Whether `guess` is `gameId`'s secret. Emits `Guessed`; `NoHash` when the
    /// game has no secret yet.
    pub fn add_guess(&mut self, game_id: String, guess: String) -> app::Result<bool> {
        let Some(public) = self.games.get(&game_id)? else {
            return Err(Error::NoHash.into());
        };
        let success = hex(&Sha256::digest(guess.as_bytes())) == public;
        env::emit(
            Event::Guessed {
                game_id,
                success,
                by: account()?,
            },
            Audience::All,
        )?;
        Ok(success)
    }

    /// The caller's own secrets, game id → secret (at most 1,000).
    #[app::view]
    pub fn my_secrets(&self) -> app::Result<BTreeMap<String, String>> {
        let me = account()?;
        Ok(self
            .secrets
            .prefix(&[KeyPart::Str(me)], FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|((_, game), secret)| (game, secret))
            .collect())
    }

    /// Every game's public hash (at most 1,000).
    #[app::view]
    pub fn games(&self) -> app::Result<BTreeMap<String, String>> {
        Ok(self
            .games
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .collect())
    }

    // ── files ────────────────────────────────────────────────────────────────

    /// Records a file whose bytes the caller uploaded to this app's blob store
    /// (`blobIdStr`, 64 hex), and returns the record's id. Emits `FileUploaded`.
    pub fn upload_file(
        &mut self,
        name: String,
        blob_id_str: String,
        size: u64,
        mime_type: String,
    ) -> app::Result<String> {
        let blob_id = parse_blob_id(&blob_id_str)?;
        let uploader = account()?;
        let id = format!("file_{}", env::unique_id().replace('.', "_"));
        let record = FileRecord {
            id: id.clone(),
            name: name.clone(),
            blob_id,
            size,
            mime_type,
            uploaded_by: uploader.clone(),
            uploaded_at: env::time_now(),
        };
        let _ = self.files.insert(&id, &record)?;
        env::emit(
            Event::FileUploaded {
                id: id.clone(),
                name,
                size,
                uploader,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Forgets a file record. Emits `FileDeleted`.
    pub fn delete_file(&mut self, file_id: String) -> app::Result<()> {
        let Some(record) = self.files.remove(&file_id)? else {
            return Err(not_found(file_id));
        };
        env::emit(
            Event::FileDeleted {
                id: file_id,
                name: record.name,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Every file record, by id (at most 1,000).
    #[app::view]
    pub fn list_files(&self) -> app::Result<Vec<FileRecord>> {
        Ok(self
            .files
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(_, f)| f)
            .collect())
    }

    /// One file record; `NotFound` when absent.
    #[app::view]
    pub fn get_file(&self, file_id: String) -> app::Result<FileRecord> {
        self.files.get(&file_id)?.ok_or_else(|| not_found(file_id))
    }

    /// A file's blob id.
    #[app::view]
    pub fn get_blob_id_hex(&self, file_id: String) -> app::Result<String> {
        Ok(self.get_file(file_id)?.blob_id)
    }

    /// Files whose name contains `query`, case-insensitive (a scan of the
    /// first 1,000 records).
    #[app::view]
    pub fn search_files(&self, query: String) -> app::Result<Vec<FileRecord>> {
        let q = query.to_lowercase();
        Ok(self
            .list_files()?
            .into_iter()
            .filter(|f| f.name.to_lowercase().contains(&q))
            .collect())
    }

    // ── counters ─────────────────────────────────────────────────────────────

    /// Adds one to the grow-only counter `key` and returns its value.
    pub fn increment_g_counter(&mut self, key: String) -> app::Result<u64> {
        let value = self.g_counters.get(&key)?.unwrap_or(0) + 1;
        let _ = self.g_counters.insert(&key, &value)?;
        env::emit(Event::GCounterIncremented { key, value }, Audience::All)?;
        Ok(value)
    }

    /// The grow-only counter `key`; `NotFound` before its first increment.
    #[app::view]
    pub fn get_g_counter(&self, key: String) -> app::Result<u64> {
        self.g_counters.get(&key)?.ok_or_else(|| not_found(key))
    }

    /// Adds one to the counter `key` and returns its value.
    pub fn increment_pn_counter(&mut self, key: String) -> app::Result<i64> {
        self.change_pn(key, 1, "increment")
    }

    /// Takes one from the counter `key` (it may go below zero).
    pub fn decrement_pn_counter(&mut self, key: String) -> app::Result<i64> {
        self.change_pn(key, -1, "decrement")
    }

    /// The counter `key`; `NotFound` before its first change.
    #[app::view]
    pub fn get_pn_counter(&self, key: String) -> app::Result<i64> {
        self.pn_counters.get(&key)?.ok_or_else(|| not_found(key))
    }

    /// v1's alias of `incrementGCounter`.
    pub fn increment_counter(&mut self, key: String) -> app::Result<u64> {
        self.increment_g_counter(key)
    }

    /// v1's alias of `getGCounter`.
    #[app::view]
    pub fn get_counter(&self, key: String) -> app::Result<u64> {
        self.get_g_counter(key)
    }

    // ── registers ────────────────────────────────────────────────────────────

    /// Sets register `key`; a later write replaces an earlier one.
    pub fn set_register(&mut self, key: String, value: String) -> app::Result<()> {
        let _ = self.registers.insert(&key, &value)?;
        env::emit(Event::RegisterSet { key, value }, Audience::All)?;
        Ok(())
    }

    /// Register `key`; `NotFound` when unset.
    #[app::view]
    pub fn get_register(&self, key: String) -> app::Result<String> {
        self.registers.get(&key)?.ok_or_else(|| not_found(key))
    }

    // ── nested maps ──────────────────────────────────────────────────────────

    /// Sets `innerKey` under `outerKey`.
    pub fn set_metadata(
        &mut self,
        outer_key: String,
        inner_key: String,
        value: String,
    ) -> app::Result<()> {
        let _ = self
            .metadata
            .insert(&(outer_key.clone(), inner_key.clone()), &value)?;
        env::emit(
            Event::MetadataSet {
                outer_key,
                inner_key,
                value,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// `innerKey` under `outerKey`; `NotFound { key: outerKey }` when the outer
    /// key holds nothing, `NotFound { key: innerKey }` when only the inner is missing.
    #[app::view]
    pub fn get_metadata(&self, outer_key: String, inner_key: String) -> app::Result<String> {
        if let Some(v) = self.metadata.get(&(outer_key.clone(), inner_key.clone()))? {
            return Ok(v);
        }
        let outer = self.metadata.prefix(
            &[KeyPart::Str(outer_key.clone())],
            FindOpts::default().limit(1),
        )?;
        if outer.items.is_empty() {
            Err(not_found(outer_key))
        } else {
            Err(not_found(inner_key))
        }
    }

    // ── metrics vector ───────────────────────────────────────────────────────

    /// Appends `value` and returns the new length.
    pub fn push_metric(&mut self, value: u64) -> app::Result<u64> {
        let _ = self.metrics.push(&value)?;
        env::emit(Event::MetricPushed { value }, Audience::All)?;
        Ok(self.metrics.len()?)
    }

    /// The metric at `index`; `NotFound` past the end.
    #[app::view]
    pub fn get_metric(&self, index: u64) -> app::Result<u64> {
        self.metrics
            .get(index)?
            .ok_or_else(|| not_found(index.to_string()))
    }

    /// How many metrics there are.
    #[app::view]
    pub fn metrics_len(&self) -> app::Result<u64> {
        Ok(self.metrics.len()?)
    }

    // ── tags ─────────────────────────────────────────────────────────────────

    /// Adds `tag` to `key`'s set. Emits `TagAdded`.
    pub fn add_tag(&mut self, key: String, tag: String) -> app::Result<()> {
        let count = self.tag_counts.get(&key)?.unwrap_or(0);
        let new = self.tags.insert(&(key.clone(), tag.clone()))?;
        let _ = self.tag_counts.insert(&key, &(count + u64::from(new)))?;
        env::emit(Event::TagAdded { key, tag }, Audience::All)?;
        Ok(())
    }

    /// Whether `key`'s set holds `tag`; `NotFound` when `key` has no tags.
    #[app::view]
    pub fn has_tag(&self, key: String, tag: String) -> app::Result<bool> {
        if !self.tag_counts.contains(&key)? {
            return Err(not_found(key));
        }
        Ok(self.tags.contains(&(key, tag))?)
    }

    /// How many tags `key` holds; `NotFound` when it has none.
    #[app::view]
    pub fn get_tag_count(&self, key: String) -> app::Result<u64> {
        self.tag_counts.get(&key)?.ok_or_else(|| not_found(key))
    }

    // ── sorted collections ───────────────────────────────────────────────────
    //
    // Every map and set reads in key order, so v1's `SortedMap`/`SortedSet`
    // are the same collections: a range or "the largest key" is a seek on the
    // node's ordered store, not a scan.

    /// Sets `key` in the ordered map.
    pub fn sorted_set(&mut self, key: String, value: String) -> app::Result<()> {
        let _ = self.sorted_items.insert(&key, &value)?;
        Ok(())
    }

    /// `key` in the ordered map, or `null`.
    #[app::view]
    pub fn sorted_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.sorted_items.get(&key)?)
    }

    /// Every key in ascending order (at most 1,000).
    #[app::view]
    pub fn sorted_keys(&self) -> app::Result<Vec<String>> {
        Ok(self
            .sorted_items
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(k, _)| k)
            .collect())
    }

    /// Entries with keys in `[start, end)`, ascending (at most 1,000). An
    /// empty or inverted range is `{}`.
    #[app::view]
    pub fn sorted_range(
        &self,
        start: String,
        end: String,
    ) -> app::Result<BTreeMap<String, String>> {
        if start >= end {
            return Ok(BTreeMap::new());
        }
        Ok(self
            .sorted_items
            .range(&start, &end, FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .collect())
    }

    /// The largest key, or `null`.
    #[app::view]
    pub fn sorted_last_key(&self) -> app::Result<Option<String>> {
        Ok(self.sorted_items.last()?.map(|(k, _)| k))
    }

    /// Removes `key`; `true` if it was there.
    pub fn sorted_remove(&mut self, key: String) -> app::Result<bool> {
        Ok(self.sorted_items.remove(&key)?.is_some())
    }

    /// How many keys the ordered map holds.
    #[app::view]
    pub fn sorted_len(&self) -> app::Result<u64> {
        Ok(self.sorted_items.len()?)
    }

    /// Adds `tag` to the ordered set; `true` if it was new.
    pub fn sorted_tag_add(&mut self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.insert(&tag)?)
    }

    /// Removes `tag`; `true` if it was there.
    pub fn sorted_tag_remove(&mut self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.remove(&tag)?)
    }

    /// Whether the ordered set holds `tag`.
    #[app::view]
    pub fn sorted_tag_contains(&self, tag: String) -> app::Result<bool> {
        Ok(self.sorted_tags.contains(&tag)?)
    }

    /// Every tag in ascending order (at most 1,000).
    #[app::view]
    pub fn sorted_tags_all(&self) -> app::Result<Vec<String>> {
        Ok(self
            .sorted_tags
            .page(FindOpts::default().limit(PAGE))?
            .items)
    }

    /// Tags in `[start, end)`, ascending (at most 1,000).
    #[app::view]
    pub fn sorted_tags_range(&self, start: String, end: String) -> app::Result<Vec<String>> {
        if start >= end {
            return Ok(Vec::new());
        }
        Ok(self
            .sorted_tags
            .range(&start, &end, FindOpts::default().limit(PAGE))?
            .items)
    }

    /// The largest tag, or `null`.
    #[app::view]
    pub fn sorted_tags_last(&self) -> app::Result<Option<String>> {
        Ok(self.sorted_tags.last()?)
    }

    // ── text document ────────────────────────────────────────────────────────

    /// Inserts `text` at character `position` (0 ..= length). Emits `TextInserted`.
    pub fn rga_insert_text(&mut self, position: u64, text: String) -> app::Result<()> {
        let editor = account()?;
        let len = self.rga_document.len()?;
        if position > len {
            return Err(invalid(format!(
                "position {position} is past the end of the document ({len})"
            )));
        }
        let _ids = self.rga_document.insert(position, &text)?;
        let _ = self.rga_edit_count.increment()?;
        env::emit(
            Event::TextInserted {
                position,
                text,
                editor,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Deletes the characters in `[start, end)`. Emits `TextDeleted`.
    pub fn rga_delete_text(&mut self, start: u64, end: u64) -> app::Result<()> {
        let editor = account()?;
        let len = self.rga_document.len()?;
        if start > end || end > len {
            return Err(invalid(format!(
                "range {start}..{end} is outside the document (0..{len})"
            )));
        }
        let _ = self.rga_document.delete(start, end - start)?;
        let _ = self.rga_edit_count.increment()?;
        env::emit(Event::TextDeleted { start, end, editor }, Audience::All)?;
        Ok(())
    }

    /// The document's text.
    #[app::view]
    pub fn rga_get_text(&self) -> app::Result<String> {
        Ok(self.rga_document.read()?)
    }

    /// The document's length in characters.
    #[app::view]
    pub fn rga_get_length(&self) -> app::Result<u64> {
        Ok(self.rga_document.len()?)
    }

    /// Whether the document is empty.
    #[app::view]
    pub fn rga_is_empty(&self) -> app::Result<bool> {
        Ok(self.rga_document.is_empty()?)
    }

    /// Renames the document; an empty title is `Invalid`. Emits `TitleChanged`.
    pub fn rga_set_title(&mut self, new_title: String) -> app::Result<()> {
        if new_title.is_empty() {
            return Err(invalid("Title cannot be empty"));
        }
        let editor = account()?;
        let old_title = self.rga_get_title()?;
        let _ = self.rga_metadata.insert(&"title".to_owned(), &new_title)?;
        env::emit(
            Event::TitleChanged {
                old_title,
                new_title,
                editor,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// The title; `"Untitled Document"` until one is set.
    #[app::view]
    pub fn rga_get_title(&self) -> app::Result<String> {
        Ok(self
            .rga_metadata
            .get(&"title".to_owned())?
            .unwrap_or_else(|| "Untitled Document".to_owned()))
    }

    /// Appends `text` at the end.
    pub fn rga_append_text(&mut self, text: String) -> app::Result<()> {
        let len = self.rga_document.len()?;
        self.rga_insert_text(len, text)
    }

    /// Deletes everything (one `TextDeleted` when there was text).
    pub fn rga_clear(&mut self) -> app::Result<()> {
        let len = self.rga_document.len()?;
        if len > 0 {
            self.rga_delete_text(0, len)?;
        }
        Ok(())
    }

    // ── authored map ─────────────────────────────────────────────────────────

    /// Creates the caller's own entry at `key`; `Invalid` when the caller
    /// already holds one there (`authoredUpdate` edits it). Another account's
    /// entry at the same key is theirs and stays. Emits `AuthoredInserted`.
    pub fn authored_insert(&mut self, key: String, value: String) -> app::Result<()> {
        let owner = account()?;
        let slot = (key.clone(), owner.clone());
        if self.authored_items.contains(&slot)? {
            return Err(invalid(format!("key already exists: {key}")));
        }
        let _ = self.authored_items.insert(&slot, &value)?;
        env::emit(Event::AuthoredInserted { key, value, owner }, Audience::All)?;
        Ok(())
    }

    /// Replaces the caller's own entry at `key`; `NotFound` when the caller
    /// holds none there (someone else's entry is not theirs to edit).
    pub fn authored_update(&mut self, key: String, value: String) -> app::Result<()> {
        let me = account()?;
        let slot = (key.clone(), me);
        if !self.authored_items.contains(&slot)? {
            return Err(not_found(key));
        }
        let _ = self.authored_items.insert(&slot, &value)?;
        env::emit(Event::AuthoredUpdated { key, value }, Audience::All)?;
        Ok(())
    }

    /// Removes the caller's own entry at `key` and returns its value.
    pub fn authored_remove(&mut self, key: String) -> app::Result<Option<String>> {
        let me = account()?;
        let removed = self.authored_items.remove(&(key.clone(), me))?;
        if removed.is_some() {
            env::emit(Event::AuthoredRemoved { key }, Audience::All)?;
        }
        Ok(removed)
    }

    /// The value at `key` of whoever holds it: the lowest account's when
    /// several do.
    #[app::view]
    pub fn authored_get(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.lowest_holder(&key)?.map(|(_, v)| v))
    }

    /// `owner`'s own value at `key`.
    #[app::view]
    pub fn authored_get_by(&self, owner: String, key: String) -> app::Result<Option<String>> {
        Ok(self.authored_items.get(&(key, owner))?)
    }

    /// Every account holding an entry at `key`, ascending.
    #[app::view]
    pub fn authored_owners(&self, key: String) -> app::Result<Vec<String>> {
        Ok(self
            .authored_items
            .prefix(&[KeyPart::Str(key)], FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|((_, owner), _)| owner)
            .collect())
    }

    /// Every key with its lowest holder's value (at most 1,000 entries read).
    #[app::view]
    pub fn authored_entries(&self) -> app::Result<BTreeMap<String, String>> {
        let mut out = BTreeMap::new();
        for ((key, _owner), value) in self
            .authored_items
            .page(FindOpts::default().limit(PAGE))?
            .items
        {
            // Pages read in key order, owners ascending: the first is the lowest.
            let _ = out.entry(key).or_insert(value);
        }
        Ok(out)
    }

    /// The account `authoredGet` reads `key` from.
    #[app::view]
    pub fn authored_get_owner(&self, key: String) -> app::Result<Option<String>> {
        Ok(self.lowest_holder(&key)?.map(|(owner, _)| owner))
    }

    /// How many (key, owner) entries there are.
    #[app::view]
    pub fn authored_len(&self) -> app::Result<u64> {
        Ok(self.authored_items.len()?)
    }

    // ── shared storage ───────────────────────────────────────────────────────

    /// Writes the shared cell (its writers only). Emits `SharedSet`.
    pub fn shared_set(&mut self, value: String) -> app::Result<()> {
        let by = self.require_shared_writer()?;
        self.shared_data.set(&value)?;
        env::emit(Event::SharedSet { value, by }, Audience::All)?;
        Ok(())
    }

    /// The shared cell; `""` before the first write.
    #[app::view]
    pub fn shared_get(&self) -> app::Result<String> {
        Ok(self.shared_data.get()?.unwrap_or_default())
    }

    /// The writer set, in key order.
    #[app::view]
    pub fn shared_get_writers(&self) -> app::Result<Vec<String>> {
        Ok(self
            .shared_writers
            .page(FindOpts::default().limit(PAGE))?
            .items)
    }

    /// Adds a writer (writers only; the app's owner or an org account).
    pub fn shared_add_writer(&mut self, account_hex: String) -> app::Result<()> {
        let _ = self.require_shared_writer()?;
        check_known_account(&account_hex)?;
        let _ = self.shared_writers.insert(&account_hex)?;
        env::emit(
            Event::SharedWriterAdded {
                writer: account_hex,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Replaces the whole writer set (writers only). A set without the caller
    /// is allowed and takes them out; an empty set is `Invalid`.
    pub fn shared_rotate_writers(&mut self, account_hexes: Vec<String>) -> app::Result<()> {
        let _ = self.require_shared_writer()?;
        let new: BTreeSet<String> = account_hexes.iter().cloned().collect();
        if new.is_empty() {
            return Err(invalid(
                "refusing to rotate to an empty writer set — the cell would be unwritable",
            ));
        }
        for a in &new {
            check_known_account(a)?;
        }
        let _ = self.shared_writers.clear()?;
        for a in &new {
            let _ = self.shared_writers.insert(a)?;
        }
        env::emit(
            Event::SharedWritersRotated {
                writers: account_hexes,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Whether `accountHex` is a writer.
    #[app::view]
    pub fn shared_is_writer(&self, account_hex: String) -> app::Result<bool> {
        Ok(self.shared_writers.contains(&account_hex)?)
    }

    /// Always `false`: the cell is never frozen (v1 created it unfrozen too).
    #[app::view]
    pub fn shared_is_frozen(&self) -> app::Result<bool> {
        Ok(false)
    }

    // ── authored vector ──────────────────────────────────────────────────────

    /// Appends a slot owned by the caller and returns its index.
    pub fn authored_vec_push(&mut self, value: String) -> app::Result<u64> {
        let owner = account()?;
        let index = self.authored_vec.push(&AuthoredSlot {
            owner: owner.clone(),
            value: Some(value.clone()),
        })?;
        env::emit(
            Event::AuthoredVecPushed {
                index,
                value,
                owner,
            },
            Audience::All,
        )?;
        Ok(index)
    }

    /// The value at `index`; `null` past the end or once removed.
    #[app::view]
    pub fn authored_vec_get(&self, index: u64) -> app::Result<Option<String>> {
        Ok(self.authored_vec.get(index)?.and_then(|s| s.value))
    }

    /// Replaces the value at `index` (its owner only).
    pub fn authored_vec_update(&mut self, index: u64, value: String) -> app::Result<()> {
        let mut slot = self.own_slot(index)?;
        slot.value = Some(value.clone());
        let _ = self.authored_vec.set(index, &slot)?;
        env::emit(Event::AuthoredVecUpdated { index, value }, Audience::All)?;
        Ok(())
    }

    /// Removes the value at `index` (its owner only). The slot stays, so no
    /// other index moves.
    pub fn authored_vec_remove(&mut self, index: u64) -> app::Result<()> {
        let mut slot = self.own_slot(index)?;
        slot.value = None;
        let _ = self.authored_vec.set(index, &slot)?;
        env::emit(Event::AuthoredVecRemoved { index }, Audience::All)?;
        Ok(())
    }

    /// Who pushed the slot at `index`; `null` past the end.
    #[app::view]
    pub fn authored_vec_get_owner(&self, index: u64) -> app::Result<Option<String>> {
        Ok(self.authored_vec.get(index)?.map(|s| s.owner))
    }

    /// The values still present, in index order (at most 1,000 slots read).
    #[app::view]
    pub fn authored_vec_entries(&self) -> app::Result<Vec<String>> {
        Ok(self
            .authored_vec
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .filter_map(|s| s.value)
            .collect())
    }

    /// How many slots there are, removed ones included.
    #[app::view]
    pub fn authored_vec_len(&self) -> app::Result<u64> {
        Ok(self.authored_vec.len()?)
    }

    // ── workspace registry ───────────────────────────────────────────────────
    //
    // An app-level directory above the org: the org says who reaches the app,
    // the workspace role says what the app lets them do.

    /// Names the workspace and makes the caller its admin. Workspace admins
    /// only (the app's owner first); once only.
    pub fn ws_init(&mut self, name: String) -> app::Result<()> {
        if let Some(current) = self.ws_claim.get()? {
            return Err(invalid(format!(
                "workspace already initialized as '{}' by {}",
                current.name, current.admin
            )));
        }
        if name.trim().is_empty() {
            return Err(invalid("workspace name cannot be empty"));
        }
        let admin = account()?;
        if !self.ws_admins.contains(&admin)? {
            return Err(forbidden(format!(
                "account {admin} is not a workspace admin and cannot claim the workspace"
            )));
        }
        self.ws_claim.set(&WsClaim {
            name: name.clone(),
            admin: admin.clone(),
        })?;
        let _ = self.ws_roles.insert(&admin, &ROLE_ADMIN.to_owned())?;
        env::emit(Event::WorkspaceInitialized { name, admin }, Audience::All)?;
        Ok(())
    }

    /// Name, admin and the three counts; `Invalid` while unclaimed.
    #[app::view]
    pub fn ws_get_info(&self) -> app::Result<WorkspaceInfo> {
        let claim = self.claim()?;
        Ok(WorkspaceInfo {
            name: claim.name,
            admin: claim.admin,
            channel_count: self.ws_channels.len()?,
            group_count: self.ws_groups.len()?,
            member_count: self.ws_roles.len()?,
        })
    }

    /// Registers a channel, or updates one the caller registered. A member
    /// that is not `read-only` may; a channel someone else registered is theirs.
    pub fn ws_register_channel(
        &mut self,
        context_id: String,
        name: String,
        topic: String,
    ) -> app::Result<()> {
        let by = self.require_writer()?;
        if context_id.trim().is_empty() {
            return Err(invalid("context_id cannot be empty"));
        }
        if let Some(existing) = self.ws_channels.get(&context_id)? {
            if existing.created_by != by {
                return Err(forbidden(format!(
                    "context {context_id} is registered by another account"
                )));
            }
        }
        let record = ChannelRecord {
            context_id: context_id.clone(),
            name: name.clone(),
            topic,
            created_by: by.clone(),
            registered_at: env::time_now(),
        };
        let _ = self.ws_channels.insert(&context_id, &record)?;
        env::emit(
            Event::ChannelRegistered {
                context_id,
                name,
                by,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Removes a channel: its registrant or a workspace admin.
    pub fn ws_unregister_channel(&mut self, context_id: String) -> app::Result<()> {
        let by = self.require_writer()?;
        let Some(existing) = self.ws_channels.get(&context_id)? else {
            return Err(invalid(format!(
                "no channel registered for context {context_id}"
            )));
        };
        if existing.created_by != by && !self.ws_admins.contains(&by)? {
            return Err(forbidden(
                "only the registrant or a workspace admin may remove a channel",
            ));
        }
        let _ = self.ws_channels.remove(&context_id)?;
        env::emit(Event::ChannelUnregistered { context_id }, Audience::All)?;
        Ok(())
    }

    /// The channel directory, by id (at most 1,000). Readable by anyone the
    /// app admits.
    #[app::view]
    pub fn ws_list_channels(&self) -> app::Result<Vec<ChannelRecord>> {
        Ok(self
            .ws_channels
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(_, c)| c)
            .collect())
    }

    /// Registers or updates a group; ownership as `wsRegisterChannel`.
    pub fn ws_register_group(
        &mut self,
        group_id: String,
        name: String,
        description: String,
    ) -> app::Result<()> {
        let by = self.require_writer()?;
        if group_id.trim().is_empty() {
            return Err(invalid("group_id cannot be empty"));
        }
        if let Some(existing) = self.ws_groups.get(&group_id)? {
            if existing.created_by != by {
                return Err(forbidden(format!(
                    "group {group_id} is registered by another account"
                )));
            }
        }
        let record = WsGroupRecord {
            group_id: group_id.clone(),
            name: name.clone(),
            description,
            created_by: by.clone(),
            registered_at: env::time_now(),
        };
        let _ = self.ws_groups.insert(&group_id, &record)?;
        env::emit(Event::GroupRegistered { group_id, name, by }, Audience::All)?;
        Ok(())
    }

    /// Removes a group: its registrant or a workspace admin.
    pub fn ws_unregister_group(&mut self, group_id: String) -> app::Result<()> {
        let by = self.require_writer()?;
        let Some(existing) = self.ws_groups.get(&group_id)? else {
            return Err(invalid(format!("no group registered with id {group_id}")));
        };
        if existing.created_by != by && !self.ws_admins.contains(&by)? {
            return Err(forbidden(
                "only the registrant or a workspace admin may remove a group",
            ));
        }
        let _ = self.ws_groups.remove(&group_id)?;
        env::emit(Event::GroupUnregistered { group_id }, Audience::All)?;
        Ok(())
    }

    /// The group directory, by id (at most 1,000).
    #[app::view]
    pub fn ws_list_groups(&self) -> app::Result<Vec<WsGroupRecord>> {
        Ok(self
            .ws_groups
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(_, g)| g)
            .collect())
    }

    /// Grants `identity` a workspace role (workspace admins only). Granting or
    /// taking away `admin` also changes who may claim, set roles and moderate.
    /// An admin cannot demote themselves.
    pub fn ws_set_member_role(&mut self, identity: String, role: String) -> app::Result<()> {
        let by = self.require_ws_admin()?;
        if identity.trim().is_empty() {
            return Err(invalid("identity cannot be empty"));
        }
        if !WS_ROLES.contains(&role.as_str()) {
            return Err(invalid(format!(
                "unknown role '{role}' (expected one of: {})",
                WS_ROLES.join(", ")
            )));
        }
        if identity == by && role != ROLE_ADMIN {
            return Err(invalid(
                "an admin cannot demote themselves — the workspace would have none",
            ));
        }
        let _ = self.ws_roles.insert(&identity, &role)?;
        if role == ROLE_ADMIN {
            let _ = self.ws_admins.insert(&identity)?;
        } else {
            let _ = self.ws_admins.remove(&identity)?;
        }
        env::emit(Event::MemberRoleSet { identity, role, by }, Audience::All)?;
        Ok(())
    }

    /// `identity`'s role, or `""`.
    #[app::view]
    pub fn ws_get_member_role(&self, identity: String) -> app::Result<String> {
        Ok(self.ws_roles.get(&identity)?.unwrap_or_default())
    }

    /// The caller's role, or `""`.
    #[app::view]
    pub fn ws_my_role(&self) -> app::Result<String> {
        self.ws_get_member_role(account()?)
    }

    /// Every member and role, by identity (at most 1,000).
    #[app::view]
    pub fn ws_list_members(&self) -> app::Result<Vec<MemberRecord>> {
        Ok(self
            .ws_roles
            .page(FindOpts::default().limit(PAGE))?
            .items
            .into_iter()
            .map(|(identity, role)| MemberRecord { identity, role })
            .collect())
    }

    /// Records a ping to another app instance in the directory and emits
    /// `ChannelPinged`. v1 queued an `xcall` to the target's `ws_pong`; core
    /// `1.0.0-rc.7` components cannot send one, so nothing is sent and the
    /// target's `wsPingCount` does not move.
    pub fn ws_ping_channel(&mut self, target_context_id: String) -> app::Result<()> {
        let by = self.require_writer()?;
        if target_context_id.trim().is_empty() {
            return Err(invalid("target_context_id cannot be empty"));
        }
        env::emit(
            Event::ChannelPinged {
                to_context: target_context_id,
                by,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Receives a ping from another app (`allow(app = "*")`). A direct call by
    /// an account is refused, and so is a caller whose `fromContext` is not
    /// the app id the node reports. Emits `PongReceived`.
    #[app::allow(app = "*")]
    pub fn ws_pong(&mut self, from_context: String) -> app::Result<()> {
        let Caller::App(origin) = env::caller() else {
            return Err(invalid(
                "ws_pong is xcall-only: no cross-app origin (direct call rejected)",
            ));
        };
        if origin != from_context {
            return Err(invalid(format!(
                "xcall provenance mismatch: node-set origin {origin} != claimed from_context {from_context}"
            )));
        }
        let count = self.ws_pings.increment()?;
        env::emit(
            Event::PongReceived {
                from_context,
                count,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Pongs received.
    #[app::view]
    pub fn ws_ping_count(&self) -> app::Result<u64> {
        Ok(self.ws_pings.get()?)
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn require_acl_admin(&self) -> app::Result<String> {
        let me = account()?;
        if !self.acl_admins.contains(&me)? {
            return Err(forbidden(format!("account {me} is not an ACL admin")));
        }
        Ok(me)
    }

    fn require_owned_owner(&self) -> app::Result<String> {
        let me = account()?;
        if self.owned_owner.get()?.as_deref() != Some(me.as_str()) {
            return Err(forbidden(format!("account {me} does not own the cell")));
        }
        Ok(me)
    }

    fn require_shared_writer(&self) -> app::Result<String> {
        let me = account()?;
        if !self.shared_writers.contains(&me)? {
            return Err(forbidden(format!(
                "account {me} is not a writer of the shared cell"
            )));
        }
        Ok(me)
    }

    fn members_of(&self, role: &str) -> app::Result<Vec<String>> {
        Ok(self
            .acl_roles
            .prefix(
                &[KeyPart::Str(role.to_owned())],
                FindOpts::default().limit(PAGE),
            )?
            .items
            .into_iter()
            .map(|(_, account)| account)
            .collect())
    }

    /// Rewrites `aclCaps` from the registry and the admins.
    fn project(&mut self) -> app::Result<u64> {
        let mut masks: BTreeMap<String, u8> = BTreeMap::new();
        for (role, mask) in &ACL_ROLES {
            for account in self.members_of(role)? {
                *masks.entry(account).or_insert(0) |= mask;
            }
        }
        for admin in self.acl_admins.page(FindOpts::default().limit(PAGE))?.items {
            let _ = masks.insert(admin, OP_FULL);
        }
        let _ = self.acl_caps.clear()?;
        for (account, mask) in &masks {
            let _ = self.acl_caps.insert(account, mask)?;
        }
        let accounts = masks.len() as u64;
        env::emit(Event::CapabilitiesProjected { accounts }, Audience::All)?;
        Ok(accounts)
    }

    fn change_pn(&mut self, key: String, delta: i64, operation: &str) -> app::Result<i64> {
        let value = self.pn_counters.get(&key)?.unwrap_or(0) + delta;
        let _ = self.pn_counters.insert(&key, &value)?;
        env::emit(
            Event::PnCounterChanged {
                key,
                value,
                operation: operation.to_owned(),
            },
            Audience::All,
        )?;
        Ok(value)
    }

    fn lowest_holder(&self, key: &str) -> app::Result<Option<(String, String)>> {
        Ok(self
            .authored_items
            .prefix(
                &[KeyPart::Str(key.to_owned())],
                FindOpts::default().limit(1),
            )?
            .items
            .pop()
            .map(|((_, owner), value)| (owner, value)))
    }

    fn own_slot(&self, index: u64) -> app::Result<AuthoredSlot> {
        let me = account()?;
        let Some(slot) = self.authored_vec.get(index)? else {
            return Err(not_found(index.to_string()));
        };
        if slot.owner != me {
            return Err(forbidden(format!(
                "slot {index} belongs to {}, not {me}",
                slot.owner
            )));
        }
        if slot.value.is_none() {
            return Err(not_found(index.to_string()));
        }
        Ok(slot)
    }

    fn claim(&self) -> app::Result<WsClaim> {
        self.ws_claim
            .get()?
            .ok_or_else(|| invalid("workspace not initialized: call ws_init first"))
    }

    /// The caller, if the workspace is claimed and they hold a role.
    fn require_member(&self) -> app::Result<String> {
        let _ = self.claim()?;
        let me = account()?;
        if self.ws_roles.get(&me)?.is_none() {
            return Err(forbidden(format!(
                "account {me} has no workspace role — an admin must grant one with ws_set_member_role"
            )));
        }
        Ok(me)
    }

    /// The caller, if they may write to the directory (not `read-only`).
    fn require_writer(&self) -> app::Result<String> {
        let me = self.require_member()?;
        if self.ws_roles.get(&me)?.as_deref() == Some(ROLE_READ_ONLY) {
            return Err(forbidden(format!(
                "role '{ROLE_READ_ONLY}' cannot modify the workspace directory"
            )));
        }
        Ok(me)
    }

    /// The caller, if they are a workspace admin.
    fn require_ws_admin(&self) -> app::Result<String> {
        let me = self.require_member()?;
        if !self.ws_admins.contains(&me)? {
            let role = self.ws_roles.get(&me)?.unwrap_or_default();
            return Err(forbidden(format!(
                "role '{role}' cannot manage members; '{ROLE_ADMIN}' required"
            )));
        }
        Ok(me)
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// No value under `key` (also a counter, register, file, index or tag key).
    NotFound { key: String },
    /// No frozen value at `hash`.
    FrozenNotFound { hash: String },
    /// `addGuess` on a game with no secret yet.
    NoHash,
    /// The caller may not do this; `message` says which rule refused it.
    Forbidden { message: String },
    /// An argument or the state does not allow it; `message` is v1's text.
    Invalid { message: String },
}

/// What changed, emitted after the write that caused it, to everyone the app
/// reaches.
#[app::event]
pub enum Event {
    Inserted {
        key: String,
        value: String,
    },
    Updated {
        key: String,
        value: String,
    },
    Removed {
        key: String,
    },
    Cleared,
    UserSimpleSet {
        account_id: String,
        value: String,
    },
    UserNestedSet {
        account_id: String,
        key: String,
        value: String,
    },
    FrozenAdded {
        hash: String,
        value: String,
    },
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
    CapabilitiesProjected {
        accounts: u64,
    },
    OwnershipTransferred {
        from: String,
        to: String,
    },
    SecretSet {
        game_id: String,
    },
    Guessed {
        game_id: String,
        success: bool,
        by: String,
    },
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
    GCounterIncremented {
        key: String,
        value: u64,
    },
    PnCounterChanged {
        key: String,
        value: i64,
        operation: String,
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
    TextInserted {
        position: u64,
        text: String,
        editor: String,
    },
    TextDeleted {
        start: u64,
        end: u64,
        editor: String,
    },
    TitleChanged {
        old_title: String,
        new_title: String,
        editor: String,
    },
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
    AuthoredVecPushed {
        index: u64,
        value: String,
        owner: String,
    },
    AuthoredVecUpdated {
        index: u64,
        value: String,
    },
    AuthoredVecRemoved {
        index: u64,
    },
    SharedSet {
        value: String,
        by: String,
    },
    SharedWriterAdded {
        writer: String,
    },
    SharedWritersRotated {
        writers: Vec<String>,
    },
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
        to_context: String,
        by: String,
    },
    PongReceived {
        from_context: String,
        count: u64,
    },
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anything that is not one.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

fn not_found(key: impl Into<String>) -> AppError {
    Error::NotFound { key: key.into() }.into()
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// An account a grant may name: the app's owner, or anyone in its org. v1
/// parsed the id as 64 hex; 1.0's account ids are the node's, so the check is
/// that the node knows the account here.
fn check_known_account(account: &str) -> app::Result<()> {
    if account == env::app_owner() || env::org_role(account).is_some() {
        Ok(())
    } else {
        Err(invalid(format!(
            "not an account of this app's org: {account}"
        )))
    }
}

/// Refuses a role this app does not define.
fn check_known_role(role: &str) -> app::Result<()> {
    if ACL_ROLES.iter().any(|(known, _)| *known == role) {
        return Ok(());
    }
    Err(invalid(format!(
        "unknown role '{role}' (this app defines: {})",
        ACL_ROLES
            .iter()
            .map(|(r, _)| *r)
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

/// A capability mask as the operation names a client can display.
fn describe_mask(mask: u8) -> Vec<String> {
    [
        (OP_WRITE, "write"),
        (OP_DELETE, "delete"),
        (OP_ADMIN, "admin"),
    ]
    .into_iter()
    .filter(|(bit, _)| mask & bit != 0)
    .map(|(_, name)| name.to_owned())
    .collect()
}

/// A blob id: 64 hex characters, lowercased.
fn parse_blob_id(id: &str) -> app::Result<String> {
    if id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id.to_ascii_lowercase())
    } else {
        Err(invalid(format!(
            "Invalid blob ID '{id}': expected 64 hex characters"
        )))
    }
}
