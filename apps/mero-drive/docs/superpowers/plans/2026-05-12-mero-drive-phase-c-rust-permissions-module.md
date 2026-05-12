# Mero Drive — Phase C-Rust: registry permissions module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner/managers + per-(folder, member) `Role` permission layer to the `registry` WASM service — the foundation the frontend's `useFolderRole` hook and the admin panels (Phase C-frontend) build on.

**Architecture:** `registry` keeps a CRDT-replicated `owner` (base58 public key, claimed once), a `managers` set, and a `folder_roles` map keyed `"{folder_id}\u{001F}{member_b58}"` → `Role`. Owner/managers gate role mutations; absent role row ⇒ `Editor`. Caller identity = `calimero_sdk::env::executor_id()` (base58). Public `#[app::logic]` wrappers live in `lib.rs` (ABI emitter only parses `lib.rs`+`events.rs`); the gating helpers, key encoding, and `_inner` methods live in a new `permissions.rs` module; `Role`/`FolderRoleEntry` ABI types in `lib.rs`, `Role` mirrored into the `mero-drive-types` crate (same duplication pattern as `FolderId`/`Visibility`). No core change. App-level "can edit docs" = `Role` (not a core capability bit).

**Tech Stack:** Rust, `calimero-sdk`, `calimero-storage` collections (`LwwRegister`, `UnorderedMap`, `FrozenValue`), `bs58`. WASM target `wasm32-unknown-unknown`, profile `app-release`. Tests: inline `#[cfg(test)] mod tests` driving `_inner` helpers (the public wrappers call `app::emit!`, which panics off-runtime — same convention already used in `registry/src/lib.rs`).

---

## Background / invariants (read before starting)

