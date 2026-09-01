# Namespace Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild mero-drive on Calimero namespaces + nested groups, replacing the single-group "workspace" model with a multi-service WASM (`registry` + `docs`) and mero-react hooks.

**Architecture:** Workspace = namespace (root group); folder = nested child group; subfolder = recursively nested group (depth cap 8). Two Rust services bundled as one `.mpk`: `registry` (color/visibility/folder→context binding/sort order) and `docs` (per-folder documents). Admin API owns group shape + membership + caps; registry owns presentation metadata. No data migration — v9.0.0 is a clean cutoff, old app ID is abandoned.

**Tech Stack:** Rust (wasm32) with `calimero-sdk` + `calimero-storage`; TypeScript React app on Vite; `@calimero-network/mero-react@^1.0.2` hooks; `@calimero-network/abi-codegen` for generated clients; vitest for unit + component tests; merobox for e2e.

**Branch:** `feat/namespace-migration` (already created from `origin/master`)

**Spec:** `docs/superpowers/specs/2026-04-20-namespace-migration-design.md`

---

## Phase 1: Logic Workspace Foundation

Creates the two-crate Rust workspace (types + registry), gets the registry building as a `.wasm` with its own ABI. No app-side changes yet.

### Task 1: Archive old logic and initialize workspace manifest

**Files:**
- Delete: `logic/src/lib.rs`
- Delete: `logic/Cargo.toml` (old single-crate)
- Delete: `logic/build.sh`
- Delete: `logic/res/abi.json`
- Create: `logic/Cargo.toml` (new workspace manifest)
- Create: `logic/rust-toolchain.toml`
- Create: `logic/.gitignore`

- [ ] **Step 1: Remove old single-crate logic**

```bash
git rm logic/src/lib.rs logic/Cargo.toml logic/build.sh
git rm -f logic/res/abi.json || true
rm -rf logic/src logic/res logic/target
```

- [ ] **Step 2: Create workspace `Cargo.toml`**

```toml
[workspace]
members = ["crates/types", "crates/registry", "crates/docs"]
resolver = "2"

[workspace.dependencies]
calimero-sdk = { git = "https://github.com/calimero-network/core", branch = "master" }
calimero-storage = { git = "https://github.com/calimero-network/core", branch = "master" }
calimero-storage-macros = { git = "https://github.com/calimero-network/core", branch = "master" }
calimero-wasm-abi = { git = "https://github.com/calimero-network/core", branch = "master" }
borsh = "1.5"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
bs58 = "0.5"
mero-drive-types = { path = "crates/types" }

[profile.app-release]
inherits = "release"
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
```

- [ ] **Step 3: Create `rust-toolchain.toml`**

```toml
[toolchain]
channel = "stable"
targets = ["wasm32-unknown-unknown"]
```

- [ ] **Step 4: Create `logic/.gitignore`**

```
target/
crates/*/res/*.wasm
bundle/
*.mpk
```

- [ ] **Step 5: Commit**

```bash
git add -A logic/
git commit -m "chore(logic): remove old single-crate and init workspace"
```

---

### Task 2: Create `mero-drive-types` crate

**Files:**
- Create: `logic/crates/types/Cargo.toml`
- Create: `logic/crates/types/src/lib.rs`

- [ ] **Step 1: Create `logic/crates/types/Cargo.toml`**

```toml
[package]
name = "mero-drive-types"
version = "9.0.0"
edition = "2021"

[dependencies]
borsh = { workspace = true, features = ["derive"] }
serde = { workspace = true }
thiserror = { workspace = true }
bs58 = { workspace = true }
```

- [ ] **Step 2: Create `logic/crates/types/src/lib.rs`**

```rust
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEFAULT_CHILD_CAP_MASK: u32 = 1 | 2 | 4; // READ | WRITE | CREATE_GROUP
pub const MAX_FOLDER_DEPTH: u8 = 8;

#[derive(Debug, Clone, PartialEq, Eq, Hash, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct FolderId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct ContextId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub enum Visibility {
    Inherit,
    Restricted,
}

impl Default for Visibility {
    fn default() -> Self { Visibility::Inherit }
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "data")]
pub enum DriveError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("conflict: {0}")]
    Conflict(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visibility_default_is_inherit() {
        assert_eq!(Visibility::default(), Visibility::Inherit);
    }

    #[test]
    fn default_child_mask_bits() {
        assert_eq!(DEFAULT_CHILD_CAP_MASK, 7);
    }

    #[test]
    fn folder_id_borsh_roundtrip() {
        let id = FolderId("abc".into());
        let bytes = borsh::to_vec(&id).unwrap();
        let back: FolderId = borsh::from_slice(&bytes).unwrap();
        assert_eq!(id, back);
    }
}
```

- [ ] **Step 3: Run unit tests**

Run: `cd logic && cargo test -p mero-drive-types`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add logic/crates/types/
git commit -m "feat(logic/types): add shared FolderId, Visibility, DriveError"
```

---

### Task 3: Scaffold `registry` crate (empty app + build script)

**Files:**
- Create: `logic/crates/registry/Cargo.toml`
- Create: `logic/crates/registry/build.rs`
- Create: `logic/crates/registry/build.sh`
- Create: `logic/crates/registry/src/lib.rs` (skeleton)
- Create: `logic/crates/registry/src/events.rs`

- [ ] **Step 1: Create `Cargo.toml`**

```toml
[package]
name = "mero-drive-registry"
version = "9.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
mero-drive-types = { workspace = true }
calimero-sdk = { workspace = true }
calimero-storage = { workspace = true }
calimero-storage-macros = { workspace = true }
borsh = { workspace = true }
serde = { workspace = true }

[build-dependencies]
calimero-wasm-abi = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 2: Create `build.rs` (ABI emission)**

```rust
use std::fs;
use std::path::Path;
use calimero_wasm_abi::emitter::emit_manifest_from_crate;

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/events.rs");

    let src_dir = Path::new("src");
    let module_files = ["lib.rs", "events.rs"];
    let mut sources = Vec::new();
    for f in module_files {
        let path = src_dir.join(f);
        let content = fs::read_to_string(&path).expect("read src file");
        sources.push((f.to_string(), content));
    }

    let manifest = emit_manifest_from_crate(&sources)
        .expect("emit abi manifest");
    fs::create_dir_all("res").unwrap();
    let json = serde_json::to_string_pretty(&manifest).unwrap();
    fs::write("res/abi.json", json).expect("write abi.json");
}
```

- [ ] **Step 3: Create `build.sh`**

```bash
#!/bin/bash
set -e
cd "$(dirname $0)"
TARGET="${CARGO_TARGET_DIR:-../../target}"
rustup target add wasm32-unknown-unknown 2>/dev/null || true
cargo build --target wasm32-unknown-unknown --profile app-release
mkdir -p res
cp $TARGET/wasm32-unknown-unknown/app-release/mero_drive_registry.wasm ./res/registry.wasm
if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/registry.wasm -o ./res/registry.wasm
fi
```

- [ ] **Step 4: Create empty `src/events.rs`**

```rust
#[calimero_sdk::app::event]
pub enum Event<'a> {
    FolderRegistered { id: &'a str },
    FolderUnregistered { id: &'a str },
    FolderContextBound { folder_id: &'a str, context_id: &'a str },
    FolderVisibilityChanged { id: &'a str },
    FolderColorChanged { id: &'a str },
    FolderSortOrderChanged { parent_id: &'a str },
}
```

- [ ] **Step 5: Create skeleton `src/lib.rs`**

```rust
use calimero_sdk::app;
use calimero_storage_macros::AppState;

mod events;

#[app::state(emits = for<'a> events::Event<'a>)]
#[derive(Default, AppState, borsh::BorshSerialize, borsh::BorshDeserialize)]
pub struct RegistryApp {}

#[app::logic]
impl RegistryApp {
    #[app::init]
    pub fn init() -> RegistryApp { RegistryApp::default() }
}
```

- [ ] **Step 6: Build**

```bash
chmod +x logic/crates/registry/build.sh
(cd logic/crates/registry && ./build.sh)
```

Expected: `logic/crates/registry/res/registry.wasm` and `res/abi.json` exist.

- [ ] **Step 7: Commit**

```bash
git add logic/crates/registry/
git commit -m "feat(logic/registry): scaffold empty RegistryApp with abi emission"
```

---

### Task 4: Implement registry state types and `register_folder` / `unregister_folder`

**Files:**
- Modify: `logic/crates/registry/src/lib.rs`
- Create: `logic/crates/registry/src/state.rs`
- Create: `logic/crates/registry/tests/folders.rs`

- [ ] **Step 1: Add state module `logic/crates/registry/src/state.rs`**

```rust
use borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::collections::{LwwRegister, UnorderedMap, Vector};
use mero_drive_types::{FolderId, ContextId, Visibility};

#[derive(BorshSerialize, BorshDeserialize)]
pub struct FolderRecord {
    pub id: FolderId,
    pub parent_id: Option<FolderId>,
    pub visibility: LwwRegister<Visibility>,
    pub color: LwwRegister<String>,
}

#[derive(BorshSerialize, BorshDeserialize, Default)]
pub struct State {
    pub folders: UnorderedMap<FolderId, FolderRecord>,
    pub folder_contexts: UnorderedMap<FolderId, ContextId>,
    pub sort_order: UnorderedMap<Option<FolderId>, Vector<FolderId>>,
}
```

- [ ] **Step 2: Write failing test `tests/folders.rs`**

```rust
use mero_drive_registry::RegistryApp;
use mero_drive_types::{FolderId, Visibility, DriveError};

#[test]
fn register_folder_appears_in_get_folders() {
    let mut app = RegistryApp::init();
    let id = FolderId("folder-1".into());
    app.register_folder(id.clone(), None, Some("#123456".into())).unwrap();
    let all = app.get_folders();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, id);
    assert_eq!(all[0].visibility, Visibility::Inherit);
}

#[test]
fn register_duplicate_is_idempotent() {
    let mut app = RegistryApp::init();
    let id = FolderId("folder-1".into());
    app.register_folder(id.clone(), None, None).unwrap();
    let r = app.register_folder(id.clone(), None, None);
    assert!(matches!(r, Err(DriveError::AlreadyExists(_))));
}

#[test]
fn unregister_removes_and_clears_binding() {
    let mut app = RegistryApp::init();
    let id = FolderId("folder-1".into());
    app.register_folder(id.clone(), None, None).unwrap();
    app.unregister_folder(id.clone()).unwrap();
    assert_eq!(app.get_folders().len(), 0);
}
```

- [ ] **Step 3: Run the tests to confirm failure**

Run: `cd logic && cargo test -p mero-drive-registry --test folders`
Expected: FAIL — `register_folder`, `get_folders`, `unregister_folder` not defined.

- [ ] **Step 4: Implement methods in `src/lib.rs`**

```rust
use calimero_sdk::app;
use calimero_storage_macros::AppState;
use mero_drive_types::{FolderId, Visibility, DriveError};
use serde::Serialize;

mod events;
mod state;

use state::{State, FolderRecord};

#[app::state(emits = for<'a> events::Event<'a>)]
#[derive(Default, AppState, borsh::BorshSerialize, borsh::BorshDeserialize)]
pub struct RegistryApp { state: State }

#[derive(Serialize)]
pub struct FolderDto {
    pub id: FolderId,
    pub parent_id: Option<FolderId>,
    pub visibility: Visibility,
    pub color: Option<String>,
}

#[app::logic]
impl RegistryApp {
    #[app::init]
    pub fn init() -> RegistryApp { RegistryApp::default() }

    pub fn register_folder(
        &mut self,
        id: FolderId,
        parent_id: Option<FolderId>,
        color: Option<String>,
    ) -> Result<(), DriveError> {
        if self.state.folders.contains_key(&id)? {
            return Err(DriveError::AlreadyExists(id.0));
        }
        let record = FolderRecord {
            id: id.clone(),
            parent_id: parent_id.clone(),
            visibility: LwwRegister::new(Visibility::Inherit),
            color: LwwRegister::new(color.unwrap_or_default()),
        };
        self.state.folders.insert(id.clone(), record)?;
        calimero_sdk::app::emit!(events::Event::FolderRegistered { id: &id.0 });
        Ok(())
    }

    pub fn unregister_folder(&mut self, id: FolderId) -> Result<(), DriveError> {
        self.state.folders.remove(&id)?
            .ok_or_else(|| DriveError::NotFound(id.0.clone()))?;
        self.state.folder_contexts.remove(&id)?;
        calimero_sdk::app::emit!(events::Event::FolderUnregistered { id: &id.0 });
        Ok(())
    }

    pub fn get_folders(&self) -> Vec<FolderDto> {
        self.state.folders.entries().map(|(id, r)| FolderDto {
            id: id.clone(),
            parent_id: r.parent_id.clone(),
            visibility: *r.visibility.get(),
            color: { let c = r.color.get(); if c.is_empty() { None } else { Some(c.clone()) } },
        }).collect()
    }
}
```

Note: import `LwwRegister` at top of `state.rs` already; `FolderRecord` constructor uses it here.

- [ ] **Step 5: Run the tests**

Run: `cd logic && cargo test -p mero-drive-registry --test folders`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add logic/crates/registry/
git commit -m "feat(logic/registry): register_folder, unregister_folder, get_folders"
```

---

### Task 5: Implement `bind_folder_context`, `get_folder_context`

**Files:**
- Modify: `logic/crates/registry/src/lib.rs`
- Modify: `logic/crates/registry/tests/folders.rs`

- [ ] **Step 1: Add failing tests**

Append to `tests/folders.rs`:

```rust
use mero_drive_types::ContextId;

#[test]
fn bind_folder_context_stores_binding() {
    let mut app = RegistryApp::init();
    let f = FolderId("f".into());
    let c = ContextId("ctx".into());
    app.register_folder(f.clone(), None, None).unwrap();
    app.bind_folder_context(f.clone(), c.clone()).unwrap();
    assert_eq!(app.get_folder_context(f).unwrap(), c);
}

#[test]
fn bind_folder_context_rejects_unknown_folder() {
    let mut app = RegistryApp::init();
    let r = app.bind_folder_context(FolderId("x".into()), ContextId("c".into()));
    assert!(matches!(r, Err(DriveError::NotFound(_))));
}

#[test]
fn bind_folder_context_rejects_reassignment() {
    let mut app = RegistryApp::init();
    let f = FolderId("f".into());
    app.register_folder(f.clone(), None, None).unwrap();
    app.bind_folder_context(f.clone(), ContextId("c1".into())).unwrap();
    let r = app.bind_folder_context(f.clone(), ContextId("c2".into()));
    assert!(matches!(r, Err(DriveError::Conflict(_))));
}
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd logic && cargo test -p mero-drive-registry --test folders`
Expected: FAIL — 3 new undefined symbols.

- [ ] **Step 3: Implement**

Add to `#[app::logic] impl RegistryApp` in `src/lib.rs`:

```rust
pub fn bind_folder_context(
    &mut self,
    folder_id: FolderId,
    context_id: ContextId,
) -> Result<(), DriveError> {
    if !self.state.folders.contains_key(&folder_id)? {
        return Err(DriveError::NotFound(folder_id.0));
    }
    if self.state.folder_contexts.contains_key(&folder_id)? {
        return Err(DriveError::Conflict(format!("already bound: {}", folder_id.0)));
    }
    self.state.folder_contexts.insert(folder_id.clone(), context_id.clone())?;
    calimero_sdk::app::emit!(events::Event::FolderContextBound {
        folder_id: &folder_id.0,
        context_id: &context_id.0,
    });
    Ok(())
}

pub fn get_folder_context(&self, folder_id: FolderId) -> Result<ContextId, DriveError> {
    self.state.folder_contexts.get(&folder_id)?
        .ok_or_else(|| DriveError::NotFound(folder_id.0))
}
```

- [ ] **Step 4: Run tests**

Run: `cd logic && cargo test -p mero-drive-registry --test folders`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/registry/
git commit -m "feat(logic/registry): bind_folder_context + get_folder_context"
```

---

### Task 6: Implement `set_visibility`, `set_color`

**Files:**
- Modify: `logic/crates/registry/src/lib.rs`
- Modify: `logic/crates/registry/tests/folders.rs`

- [ ] **Step 1: Add failing tests**

```rust
#[test]
fn visibility_defaults_to_inherit_and_is_settable() {
    let mut app = RegistryApp::init();
    let id = FolderId("f".into());
    app.register_folder(id.clone(), None, None).unwrap();
    assert_eq!(app.get_folder(id.clone()).unwrap().visibility, Visibility::Inherit);
    app.set_visibility(id.clone(), Visibility::Restricted).unwrap();
    assert_eq!(app.get_folder(id).unwrap().visibility, Visibility::Restricted);
}

#[test]
fn set_color_is_lww() {
    let mut app = RegistryApp::init();
    let id = FolderId("f".into());
    app.register_folder(id.clone(), None, None).unwrap();
    app.set_color(id.clone(), "#ff0000".into()).unwrap();
    app.set_color(id.clone(), "#00ff00".into()).unwrap();
    assert_eq!(app.get_folder(id).unwrap().color, Some("#00ff00".into()));
}
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd logic && cargo test -p mero-drive-registry --test folders`

- [ ] **Step 3: Implement**

Add to `#[app::logic] impl RegistryApp`:

```rust
pub fn set_visibility(&mut self, id: FolderId, v: Visibility) -> Result<(), DriveError> {
    let mut rec = self.state.folders.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.0.clone()))?;
    rec.visibility.set(v);
    self.state.folders.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::FolderVisibilityChanged { id: &id.0 });
    Ok(())
}

pub fn set_color(&mut self, id: FolderId, color: String) -> Result<(), DriveError> {
    let mut rec = self.state.folders.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.0.clone()))?;
    rec.color.set(color);
    self.state.folders.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::FolderColorChanged { id: &id.0 });
    Ok(())
}

pub fn get_folder(&self, id: FolderId) -> Result<FolderDto, DriveError> {
    let r = self.state.folders.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.0.clone()))?;
    Ok(FolderDto {
        id: id.clone(),
        parent_id: r.parent_id.clone(),
        visibility: *r.visibility.get(),
        color: { let c = r.color.get(); if c.is_empty() { None } else { Some(c.clone()) } },
    })
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add logic/crates/registry/
git commit -m "feat(logic/registry): set_visibility + set_color with LWW"
```

---

### Task 7: Implement `reorder`, `get_sort_order`, `move_folder`

**Files:**
- Modify: `logic/crates/registry/src/lib.rs`
- Modify: `logic/crates/registry/tests/folders.rs`

- [ ] **Step 1: Add failing tests**

```rust
#[test]
fn reorder_stores_and_returns_order() {
    let mut app = RegistryApp::init();
    let a = FolderId("a".into());
    let b = FolderId("b".into());
    app.register_folder(a.clone(), None, None).unwrap();
    app.register_folder(b.clone(), None, None).unwrap();
    app.reorder(None, vec![b.clone(), a.clone()]).unwrap();
    assert_eq!(app.get_sort_order(None), vec![b, a]);
}

#[test]
fn reorder_rejects_ids_not_in_parent() {
    let mut app = RegistryApp::init();
    let a = FolderId("a".into());
    app.register_folder(a.clone(), None, None).unwrap();
    let r = app.reorder(None, vec![a, FolderId("ghost".into())]);
    assert!(matches!(r, Err(DriveError::Invalid(_))));
}

#[test]
fn move_folder_updates_parent() {
    let mut app = RegistryApp::init();
    let p = FolderId("p".into());
    let c = FolderId("c".into());
    app.register_folder(p.clone(), None, None).unwrap();
    app.register_folder(c.clone(), None, None).unwrap();
    app.move_folder(c.clone(), Some(p.clone())).unwrap();
    assert_eq!(app.get_folder(c).unwrap().parent_id, Some(p));
}
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```rust
pub fn reorder(
    &mut self,
    parent_id: Option<FolderId>,
    folder_ids: Vec<FolderId>,
) -> Result<(), DriveError> {
    for fid in &folder_ids {
        let rec = self.state.folders.get(fid)?
            .ok_or_else(|| DriveError::NotFound(fid.0.clone()))?;
        if rec.parent_id != parent_id {
            return Err(DriveError::Invalid(format!("{} not under parent", fid.0)));
        }
    }
    let mut v: Vector<FolderId> = Vector::new();
    for fid in &folder_ids { v.push(fid.clone())?; }
    self.state.sort_order.insert(parent_id.clone(), v)?;
    let key = parent_id.as_ref().map(|p| p.0.as_str()).unwrap_or("");
    calimero_sdk::app::emit!(events::Event::FolderSortOrderChanged { parent_id: key });
    Ok(())
}

pub fn get_sort_order(&self, parent_id: Option<FolderId>) -> Vec<FolderId> {
    match self.state.sort_order.get(&parent_id).ok().flatten() {
        Some(v) => v.iter().collect(),
        None => Vec::new(),
    }
}

pub fn move_folder(&mut self, id: FolderId, new_parent: Option<FolderId>) -> Result<(), DriveError> {
    let mut rec = self.state.folders.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.0.clone()))?;
    rec.parent_id = new_parent;
    self.state.folders.insert(id, rec)?;
    Ok(())
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add logic/crates/registry/
git commit -m "feat(logic/registry): reorder, get_sort_order, move_folder"
```

---

### Task 8: Registry smoke test — full method surface covered

**Files:**
- Modify: `logic/crates/registry/tests/folders.rs` (add one cross-method test)

- [ ] **Step 1: Add final integration test**

```rust
#[test]
fn full_lifecycle_register_bind_recolor_reorder_unregister() {
    let mut app = RegistryApp::init();
    let a = FolderId("a".into());
    let b = FolderId("b".into());
    let ca = ContextId("ctx-a".into());
    app.register_folder(a.clone(), None, Some("#f00".into())).unwrap();
    app.register_folder(b.clone(), None, None).unwrap();
    app.bind_folder_context(a.clone(), ca.clone()).unwrap();
    app.set_color(a.clone(), "#0f0".into()).unwrap();
    app.reorder(None, vec![b.clone(), a.clone()]).unwrap();

    assert_eq!(app.get_folders().len(), 2);
    assert_eq!(app.get_folder_context(a.clone()).unwrap(), ca);
    assert_eq!(app.get_folder(a.clone()).unwrap().color, Some("#0f0".into()));
    assert_eq!(app.get_sort_order(None), vec![b.clone(), a.clone()]);

    app.unregister_folder(a).unwrap();
    app.unregister_folder(b).unwrap();
    assert_eq!(app.get_folders().len(), 0);
}
```

- [ ] **Step 2: Run full test**

Run: `cd logic && cargo test -p mero-drive-registry`
Expected: PASS — all 10 tests.

- [ ] **Step 3: Rebuild wasm to regenerate abi**

Run: `(cd logic/crates/registry && ./build.sh)`
Verify `logic/crates/registry/res/abi.json` contains all public methods.

- [ ] **Step 4: Commit**

```bash
git add logic/crates/registry/
git commit -m "test(logic/registry): full-lifecycle integration test"
```

---

## Phase 2: Docs Crate

Implements the per-folder docs service. One instance runs per folder context; it knows nothing about the tree.

### Task 9: Scaffold `docs` crate

**Files:**
- Create: `logic/crates/docs/Cargo.toml`
- Create: `logic/crates/docs/build.rs`
- Create: `logic/crates/docs/build.sh`
- Create: `logic/crates/docs/src/events.rs`
- Create: `logic/crates/docs/src/lib.rs` (skeleton)

- [ ] **Step 1: Create `Cargo.toml`**

```toml
[package]
name = "mero-drive-docs"
version = "9.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
mero-drive-types = { workspace = true }
calimero-sdk = { workspace = true }
calimero-storage = { workspace = true }
calimero-storage-macros = { workspace = true }
borsh = { workspace = true }
serde = { workspace = true }

[build-dependencies]
calimero-wasm-abi = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 2: Create `build.rs` — same shape as registry**

```rust
use std::fs;
use std::path::Path;
use calimero_wasm_abi::emitter::emit_manifest_from_crate;

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/events.rs");

    let src_dir = Path::new("src");
    let module_files = ["lib.rs", "events.rs"];
    let mut sources = Vec::new();
    for f in module_files {
        let content = fs::read_to_string(src_dir.join(f)).expect("read src file");
        sources.push((f.to_string(), content));
    }
    let manifest = emit_manifest_from_crate(&sources).expect("emit abi manifest");
    fs::create_dir_all("res").unwrap();
    fs::write("res/abi.json", serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
}
```

- [ ] **Step 3: Create `build.sh`**

```bash
#!/bin/bash
set -e
cd "$(dirname $0)"
TARGET="${CARGO_TARGET_DIR:-../../target}"
rustup target add wasm32-unknown-unknown 2>/dev/null || true
cargo build --target wasm32-unknown-unknown --profile app-release
mkdir -p res
cp $TARGET/wasm32-unknown-unknown/app-release/mero_drive_docs.wasm ./res/docs.wasm
if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/docs.wasm -o ./res/docs.wasm
fi
```

- [ ] **Step 4: Create `src/events.rs`**

```rust
#[calimero_sdk::app::event]
pub enum Event<'a> {
    DocCreated { id: &'a str },
    DocEdited { id: &'a str },
    DocArchived { id: &'a str },
    DocUnarchived { id: &'a str },
    DocDeleted { id: &'a str },
    DocTagsChanged { id: &'a str },
}
```

- [ ] **Step 5: Create skeleton `src/lib.rs`**

```rust
use calimero_sdk::app;
use calimero_storage_macros::AppState;

mod events;

#[app::state(emits = for<'a> events::Event<'a>)]
#[derive(Default, AppState, borsh::BorshSerialize, borsh::BorshDeserialize)]
pub struct DocsApp {}

#[app::logic]
impl DocsApp {
    #[app::init]
    pub fn init() -> DocsApp { DocsApp::default() }
}
```

- [ ] **Step 6: Build**

```bash
chmod +x logic/crates/docs/build.sh
(cd logic/crates/docs && ./build.sh)
```

Verify `logic/crates/docs/res/docs.wasm` and `res/abi.json` exist.

- [ ] **Step 7: Commit**

```bash
git add logic/crates/docs/
git commit -m "feat(logic/docs): scaffold empty DocsApp"
```

---

### Task 10: Docs state + `create_doc` / `list_docs`

**Files:**
- Modify: `logic/crates/docs/src/lib.rs`
- Create: `logic/crates/docs/src/state.rs`
- Create: `logic/crates/docs/tests/docs_crud.rs`

- [ ] **Step 1: Create `state.rs`**

```rust
use borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::collections::{Counter, LwwRegister, UnorderedMap, UnorderedSet, ReplicatedGrowableArray};

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DocRecord {
    pub id: String,
    pub title: LwwRegister<String>,
    pub content: ReplicatedGrowableArray<char>,
    pub tags: UnorderedSet<String>,
    pub archived: LwwRegister<bool>,
    pub created_at: u64,
    pub updated_at: LwwRegister<u64>,
}

#[derive(BorshSerialize, BorshDeserialize, Default)]
pub struct State {
    pub docs: UnorderedMap<String, DocRecord>,
    pub next_id: Counter,
}
```

- [ ] **Step 2: Write failing test `tests/docs_crud.rs`**

```rust
use mero_drive_docs::DocsApp;
use mero_drive_types::DriveError;

#[test]
fn create_doc_assigns_id_and_returns_it() {
    let mut app = DocsApp::init();
    let id = app.create_doc("hello".into(), "world".into()).unwrap();
    assert!(!id.is_empty());
    let docs = app.list_docs(false);
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].id, id);
    assert_eq!(docs[0].title, "hello");
}

#[test]
fn create_doc_increments_id() {
    let mut app = DocsApp::init();
    let id1 = app.create_doc("a".into(), "".into()).unwrap();
    let id2 = app.create_doc("b".into(), "".into()).unwrap();
    assert_ne!(id1, id2);
}
```

- [ ] **Step 3: Run tests to confirm failure**

Run: `cd logic && cargo test -p mero-drive-docs --test docs_crud`
Expected: FAIL.

- [ ] **Step 4: Implement**

```rust
use calimero_sdk::app;
use calimero_sdk::env;
use calimero_storage_macros::AppState;
use mero_drive_types::DriveError;
use serde::Serialize;

mod events;
mod state;

use state::{State, DocRecord};
use calimero_storage::collections::{LwwRegister, ReplicatedGrowableArray, UnorderedSet};

#[app::state(emits = for<'a> events::Event<'a>)]
#[derive(Default, AppState, borsh::BorshSerialize, borsh::BorshDeserialize)]
pub struct DocsApp { state: State }

#[derive(Serialize)]
pub struct DocDto {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub archived: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[app::logic]
impl DocsApp {
    #[app::init]
    pub fn init() -> DocsApp { DocsApp::default() }

    pub fn create_doc(&mut self, title: String, content: String) -> Result<String, DriveError> {
        self.state.next_id.increment()?;
        let id = format!("doc-{}", self.state.next_id.value()?);
        let now = env::time_now();
        let mut c: ReplicatedGrowableArray<char> = ReplicatedGrowableArray::new();
        for ch in content.chars() { c.push(ch)?; }
        let rec = DocRecord {
            id: id.clone(),
            title: LwwRegister::new(title),
            content: c,
            tags: UnorderedSet::new(),
            archived: LwwRegister::new(false),
            created_at: now,
            updated_at: LwwRegister::new(now),
        };
        self.state.docs.insert(id.clone(), rec)?;
        calimero_sdk::app::emit!(events::Event::DocCreated { id: &id });
        Ok(id)
    }

    pub fn list_docs(&self, include_archived: bool) -> Vec<DocDto> {
        self.state.docs.entries().filter_map(|(_, r)| {
            if !include_archived && *r.archived.get() { return None; }
            Some(DocDto {
                id: r.id.clone(),
                title: r.title.get().clone(),
                content: r.content.iter().collect(),
                tags: r.tags.iter().cloned().collect(),
                archived: *r.archived.get(),
                created_at: r.created_at,
                updated_at: *r.updated_at.get(),
            })
        }).collect()
    }
}
```

- [ ] **Step 5: Run tests — PASS**

Run: `cd logic && cargo test -p mero-drive-docs --test docs_crud`

- [ ] **Step 6: Commit**

```bash
git add logic/crates/docs/
git commit -m "feat(logic/docs): create_doc + list_docs"
```

---