- `registry/src/lib.rs` already defines `RegistryState` with `folders`/`folder_contexts`/`sort_order`, plus ABI-boundary newtypes `FolderId`/`ContextId` and enum `Visibility` (re-declared from `mero-drive-types`). Keep that style for new ABI types.
- The wasm-abi `build.rs` parses **only** `src/lib.rs` and `src/events.rs`. Anything appearing in a `pub fn` signature inside `#[app::logic] impl RegistryState` (so: `Role`, `FolderRoleEntry`, `FolderId`) must be declared in `lib.rs`. `DriveError` stays internal — keep importing it from `mero_drive_types`.
- `calimero_sdk::env::executor_id()` returns `[u8; 32]`. It calls a host function — **do not call it from `init()` or from any code reached by `cargo test`**; only the public wrappers call it.
- `UnorderedMap`: `insert(k,v) -> Result<Option<V>, _>`, `remove(&q) -> Result<Option<V>, _>`, `contains(&q) -> Result<bool, _>`, `get(&q) -> Result<Option<V>, _>`, `entries() -> Result<impl Iterator<Item=(K,V)>, _>`.
- `LwwRegister<T>`: `new(v)`, `get() -> &T`, `set(v)`. Used as a map *value* already (`sort_order: UnorderedMap<String, LwwRegister<Vec<String>>>`), so `UnorderedMap<String, LwwRegister<Role>>` is a proven shape.
- `FrozenValue<T>` newtype with no-op merge: build with `FrozenValue::from(value)`, read field `.0`. `FrozenValue<()>` is fine for a set-as-map value.
- `UnorderedMap::remove` **tombstones** — re-inserting a removed key does not revive it. In production every folder gets a fresh random group id, so this never bites; the existing `tombstone_persists_after_unregister` test documents it. Same applies to `managers` / `folder_roles`.
- Run all Rust commands from the `logic/` directory of the worktree `/Users/beast/Developer/Calimero/mero-drive--open-restricted`. `cargo test` (host target) and `cargo clippy --all-targets -- -D warnings` must be green; `bash build-bundle.sh` (needs sibling `../../core` for signing; warns + produces unsigned bundle otherwise — that's OK) must succeed and refresh `logic/dist/com.calimero.mero-drive-docs-9.0.0.mpk` + the two `res/abi.json` files.
- **Out of scope for this phase:** removing the existing `set_folder_alias` / `set_visibility` / `FolderRecord.alias` / `FolderRecord.visibility` (vestigial after Phase A but harmless and ABI-stable — a separate cleanup). Do **not** add gating to `register_folder` (any namespace member may register a folder; core gates the subgroup creation). Frontend, merobox, and the `useFolderRole` hook are later phases.

## Key encoding & helpers (used by several tasks)

```rust
// permissions.rs
/// Composite key for the per-(folder, member) role map. U+001F (ASCII Unit
/// Separator) cannot appear in a base58 string or a Calimero group id, so it
/// is a safe, collision-free delimiter.
pub(crate) fn role_key(folder_id: &str, member_b58: &str) -> String {
    format!("{folder_id}\u{1f}{member_b58}")
}

/// Prefix matching every role row for one folder.
pub(crate) fn role_key_prefix(folder_id: &str) -> String {
    format!("{folder_id}\u{1f}")
}

/// base58 public key of the caller (the context executor).
pub(crate) fn caller_b58() -> Result<String, mero_drive_types::DriveError> {
    let id = calimero_sdk::env::executor_id();
    if id.len() != 32 {
        return Err(mero_drive_types::DriveError::Invalid("executor id length".into()));
    }
    Ok(bs58::encode(&id).into_string())
}

/// Validate & normalise an incoming base58 32-byte public key.
pub(crate) fn validate_member_key(s: &str) -> Result<String, mero_drive_types::DriveError> {
    let decoded = bs58::decode(s)
        .into_vec()
        .map_err(|e| mero_drive_types::DriveError::Invalid(format!("bad base58 key: {e}")))?;
    if decoded.len() != 32 {
        return Err(mero_drive_types::DriveError::Invalid("member key length".into()));
    }
    Ok(bs58::encode(&decoded).into_string())
}
```

---

## Task 1: `Role` enum in `mero-drive-types`

**Files:**
- Modify: `logic/crates/types/src/lib.rs`

- [ ] **Step 1: Add the `Role` enum** after the `Visibility` enum, before `DriveError`:

```rust
/// Per-folder collaborator role — the *application* permission for what a
/// member may do inside a folder, distinct from core's namespace-level
/// `MemberCapabilities` bitmask (core gates *joining* a subgroup; this gates
/// what you do once you are in it).
///
/// A member with no explicit role row is treated as `Editor`. `Viewer` is
/// read-only; `Manager` may additionally set other members' folder roles.
///
/// Phase-2 (per-document ACLs, share links, approval workflows) will layer
/// finer-grained grants on top of this in the `docs` service; this enum is
/// the coarse folder-level baseline.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
pub enum Role {
    Viewer,
    #[default]
    Editor,
    Manager,
}
```

- [ ] **Step 2: Add tests** inside the existing `mod tests`:

```rust
#[test]
fn role_default_is_editor() {
    assert_eq!(Role::default(), Role::Editor);
}

#[test]
fn role_borsh_roundtrip() {
    for r in [Role::Viewer, Role::Editor, Role::Manager] {
        let bytes = borsh::to_vec(&r).unwrap();
        let back: Role = borsh::from_slice(&bytes).unwrap();
        assert_eq!(r, back);
    }
}
```

- [ ] **Step 3:** `cd logic && cargo test -p mero-drive-types` → PASS. `cargo clippy -p mero-drive-types --all-targets -- -D warnings` → clean.

- [ ] **Step 4: Commit** — `git add logic/crates/types/src/lib.rs && git commit -m "feat(types): add Role enum (Viewer/Editor/Manager) for folder permissions"` (append the Co-Authored-By trailer).

---

## Task 2: `bs58` dep + ABI types + new `RegistryState` fields

**Files:**
- Modify: `logic/crates/registry/Cargo.toml`
- Modify: `logic/crates/registry/src/lib.rs`

- [ ] **Step 1:** Add to `logic/crates/registry/Cargo.toml` under `[dependencies]`: `bs58 = { workspace = true }` (already in the workspace `[workspace.dependencies]`).

- [ ] **Step 2:** In `lib.rs`, add `pub mod permissions;` near `pub mod events;`.

- [ ] **Step 3:** In `lib.rs`, after the `Visibility` enum (in the "ABI-boundary types" section), add `Role` (mirror of `mero_drive_types::Role`) and `FolderRoleEntry`:

```rust
/// Per-folder collaborator role. **Re-declared here** — it also lives in
/// `mero_drive_types::Role` — because the `calimero-wasm-abi` emitter only
/// parses this crate's `lib.rs` + `events.rs` (same reason `FolderId` /
/// `Visibility` are duplicated). Keep the two definitions in sync.
#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Role {
    Viewer,
    #[default]
    Editor,
    Manager,
}

/// One explicit per-member role row for a folder (what `list_folder_roles`
/// returns). Members not present have the implicit `Editor` role.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FolderRoleEntry {
    /// base58-encoded member public key.
    pub member: String,
    pub role: Role,
}
```

- [ ] **Step 4:** Add three fields to `struct RegistryState` (after `sort_order`):

```rust
    /// base58 public key of the registry owner (the namespace creator).
    /// Empty until `claim_owner` is called once; never reassigned after that.
    owner: LwwRegister<String>,
    /// base58 public keys granted manager rights over the whole registry
    /// (may set/clear any folder role). The owner is implicitly a manager
    /// and is NOT stored here. Set-as-map: value is an inert `FrozenValue`.
    managers: UnorderedMap<String, FrozenValue<()>>,
    /// `role_key(folder_id, member_b58)` → role. Absent ⇒ `Role::Editor`.
    folder_roles: UnorderedMap<String, LwwRegister<Role>>,
```

- [ ] **Step 5:** In `init()`, initialise them:

```rust
            owner: LwwRegister::new(String::new()),
            managers: UnorderedMap::new_with_field_name("registry:managers"),
            folder_roles: UnorderedMap::new_with_field_name("registry:folder_roles"),
```

- [ ] **Step 6:** Create `logic/crates/registry/src/permissions.rs` with just the free helpers from the "Key encoding & helpers" section above plus `use crate::{RegistryState, Role};` and an empty `#[cfg(test)] mod tests {}` placeholder (filled in Task 4). Add the gating helpers as a `impl RegistryState` block:

```rust
//! Permissions layer for the registry service: owner / managers bootstrap and
//! per-(folder, member) `Role` storage. The public `#[app::logic]` wrappers
//! that call these live in `lib.rs` (ABI-emitter constraint); the gating,
//! key encoding, and `_inner` mutators live here.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize}; // (only if needed; remove if unused)
use calimero_storage::collections::{FrozenValue, LwwRegister};
use mero_drive_types::DriveError;

use crate::{FolderRoleEntry, RegistryState, Role};

// ... role_key / role_key_prefix / caller_b58 / validate_member_key (above) ...

impl RegistryState {
    /// True if `caller` is the owner or a manager. Fail-closed: if no owner
    /// has been claimed yet, nobody is an admin.
    pub(crate) fn is_admin(&self, caller: &str) -> Result<bool, DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() {
            return Ok(false);
        }
        if owner == caller {
            return Ok(true);
        }
        self.managers
            .contains(&caller.to_string())
            .map_err(|e| DriveError::Invalid(format!("managers.contains: {e}")))
    }

    pub(crate) fn require_admin(&self, caller: &str) -> Result<(), DriveError> {
        if self.is_admin(caller)? {
            Ok(())
        } else {
            Err(DriveError::Forbidden(format!("not a registry admin: {caller}")))
        }
    }

    pub(crate) fn owner_b58(&self) -> String {
        self.owner.get().clone()
    }

    // claim_owner_inner / add_manager_inner / remove_manager_inner /
    // set_folder_role_inner / clear_folder_role_inner / get_folder_role_inner /
    // list_managers_inner / list_folder_roles_inner — added in Task 3.
}
```

Note: `owner`, `managers`, `folder_roles` are private fields of `RegistryState` in `lib.rs`; since `permissions.rs` is a child module of the same crate it can access them. (If the build complains about privacy, mark those three fields `pub(crate)`.)

- [ ] **Step 7:** `cd logic && cargo build` (host) → compiles. `cargo build --target wasm32-unknown-unknown --profile app-release -p mero-drive-registry` → compiles. `cargo clippy --all-targets -- -D warnings` → clean (delete the unused `BorshSerialize/Deserialize` import line if clippy flags it).

- [ ] **Step 8: Commit** — `git add logic/crates/registry/Cargo.toml logic/crates/registry/src/lib.rs logic/crates/registry/src/permissions.rs && git commit -m "feat(registry): add owner/managers/folder_roles state + permissions module scaffold"`.

---

## Task 3: owner/managers/role `_inner` mutators + public `#[app::logic]` wrappers + events