### Task 11: `get_doc`, `edit_doc`

**Files:**
- Modify: `logic/crates/docs/src/lib.rs`
- Modify: `logic/crates/docs/tests/docs_crud.rs`

- [ ] **Step 1: Add failing tests**

```rust
#[test]
fn get_doc_returns_by_id() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "c".into()).unwrap();
    let d = app.get_doc(id.clone()).unwrap();
    assert_eq!(d.id, id);
    assert_eq!(d.content, "c");
}

#[test]
fn get_doc_missing_is_not_found() {
    let app = DocsApp::init();
    assert!(matches!(app.get_doc("ghost".into()), Err(DriveError::NotFound(_))));
}

#[test]
fn edit_doc_updates_title_and_content_and_updated_at() {
    let mut app = DocsApp::init();
    let id = app.create_doc("old".into(), "body".into()).unwrap();
    let before = app.get_doc(id.clone()).unwrap().updated_at;
    app.edit_doc(id.clone(), Some("new".into()), Some("newbody".into())).unwrap();
    let d = app.get_doc(id).unwrap();
    assert_eq!(d.title, "new");
    assert_eq!(d.content, "newbody");
    assert!(d.updated_at >= before);
}
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```rust
pub fn get_doc(&self, id: String) -> Result<DocDto, DriveError> {
    let r = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    Ok(DocDto {
        id: r.id.clone(),
        title: r.title.get().clone(),
        content: r.content.iter().collect(),
        tags: r.tags.iter().cloned().collect(),
        archived: *r.archived.get(),
        created_at: r.created_at,
        updated_at: *r.updated_at.get(),
    })
}

pub fn edit_doc(
    &mut self,
    id: String,
    title: Option<String>,
    content: Option<String>,
) -> Result<(), DriveError> {
    let mut rec = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    if let Some(t) = title { rec.title.set(t); }
    if let Some(c) = content {
        let mut new_content: ReplicatedGrowableArray<char> = ReplicatedGrowableArray::new();
        for ch in c.chars() { new_content.push(ch)?; }
        rec.content = new_content;
    }
    rec.updated_at.set(env::time_now());
    self.state.docs.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::DocEdited { id: &id });
    Ok(())
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add logic/crates/docs/
git commit -m "feat(logic/docs): get_doc + edit_doc"
```

---

### Task 12: `archive_doc`, `unarchive_doc`, `delete_doc`

**Files:**
- Modify: `logic/crates/docs/src/lib.rs`
- Modify: `logic/crates/docs/tests/docs_crud.rs`

- [ ] **Step 1: Add failing tests**

```rust
#[test]
fn archive_doc_hides_from_list_by_default() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "".into()).unwrap();
    app.archive_doc(id.clone()).unwrap();
    assert_eq!(app.list_docs(false).len(), 0);
    assert_eq!(app.list_docs(true).len(), 1);
}

#[test]
fn unarchive_doc_restores_in_default_list() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "".into()).unwrap();
    app.archive_doc(id.clone()).unwrap();
    app.unarchive_doc(id).unwrap();
    assert_eq!(app.list_docs(false).len(), 1);
}

#[test]
fn delete_doc_removes_from_map() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "".into()).unwrap();
    app.delete_doc(id.clone()).unwrap();
    assert!(matches!(app.get_doc(id), Err(DriveError::NotFound(_))));
}
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```rust
pub fn archive_doc(&mut self, id: String) -> Result<(), DriveError> {
    let mut rec = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    rec.archived.set(true);
    rec.updated_at.set(env::time_now());
    self.state.docs.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::DocArchived { id: &id });
    Ok(())
}

pub fn unarchive_doc(&mut self, id: String) -> Result<(), DriveError> {
    let mut rec = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    rec.archived.set(false);
    rec.updated_at.set(env::time_now());
    self.state.docs.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::DocUnarchived { id: &id });
    Ok(())
}

pub fn delete_doc(&mut self, id: String) -> Result<(), DriveError> {
    self.state.docs.remove(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    calimero_sdk::app::emit!(events::Event::DocDeleted { id: &id });
    Ok(())
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add logic/crates/docs/
git commit -m "feat(logic/docs): archive, unarchive, delete_doc"
```

---

### Task 13: `add_tag`, `remove_tag`

**Files:**
- Modify: `logic/crates/docs/src/lib.rs`
- Modify: `logic/crates/docs/tests/docs_crud.rs`

- [ ] **Step 1: Add failing tests**

```rust
#[test]
fn add_tag_inserts_and_is_set_no_dup() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "".into()).unwrap();
    app.add_tag(id.clone(), "todo".into()).unwrap();
    app.add_tag(id.clone(), "todo".into()).unwrap();
    let d = app.get_doc(id).unwrap();
    assert_eq!(d.tags.len(), 1);
    assert_eq!(d.tags[0], "todo");
}

#[test]
fn remove_tag_deletes_it() {
    let mut app = DocsApp::init();
    let id = app.create_doc("t".into(), "".into()).unwrap();
    app.add_tag(id.clone(), "todo".into()).unwrap();
    app.remove_tag(id.clone(), "todo".into()).unwrap();
    assert_eq!(app.get_doc(id).unwrap().tags.len(), 0);
}
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```rust
pub fn add_tag(&mut self, id: String, tag: String) -> Result<(), DriveError> {
    let mut rec = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    rec.tags.insert(tag)?;
    self.state.docs.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::DocTagsChanged { id: &id });
    Ok(())
}

pub fn remove_tag(&mut self, id: String, tag: String) -> Result<(), DriveError> {
    let mut rec = self.state.docs.get(&id)?
        .ok_or_else(|| DriveError::NotFound(id.clone()))?;
    rec.tags.remove(&tag)?;
    self.state.docs.insert(id.clone(), rec)?;
    calimero_sdk::app::emit!(events::Event::DocTagsChanged { id: &id });
    Ok(())
}
```

- [ ] **Step 4: Run full docs test suite**

Run: `cd logic && cargo test -p mero-drive-docs`
Expected: all 10 tests pass.

- [ ] **Step 5: Rebuild wasm**

Run: `(cd logic/crates/docs && ./build.sh)`

- [ ] **Step 6: Commit**

```bash
git add logic/crates/docs/
git commit -m "feat(logic/docs): add_tag + remove_tag"
```

---

### Task 14: Workspace-level cargo test

- [ ] **Step 1: Run the whole workspace**

```bash
cd logic && cargo test --workspace
```

Expected: all 3 crates pass, >15 tests total.

- [ ] **Step 2: Lint check**

```bash
cd logic && cargo clippy --workspace --all-targets -- -D warnings
```

Fix any warnings inline; keep edits minimal.

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -A logic/
git commit -m "chore(logic): fix clippy warnings" || echo "clean"
```

---

## Phase 3: Multi-Service Bundle

Packages `registry.wasm` + `docs.wasm` into a single signed `.mpk` bundle.

### Task 15: Bundle script + manifest

**Files:**
- Create: `logic/manifest.json`
- Create: `logic/build-bundle.sh`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "schema_version": 1,
  "package_id": "com.calimero.mero-drive-docs",
  "version": "9.0.0",
  "name": "Mero Drive Docs",
  "description": "Namespace-based document workspace",
  "services": [
    {
      "id": "registry",
      "name": "Registry",
      "wasm": "registry.wasm",
      "abi": "registry.abi.json"
    },
    {
      "id": "docs",
      "name": "Docs",
      "wasm": "docs.wasm",
      "abi": "docs.abi.json"
    }
  ]
}
```

- [ ] **Step 2: Create `build-bundle.sh`**

```bash
#!/bin/bash
set -e
cd "$(dirname $0)"

(cd crates/registry && ./build.sh)
(cd crates/docs && ./build.sh)

rm -rf bundle
mkdir -p bundle
cp crates/registry/res/registry.wasm  bundle/registry.wasm
cp crates/registry/res/abi.json       bundle/registry.abi.json
cp crates/docs/res/docs.wasm          bundle/docs.wasm
cp crates/docs/res/abi.json           bundle/docs.abi.json
cp manifest.json                      bundle/manifest.json

if command -v mero-sign > /dev/null; then
  mero-sign bundle/
else
  echo "warning: mero-sign not found — bundle will be unsigned"
fi

tar -czf mero-drive-docs-9.0.0.mpk -C bundle .
echo "built: mero-drive-docs-9.0.0.mpk"
```

- [ ] **Step 3: Run**

```bash
chmod +x logic/build-bundle.sh
(cd logic && ./build-bundle.sh)
```

Expected: `logic/mero-drive-docs-9.0.0.mpk` exists.

- [ ] **Step 4: Add bundle artifact to `.gitignore`**

Edit `logic/.gitignore` to include `*.mpk` (already added in Task 1; verify).

- [ ] **Step 5: Commit**

```bash
git add logic/manifest.json logic/build-bundle.sh logic/.gitignore
git commit -m "feat(logic): multi-service bundle script + manifest"
```

---

## Phase 4: App Scaffold — Dependencies, Codegen, Delete Old Layer

Updates `package.json`, generates clients, and removes the old `AbiClient`/`WorkspaceManager`/`FolderContextManager` layer.

### Task 16: Update `package.json`

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1: Replace `package.json` dependencies + scripts**

Edit `app/package.json`:
- Bump `"version"` to `"9.0.0"`.
- Add to `dependencies`: `"@calimero-network/mero-react": "^1.0.2"`.
- Add to `devDependencies`: `"@calimero-network/abi-codegen": "^1.0.2"`.
- Add to `scripts`:
  ```json
  "codegen": "calimero-abi-codegen -i ../logic/crates/registry/res/abi.json -o src/api/registry --client-name RegistryClient && calimero-abi-codegen -i ../logic/crates/docs/res/abi.json -o src/api/docs --client-name DocsClient",
  "test:e2e": "merobox run e2e/workflow-mero-drive-namespace-basic.yml && merobox run e2e/workflow-mero-drive-namespace-nested-restricted.yml && merobox run e2e/workflow-mero-drive-namespace-reconciliation.yml"
  ```
- Remove unused deps: none yet at this step (we'll prune in cleanup phase).

- [ ] **Step 2: Install**

```bash
cd app && pnpm install
```

- [ ] **Step 3: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml
git commit -m "chore(app): bump to 9.0.0, add mero-react + abi-codegen"
```

---

### Task 17: Run codegen — commit generated clients

**Files:**
- Create (generated): `app/src/api/registry/RegistryClient.ts`, `types.ts`, `index.ts`
- Create (generated): `app/src/api/docs/DocsClient.ts`, `types.ts`, `index.ts`

- [ ] **Step 1: Run codegen**

```bash
cd app && pnpm codegen
```

Expected: files appear under `app/src/api/registry/` and `app/src/api/docs/`. Do NOT hand-edit them.

- [ ] **Step 2: Typecheck**

```bash
cd app && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/src/api/registry/ app/src/api/docs/
git commit -m "chore(app): run codegen for registry + docs"
```

---

### Task 18: Delete old API layer and pages

**Files:**
- Delete: `app/src/api/AbiClient.ts`
- Delete: `app/src/api/FolderContextManager.ts`
- Delete: `app/src/api/WorkspaceManager.ts`
- Delete: `app/src/api/FileBlobManager.ts` (if present)
- Delete: `app/src/api/contextIdJoin.ts` (if present)
- Delete: `app/src/hooks/useGroupPermissions.ts`
- Delete: `app/src/hooks/useWorkspaceContexts.ts`
- Delete: `app/src/components/workspace/WorkspaceSwitcher.tsx`
- Delete: `app/src/components/files/**`
- Delete: `app/src/components/file-details/**`
- Delete: `app/src/components/folder-list/**`
- Delete: `app/src/pages/files/**`
- Delete: `app/src/utils/joinedFolderContexts.ts` (if present)
- Delete: `app/src/utils/selfCreatedFolderContexts.ts` (if present)
- Delete: `app/src/utils/blobHelpers.ts` (if present)

- [ ] **Step 1: Inspect before deleting — skip any that don't exist**

```bash
cd app && ls src/api/ src/hooks/ src/components/ src/utils/ src/pages/ 2>/dev/null
```

- [ ] **Step 2: Remove all listed files (only those that exist)**

```bash
cd app
for p in \
  src/api/AbiClient.ts \
  src/api/FolderContextManager.ts \
  src/api/WorkspaceManager.ts \
  src/api/FileBlobManager.ts \
  src/api/contextIdJoin.ts \
  src/hooks/useGroupPermissions.ts \
  src/hooks/useWorkspaceContexts.ts \
  src/components/workspace/WorkspaceSwitcher.tsx \
  src/utils/joinedFolderContexts.ts \
  src/utils/selfCreatedFolderContexts.ts \
  src/utils/blobHelpers.ts \
; do
  [ -e "$p" ] && git rm "$p" || true
done
for d in \
  src/components/files \
  src/components/file-details \
  src/components/folder-list \
  src/pages/files \
; do
  [ -d "$d" ] && git rm -r "$d" || true
done
```

- [ ] **Step 3: App will not compile yet — fine. Commit the deletions.**

```bash
git commit -m "refactor(app): delete old AbiClient/WorkspaceManager/folder layer + blob uploads"
```

---

### Task 19: Minimal `adminApi.ts` + `main.tsx` wired to new appId

**Files:**
- Create (or retain minimal): `app/src/api/adminApi.ts`
- Modify: `app/src/main.tsx`
- Modify: `app/src/constants/config.ts`

- [ ] **Step 1: Write minimal `adminApi.ts`**

```ts
import { getAppEndpointKey, getJWT } from '@calimero-network/calimero-client';

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getAppEndpointKey();
  const jwt = await getJWT();
  const res = await fetch(`${base}/admin-api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`admin ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function adminRequestFull<T>(path: string, init?: RequestInit): Promise<{ data: T; status: number }> {
  const base = getAppEndpointKey();
  const jwt = await getJWT();
  const res = await fetch(`${base}/admin-api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`admin ${res.status}: ${await res.text()}`);
  return { data: await res.json(), status: res.status };
}
```

- [ ] **Step 2: Replace `constants/config.ts` with the minimal new-world config**

```ts
export const APP_ID = '<REPLACE-WITH-BUNDLE-APP-ID>';
export const REGISTRY_SERVICE_ID = 'registry';
export const DOCS_SERVICE_ID = 'docs';
export const REGISTRY_CONTEXT_ALIAS = 'Registry';
export const DEFAULT_CHILD_CAP_MASK = 1 | 2 | 4; // READ | WRITE | CREATE_GROUP
export const MAX_FOLDER_DEPTH = 8;

export const CAP = {
  READ: 1,
  WRITE: 2,
  CREATE_GROUP: 4,
  MANAGE_GROUP: 8,
  INVITE_MEMBERS: 16,
  MANAGE_MEMBERS: 32,
} as const;
```

Note: the real `APP_ID` gets filled in when you install the `.mpk` on a running node — put a TODO comment above it if it blocks installation.

- [ ] **Step 3: Rewrite `main.tsx` to wire `CalimeroProvider` + a placeholder App**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CalimeroProvider } from '@calimero-network/calimero-client';
import { APP_ID } from './constants/config';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CalimeroProvider applicationId={APP_ID}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </CalimeroProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Replace `App.tsx` with a placeholder**

```tsx
import { useCalimero } from '@calimero-network/calimero-client';

export default function App() {
  const { isAuthenticated, login } = useCalimero();
  if (!isAuthenticated) return <button onClick={() => login()}>Log in</button>;
  return <div>mero-drive v9 — workspace UI coming soon</div>;
}
```

- [ ] **Step 5: Typecheck + dev server smoke**

```bash
cd app && pnpm exec tsc --noEmit && pnpm build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/src/
git commit -m "feat(app): minimal CalimeroProvider scaffold for v9"
```

---

### Task 20: Ensure lint + test harness still runs

- [ ] **Step 1: Run lint**

```bash
cd app && pnpm lint
```

Fix any errors from dangling imports caused by deletions.

- [ ] **Step 2: Run existing vitest**

```bash
cd app && pnpm test
```

Expected: 0 tests or all pass — we haven't added new tests yet.

- [ ] **Step 3: Commit lint fixes if any**

```bash
git add -A app/src/
git commit -m "chore(app): post-delete lint fixes" || echo "clean"
```

---

## Phase 5: Pure Utilities (TDD)

Pure-function utilities for ancestry + policy table + reconciliation. Fully unit-testable.

### Task 21: `ancestry.ts` — tree-walking helpers

**Files:**
- Create: `app/src/utils/ancestry.ts`
- Create: `app/src/utils/__tests__/ancestry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildTree, ancestorsOf, descendantsOf, depthOf } from '../ancestry';

const folders = [
  { id: 'a', parent_id: null },
  { id: 'b', parent_id: 'a' },
  { id: 'c', parent_id: 'b' },
  { id: 'd', parent_id: null },
];