**Files:**
- Modify: `logic/crates/registry/src/permissions.rs`
- Modify: `logic/crates/registry/src/lib.rs`
- Modify: `logic/crates/registry/src/events.rs`

- [ ] **Step 1: events** — add to `events.rs` enum `Event<'a>`:

```rust
    OwnerClaimed {
        owner: &'a str,
    },
    ManagerAdded {
        member: &'a str,
    },
    ManagerRemoved {
        member: &'a str,
    },
    /// A folder's per-member role was set or cleared (UI re-fetches the row).
    FolderRoleChanged {
        folder_id: &'a str,
        member: &'a str,
    },
```

- [ ] **Step 2: `_inner` mutators** in `permissions.rs` (inside the `impl RegistryState` block):

```rust
    /// Claim ownership of the registry. Idempotent for the current owner;
    /// `Forbidden` if a different key already owns it.
    pub(crate) fn claim_owner_inner(&mut self, caller: &str) -> Result<(), DriveError> {
        let cur = self.owner_b58();
        if cur.is_empty() {
            self.owner.set(caller.to_string());
            Ok(())
        } else if cur == caller {
            Ok(())
        } else {
            Err(DriveError::Forbidden(format!("registry already owned by {cur}")))
        }
    }

    /// Owner-only. Validates `member` as base58. Re-adding an existing
    /// manager is a no-op success.
    pub(crate) fn add_manager_inner(&mut self, caller: &str, member: &str) -> Result<(), DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() || owner != caller {
            return Err(DriveError::Forbidden("only the registry owner may add managers".into()));
        }
        let member = validate_member_key(member)?;
        if member == owner {
            return Err(DriveError::Invalid("owner is implicitly a manager".into()));
        }
        self.managers
            .insert(member, FrozenValue::from(()))
            .map_err(|e| DriveError::Invalid(format!("managers.insert: {e}")))?;
        Ok(())
    }

    /// Owner-only. `NotFound` if `member` is not currently a manager.
    pub(crate) fn remove_manager_inner(&mut self, caller: &str, member: &str) -> Result<(), DriveError> {
        let owner = self.owner_b58();
        if owner.is_empty() || owner != caller {
            return Err(DriveError::Forbidden("only the registry owner may remove managers".into()));
        }
        let member = validate_member_key(member)?;
        let removed = self
            .managers
            .remove(&member)
            .map_err(|e| DriveError::Invalid(format!("managers.remove: {e}")))?;
        if removed.is_none() {
            return Err(DriveError::NotFound(member));
        }
        Ok(())
    }

    pub(crate) fn list_managers_inner(&self) -> Result<Vec<String>, DriveError> {
        let entries = self
            .managers
            .entries()
            .map_err(|e| DriveError::Invalid(format!("managers.entries: {e}")))?;
        Ok(entries.map(|(k, _)| k).collect())
    }

    /// Admin-gated (owner or manager). Folder must exist. Validates `member`.
    pub(crate) fn set_folder_role_inner(
        &mut self,
        caller: &str,
        folder_id: &str,
        member: &str,
        role: Role,
    ) -> Result<(), DriveError> {
        self.require_admin(caller)?;
        let known = self
            .folders
            .contains(&folder_id.to_string())
            .map_err(|e| DriveError::Invalid(format!("folders.contains: {e}")))?;
        if !known {
            return Err(DriveError::NotFound(folder_id.to_string()));
        }
        let member = validate_member_key(member)?;
        self.folder_roles
            .insert(role_key(folder_id, &member), LwwRegister::new(role))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.insert: {e}")))?;
        Ok(())
    }

    /// Admin-gated. Removes the explicit row (member falls back to `Editor`).
    /// `NotFound` if there was no row.
    pub(crate) fn clear_folder_role_inner(
        &mut self,
        caller: &str,
        folder_id: &str,
        member: &str,
    ) -> Result<(), DriveError> {
        self.require_admin(caller)?;
        let member = validate_member_key(member)?;
        let removed = self
            .folder_roles
            .remove(&role_key(folder_id, &member))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.remove: {e}")))?;
        if removed.is_none() {
            return Err(DriveError::NotFound(format!("{folder_id}/{member}")));
        }
        Ok(())
    }

    /// Read — no caller gating. Validates `member` as base58; returns the
    /// stored role or `Role::Editor` if none.
    pub(crate) fn get_folder_role_inner(&self, folder_id: &str, member: &str) -> Result<Role, DriveError> {
        let member = validate_member_key(member)?;
        let reg = self
            .folder_roles
            .get(&role_key(folder_id, &member))
            .map_err(|e| DriveError::Invalid(format!("folder_roles.get: {e}")))?;
        Ok(reg.map(|r| *r.get()).unwrap_or(Role::Editor))
    }

    pub(crate) fn list_folder_roles_inner(&self, folder_id: &str) -> Result<Vec<FolderRoleEntry>, DriveError> {
        let prefix = role_key_prefix(folder_id);
        let entries = self
            .folder_roles
            .entries()
            .map_err(|e| DriveError::Invalid(format!("folder_roles.entries: {e}")))?;
        let mut out = Vec::new();
        for (k, reg) in entries {
            if let Some(member) = k.strip_prefix(&prefix) {
                out.push(FolderRoleEntry { member: member.to_string(), role: *reg.get() });
            }
        }
        Ok(out)
    }

    /// Drop every per-member role row for a folder (called from
    /// `unregister_folder_inner`).
    pub(crate) fn purge_folder_roles(&mut self, folder_id: &str) -> Result<(), DriveError> {
        let prefix = role_key_prefix(folder_id);
        let stale: Vec<String> = self
            .folder_roles
            .entries()
            .map_err(|e| DriveError::Invalid(format!("folder_roles.entries: {e}")))?
            .map(|(k, _)| k)
            .filter(|k| k.starts_with(&prefix))
            .collect();
        for k in stale {
            self.folder_roles
                .remove(&k)
                .map_err(|e| DriveError::Invalid(format!("folder_roles.remove: {e}")))?;
        }
        Ok(())
    }
```