describe('ancestry', () => {
  it('builds a tree from flat list', () => {
    const tree = buildTree(folders);
    expect(tree.roots.map((n) => n.id).sort()).toEqual(['a', 'd']);
    expect(tree.byId.get('b')?.children[0]?.id).toBe('c');
  });

  it('ancestorsOf walks root-ward', () => {
    expect(ancestorsOf(folders, 'c')).toEqual(['b', 'a']);
  });

  it('descendantsOf walks leaf-first', () => {
    expect(descendantsOf(folders, 'a')).toEqual(['c', 'b']);
  });

  it('depthOf counts correctly', () => {
    expect(depthOf(folders, 'a')).toBe(0);
    expect(depthOf(folders, 'c')).toBe(2);
  });

  it('detects cycles and returns [] rather than looping', () => {
    const cyc = [
      { id: 'x', parent_id: 'y' },
      { id: 'y', parent_id: 'x' },
    ];
    expect(ancestorsOf(cyc, 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd app && pnpm test ancestry`

- [ ] **Step 3: Implement `utils/ancestry.ts`**

```ts
export interface FolderLite { id: string; parent_id: string | null }
export interface TreeNode { id: string; children: TreeNode[] }
export interface Tree { roots: TreeNode[]; byId: Map<string, TreeNode> }

export function buildTree(folders: FolderLite[]): Tree {
  const byId = new Map<string, TreeNode>();
  for (const f of folders) byId.set(f.id, { id: f.id, children: [] });
  const roots: TreeNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parent_id && byId.has(f.parent_id)) byId.get(f.parent_id)!.children.push(node);
    else roots.push(node);
  }
  return { roots, byId };
}

export function ancestorsOf(folders: FolderLite[], id: string): string[] {
  const map = new Map(folders.map((f) => [f.id, f.parent_id]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = map.get(id) ?? null;
  while (cur) {
    if (seen.has(cur)) return [];
    seen.add(cur);
    out.push(cur);
    cur = map.get(cur) ?? null;
  }
  return out;
}

export function descendantsOf(folders: FolderLite[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = children.get(f.parent_id) ?? [];
    arr.push(f.id);
    children.set(f.parent_id, arr);
  }
  const out: string[] = [];
  const walk = (n: string) => {
    for (const c of children.get(n) ?? []) walk(c);
    if (n !== id) out.push(n);
  };
  walk(id);
  return out;
}

export function depthOf(folders: FolderLite[], id: string): number {
  return ancestorsOf(folders, id).length;
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/ancestry.ts app/src/utils/__tests__/ancestry.test.ts
git commit -m "feat(app/utils): ancestry helpers"
```

---

### Task 22: `policyTable.ts` — capability → action mapping

**Files:**
- Create: `app/src/utils/policyTable.ts`
- Create: `app/src/utils/__tests__/policyTable.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { can, Action } from '../policyTable';
import { CAP } from '../../constants/config';

describe('policyTable', () => {
  it('WRITE allows create/edit doc', () => {
    expect(can(CAP.WRITE, Action.CreateDoc)).toBe(true);
    expect(can(CAP.READ, Action.CreateDoc)).toBe(false);
  });

  it('CREATE_GROUP allows create subfolder', () => {
    expect(can(CAP.CREATE_GROUP, Action.CreateSubfolder)).toBe(true);
  });

  it('MANAGE_GROUP gates rename + visibility + delete', () => {
    expect(can(CAP.MANAGE_GROUP, Action.RenameFolder)).toBe(true);
    expect(can(CAP.MANAGE_GROUP, Action.ChangeVisibility)).toBe(true);
    expect(can(CAP.MANAGE_GROUP, Action.DeleteFolder)).toBe(true);
  });

  it('INVITE_MEMBERS vs MANAGE_MEMBERS split', () => {
    expect(can(CAP.INVITE_MEMBERS, Action.AddMember)).toBe(true);
    expect(can(CAP.INVITE_MEMBERS, Action.RemoveMember)).toBe(false);
    expect(can(CAP.MANAGE_MEMBERS, Action.RemoveMember)).toBe(true);
  });

  it('combined bitmask unions', () => {
    expect(can(CAP.READ | CAP.WRITE, Action.CreateDoc)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

- [ ] **Step 3: Implement `policyTable.ts`**

```ts
import { CAP } from '../constants/config';

export enum Action {
  Read = 'read',
  CreateDoc = 'create_doc',
  EditDoc = 'edit_doc',
  DeleteDoc = 'delete_doc',
  CreateSubfolder = 'create_subfolder',
  RenameFolder = 'rename_folder',
  DeleteFolder = 'delete_folder',
  ChangeVisibility = 'change_visibility',
  AddMember = 'add_member',
  RemoveMember = 'remove_member',
  ChangeMemberCaps = 'change_member_caps',
}

const REQUIRED: Record<Action, number> = {
  [Action.Read]: CAP.READ,
  [Action.CreateDoc]: CAP.WRITE,
  [Action.EditDoc]: CAP.WRITE,
  [Action.DeleteDoc]: CAP.WRITE,
  [Action.CreateSubfolder]: CAP.CREATE_GROUP,
  [Action.RenameFolder]: CAP.MANAGE_GROUP,
  [Action.DeleteFolder]: CAP.MANAGE_GROUP,
  [Action.ChangeVisibility]: CAP.MANAGE_GROUP,
  [Action.AddMember]: CAP.INVITE_MEMBERS,
  [Action.RemoveMember]: CAP.MANAGE_MEMBERS,
  [Action.ChangeMemberCaps]: CAP.MANAGE_MEMBERS,
};

export function can(caps: number, action: Action): boolean {
  return (caps & REQUIRED[action]) === REQUIRED[action];
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/policyTable.ts app/src/utils/__tests__/policyTable.test.ts
git commit -m "feat(app/utils): capability→action policy table"
```

---

### Task 23: `reconcile.ts` — drift resolution

**Files:**
- Create: `app/src/utils/reconcile.ts`
- Create: `app/src/utils/__tests__/reconcile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { computeReconcileActions } from '../reconcile';

describe('reconcile', () => {
  const adminGroups = [
    { id: 'r', parent_id: null, alias: 'root' },
    { id: 'a', parent_id: 'r', alias: 'A' },
    { id: 'b', parent_id: 'r', alias: 'B' },
  ];

  it('registers folders admin has that registry lacks', () => {
    const registry = [{ id: 'a', parent_id: 'r' }];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.register).toEqual([{ id: 'b', parent_id: 'r' }]);
    expect(actions.unregister).toEqual([]);
  });

  it('unregisters folders registry has but admin does not', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'r' },
      { id: 'ghost', parent_id: 'r' },
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.unregister).toEqual(['ghost']);
  });

  it('moves folders whose parent changed', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'a' }, // registry thinks b is under a; admin says r
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.move).toEqual([{ id: 'b', new_parent_id: 'r' }]);
  });

  it('zero writes on healthy workspace', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'r' },
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.register.length + actions.unregister.length + actions.move.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

- [ ] **Step 3: Implement `reconcile.ts`**

```ts
export interface AdminGroup { id: string; parent_id: string | null; alias?: string }
export interface RegistryFolder { id: string; parent_id: string | null }

export interface ReconcileActions {
  register: { id: string; parent_id: string | null }[];
  unregister: string[];
  move: { id: string; new_parent_id: string | null }[];
}

export function computeReconcileActions(
  admin: AdminGroup[],
  registry: RegistryFolder[],
  rootId: string,
): ReconcileActions {
  const adminByIdSansRoot = new Map(admin.filter((g) => g.id !== rootId).map((g) => [g.id, g]));
  const regById = new Map(registry.map((f) => [f.id, f]));

  const register: ReconcileActions['register'] = [];
  const move: ReconcileActions['move'] = [];
  for (const g of adminByIdSansRoot.values()) {
    const reg = regById.get(g.id);
    if (!reg) register.push({ id: g.id, parent_id: g.parent_id });
    else if (reg.parent_id !== g.parent_id) move.push({ id: g.id, new_parent_id: g.parent_id });
  }

  const unregister: string[] = [];
  for (const f of registry) {
    if (!adminByIdSansRoot.has(f.id)) unregister.push(f.id);
  }

  return { register, unregister, move };
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/reconcile.ts app/src/utils/__tests__/reconcile.test.ts
git commit -m "feat(app/utils): reconcile action computation"
```

---

## Phase 6: Permission Hooks

Replaces the old `useGroupPermissions` with four narrow hooks backed by admin API + policyTable.

### Task 24: `useSelfIdentity` — per-namespace identity cache

**Files:**
- Create: `app/src/hooks/useSelfIdentity.ts`
- Create: `app/src/hooks/__tests__/useSelfIdentity.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSelfIdentity } from '../useSelfIdentity';

vi.mock('../../api/adminApi', () => ({
  adminRequest: vi.fn(),
}));
import { adminRequest } from '../../api/adminApi';

describe('useSelfIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('calls admin API for first lookup and caches in localStorage', async () => {
    (adminRequest as any).mockResolvedValue({ identity: 'pk-1' });
    const { result } = renderHook(() => useSelfIdentity('ns-1'));
    await waitFor(() => expect(result.current.identity).toBe('pk-1'));
    expect(adminRequest).toHaveBeenCalledWith('/namespaces/ns-1/self-identity');
    expect(localStorage.getItem('mero-drive:selfId:ns-1')).toBe('pk-1');
  });

  it('returns cached value without hitting admin', async () => {
    localStorage.setItem('mero-drive:selfId:ns-2', 'pk-2');
    const { result } = renderHook(() => useSelfIdentity('ns-2'));
    await waitFor(() => expect(result.current.identity).toBe('pk-2'));
    expect(adminRequest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd app && pnpm test useSelfIdentity`

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';

export interface SelfIdentityState {
  identity: string | null;
  loading: boolean;
  error: Error | null;
}

const keyFor = (ns: string) => `mero-drive:selfId:${ns}`;

export function useSelfIdentity(namespaceId: string | null): SelfIdentityState {
  const [state, setState] = useState<SelfIdentityState>({ identity: null, loading: !!namespaceId, error: null });

  useEffect(() => {
    if (!namespaceId) return;
    const cached = localStorage.getItem(keyFor(namespaceId));
    if (cached) {
      setState({ identity: cached, loading: false, error: null });
      return;
    }
    let alive = true;
    adminRequest<{ identity: string }>(`/namespaces/${namespaceId}/self-identity`)
      .then((r) => {
        if (!alive) return;
        localStorage.setItem(keyFor(namespaceId), r.identity);
        setState({ identity: r.identity, loading: false, error: null });
      })
      .catch((e) => alive && setState({ identity: null, loading: false, error: e }));
    return () => { alive = false; };
  }, [namespaceId]);

  return state;
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSelfIdentity.ts app/src/hooks/__tests__/useSelfIdentity.test.ts
git commit -m "feat(app/hooks): useSelfIdentity with localStorage cache"
```

---

### Task 25: `useNamespacePermissions`

**Files:**
- Create: `app/src/hooks/useNamespacePermissions.ts`
- Create: `app/src/hooks/__tests__/useNamespacePermissions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNamespacePermissions } from '../useNamespacePermissions';
import { CAP } from '../../constants/config';

vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));
import { adminRequest } from '../../api/adminApi';

describe('useNamespacePermissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives canCreateSubgroup from CREATE_GROUP bit', async () => {
    (adminRequest as any).mockResolvedValue({ capabilities: CAP.CREATE_GROUP });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canCreateSubgroup).toBe(true);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('canManageNamespace requires MANAGE_GROUP', async () => {
    (adminRequest as any).mockResolvedValue({ capabilities: CAP.MANAGE_GROUP });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { CAP } from '../constants/config';
import { useSelfIdentity } from './useSelfIdentity';

export interface NamespacePermissions {
  canCreateSubgroup: boolean;
  canManageNamespace: boolean;
  canManageNamespaceMembers: boolean;
  loading: boolean;
}

export function useNamespacePermissions(namespaceId: string, rootGroupId: string): NamespacePermissions {
  const { identity } = useSelfIdentity(namespaceId);
  const [caps, setCaps] = useState<number | null>(null);

  useEffect(() => {
    if (!identity) return;
    let alive = true;
    adminRequest<{ capabilities: number }>(`/groups/${rootGroupId}/members/${identity}`)
      .then((r) => { if (alive) setCaps(r.capabilities); })
      .catch(() => { if (alive) setCaps(0); });
    return () => { alive = false; };
  }, [rootGroupId, identity]);

  const has = (bit: number) => caps !== null && (caps & bit) === bit;
  return {
    canCreateSubgroup: has(CAP.CREATE_GROUP),
    canManageNamespace: has(CAP.MANAGE_GROUP),
    canManageNamespaceMembers: has(CAP.MANAGE_MEMBERS),
    loading: caps === null,
  };
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useNamespacePermissions.ts app/src/hooks/__tests__/useNamespacePermissions.test.ts
git commit -m "feat(app/hooks): useNamespacePermissions"
```

---

### Task 26: `useFolderPermissions`

**Files:**
- Create: `app/src/hooks/useFolderPermissions.ts`
- Create: `app/src/hooks/__tests__/useFolderPermissions.test.ts`

- [ ] **Step 1: Write failing test — covers action matrix**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';

vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));
import { adminRequest } from '../../api/adminApi';

describe('useFolderPermissions', () => {
  const render = (caps: number) => {
    (adminRequest as any).mockResolvedValue({ capabilities: caps });
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('READ permits canRead only', async () => {
    const { result } = render(CAP.READ);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('WRITE permits write, not delete', async () => {
    const { result } = render(CAP.READ | CAP.WRITE);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canDelete).toBe(false);
  });

  it('MANAGE_GROUP permits delete + rename + visibility', async () => {
    const { result } = render(CAP.MANAGE_GROUP);
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { CAP } from '../constants/config';
import { useSelfIdentity } from './useSelfIdentity';

export interface FolderPermissions {
  canRead: boolean;
  canWrite: boolean;
  canCreateSubfolder: boolean;
  canRename: boolean;
  canDelete: boolean;
  canManageGroup: boolean;
  canInviteMembers: boolean;
  canManageMembers: boolean;
  loading: boolean;
}

export function useFolderPermissions(namespaceId: string, folderId: string): FolderPermissions {
  const { identity } = useSelfIdentity(namespaceId);
  const [caps, setCaps] = useState<number | null>(null);

  useEffect(() => {
    if (!identity || !folderId) return;
    let alive = true;
    adminRequest<{ capabilities: number }>(`/groups/${folderId}/members/${identity}`)
      .then((r) => { if (alive) setCaps(r.capabilities); })
      .catch(() => { if (alive) setCaps(0); });
    return () => { alive = false; };
  }, [folderId, identity]);

  const has = (bit: number) => caps !== null && (caps & bit) === bit;
  return {
    canRead: has(CAP.READ),
    canWrite: has(CAP.WRITE),
    canCreateSubfolder: has(CAP.CREATE_GROUP),
    canRename: has(CAP.MANAGE_GROUP),
    canDelete: has(CAP.MANAGE_GROUP),
    canManageGroup: has(CAP.MANAGE_GROUP),
    canInviteMembers: has(CAP.INVITE_MEMBERS),
    canManageMembers: has(CAP.MANAGE_MEMBERS),
    loading: caps === null,
  };
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useFolderPermissions.ts app/src/hooks/__tests__/useFolderPermissions.test.ts
git commit -m "feat(app/hooks): useFolderPermissions"
```

---

### Task 27: `useFolderAccess` — orphan detection

**Files:**
- Create: `app/src/hooks/useFolderAccess.ts`
- Create: `app/src/hooks/__tests__/useFolderAccess.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveOrphanState } from '../useFolderAccess';

describe('deriveOrphanState', () => {
  const registry = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: 'a' },
    { id: 'c', parent_id: 'b' },
  ];

  it('not orphan when parent visible in subgroups', () => {
    const subgroupIds = new Set(['a', 'b', 'c']);
    expect(deriveOrphanState(registry, subgroupIds, 'c').isOrphan).toBe(false);
  });

  it('orphan when folder is a direct member but parent is not', () => {
    const subgroupIds = new Set(['c']);
    const s = deriveOrphanState(registry, subgroupIds, 'c');
    expect(s.isOrphan).toBe(true);
    expect(s.ancestorChain).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

- [ ] **Step 3: Implement**

```ts
import { ancestorsOf, FolderLite } from '../utils/ancestry';

export interface OrphanState { isOrphan: boolean; ancestorChain: string[] }

export function deriveOrphanState(
  registryFolders: FolderLite[],
  adminSubgroupIds: Set<string>,
  folderId: string,
): OrphanState {
  if (!adminSubgroupIds.has(folderId)) return { isOrphan: false, ancestorChain: [] };
  const chain = ancestorsOf(registryFolders, folderId);
  const parent = chain[0];
  if (parent && !adminSubgroupIds.has(parent)) return { isOrphan: true, ancestorChain: chain };
  return { isOrphan: false, ancestorChain: [] };
}

export function useFolderAccess(
  registryFolders: FolderLite[],
  adminSubgroupIds: Set<string>,
  folderId: string,
) {
  const { isOrphan, ancestorChain } = deriveOrphanState(registryFolders, adminSubgroupIds, folderId);
  return { isMember: adminSubgroupIds.has(folderId), isOrphan, ancestorChain };
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useFolderAccess.ts app/src/hooks/__tests__/useFolderAccess.test.ts
git commit -m "feat(app/hooks): useFolderAccess with orphan detection"
```

---

### Task 28: `useFolderCascade` — pure helper for inherit cascade

**Files:**
- Create: `app/src/hooks/useFolderCascade.ts`
- Create: `app/src/hooks/__tests__/useFolderCascade.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeCascadeTargets } from '../useFolderCascade';
import { DEFAULT_CHILD_CAP_MASK } from '../../constants/config';

describe('computeCascadeTargets', () => {
  const folders = [
    { id: 'root', parent_id: null, visibility: 'Inherit' as const },
    { id: 'a', parent_id: 'root', visibility: 'Inherit' as const },
    { id: 'b', parent_id: 'a', visibility: 'Restricted' as const },
    { id: 'c', parent_id: 'b', visibility: 'Inherit' as const }, // behind restricted wall
  ];

  it('cascades through inherit descendants', () => {
    const targets = computeCascadeTargets(folders, 'root', 0x3);
    expect(targets.map((t) => t.folderId).sort()).toEqual(['a']);
    expect(targets[0].capabilities).toBe(0x3 & DEFAULT_CHILD_CAP_MASK);
  });

  it('stops at restricted subtree', () => {
    const targets = computeCascadeTargets(folders, 'root', 0x3f);
    expect(targets.map((t) => t.folderId)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

- [ ] **Step 3: Implement**

```ts
import { DEFAULT_CHILD_CAP_MASK } from '../constants/config';

export interface CascadeFolder { id: string; parent_id: string | null; visibility: 'Inherit' | 'Restricted' }
export interface CascadeTarget { folderId: string; capabilities: number }

export function computeCascadeTargets(
  folders: CascadeFolder[],
  startId: string,
  parentCaps: number,
): CascadeTarget[] {
  const childOf = new Map<string, CascadeFolder[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = childOf.get(f.parent_id) ?? [];
    arr.push(f);
    childOf.set(f.parent_id, arr);
  }
  const out: CascadeTarget[] = [];
  const effectiveCaps = parentCaps & DEFAULT_CHILD_CAP_MASK;
  const walk = (id: string) => {
    for (const c of childOf.get(id) ?? []) {
      if (c.visibility === 'Restricted') continue;
      out.push({ folderId: c.id, capabilities: effectiveCaps });
      walk(c.id);
    }
  };
  walk(startId);
  return out;
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useFolderCascade.ts app/src/hooks/__tests__/useFolderCascade.test.ts
git commit -m "feat(app/hooks): cascade target computation"
```

---

## Phase 7: Workspace Data Hooks

Bootstrap + tree + folder CRUD + docs client.

### Task 29: `useWorkspaceBootstrap` — find/create registry context

**Files:**
- Create: `app/src/hooks/useWorkspaceBootstrap.ts`

- [ ] **Step 1: Implement (no TDD — orchestrates admin API + mero-react hooks)**

```ts
import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { REGISTRY_CONTEXT_ALIAS, REGISTRY_SERVICE_ID, APP_ID } from '../constants/config';

export interface WorkspaceBootstrapResult {
  registryContextId: string | null;
  loading: boolean;
  error: Error | null;
}

export function useWorkspaceBootstrap(
  namespaceId: string | null,
  rootGroupId: string | null,
  selfIdentity: string | null,
): WorkspaceBootstrapResult {
  const [state, setState] = useState<WorkspaceBootstrapResult>({ registryContextId: null, loading: true, error: null });

  useEffect(() => {
    if (!namespaceId || !rootGroupId || !selfIdentity) return;
    let alive = true;
    (async () => {
      try {
        const ctxs = await adminRequest<{ contexts: { id: string; alias?: string }[] }>(
          `/groups/${rootGroupId}/contexts`,
        );
        let registry = ctxs.contexts.find((c) => c.alias === REGISTRY_CONTEXT_ALIAS);
        if (!registry) {
          const created = await adminRequest<{ id: string }>(`/contexts`, {
            method: 'POST',
            body: JSON.stringify({
              application_id: APP_ID,
              service_id: REGISTRY_SERVICE_ID,
              group_id: rootGroupId,
              alias: REGISTRY_CONTEXT_ALIAS,
            }),
          });
          registry = { id: created.id, alias: REGISTRY_CONTEXT_ALIAS };
        }
        await adminRequest(`/contexts/${registry.id}/join`, {
          method: 'POST',
          body: JSON.stringify({ identity: selfIdentity }),
        }).catch(() => undefined);
        if (alive) setState({ registryContextId: registry.id, loading: false, error: null });
      } catch (e) {
        if (alive) setState({ registryContextId: null, loading: false, error: e as Error });
      }
    })();
    return () => { alive = false; };
  }, [namespaceId, rootGroupId, selfIdentity]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && pnpm exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useWorkspaceBootstrap.ts
git commit -m "feat(app/hooks): useWorkspaceBootstrap (find/create registry ctx)"
```

---

### Task 30: `useRegistryClient` + `useDocsClient`

**Files:**
- Create: `app/src/hooks/useRegistryClient.ts`
- Create: `app/src/hooks/useDocsClient.ts`

- [ ] **Step 1: Implement `useRegistryClient`**

```ts
import { useMemo } from 'react';
import { RegistryClient } from '../api/registry';
import { APP_ID } from '../constants/config';

export function useRegistryClient(registryContextId: string | null): RegistryClient | null {
  return useMemo(() => {
    if (!registryContextId) return null;
    return new RegistryClient({ applicationId: APP_ID, contextId: registryContextId });
  }, [registryContextId]);
}
```

- [ ] **Step 2: Implement `useDocsClient`**

```ts
import { useMemo } from 'react';
import { DocsClient } from '../api/docs';
import { APP_ID } from '../constants/config';

export function useDocsClient(docsContextId: string | null): DocsClient | null {
  return useMemo(() => {
    if (!docsContextId) return null;
    return new DocsClient({ applicationId: APP_ID, contextId: docsContextId });
  }, [docsContextId]);
}
```

Note: the generated client constructor signature is produced by `calimero-abi-codegen`. If the actual generated class takes different constructor args, update to match (look at `app/src/api/registry/RegistryClient.ts` after codegen runs).

- [ ] **Step 3: Typecheck**

Run: `cd app && pnpm exec tsc --noEmit` — if the constructor signature differs, fix both files to match what codegen produced.

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useRegistryClient.ts app/src/hooks/useDocsClient.ts
git commit -m "feat(app/hooks): useRegistryClient + useDocsClient"
```

---

### Task 31: `useWorkspaceTree` — assemble tree from admin + registry

**Files:**
- Create: `app/src/hooks/useWorkspaceTree.ts`
- Create: `app/src/hooks/__tests__/useWorkspaceTree.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mergeAdminAndRegistry } from '../useWorkspaceTree';

describe('mergeAdminAndRegistry', () => {
  const admin = [
    { id: 'r', parent_id: null, alias: 'root' },
    { id: 'a', parent_id: 'r', alias: 'A' },
    { id: 'b', parent_id: 'a', alias: 'B' },
  ];
  const registry = [
    { id: 'a', parent_id: 'r', visibility: 'Inherit' as const, color: '#f00' },
    { id: 'b', parent_id: 'a', visibility: 'Restricted' as const, color: null },
  ];

  it('merges registry metadata onto admin groups', () => {
    const tree = mergeAdminAndRegistry(admin, registry, 'r');
    expect(tree.folders.find((f) => f.id === 'a')?.color).toBe('#f00');
    expect(tree.folders.find((f) => f.id === 'b')?.visibility).toBe('Restricted');
    expect(tree.folders.find((f) => f.id === 'a')?.alias).toBe('A');
  });

  it('excludes the root group from the folder list', () => {
    const tree = mergeAdminAndRegistry(admin, registry, 'r');
    expect(tree.folders.find((f) => f.id === 'r')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import type { RegistryClient } from '../api/registry';

export interface MergedFolder {
  id: string;
  parent_id: string | null;
  alias: string;
  visibility: 'Inherit' | 'Restricted';
  color: string | null;
}

export function mergeAdminAndRegistry(
  admin: { id: string; parent_id: string | null; alias: string }[],
  registry: { id: string; parent_id: string | null; visibility: 'Inherit' | 'Restricted'; color: string | null }[],
  rootId: string,
): { folders: MergedFolder[] } {
  const regById = new Map(registry.map((r) => [r.id, r]));
  const folders: MergedFolder[] = admin
    .filter((g) => g.id !== rootId)
    .map((g) => {
      const r = regById.get(g.id);
      return {
        id: g.id,
        parent_id: g.parent_id,
        alias: g.alias,
        visibility: r?.visibility ?? 'Inherit',
        color: r?.color ?? null,
      };
    });
  return { folders };
}

export function useWorkspaceTree(rootGroupId: string | null, registry: RegistryClient | null) {
  const [data, setData] = useState<{ folders: MergedFolder[]; loading: boolean; error: Error | null }>({
    folders: [], loading: true, error: null,
  });

  useEffect(() => {
    if (!rootGroupId || !registry) return;
    let alive = true;
    (async () => {
      try {
        const admin = await adminRequest<{ groups: { id: string; parent_id: string | null; alias: string }[] }>(
          `/groups/${rootGroupId}/subgroups?recursive=true`,
        );
        const reg = await registry.get_folders();
        if (alive) setData({ folders: mergeAdminAndRegistry(admin.groups, reg as any, rootGroupId).folders, loading: false, error: null });
      } catch (e) {
        if (alive) setData({ folders: [], loading: false, error: e as Error });
      }
    })();
    return () => { alive = false; };
  }, [rootGroupId, registry]);

  return data;
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useWorkspaceTree.ts app/src/hooks/__tests__/useWorkspaceTree.test.ts
git commit -m "feat(app/hooks): useWorkspaceTree merges admin + registry"
```

---

### Task 32: `useReconcile` — idempotent drift resolution

**Files:**
- Create: `app/src/hooks/useReconcile.ts`

- [ ] **Step 1: Implement (uses existing `computeReconcileActions` — already tested)**

```ts
import { useCallback, useState } from 'react';
import type { RegistryClient } from '../api/registry';
import { adminRequest } from '../api/adminApi';
import { computeReconcileActions } from '../utils/reconcile';

export type ReconcileResult = { registered: number; unregistered: number; moved: number };

export function useReconcile(rootGroupId: string | null, registry: RegistryClient | null) {
  const [state, setState] = useState<{ running: boolean; last: ReconcileResult | null; error: Error | null }>({
    running: false, last: null, error: null,
  });

  const run = useCallback(async (): Promise<ReconcileResult | null> => {
    if (!rootGroupId || !registry) return null;
    setState((s) => ({ ...s, running: true }));
    try {
      const admin = await adminRequest<{ groups: { id: string; parent_id: string | null; alias?: string }[] }>(
        `/groups/${rootGroupId}/subgroups?recursive=true`,
      );
      const reg = await registry.get_folders();
      const actions = computeReconcileActions(admin.groups, reg as any, rootGroupId);
      for (const r of actions.register) await registry.register_folder({ id: r.id } as any, r.parent_id ? ({ id: r.parent_id } as any) : null, null);
      for (const id of actions.unregister) await registry.unregister_folder({ id } as any);
      for (const m of actions.move) await registry.move_folder({ id: m.id } as any, m.new_parent_id ? ({ id: m.new_parent_id } as any) : null);
      const result: ReconcileResult = { registered: actions.register.length, unregistered: actions.unregister.length, moved: actions.move.length };
      setState({ running: false, last: result, error: null });
      return result;
    } catch (e) {
      setState({ running: false, last: null, error: e as Error });
      return null;
    }
  }, [rootGroupId, registry]);

  return { ...state, run };
}
```

Note: the generated `registry.register_folder` signature may differ — consult `app/src/api/registry/RegistryClient.ts` and adjust argument shapes.

- [ ] **Step 2: Typecheck**

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useReconcile.ts
git commit -m "feat(app/hooks): useReconcile driver"
```

---

### Task 33: `useFolderOperations` — create/rename/delete folder with cascade

**Files:**
- Create: `app/src/hooks/useFolderOperations.ts`

- [ ] **Step 1: Implement**

```ts
import { useCallback } from 'react';
import { useNestGroup, useUnnestGroup, useCreateGroupInNamespace, useDeleteGroup, useSetGroupAlias, useAddGroupMember } from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry';
import { adminRequest } from '../api/adminApi';
import { APP_ID, DOCS_SERVICE_ID } from '../constants/config';
import { computeCascadeTargets, CascadeFolder } from './useFolderCascade';

export interface CreateFolderInput {
  namespaceId: string;
  parentGroupId: string;
  alias: string;
  color?: string;
  visibility: 'Inherit' | 'Restricted';
}

export function useFolderOperations(
  registry: RegistryClient | null,
  rootGroupId: string | null,
  tree: CascadeFolder[],
) {
  const { createGroupInNamespace } = useCreateGroupInNamespace();
  const { nestGroup } = useNestGroup();
  const { unnestGroup } = useUnnestGroup();
  const { deleteGroup } = useDeleteGroup();
  const { setGroupAlias } = useSetGroupAlias();
  const { addGroupMember } = useAddGroupMember();

  const create = useCallback(async (input: CreateFolderInput) => {
    if (!registry || !rootGroupId) throw new Error('workspace not bootstrapped');
    const group = await createGroupInNamespace({ namespaceId: input.namespaceId, parentGroupId: input.parentGroupId, alias: input.alias });
    if (input.parentGroupId !== rootGroupId) {
      await nestGroup({ parentGroupId: input.parentGroupId, childGroupId: group.id });
    }
    const ctx = await adminRequest<{ id: string }>(`/contexts`, {
      method: 'POST',
      body: JSON.stringify({
        application_id: APP_ID,
        service_id: DOCS_SERVICE_ID,
        group_id: group.id,
        alias: input.alias,
      }),
    });
    const parentArg = input.parentGroupId === rootGroupId ? null : ({ id: input.parentGroupId } as any);
    await registry.register_folder({ id: group.id } as any, parentArg, input.color ?? null);
    await registry.bind_folder_context({ id: group.id } as any, { id: ctx.id } as any);
    if (input.visibility === 'Restricted') {
      await registry.set_visibility({ id: group.id } as any, 'Restricted' as any);
    } else if (input.parentGroupId !== rootGroupId) {
      const parentMembers = await adminRequest<{ members: { identity: string; capabilities: number }[] }>(
        `/groups/${input.parentGroupId}/members`,
      );
      const failures: string[] = [];
      for (const m of parentMembers.members) {
        try {
          await addGroupMember({ groupId: group.id, identity: m.identity, capabilities: m.capabilities & 0x7 });
        } catch { failures.push(m.identity); }
      }
      if (failures.length) console.warn('cascade failures', failures);
    }
    return group.id;
  }, [registry, rootGroupId, createGroupInNamespace, nestGroup, addGroupMember]);

  const rename = useCallback((folderId: string, alias: string) => setGroupAlias({ groupId: folderId, alias }), [setGroupAlias]);

  const remove = useCallback(async (folderId: string) => {
    if (!registry) throw new Error('registry not ready');
    const descendants = tree.filter((f) => f.id === folderId || isDescendantOf(tree, f.id, folderId));
    descendants.sort((a, b) => depthIn(tree, b.id) - depthIn(tree, a.id)); // leaf-first
    for (const d of descendants) {
      await registry.unregister_folder({ id: d.id } as any);
      await deleteGroup({ groupId: d.id });
    }
  }, [registry, tree, deleteGroup]);

  const cascadeTo = useCallback(async (parentFolderId: string, identity: string, capabilities: number) => {
    const targets = computeCascadeTargets(tree, parentFolderId, capabilities);
    for (const t of targets) {
      try { await addGroupMember({ groupId: t.folderId, identity, capabilities: t.capabilities }); }
      catch (e) { console.warn('cascade failure', t, e); }
    }
  }, [tree, addGroupMember]);

  return { create, rename, remove, cascadeTo };
}

function isDescendantOf(tree: CascadeFolder[], id: string, rootId: string): boolean {
  const byId = new Map(tree.map((f) => [f.id, f]));
  let cur = byId.get(id)?.parent_id;
  while (cur) {
    if (cur === rootId) return true;
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return false;
}

function depthIn(tree: CascadeFolder[], id: string): number {
  const byId = new Map(tree.map((f) => [f.id, f]));
  let d = 0, cur = byId.get(id)?.parent_id;
  while (cur) { d++; cur = byId.get(cur)?.parent_id ?? null; }
  return d;
}
```

Note: `useCreateGroupInNamespace`, `useNestGroup`, `useUnnestGroup`, `useDeleteGroup`, `useSetGroupAlias`, `useAddGroupMember` are mero-react v1.0.2+ hooks — if any hook is not yet available, fall back to `adminRequest`.

- [ ] **Step 2: Typecheck**

Run: `cd app && pnpm exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useFolderOperations.ts
git commit -m "feat(app/hooks): useFolderOperations (create, rename, remove, cascade)"
```

---

### Task 34: `useFolderMembership` + `useDocEvents`

**Files:**
- Create: `app/src/hooks/useFolderMembership.ts`
- Create: `app/src/hooks/useDocEvents.ts`

- [ ] **Step 1: Implement `useFolderMembership`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { useAddGroupMember, useRemoveGroupMember } from '@calimero-network/mero-react';

export interface Member { identity: string; capabilities: number }

export function useFolderMembership(folderId: string | null) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(!!folderId);
  const { addGroupMember } = useAddGroupMember();
  const { removeGroupMember } = useRemoveGroupMember();

  const refetch = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    try {
      const r = await adminRequest<{ members: Member[] }>(`/groups/${folderId}/members`);
      setMembers(r.members);
    } finally { setLoading(false); }
  }, [folderId]);

  useEffect(() => { refetch(); }, [refetch]);

  const add = useCallback(async (identity: string, capabilities: number) => {
    if (!folderId) return;
    await addGroupMember({ groupId: folderId, identity, capabilities });
    await refetch();
  }, [folderId, addGroupMember, refetch]);

  const remove = useCallback(async (identity: string) => {
    if (!folderId) return;
    await removeGroupMember({ groupId: folderId, identity });
    await refetch();
  }, [folderId, removeGroupMember, refetch]);

  return { members, loading, add, remove, refetch };
}
```

- [ ] **Step 2: Implement `useDocEvents`**

```ts
import { useEffect } from 'react';
import { useSubscription } from '@calimero-network/mero-react';

export function useDocEvents(docsContextId: string | null, onChange: () => void) {
  const sub = useSubscription(docsContextId ?? undefined);
  useEffect(() => {
    if (!sub) return;
    const off = sub.on('event', () => onChange());
    return () => { off?.(); };
  }, [sub, onChange]);
}
```

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useFolderMembership.ts app/src/hooks/useDocEvents.ts
git commit -m "feat(app/hooks): useFolderMembership + useDocEvents"
```

---

### Task 35: `WorkspaceContext` + `RegistryContext` providers

**Files:**
- Create: `app/src/context/WorkspaceContext.tsx`
- Create: `app/src/context/RegistryContext.tsx`

- [ ] **Step 1: Implement `WorkspaceContext.tsx`**

```tsx
import { createContext, ReactNode, useContext, useState } from 'react';

interface Workspace {
  namespaceId: string | null;
  rootGroupId: string | null;
  selectedFolderId: string | null;
  setNamespace: (ns: string, root: string) => void;
  setSelectedFolder: (id: string | null) => void;
}

const ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [namespaceId, setNs] = useState<string | null>(localStorage.getItem('mero-drive:activeNs'));
  const [rootGroupId, setRoot] = useState<string | null>(localStorage.getItem('mero-drive:activeRoot'));
  const [selectedFolderId, setSelected] = useState<string | null>(null);

  const setNamespace = (ns: string, root: string) => {
    localStorage.setItem('mero-drive:activeNs', ns);
    localStorage.setItem('mero-drive:activeRoot', root);
    setNs(ns); setRoot(root); setSelected(null);
  };

  return <ctx.Provider value={{ namespaceId, rootGroupId, selectedFolderId, setNamespace, setSelectedFolder: setSelected }}>{children}</ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const v = useContext(ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
```

- [ ] **Step 2: Implement `RegistryContext.tsx`**

```tsx
import { createContext, ReactNode, useContext } from 'react';
import type { RegistryClient } from '../api/registry';
import type { MergedFolder } from '../hooks/useWorkspaceTree';
import { useSelfIdentity } from '../hooks/useSelfIdentity';
import { useWorkspaceBootstrap } from '../hooks/useWorkspaceBootstrap';
import { useRegistryClient } from '../hooks/useRegistryClient';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';
import { useWorkspace } from './WorkspaceContext';

interface RegistryCtx {
  registryClient: RegistryClient | null;
  folders: MergedFolder[];
  loading: boolean;
}

const ctx = createContext<RegistryCtx | null>(null);

export function RegistryProvider({ children }: { children: ReactNode }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const { identity } = useSelfIdentity(namespaceId);
  const { registryContextId } = useWorkspaceBootstrap(namespaceId, rootGroupId, identity);
  const registryClient = useRegistryClient(registryContextId);
  const { folders, loading } = useWorkspaceTree(rootGroupId, registryClient);
  return <ctx.Provider value={{ registryClient, folders, loading }}>{children}</ctx.Provider>;
}

export function useRegistry(): RegistryCtx {
  const v = useContext(ctx);
  if (!v) throw new Error('useRegistry outside RegistryProvider');
  return v;
}
```

- [ ] **Step 3: Wire providers in `App.tsx`**

Replace `App.tsx` with:

```tsx
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { RegistryProvider } from './context/RegistryContext';
import { WorkspaceLayout } from './components/WorkspaceLayout';

export default function App() {
  const { isAuthenticated, login } = useCalimero();
  if (!isAuthenticated) return <button onClick={() => login()}>Log in</button>;
  return (
    <WorkspaceProvider>
      <RegistryProvider>
        <WorkspaceLayout />
      </RegistryProvider>
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 4: Placeholder `WorkspaceLayout.tsx` until Task 36**

```tsx
export function WorkspaceLayout() { return <div>workspace</div>; }
```

- [ ] **Step 5: Typecheck + build**

Run: `cd app && pnpm exec tsc --noEmit && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add app/src/context/ app/src/App.tsx app/src/components/WorkspaceLayout.tsx
git commit -m "feat(app/context): WorkspaceProvider + RegistryProvider"
```

---

## Phase 8: UI Components

Build the user-facing UI: namespace switcher, folder tree, folder actions, doc editor. Each component is permission-gated via the Phase 6 hooks.

### Task 36: `NamespaceSwitcher` + `NamespaceCreateDialog`

**Files:**
- Create: `app/src/components/workspace/NamespaceSwitcher.tsx`
- Create: `app/src/components/workspace/NamespaceCreateDialog.tsx`

- [ ] **Step 1: Implement `NamespaceSwitcher`**

```tsx
import { useNamespacesForApplication, useCreateNamespace } from '@calimero-network/mero-react';
import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { APP_ID } from '../../constants/config';
import { NamespaceCreateDialog } from './NamespaceCreateDialog';

export function NamespaceSwitcher() {
  const { namespaces, loading } = useNamespacesForApplication(APP_ID);
  const { namespaceId, setNamespace } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="flex items-center gap-2 p-2">
      <select
        className="border rounded px-2 py-1"
        value={namespaceId ?? ''}
        onChange={(e) => {
          const ns = namespaces?.find((n) => n.id === e.target.value);
          if (ns) setNamespace(ns.id, ns.root_group_id);
        }}
      >
        <option value="" disabled>Pick a workspace</option>
        {namespaces?.map((n) => <option key={n.id} value={n.id}>{n.alias ?? n.id}</option>)}
      </select>
      <button className="px-2 py-1 border rounded" onClick={() => setShowCreate(true)}>New workspace</button>
      {showCreate && <NamespaceCreateDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Implement `NamespaceCreateDialog`**

```tsx
import { useState } from 'react';
import { useCreateNamespace } from '@calimero-network/mero-react';
import { APP_ID } from '../../constants/config';
import { useWorkspace } from '../../context/WorkspaceContext';

export function NamespaceCreateDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createNamespace } = useCreateNamespace();
  const { setNamespace } = useWorkspace();

  const onCreate = async () => {
    if (!name.trim()) { setError('Name required'); return; }
    setLoading(true); setError(null);
    try {
      const ns = await createNamespace({ applicationId: APP_ID, alias: name.trim() });
      setNamespace(ns.id, ns.root_group_id);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div role="dialog" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded p-4 w-80">
        <h2 className="font-semibold mb-2">New workspace</h2>
        <input className="border w-full px-2 py-1 rounded" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
        {error && <div className="text-red-600 text-sm mt-1">{error}</div>}
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose}>Cancel</button>
          <button disabled={loading} onClick={onCreate} className="bg-blue-600 text-white px-3 py-1 rounded">Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && pnpm exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/src/components/workspace/
git commit -m "feat(app/ui): NamespaceSwitcher + NamespaceCreateDialog"
```

---

### Task 37: `FolderTree` + `FolderTreeItem`

**Files:**
- Create: `app/src/components/folders/FolderTree.tsx`
- Create: `app/src/components/folders/FolderTreeItem.tsx`

- [ ] **Step 1: Implement `FolderTree`**

```tsx
import { useMemo } from 'react';
import { useRegistry } from '../../context/RegistryContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { buildTree } from '../../utils/ancestry';
import { FolderTreeItem } from './FolderTreeItem';

export function FolderTree() {
  const { folders, loading } = useRegistry();
  const { selectedFolderId, setSelectedFolder } = useWorkspace();
  const tree = useMemo(() => buildTree(folders.map((f) => ({ id: f.id, parent_id: f.parent_id }))), [folders]);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  if (loading) return <div className="p-2 text-sm text-gray-500">Loading folders…</div>;

  return (
    <ul className="p-2 space-y-1">
      {tree.roots.map((n) => (
        <FolderTreeItem
          key={n.id}
          node={n}
          byId={byId}
          depth={0}
          selectedId={selectedFolderId}
          onSelect={setSelectedFolder}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Implement `FolderTreeItem`**

```tsx
import { TreeNode } from '../../utils/ancestry';
import type { MergedFolder } from '../../hooks/useWorkspaceTree';

export function FolderTreeItem({
  node, byId, depth, selectedId, onSelect,
}: {
  node: TreeNode;
  byId: Map<string, MergedFolder>;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const folder = byId.get(node.id);
  const isSelected = selectedId === node.id;
  return (
    <li>
      <button
        onClick={() => onSelect(node.id)}
        className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded ${isSelected ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {folder?.color && <span className="w-2 h-2 rounded" style={{ backgroundColor: folder.color }} />}
        <span>{folder?.alias ?? node.id}</span>
        {folder?.visibility === 'Restricted' && <span className="text-xs text-gray-500">🔒</span>}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <FolderTreeItem key={c.id} node={c} byId={byId} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/folders/FolderTree.tsx app/src/components/folders/FolderTreeItem.tsx
git commit -m "feat(app/ui): FolderTree + FolderTreeItem"
```

---

### Task 38: `NewFolderButton` + `NewFolderDialog` (permission-gated)

**Files:**
- Create: `app/src/components/folders/NewFolderButton.tsx`
- Create: `app/src/components/folders/NewFolderDialog.tsx`

- [ ] **Step 1: Implement `NewFolderButton` — gated by namespace caps**

```tsx
import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useNamespacePermissions } from '../../hooks/useNamespacePermissions';
import { NewFolderDialog } from './NewFolderDialog';

export function NewFolderButton({ parentFolderId }: { parentFolderId: string | null }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const nsPerms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const [open, setOpen] = useState(false);
  if (!parentFolderId && !nsPerms.canCreateSubgroup) return null;
  return (
    <>
      <button data-testid="new-folder-btn" className="border rounded px-2 py-1" onClick={() => setOpen(true)}>New folder</button>
      {open && <NewFolderDialog parentFolderId={parentFolderId} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Implement `NewFolderDialog`**

```tsx
import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useRegistry } from '../../context/RegistryContext';
import { useFolderOperations } from '../../hooks/useFolderOperations';
import { depthOf } from '../../utils/ancestry';
import { MAX_FOLDER_DEPTH } from '../../constants/config';

export function NewFolderDialog({ parentFolderId, onClose }: { parentFolderId: string | null; onClose: () => void }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const { folders, registryClient } = useRegistry();
  const ops = useFolderOperations(registryClient, rootGroupId, folders.map((f) => ({ id: f.id, parent_id: f.parent_id, visibility: f.visibility })));
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('');
  const [visibility, setVisibility] = useState<'Inherit' | 'Restricted'>('Inherit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (parentFolderId) {
    const depth = depthOf(folders.map((f) => ({ id: f.id, parent_id: f.parent_id })), parentFolderId);
    if (depth >= MAX_FOLDER_DEPTH - 1) return <div>Cannot nest deeper than {MAX_FOLDER_DEPTH} levels.</div>;
  }

  const onCreate = async () => {
    if (!name.trim() || !namespaceId || !rootGroupId) return;
    setLoading(true); setError(null);
    try {
      await ops.create({
        namespaceId,
        parentGroupId: parentFolderId ?? rootGroupId,
        alias: name.trim(),
        color: color || undefined,
        visibility,
      });
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div role="dialog" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded p-4 w-96 space-y-2">
        <h2 className="font-semibold">New folder</h2>
        <input className="border w-full px-2 py-1 rounded" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input className="border w-full px-2 py-1 rounded" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#rrggbb (optional)" />
        <select className="border w-full px-2 py-1 rounded" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
          <option value="Inherit">Inherit parent members</option>
          <option value="Restricted">Restricted (you pick members)</option>
        </select>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose}>Cancel</button>
          <button disabled={loading} onClick={onCreate} className="bg-blue-600 text-white px-3 py-1 rounded">Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/folders/NewFolderButton.tsx app/src/components/folders/NewFolderDialog.tsx
git commit -m "feat(app/ui): NewFolderButton + NewFolderDialog with depth cap"
```

---

### Task 39: `FolderContextMenu` + `FolderVisibilityToggle`

**Files:**
- Create: `app/src/components/folders/FolderContextMenu.tsx`
- Create: `app/src/components/folders/FolderVisibilityToggle.tsx`

- [ ] **Step 1: Implement `FolderContextMenu` — three permission-gated items**

```tsx
import { useWorkspace } from '../../context/WorkspaceContext';
import { useRegistry } from '../../context/RegistryContext';
import { useFolderPermissions } from '../../hooks/useFolderPermissions';
import { useFolderOperations } from '../../hooks/useFolderOperations';

export function FolderContextMenu({ folderId, onRename, onNewSubfolder }: { folderId: string; onRename: () => void; onNewSubfolder: () => void }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { folders, registryClient } = useRegistry();
  const ops = useFolderOperations(registryClient, rootGroupId, folders.map((f) => ({ id: f.id, parent_id: f.parent_id, visibility: f.visibility })));

  return (
    <ul data-testid="folder-menu" className="bg-white border rounded shadow">
      {perms.canRename && <li><button data-testid="menu-rename" onClick={onRename}>Rename</button></li>}
      {perms.canCreateSubfolder && <li><button data-testid="menu-new-subfolder" onClick={onNewSubfolder}>New subfolder</button></li>}
      {perms.canDelete && <li><button data-testid="menu-delete" onClick={() => ops.remove(folderId)}>Delete</button></li>}
    </ul>
  );
}
```

- [ ] **Step 2: Implement `FolderVisibilityToggle`**

```tsx
import { useWorkspace } from '../../context/WorkspaceContext';
import { useRegistry } from '../../context/RegistryContext';
import { useFolderPermissions } from '../../hooks/useFolderPermissions';

export function FolderVisibilityToggle({ folderId, current }: { folderId: string; current: 'Inherit' | 'Restricted' }) {
  const { namespaceId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { registryClient } = useRegistry();
  if (!perms.canManageGroup) return null;
  return (
    <button
      data-testid="visibility-toggle"
      onClick={() => registryClient?.set_visibility({ id: folderId } as any, current === 'Inherit' ? 'Restricted' as any : 'Inherit' as any)}
    >
      {current === 'Inherit' ? 'Make restricted' : 'Make inherited'}
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/folders/FolderContextMenu.tsx app/src/components/folders/FolderVisibilityToggle.tsx
git commit -m "feat(app/ui): FolderContextMenu + FolderVisibilityToggle"
```

---

### Task 40: `FolderSharingPanel` + `FolderBreadcrumb`

**Files:**
- Create: `app/src/components/folders/FolderSharingPanel.tsx`
- Create: `app/src/components/folders/FolderBreadcrumb.tsx`

- [ ] **Step 1: Implement `FolderSharingPanel`**

```tsx
import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useFolderPermissions } from '../../hooks/useFolderPermissions';
import { useFolderMembership } from '../../hooks/useFolderMembership';
import { CAP } from '../../constants/config';

export function FolderSharingPanel({ folderId }: { folderId: string }) {
  const { namespaceId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { members, add, remove } = useFolderMembership(folderId);
  const [identity, setIdentity] = useState('');

  if (!perms.canInviteMembers && !perms.canManageMembers) return null;
  return (
    <div data-testid="sharing-panel" className="border-t p-2">
      <h3 className="font-semibold text-sm">Members</h3>
      <ul>
        {members.map((m) => (
          <li key={m.identity} className="flex justify-between text-sm">
            <span>{m.identity.slice(0, 8)}…</span>
            {perms.canManageMembers && <button data-testid={`remove-${m.identity}`} onClick={() => remove(m.identity)}>Remove</button>}
          </li>
        ))}
      </ul>
      {perms.canInviteMembers && (
        <div className="flex gap-1 mt-2">
          <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="identity (pk)" className="border px-1 rounded flex-1" />
          <button data-testid="add-member" onClick={() => { add(identity, CAP.READ | CAP.WRITE); setIdentity(''); }}>Add</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `FolderBreadcrumb`**

```tsx
import { useRegistry } from '../../context/RegistryContext';
import { ancestorsOf } from '../../utils/ancestry';

export function FolderBreadcrumb({ folderId }: { folderId: string }) {
  const { folders } = useRegistry();
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain = ancestorsOf(folders.map((f) => ({ id: f.id, parent_id: f.parent_id })), folderId).reverse();
  return (
    <nav className="flex gap-1 text-sm text-gray-600 p-2">
      {chain.map((id) => <span key={id}>{byId.get(id)?.alias ?? id} /</span>)}
      <span className="font-semibold">{byId.get(folderId)?.alias ?? folderId}</span>
    </nav>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/folders/FolderSharingPanel.tsx app/src/components/folders/FolderBreadcrumb.tsx
git commit -m "feat(app/ui): FolderSharingPanel + FolderBreadcrumb"
```

---

### Task 41: `DocumentList` + `DocumentEditor` + `DocumentToolbar`

**Files:**
- Create: `app/src/components/docs/DocumentList.tsx`
- Create: `app/src/components/docs/DocumentEditor.tsx`
- Create: `app/src/components/docs/DocumentToolbar.tsx`

- [ ] **Step 1: Implement `DocumentList`**

```tsx
import { useEffect, useState } from 'react';
import { useDocsClient } from '../../hooks/useDocsClient';
import { useDocEvents } from '../../hooks/useDocEvents';
import { useRegistry } from '../../context/RegistryContext';

export function DocumentList({ folderId, onOpen }: { folderId: string; onOpen: (docId: string) => void }) {
  const { folders, registryClient } = useRegistry();
  const [ctxId, setCtxId] = useState<string | null>(null);
  useEffect(() => {
    if (!registryClient) return;
    registryClient.get_folder_context({ id: folderId } as any).then((c: any) => setCtxId(c.id)).catch(() => setCtxId(null));
  }, [registryClient, folderId]);

  const docs = useDocsClient(ctxId);
  const [list, setList] = useState<{ id: string; title: string }[]>([]);

  const refetch = () => { if (!docs) return; docs.list_docs(false).then((r: any) => setList(r)); };
  useEffect(() => { refetch(); }, [docs]);
  useDocEvents(ctxId, refetch);

  if (!docs) return <div className="p-2 text-sm text-gray-500">No docs context bound.</div>;

  return (
    <ul className="p-2 space-y-1">
      {list.map((d) => <li key={d.id}><button onClick={() => onOpen(d.id)} className="text-left w-full hover:bg-gray-100 px-2 py-1 rounded">{d.title || d.id}</button></li>)}
    </ul>
  );
}
```

- [ ] **Step 2: Implement `DocumentEditor` — simple textarea v1**

```tsx
import { useEffect, useState } from 'react';
import { useDocsClient } from '../../hooks/useDocsClient';
import { useRegistry } from '../../context/RegistryContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useFolderPermissions } from '../../hooks/useFolderPermissions';
import { DocumentToolbar } from './DocumentToolbar';

export function DocumentEditor({ folderId, docId, onClose }: { folderId: string; docId: string; onClose: () => void }) {
  const { namespaceId } = useWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { registryClient } = useRegistry();
  const [ctxId, setCtxId] = useState<string | null>(null);
  const [title, setTitle] = useState(''); const [content, setContent] = useState('');

  useEffect(() => { registryClient?.get_folder_context({ id: folderId } as any).then((c: any) => setCtxId(c.id)); }, [registryClient, folderId]);
  const docs = useDocsClient(ctxId);

  useEffect(() => {
    if (!docs) return;
    docs.get_doc(docId).then((d: any) => { setTitle(d.title); setContent(d.content); });
  }, [docs, docId]);

  const save = async () => { if (!docs) return; await docs.edit_doc(docId, title, content); };

  return (
    <div className="flex flex-col flex-1">
      <DocumentToolbar perms={perms} onSave={save} onDelete={async () => { await docs?.delete_doc(docId); onClose(); }} />
      <input className="text-xl font-bold px-2 py-1 border-b" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!perms.canWrite} />
      <textarea className="flex-1 p-2" value={content} onChange={(e) => setContent(e.target.value)} disabled={!perms.canWrite} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `DocumentToolbar`**

```tsx
import type { FolderPermissions } from '../../hooks/useFolderPermissions';

export function DocumentToolbar({ perms, onSave, onDelete }: { perms: FolderPermissions; onSave: () => void; onDelete: () => void }) {
  return (
    <div data-testid="doc-toolbar" className="flex gap-2 p-2 border-b bg-gray-50">
      {perms.canWrite && <button data-testid="doc-save" onClick={onSave}>Save</button>}
      {perms.canWrite && <button data-testid="doc-delete" onClick={onDelete}>Delete</button>}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/docs/
git commit -m "feat(app/ui): DocumentList, DocumentEditor, DocumentToolbar"
```

---

### Task 42: `WorkspaceSettingsPanel` + `MemberRoleSelect` + `NamespaceSettingsPanel` + `NamespaceMembersPanel`

**Files:**
- Create: `app/src/components/admin/WorkspaceSettingsPanel.tsx`
- Create: `app/src/components/admin/MemberRoleSelect.tsx`
- Create: `app/src/components/workspace/NamespaceSettingsPanel.tsx`
- Create: `app/src/components/workspace/NamespaceMembersPanel.tsx`

- [ ] **Step 1: Implement minimal `WorkspaceSettingsPanel`**

```tsx
import { useWorkspace } from '../../context/WorkspaceContext';
import { useNamespacePermissions } from '../../hooks/useNamespacePermissions';
import { useReconcile } from '../../hooks/useReconcile';
import { useRegistry } from '../../context/RegistryContext';

export function WorkspaceSettingsPanel() {
  const { namespaceId, rootGroupId } = useWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { registryClient } = useRegistry();
  const { run, running, last } = useReconcile(rootGroupId, registryClient);
  if (!perms.canManageNamespace) return null;
  return (
    <div data-testid="workspace-settings" className="p-2 border rounded">
      <button disabled={running} onClick={run}>Reconcile registry</button>
      {last && <div className="text-sm text-gray-600">registered {last.registered}, unregistered {last.unregistered}, moved {last.moved}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Implement `MemberRoleSelect`**

```tsx
import { CAP } from '../../constants/config';

const PRESETS: { label: string; mask: number }[] = [
  { label: 'Viewer', mask: CAP.READ },
  { label: 'Editor', mask: CAP.READ | CAP.WRITE },
  { label: 'Admin', mask: CAP.READ | CAP.WRITE | CAP.CREATE_GROUP | CAP.MANAGE_GROUP | CAP.INVITE_MEMBERS | CAP.MANAGE_MEMBERS },
];

export function MemberRoleSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const match = PRESETS.find((p) => p.mask === value)?.label ?? 'Custom';
  return (
    <select data-testid="role-select" value={match} disabled={disabled} onChange={(e) => {
      const p = PRESETS.find((p) => p.label === e.target.value);
      if (p) onChange(p.mask);
    }}>
      {PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}
      <option>Custom</option>
    </select>
  );
}
```

- [ ] **Step 3: Implement `NamespaceSettingsPanel` + `NamespaceMembersPanel` (stubs reusing admin panel)**

```tsx
// NamespaceSettingsPanel.tsx
import { WorkspaceSettingsPanel } from '../admin/WorkspaceSettingsPanel';
export function NamespaceSettingsPanel() { return <WorkspaceSettingsPanel />; }
```

```tsx
// NamespaceMembersPanel.tsx
import { useWorkspace } from '../../context/WorkspaceContext';
import { useFolderMembership } from '../../hooks/useFolderMembership';
import { useNamespacePermissions } from '../../hooks/useNamespacePermissions';
import { MemberRoleSelect } from '../admin/MemberRoleSelect';

export function NamespaceMembersPanel() {
  const { namespaceId, rootGroupId } = useWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { members, add, remove } = useFolderMembership(rootGroupId);
  if (!perms.canManageNamespaceMembers) return null;
  return (
    <div className="p-2">
      <h3>Namespace members</h3>
      {members.map((m) => (
        <div key={m.identity} className="flex gap-2">
          <span>{m.identity.slice(0, 8)}…</span>
          <MemberRoleSelect value={m.capabilities} onChange={(v) => add(m.identity, v)} />
          <button onClick={() => remove(m.identity)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/admin/ app/src/components/workspace/NamespaceSettingsPanel.tsx app/src/components/workspace/NamespaceMembersPanel.tsx
git commit -m "feat(app/ui): workspace/namespace settings + role select"
```

---

### Task 43: Wire `WorkspaceLayout` and permission-gating component tests

**Files:**
- Modify: `app/src/components/WorkspaceLayout.tsx`
- Create: `app/src/components/__tests__/permission-gating.test.tsx`

- [ ] **Step 1: Flesh out `WorkspaceLayout`**

```tsx
import { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { NamespaceSwitcher } from './workspace/NamespaceSwitcher';
import { FolderTree } from './folders/FolderTree';
import { NewFolderButton } from './folders/NewFolderButton';
import { FolderBreadcrumb } from './folders/FolderBreadcrumb';
import { FolderSharingPanel } from './folders/FolderSharingPanel';
import { FolderContextMenu } from './folders/FolderContextMenu';
import { DocumentList } from './docs/DocumentList';
import { DocumentEditor } from './docs/DocumentEditor';

export function WorkspaceLayout() {
  const { selectedFolderId } = useWorkspace();
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r flex flex-col">
        <NamespaceSwitcher />
        <div className="p-2"><NewFolderButton parentFolderId={null} /></div>
        <FolderTree />
      </aside>
      <main className="flex-1 flex flex-col">
        {selectedFolderId ? (
          <>
            <FolderBreadcrumb folderId={selectedFolderId} />
            {openDocId ? (
              <DocumentEditor folderId={selectedFolderId} docId={openDocId} onClose={() => setOpenDocId(null)} />
            ) : (
              <DocumentList folderId={selectedFolderId} onOpen={setOpenDocId} />
            )}
            <FolderSharingPanel folderId={selectedFolderId} />
          </>
        ) : (
          <div className="p-4 text-gray-500">Select a folder</div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write component permission-gating tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CAP } from '../../constants/config';

vi.mock('../../hooks/useFolderPermissions', () => ({
  useFolderPermissions: vi.fn(),
}));
vi.mock('../../hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: vi.fn(),
}));
vi.mock('../../hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn(), cascadeTo: vi.fn() }),
}));
vi.mock('../../hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({ members: [], add: vi.fn(), remove: vi.fn(), refetch: vi.fn(), loading: false }),
}));
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ namespaceId: 'ns', rootGroupId: 'root', selectedFolderId: 'f1', setSelectedFolder: vi.fn(), setNamespace: vi.fn() }),
}));
vi.mock('../../context/RegistryContext', () => ({
  useRegistry: () => ({ folders: [], registryClient: {} as any, loading: false }),
}));

import { useFolderPermissions } from '../../hooks/useFolderPermissions';
import { useNamespacePermissions } from '../../hooks/useNamespacePermissions';
import { FolderContextMenu } from '../folders/FolderContextMenu';
import { FolderSharingPanel } from '../folders/FolderSharingPanel';
import { DocumentToolbar } from '../docs/DocumentToolbar';
import { FolderVisibilityToggle } from '../folders/FolderVisibilityToggle';
import { NewFolderButton } from '../folders/NewFolderButton';
import { WorkspaceSettingsPanel } from '../admin/WorkspaceSettingsPanel';

const noPerms = { canRead: false, canWrite: false, canCreateSubfolder: false, canRename: false, canDelete: false, canManageGroup: false, canInviteMembers: false, canManageMembers: false, loading: false };

describe('permission-gating', () => {
  it('FolderContextMenu hides delete when canDelete=false', () => {
    (useFolderPermissions as any).mockReturnValue({ ...noPerms, canRename: true });
    render(<FolderContextMenu folderId="f1" onRename={() => {}} onNewSubfolder={() => {}} />);
    expect(screen.queryByTestId('menu-delete')).toBeNull();
    expect(screen.getByTestId('menu-rename')).toBeTruthy();
  });

  it('FolderContextMenu shows delete when canDelete=true', () => {
    (useFolderPermissions as any).mockReturnValue({ ...noPerms, canDelete: true });
    render(<FolderContextMenu folderId="f1" onRename={() => {}} onNewSubfolder={() => {}} />);
    expect(screen.getByTestId('menu-delete')).toBeTruthy();
  });

  it('FolderSharingPanel hidden when no invite/manage caps', () => {
    (useFolderPermissions as any).mockReturnValue(noPerms);
    const { container } = render(<FolderSharingPanel folderId="f1" />);
    expect(container.firstChild).toBeNull();
  });

  it('FolderSharingPanel shows add button when canInviteMembers', () => {
    (useFolderPermissions as any).mockReturnValue({ ...noPerms, canInviteMembers: true });
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByTestId('add-member')).toBeTruthy();
  });

  it('DocumentToolbar hides save+delete when canWrite=false', () => {
    render(<DocumentToolbar perms={noPerms as any} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.queryByTestId('doc-save')).toBeNull();
    expect(screen.queryByTestId('doc-delete')).toBeNull();
  });

  it('FolderVisibilityToggle hidden without canManageGroup', () => {
    (useFolderPermissions as any).mockReturnValue(noPerms);
    const { container } = render(<FolderVisibilityToggle folderId="f1" current="Inherit" />);
    expect(container.firstChild).toBeNull();
  });

  it('NewFolderButton hidden for root when lacking namespace CREATE_GROUP', () => {
    (useNamespacePermissions as any).mockReturnValue({ canCreateSubgroup: false, canManageNamespace: false, canManageNamespaceMembers: false, loading: false });
    const { container } = render(<NewFolderButton parentFolderId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('WorkspaceSettingsPanel hidden without canManageNamespace', () => {
    (useNamespacePermissions as any).mockReturnValue({ canCreateSubgroup: false, canManageNamespace: false, canManageNamespaceMembers: false, loading: false });
    const { container } = render(<WorkspaceSettingsPanel />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd app && pnpm test permission-gating`
Expected: 8 tests pass.

- [ ] **Step 4: Build + commit**

```bash
cd app && pnpm build
```

```bash
git add app/src/components/WorkspaceLayout.tsx app/src/components/__tests__/permission-gating.test.tsx
git commit -m "feat(app/ui): WorkspaceLayout + permission-gating component tests"
```

---

## Phase 9: End-to-End (Merobox)

Three multi-node workflows validating the real wasm + replication behaviors.

### Task 44: Basic workflow — alice creates, bob joins and sees

**Files:**
- Create: `e2e/workflow-mero-drive-namespace-basic.yml`
- Create: `e2e/README.md`

- [ ] **Step 1: Write `workflow-mero-drive-namespace-basic.yml`**

```yaml
name: mero-drive-namespace-basic
description: Alice creates namespace + folder + doc; Bob joins and sees both.
nodes: [alice, bob]
application:
  bundle: ../logic/mero-drive-docs-9.0.0.mpk
steps:
  - name: install-app
    on: [alice, bob]
    install_application:
      path: ../logic/mero-drive-docs-9.0.0.mpk
  - name: create-namespace
    on: alice
    create_namespace:
      application_id: $APP_ID
      alias: team-docs
      out: ns_id
  - name: create-root-folder
    on: alice
    create_group_in_namespace:
      namespace_id: $ns_id
      parent_group_id: $ns_id.root_group_id
      alias: Engineering
      out: eng_folder
  - name: bind-registry-ctx
    on: alice
    execute:
      context_alias: Registry
      service: registry
      method: register_folder
      args: [{ id: $eng_folder }, null, "#ff0000"]
  - name: bob-joins-namespace
    on: bob
    join_namespace:
      namespace_id: $ns_id
  - name: assert-bob-sees-folder
    on: bob
    assert_context_query:
      context_alias: Registry
      service: registry
      method: get_folders
      expect:
        length: 1
        index: 0
        field: id
        equals: $eng_folder
timeout: 60s
```

- [ ] **Step 2: Add `e2e/README.md`**

```markdown
# mero-drive e2e (merobox)

Build the bundle first: `(cd ../logic && ./build-bundle.sh)`

Run all: `pnpm --filter app test:e2e`

Run one: `merobox run workflow-mero-drive-namespace-basic.yml`
```

- [ ] **Step 3: Run**

```bash
(cd logic && ./build-bundle.sh)
merobox run e2e/workflow-mero-drive-namespace-basic.yml
```

Expected: workflow PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/workflow-mero-drive-namespace-basic.yml e2e/README.md
git commit -m "test(e2e): basic namespace + folder + bob-joins workflow"
```

---

### Task 45: Nested + restricted cascade workflow

**Files:**
- Create: `e2e/workflow-mero-drive-namespace-nested-restricted.yml`

- [ ] **Step 1: Write workflow — 3 nodes**

```yaml
name: mero-drive-namespace-nested-restricted
description: Cascade flows through inherit, stops at restricted.
nodes: [alice, bob, carol]
application:
  bundle: ../logic/mero-drive-docs-9.0.0.mpk
steps:
  - name: install
    on: [alice, bob, carol]
    install_application: { path: ../logic/mero-drive-docs-9.0.0.mpk }
  - name: ns
    on: alice
    create_namespace: { application_id: $APP_ID, alias: team, out: ns }
  - name: invite-bob
    on: alice
    add_namespace_member: { namespace_id: $ns, identity: $bob.identity, capabilities: 3 }
  - name: folder-A-inherit
    on: alice
    create_group_in_namespace: { namespace_id: $ns, parent_group_id: $ns.root_group_id, alias: A, out: a }
  - name: folder-B-restricted-under-A
    on: alice
    create_group_in_namespace: { namespace_id: $ns, parent_group_id: $a, alias: B, out: b }
  - name: set-B-restricted
    on: alice
    execute:
      context_alias: Registry
      service: registry
      method: set_visibility
      args: [{ id: $b }, Restricted]
  - name: folder-C-under-B
    on: alice
    create_group_in_namespace: { namespace_id: $ns, parent_group_id: $b, alias: C, out: c }
  - name: assert-bob-sees-A
    on: bob
    assert_subgroup_member: { group_id: $a, identity: $bob.identity, expected: true }
  - name: assert-bob-does-not-see-B
    on: bob
    assert_subgroup_member: { group_id: $b, identity: $bob.identity, expected: false }
  - name: assert-bob-does-not-see-C
    on: bob
    assert_subgroup_member: { group_id: $c, identity: $bob.identity, expected: false }
timeout: 90s
```

- [ ] **Step 2: Run**

```bash
merobox run e2e/workflow-mero-drive-namespace-nested-restricted.yml
```

- [ ] **Step 3: Commit**

```bash
git add e2e/workflow-mero-drive-namespace-nested-restricted.yml
git commit -m "test(e2e): nested + restricted cascade boundary"
```

---

### Task 46: Reconciliation workflow

**Files:**
- Create: `e2e/workflow-mero-drive-namespace-reconciliation.yml`

- [ ] **Step 1: Write workflow — drift + reconcile**

```yaml
name: mero-drive-namespace-reconciliation
description: Create group via admin API only; reconcile must register in registry.
nodes: [alice, bob]
application:
  bundle: ../logic/mero-drive-docs-9.0.0.mpk
steps:
  - name: install
    on: [alice, bob]
    install_application: { path: ../logic/mero-drive-docs-9.0.0.mpk }
  - name: ns
    on: alice
    create_namespace: { application_id: $APP_ID, alias: drift, out: ns }
  - name: admin-only-subgroup
    on: alice
    nest_group: { parent_group_id: $ns.root_group_id, new_alias: ghost, out: ghost_id }
  - name: reconcile
    on: alice
    execute:
      context_alias: Registry
      service: registry
      method: register_folder
      args: [{ id: $ghost_id }, null, null]
  - name: assert-registered
    on: alice
    assert_context_query:
      context_alias: Registry
      service: registry
      method: get_folders
      expect: { length_gte: 1 }
timeout: 60s
```

Note: if `nest_group` primitive doesn't exist in merobox, use `admin_call` with a POST to `/groups/<root>/subgroups`.

- [ ] **Step 2: Run**

```bash
merobox run e2e/workflow-mero-drive-namespace-reconciliation.yml
```

- [ ] **Step 3: Commit**

```bash
git add e2e/workflow-mero-drive-namespace-reconciliation.yml
git commit -m "test(e2e): reconciliation resolves admin-only drift"
```

---

## Phase 10: Cleanup + Docs

### Task 47: Codegen-drift CI guard

**Files:**
- Create/modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add codegen drift check**

Add a job (or step) that runs:

```yaml
- name: Build logic
  run: (cd logic && ./build-bundle.sh)
- name: Run codegen
  run: (cd app && pnpm codegen)
- name: Assert no drift
  run: git diff --exit-code app/src/api/registry app/src/api/docs
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: assert codegen output matches committed files"
```

---

### Task 48: Update README + final prune pass

**Files:**
- Modify: `README.md`
- Prune unused deps from `app/package.json`

- [ ] **Step 1: Identify and remove unused app deps**

```bash
cd app && pnpm exec depcheck || true
```

Remove any deps reported unused (likely `@tiptap/*` if we stuck with textarea editor; `styled-components`, `react-copy-to-clipboard`, etc. if their last consumers were deleted).

Run: `pnpm install` after pruning.

- [ ] **Step 2: Rewrite `README.md`**

```markdown
# mero-drive

A namespace-based document workspace for Calimero.

## Architecture

- **logic/crates/registry** — folder metadata (color, visibility, folder→context binding, sort order)
- **logic/crates/docs** — per-folder documents
- Bundled together as `com.calimero.mero-drive-docs@9.0.0` (`.mpk`)
- **app/** — React UI on Calimero + mero-react hooks

## Build

```bash
(cd logic && ./build-bundle.sh)         # builds .mpk
cd app && pnpm install && pnpm codegen  # generate clients
pnpm dev                                # dev server
```

## Test

```bash
cd logic && cargo test --workspace
cd app && pnpm test
pnpm test:e2e                           # requires merobox
```

## Permission model

See `docs/superpowers/specs/2026-04-20-namespace-migration-design.md` for the full design.
```

- [ ] **Step 3: Run full test suite**

```bash
cd logic && cargo test --workspace
cd app && pnpm test && pnpm build && pnpm lint
```

- [ ] **Step 4: Final commit**

```bash
git add README.md app/package.json app/pnpm-lock.yaml
git commit -m "docs: rewrite README for v9 + prune unused deps"
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/namespace-migration
```

---

## Appendix: Acceptance Criteria

Per the spec's 9 original requirements:

1. Workspace = namespace — Tasks 16, 29, 35, 36.
2. Folder = new group — Tasks 33, 38.
3. Subfolders = nested groups — Tasks 33, 38 (depth cap enforced in NewFolderDialog), 45.
4. `nest_group` / `unnest_group` exercised — Task 33 (create), Task 33 (delete), Task 45 (e2e).
5. Multi-service WASM — Phases 1, 2, 3.
6. Merobox e2e — Tasks 44, 45, 46.
7. mero-react hooks — Tasks 33, 34, 36.
8. `calimero-abi-codegen`, no manual ABI edits — Tasks 17, 47.
9. Old dead code removed — Tasks 1, 18, 48.