- [ ] **Step 3: public wrappers** in `lib.rs` inside `#[app::logic] impl RegistryState`, after the existing methods (e.g. after `get_sort_order`). Use `AppError::msg(e.to_string())` and `app::emit!` exactly like the existing wrappers; pull the caller via `permissions::caller_b58()`:

```rust
    // ---- permissions: owner / managers ----------------------------------

    pub fn claim_owner(&mut self) -> app::Result<()> {
        let caller = permissions::caller_b58().map_err(|e| AppError::msg(e.to_string()))?;
        self.claim_owner_inner(&caller).map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::OwnerClaimed { owner: &caller });
        Ok(())
    }

    pub fn get_owner(&self) -> app::Result<Option<String>> {
        let o = self.owner_b58();
        Ok(if o.is_empty() { None } else { Some(o) })
    }

    pub fn add_manager(&mut self, member: String) -> app::Result<()> {
        let caller = permissions::caller_b58().map_err(|e| AppError::msg(e.to_string()))?;
        let member_for_event = member.clone();
        self.add_manager_inner(&caller, &member).map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::ManagerAdded { member: &member_for_event });
        Ok(())
    }

    pub fn remove_manager(&mut self, member: String) -> app::Result<()> {
        let caller = permissions::caller_b58().map_err(|e| AppError::msg(e.to_string()))?;
        let member_for_event = member.clone();
        self.remove_manager_inner(&caller, &member).map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::ManagerRemoved { member: &member_for_event });
        Ok(())
    }

    pub fn list_managers(&self) -> app::Result<Vec<String>> {
        self.list_managers_inner().map_err(|e| AppError::msg(e.to_string()))
    }

    // ---- permissions: per-folder roles ----------------------------------

    pub fn set_folder_role(&mut self, folder_id: FolderId, member: String, role: Role) -> app::Result<()> {
        let caller = permissions::caller_b58().map_err(|e| AppError::msg(e.to_string()))?;
        let fid = folder_id.0.clone();
        let member_for_event = member.clone();
        self.set_folder_role_inner(&caller, &folder_id.0, &member, role)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderRoleChanged { folder_id: &fid, member: &member_for_event });
        Ok(())
    }

    pub fn clear_folder_role(&mut self, folder_id: FolderId, member: String) -> app::Result<()> {
        let caller = permissions::caller_b58().map_err(|e| AppError::msg(e.to_string()))?;
        let fid = folder_id.0.clone();
        let member_for_event = member.clone();
        self.clear_folder_role_inner(&caller, &folder_id.0, &member)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::FolderRoleChanged { folder_id: &fid, member: &member_for_event });
        Ok(())
    }

    pub fn get_folder_role(&self, folder_id: FolderId, member: String) -> app::Result<Role> {
        self.get_folder_role_inner(&folder_id.0, &member).map_err(|e| AppError::msg(e.to_string()))
    }

    pub fn list_folder_roles(&self, folder_id: FolderId) -> app::Result<Vec<FolderRoleEntry>> {
        self.list_folder_roles_inner(&folder_id.0).map_err(|e| AppError::msg(e.to_string()))
    }
```

Add `use permissions;` / `mod permissions;` is already there from Task 2; reference helpers as `permissions::caller_b58()`. (If the module is `pub mod permissions;` you can also `use crate::permissions;` — match the crate's existing import style.)

- [ ] **Step 4:** Wire the purge into `unregister_folder_inner` (in `lib.rs`) — after `let _ = self.folder_contexts.remove(&id.0);`, add:

```rust
        // Drop any per-member role rows for this folder (CRDT-tombstoned —
        // documented alongside the FolderId tombstone semantics).
        self.purge_folder_roles(&id.0)?;
```

- [ ] **Step 5:** `cd logic && cargo build && cargo build --target wasm32-unknown-unknown --profile app-release -p mero-drive-registry` → compile. `cargo clippy --all-targets -- -D warnings` → clean.

- [ ] **Step 6: Commit** — `git add logic/crates/registry/ && git commit -m "feat(registry): owner/managers + per-folder Role API (set/clear/get/list, purge on unregister)"`.

---

## Task 4: Rust unit tests for the permissions layer

**Files:**
- Modify: `logic/crates/registry/src/permissions.rs` (`#[cfg(test)] mod tests`)

Use this fixed test fixture (32-byte keys, base58-encoded). At the top of the test module:

```rust
#[cfg(test)]
mod tests {
    use crate::{RegistryState, Role};
    use mero_drive_types::DriveError;

    fn key(byte: u8) -> String {
        bs58::encode([byte; 32]).into_string()
    }
    fn fid(s: &str) -> crate::FolderId {
        crate::FolderId(s.to_string())
    }

    // Convenience: a state with a folder "f1" registered and `owner` claimed.
    fn with_owner_and_folder(owner: &str) -> RegistryState {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None).unwrap();
        app.claim_owner_inner(owner).unwrap();
        app
    }
    // ... tests below ...
}
```

- [ ] **Step 1: write the failing tests** (then implement is already done in Task 3, so they should pass — if any fail, fix Task-3 code):

```rust
    // ---- claim_owner ----
    #[test]
    fn claim_owner_sets_owner_when_unclaimed() {
        let mut app = RegistryState::init();
        assert_eq!(app.owner_b58(), "");
        app.claim_owner_inner(&key(1)).unwrap();
        assert_eq!(app.owner_b58(), key(1));
    }
    #[test]
    fn claim_owner_is_idempotent_for_owner() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.claim_owner_inner(&key(1)).unwrap(); // no error
        assert_eq!(app.owner_b58(), key(1));
    }
    #[test]
    fn claim_owner_rejects_second_claimer() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        let err = app.claim_owner_inner(&key(2)).unwrap_err();
        assert!(matches!(err, DriveError::Forbidden(_)));
        assert_eq!(app.owner_b58(), key(1));
    }

    // ---- is_admin / require_admin ----
    #[test]
    fn is_admin_false_before_owner_claimed() {
        let app = RegistryState::init();
        assert!(!app.is_admin(&key(1)).unwrap());
    }
    #[test]
    fn owner_is_admin_managers_are_admin_others_are_not() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        assert!(app.is_admin(&key(1)).unwrap());
        assert!(app.is_admin(&key(2)).unwrap());
        assert!(!app.is_admin(&key(3)).unwrap());
        assert!(app.require_admin(&key(3)).is_err());
    }

    // ---- managers ----
    #[test]
    fn add_manager_requires_owner() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        // a non-owner (even though there are no managers yet) cannot add
        let err = app.add_manager_inner(&key(2), &key(3)).unwrap_err();
        assert!(matches!(err, DriveError::Forbidden(_)));
    }
    #[test]
    fn add_manager_rejects_owner_as_member_and_bad_key() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        assert!(matches!(app.add_manager_inner(&key(1), &key(1)).unwrap_err(), DriveError::Invalid(_)));
        assert!(matches!(app.add_manager_inner(&key(1), "not-base58!!").unwrap_err(), DriveError::Invalid(_)));
        assert!(matches!(app.add_manager_inner(&key(1), &bs58::encode([0u8; 16]).into_string()).unwrap_err(), DriveError::Invalid(_)));
    }
    #[test]
    fn add_then_remove_manager_roundtrips_and_is_listed() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.add_manager_inner(&key(1), &key(2)).unwrap(); // re-add: ok
        assert_eq!(app.list_managers_inner().unwrap(), vec![key(2)]);
        app.remove_manager_inner(&key(1), &key(2)).unwrap();
        assert!(app.list_managers_inner().unwrap().is_empty());
        assert!(!app.is_admin(&key(2)).unwrap());
    }
    #[test]
    fn remove_unknown_manager_is_not_found() {
        let mut app = RegistryState::init();
        app.claim_owner_inner(&key(1)).unwrap();
        assert!(matches!(app.remove_manager_inner(&key(1), &key(9)).unwrap_err(), DriveError::NotFound(_)));
    }

    // ---- folder roles ----
    #[test]
    fn get_folder_role_defaults_to_editor() {
        let app = with_owner_and_folder(&key(1));
        assert_eq!(app.get_folder_role_inner("f1", &key(7)).unwrap(), Role::Editor);
        // even for an unknown folder:
        assert_eq!(app.get_folder_role_inner("ghost", &key(7)).unwrap(), Role::Editor);
    }
    #[test]
    fn set_folder_role_then_get_returns_it() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer).unwrap();
        assert_eq!(app.get_folder_role_inner("f1", &key(7)).unwrap(), Role::Viewer);
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Manager).unwrap(); // LWW overwrite
        assert_eq!(app.get_folder_role_inner("f1", &key(7)).unwrap(), Role::Manager);
    }
    #[test]
    fn set_folder_role_requires_admin() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(app.set_folder_role_inner(&key(2), "f1", &key(7), Role::Viewer).unwrap_err(), DriveError::Forbidden(_)));
        // a manager can:
        app.add_manager_inner(&key(1), &key(2)).unwrap();
        app.set_folder_role_inner(&key(2), "f1", &key(7), Role::Viewer).unwrap();
    }
    #[test]
    fn set_folder_role_unknown_folder_is_not_found() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(app.set_folder_role_inner(&key(1), "ghost", &key(7), Role::Viewer).unwrap_err(), DriveError::NotFound(_)));
    }
    #[test]
    fn set_folder_role_rejects_bad_member_key() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(app.set_folder_role_inner(&key(1), "f1", "bad!!", Role::Viewer).unwrap_err(), DriveError::Invalid(_)));
    }
    #[test]
    fn clear_folder_role_removes_row_and_falls_back_to_editor() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer).unwrap();
        app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap();
        assert_eq!(app.get_folder_role_inner("f1", &key(7)).unwrap(), Role::Editor);
    }
    #[test]
    fn clear_folder_role_no_row_is_not_found() {
        let mut app = with_owner_and_folder(&key(1));
        assert!(matches!(app.clear_folder_role_inner(&key(1), "f1", &key(7)).unwrap_err(), DriveError::NotFound(_)));
    }
    #[test]
    fn clear_folder_role_requires_admin() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(7), Role::Viewer).unwrap();
        assert!(matches!(app.clear_folder_role_inner(&key(2), "f1", &key(7)).unwrap_err(), DriveError::Forbidden(_)));
    }
    #[test]
    fn list_folder_roles_only_returns_rows_for_that_folder() {
        let mut app = RegistryState::init();
        app.register_folder_inner(fid("f1"), None, None, None).unwrap();
        app.register_folder_inner(fid("f2"), None, None, None).unwrap();
        app.claim_owner_inner(&key(1)).unwrap();
        app.set_folder_role_inner(&key(1), "f1", &key(2), Role::Viewer).unwrap();
        app.set_folder_role_inner(&key(1), "f1", &key(3), Role::Manager).unwrap();
        app.set_folder_role_inner(&key(1), "f2", &key(2), Role::Viewer).unwrap();
        let mut rows = app.list_folder_roles_inner("f1").unwrap();
        rows.sort_by(|a, b| a.member.cmp(&b.member));
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.member == key(2) && r.role == Role::Viewer));
        assert!(rows.iter().any(|r| r.member == key(3) && r.role == Role::Manager));
        assert_eq!(app.list_folder_roles_inner("f2").unwrap().len(), 1);
    }
    #[test]
    fn unregister_folder_purges_its_roles() {
        let mut app = with_owner_and_folder(&key(1));
        app.set_folder_role_inner(&key(1), "f1", &key(2), Role::Viewer).unwrap();
        app.unregister_folder_inner(fid("f1")).unwrap();
        assert!(app.list_folder_roles_inner("f1").unwrap().is_empty());
        // and a fresh, distinct folder id has no inherited rows:
        app.register_folder_inner(fid("f2"), None, None, None).unwrap();
        assert_eq!(app.get_folder_role_inner("f2", &key(2)).unwrap(), Role::Editor);
    }
    #[test]
    fn role_key_uses_unit_separator_and_is_unambiguous() {
        // "a" + member vs "a\u{1f}..." prefix must not collide with "a\u{1f}b" + member
        let k1 = super::role_key("a", &key(1));
        let k2 = super::role_key("a\u{1f}b", &key(1));
        assert_ne!(k1, k2);
        assert!(k1.starts_with(&super::role_key_prefix("a")));
        assert!(!k1.starts_with(&super::role_key_prefix("a\u{1f}b")));
    }
```

Adjust visibility (`super::role_key` etc.) so the tests compile — `role_key`/`role_key_prefix` are `pub(crate)` in `permissions`, so from `permissions::tests` they're reachable as `super::role_key` or `crate::permissions::role_key`.

- [ ] **Step 2:** `cd logic && cargo test` → all green (existing 30-ish registry tests + types tests + the new permissions tests).

- [ ] **Step 3:** `cargo clippy --all-targets -- -D warnings` → clean. `cargo fmt --check` (if the repo enforces it — check for `rustfmt.toml`; if `cargo fmt --check` was not previously clean, skip).

- [ ] **Step 4: Commit** — `git add logic/crates/registry/src/permissions.rs && git commit -m "test(registry): unit tests for owner/managers + per-folder Role"`.

---

## Task 5: regenerate ABI + rebuild the bundle

**Files (build outputs):**
- `logic/crates/registry/res/abi.json`, `logic/crates/docs/res/abi.json`
- `logic/dist/com.calimero.mero-drive-docs-9.0.0.mpk`
- (codegen) `app/src/api/registry/*` — regenerate from the new ABI

- [ ] **Step 1:** `cd logic && bash build-bundle.sh`. Expect: "Bundle created: dist/com.calimero.mero-drive-docs-9.0.0.mpk" (with sibling `../../core` present it signs; if not, it warns "bundle will be UNSIGNED" — acceptable). Confirm `git status` shows `logic/crates/registry/res/abi.json` and `logic/dist/...mpk` changed.

- [ ] **Step 2:** Regenerate the TS client from the new registry ABI: from the repo root, `pnpm --dir app run codegen` (it runs `calimero-abi-codegen` for both `registry` and `docs`). Confirm `app/src/api/registry/` now contains `claimOwner`/`getOwner`/`addManager`/`removeManager`/`listManagers`/`setFolderRole`/`clearFolderRole`/`getFolderRole`/`listFolderRoles` and the `Role` / `FolderRoleEntry` types.

- [ ] **Step 3:** `pnpm --dir app exec tsc --noEmit` → 0 errors (the generated client should be self-consistent; if Phase-A app code references the registry client in a way that the new generated types break, that's a Phase-B/C-frontend concern — note it, don't fix here, but it should be additive so expect 0).

- [ ] **Step 4: Commit** — `git add logic/crates/registry/res/abi.json logic/crates/docs/res/abi.json logic/dist/ app/src/api/ && git commit -m "build(logic): regenerate registry ABI + bundle + TS client for permissions API"`.

---

## Task 6: push

- [ ] **Step 1:** `git push origin feat/open-restricted-folders-permissions`.

- [ ] **Step 2:** Report the commit list and confirm `cargo test` + `cargo clippy` + `bash build-bundle.sh` + `tsc --noEmit` all green.

---

## Self-review checklist (run before reporting)

1. **Spec coverage:** owner bootstrap (`claim_owner`) ✔; managers add/remove/list owner-gated ✔; per-(folder,member) `Role{Viewer,Editor,Manager}`, absent⇒Editor ✔; set/clear/get/list_folder_roles owner/managers-gated + events ✔; tombstone roles on `unregister_folder` ✔; `Role` in `types` ✔; events ✔. Not done (deliberately, see "Out of scope"): retiring `set_folder_alias`/`set_visibility`; gating `register_folder`.
2. **Placeholder scan:** none — every step has concrete code or a concrete command.
3. **Type consistency:** `Role` (3 variants, `Editor` default) identical in `types` and `registry::lib`; `FolderRoleEntry { member: String, role: Role }`; `_inner` helpers take `caller: &str` first; key = `role_key(folder, member) = "{folder}\u{1f}{member}"`.
4. **ABI constraint:** `Role`, `FolderRoleEntry`, all `pub fn` permission wrappers, and `FolderId` references live in `lib.rs`; helpers/`_inner` in `permissions.rs`. ✔
