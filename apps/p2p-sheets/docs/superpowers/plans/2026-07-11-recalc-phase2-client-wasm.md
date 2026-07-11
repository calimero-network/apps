# Recalc Phase 2 — Client-side WASM engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the same pure Rust evaluator in the browser (compiled to WASM) so a local edit recomputes in-process and paints instantly, with the node write happening off the interactive path.

**Architecture:** Extract the pure `formula`+`recalc` engine out of the node's `lib.rs` into a calimero-free crate (`p2p-sheets-recalc`) consumed by the node as an `rlib`. A thin `recalc-wasm` crate wraps it with `wasm-bindgen`; `wasm-pack` builds a browser artifact that is committed into the client. The client holds every sheet's raw inputs in a warm store, derives computed values locally via the WASM engine over `snapshot ⊕ pending-overlay`, and retires overlay entries as node/peer sync echoes them back (flicker-free optimistic echo). The node read path is unchanged except for one new all-cells read method.

**Tech Stack:** Rust (edition 2021, calimero tag `0.11.0-rc.8`), `wasm-bindgen` + `wasm-pack`, TypeScript + React 19 + Vite 7, vitest (node env), `@calimero-network/abi-codegen`.

## Global Constraints

- The new pure crate `p2p-sheets-recalc` is **calimero-free and depends on `std` only** — no `calimero-sdk`/`calimero-storage`, no `serde`. All JSON/serde lives in `recalc-wasm`.
- `recalc-wasm` (`crate-type = ["cdylib"]`) is the **only** crate that pulls in `wasm-bindgen`; the pure crate must stay linkable by the node.
- The node read path is **unchanged** except adding a new `get_all_cells` method. `get_cells`, `sheet_closure`, and their behavior are preserved exactly (existing tests must stay green).
- Browser WASM is built with `wasm-pack build --target web`; the generated JS+`.wasm` artifact is **committed** under `app/src/engine/recalc/`. Vercel builds need **no Rust toolchain**.
- The client derives from the WASM engine once it is ready; the node's `computed_value` is used only for the pre-WASM initial paint and the dev-mode agreement assert.
- Reconciliation is **pending-overlay**: derive over `snapshot ⊕ overlay`; a sync snapshot that confirms an overlay entry (same raw value / confirmed clear) retires it; in-flight entries survive a racing refetch. No flicker.
- Client pure logic is unit-tested in **node-env vitest**; there is **no React-hook test harness** — hook wiring is verified by `tsc` + `vite build` + a browser smoke test (the established repo pattern).
- Determinism is preserved (BTreeMap ordering in the engine); every moved test must stay green.
- After Rust crate changes, `bash logic/build-bundle.sh` (dev mode) must still produce the node `.mpk`.
- **Local-only:** do not push; commit locally per task.

---

## File Structure

**New (Rust):**
- `logic/crates/recalc/Cargo.toml` — pure engine crate manifest (`std`-only).
- `logic/crates/recalc/src/lib.rs` — `pub mod formula;` + `pub mod recalc;`.
- `logic/crates/recalc/src/formula.rs` — the `formula` module moved out of `lib.rs` (parser/evaluator + its unit tests).
- `logic/crates/recalc/src/recalc.rs` — moved from `logic/crates/spreadsheet/src/recalc.rs` (unchanged body + its tests).
- `logic/crates/recalc-wasm/Cargo.toml` — wasm-bindgen bindings manifest (`cdylib`).
- `logic/crates/recalc-wasm/src/lib.rs` — serde DTOs, native `evaluate_json`, `#[wasm_bindgen] evaluate`.
- `logic/build-recalc-wasm.sh` — builds `recalc-wasm` via `wasm-pack`, copies the artifact into the client.

**Modified (Rust):**
- `logic/Cargo.toml` — add the two new members + a workspace dep.
- `logic/crates/spreadsheet/Cargo.toml` — depend on `p2p-sheets-recalc`.
- `logic/crates/spreadsheet/src/lib.rs` — delete the inline `formula` module + `mod recalc;`, import from the new crate, add `get_all_cells`.

**New (client):**
- `app/src/engine/recalc/` — committed `wasm-pack --target web` output (`recalc_wasm.js`, `recalc_wasm_bg.wasm`, `.d.ts`). Generated; do not hand-edit.
- `app/src/engine/engine.ts` — lazy WASM init + typed synchronous `evaluate(inputJson) => outputJson`.
- `app/src/engine/derive.ts` — **pure**, engine-agnostic: input-store/overlay types, merge, overlay retirement, engine-input builder, active-sheet cell derivation, dev-assert diff.
- `app/src/engine/derive.test.ts` — unit tests for `derive.ts`.

**Modified (client):**
- `app/src/api/spreadsheet/SpreadsheetClient.ts` — regenerated to add `getAllCells()`.
- `app/src/hooks/useSpreadsheet.ts` — warm store + overlay wiring; read path derives locally; write path is optimistic.

---

## Global interfaces (names used across tasks)

Rust (crate `p2p-sheets-recalc`):
- `p2p_sheets_recalc::recalc::CellRef { sheet_id: String, row: u32, col: u32 }` (pub, `Ord`).
- `p2p_sheets_recalc::recalc::WorkbookInputs { cells: BTreeMap<CellRef,String>, sheet_ids: HashSet<String> }` (pub).
- `p2p_sheets_recalc::recalc::evaluate(&WorkbookInputs) -> BTreeMap<CellRef,String>` (pub).
- `p2p_sheets_recalc::recalc::sheet_closure(&BTreeMap<CellRef,String>, &str) -> HashSet<String>` (pub).
- `p2p_sheets_recalc::formula::precedents(&str, &str) -> Vec<(String,u32,u32)>` (pub).
- `p2p_sheets_recalc::formula::evaluate(&str, impl Fn(Option<&str>,u32,u32)->Option<String>) -> String` (pub).

Rust (crate `recalc-wasm`):
- `evaluate_json(input: &str) -> String` (pub, native-testable).
- `#[wasm_bindgen] pub fn evaluate(input: &str) -> String` (calls `evaluate_json`).
- Input JSON: `{"cells":[{"sheet_id":s,"row":u32,"col":u32,"raw_value":s}],"sheet_ids":[s]}`.
- Output JSON: `[{"sheet_id":s,"row":u32,"col":u32,"computed_value":s}]`.

Client (`app/src/engine/derive.ts`):
- `type InputCell = { sheet_id: string; row: number; col: number; raw_value: string; format: string }`
- `type Snapshot = Map<string, Cell>` (full node `Cell`, keyed by `cellKey`).
- `type OverlayEntry = { sheet_id: string; row: number; col: number; raw_value: string; format: string }`
- `type Overlay = Map<string, OverlayEntry>`
- `cellKey(sheetId: string, row: number, col: number): string`
- `snapshotFromCells(cells: Cell[]): Snapshot`
- `retireOverlay(overlay: Overlay, snapshot: Snapshot): Overlay`
- `buildEngineInput(snapshot: Snapshot, overlay: Overlay, sheetIds: string[]): string`
- `deriveActiveCells(snapshot: Snapshot, overlay: Overlay, sheetIds: string[], activeSheetId: string, evaluate: (json: string) => string): Cell[]`
- `diffComputed(nodeActive: Cell[], derivedActive: Cell[]): string[]`

Client (`app/src/engine/engine.ts`):
- `initEngine(): Promise<void>` (idempotent).
- `engineReady(): boolean`
- `evaluate(inputJson: string): string` (throws if called before `initEngine` resolves).

---

### Task 1: Extract the pure engine into `p2p-sheets-recalc`

Move `formula` + `recalc` (and their tests) into a new `std`-only crate the node depends on. Pure refactor — guarded by the moved tests. No behavior change.

**Files:**
- Create: `logic/crates/recalc/Cargo.toml`, `logic/crates/recalc/src/lib.rs`, `logic/crates/recalc/src/formula.rs`, `logic/crates/recalc/src/recalc.rs`
- Modify: `logic/Cargo.toml`, `logic/crates/spreadsheet/Cargo.toml`, `logic/crates/spreadsheet/src/lib.rs`
- Delete: `logic/crates/spreadsheet/src/recalc.rs`

**Interfaces:**
- Consumes: nothing (leaf crate).
- Produces: the `p2p-sheets-recalc` crate surface listed in *Global interfaces*.

- [ ] **Step 1: Create the crate manifest**

`logic/crates/recalc/Cargo.toml`:

```toml
[package]
name = "p2p-sheets-recalc"
version = "0.1.0"
edition = "2021"

# Pure evaluation engine (formula parser + recalc). std-only and calimero-free
# so it links into the node crate AND compiles to browser WASM via recalc-wasm.
[lib]
crate-type = ["rlib"]

[dependencies]
```

- [ ] **Step 2: Create the crate root**

`logic/crates/recalc/src/lib.rs`:

```rust
//! Pure recalculation engine for p2p-sheets: workbook inputs -> computed values.
//!
//! `std`-only and free of any calimero dependency, so it links into the node
//! service crate as an rlib AND compiles to browser WASM (via `recalc-wasm`).
//! One implementation, two homes — both agree by construction.

pub mod formula;
pub mod recalc;
```

- [ ] **Step 3: Move `recalc.rs` verbatim, fixing the formula import**

Move `logic/crates/spreadsheet/src/recalc.rs` to `logic/crates/recalc/src/recalc.rs` **unchanged** except its one import line. It currently reads `use crate::formula;` — that still resolves (the new crate has `crate::formula`), so **no edit is needed**. Keep the entire file body and both `#[cfg(test)]` modules exactly as-is.

- [ ] **Step 4: Move the `formula` module into `formula.rs`**

Cut `logic/crates/spreadsheet/src/lib.rs` lines `826`–`1402` (the `pub(crate) mod formula { … }` block). Create `logic/crates/recalc/src/formula.rs` with the module **body** (the contents between the outer `{` and `}`, de-indented one level), and change the two public fns from `pub(crate) fn` to `pub fn`:
- `pub(crate) fn evaluate(...)` → `pub fn evaluate(...)`
- `pub(crate) fn precedents(...)` → `pub fn precedents(...)`

Leave every other (private) fn as-is. The module has **no** `super::`/`crate::`/`serde`/`calimero` references (verified), so it moves cleanly.

- [ ] **Step 5: Move the node's `formula` unit tests into the new crate**

In `logic/crates/spreadsheet/src/lib.rs`, the `#[cfg(test)]` tests that call `formula::…` (the block starting near line `1404` after `mod recalc;`, e.g. `formula::precedents(...)`, `formula::evaluate(...)`) test code that now lives in the new crate. Move those test fns into a `#[cfg(test)] mod tests { use super::*; … }` at the bottom of `logic/crates/recalc/src/formula.rs`. Change any `formula::precedents` / `formula::evaluate` calls to bare `precedents` / `evaluate` (they are now `super::*`). Do **not** move tests that exercise node-only behavior (storage, `make_app`, sheet CRUD) — only the pure `formula::` tests.

- [ ] **Step 6: Delete the old recalc file and inline module from the node**

- Delete `logic/crates/spreadsheet/src/recalc.rs`.
- In `logic/crates/spreadsheet/src/lib.rs`, delete the now-empty `pub(crate) mod formula { … }` block (already cut in Step 4) and the `mod recalc;` line (near line `1404`).

- [ ] **Step 7: Point the node at the new crate**

In `logic/crates/spreadsheet/src/lib.rs`, add near the other `use` lines at the top:

```rust
use p2p_sheets_recalc::{formula, recalc};
```

`formula` is now referenced only by the code that moved (none remains in the node) — if `cargo` warns `formula` is unused, drop it from the `use` and keep only `recalc`. `get_cells` keeps calling `recalc::CellRef`, `recalc::sheet_closure`, `recalc::WorkbookInputs`, `recalc::evaluate` unchanged.

- [ ] **Step 8: Wire the workspace + node manifest**

`logic/Cargo.toml` — add members and a workspace dep:

```toml
members = [
    "crates/types",
    "crates/recalc",
    "crates/recalc-wasm",
    "crates/spreadsheet"
]
```

Add under `[workspace.dependencies]`:

```toml
p2p-sheets-recalc = { path = "crates/recalc" }
```

(`crates/recalc-wasm` is created in Task 2; listing it now is fine only if that directory exists — instead add the `recalc-wasm` member line in Task 2. For this task, add only `"crates/recalc"`.)

`logic/crates/spreadsheet/Cargo.toml` — add under `[dependencies]`:

```toml
p2p-sheets-recalc = { workspace = true }
```

- [ ] **Step 9: Run the moved tests — the whole workspace must be green**

Run: `cd logic && cargo test -p p2p-sheets-recalc`
Expected: all moved `formula`/`recalc` tests PASS (the closure/order/eval tests + the moved formula tests).

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet`
Expected: PASS — the node's remaining tests (storage, sheet CRUD, `get_cells`, converge) still green with the engine imported from the new crate.

Run: `cd logic && cargo test --workspace`
Expected: PASS, no warnings about unused imports.

- [ ] **Step 10: Confirm the node bundle still builds**

Run: `cd logic && bash build-bundle.sh`
Expected: `Bundle created: res/p2p-sheets-<version>.mpk` with no compile error (the spreadsheet crate still compiles to wasm32 with the engine as a path dep).

- [ ] **Step 11: Commit**

```bash
git add logic/Cargo.toml logic/crates/recalc logic/crates/spreadsheet
git rm logic/crates/spreadsheet/src/recalc.rs
git commit -m "refactor(recalc): extract pure formula+recalc into p2p-sheets-recalc crate"
```

---

### Task 2: `recalc-wasm` bindings crate

Wrap the pure engine with a JSON boundary and a `wasm-bindgen` export. The native `evaluate_json` is TDD'd; the `#[wasm_bindgen]` fn is a one-line delegate.

**Files:**
- Create: `logic/crates/recalc-wasm/Cargo.toml`, `logic/crates/recalc-wasm/src/lib.rs`
- Modify: `logic/Cargo.toml` (add `crates/recalc-wasm` member)

**Interfaces:**
- Consumes: `p2p_sheets_recalc::recalc::{CellRef, WorkbookInputs, evaluate}` (Task 1).
- Produces: `evaluate_json(&str) -> String` and `#[wasm_bindgen] evaluate(&str) -> String`; the input/output JSON shapes in *Global interfaces*.

- [ ] **Step 1: Add the workspace member + manifest**

In `logic/Cargo.toml` `members`, add `"crates/recalc-wasm"` (already listed in Task 1 Step 8 note — ensure it is present now that the dir exists).

`logic/crates/recalc-wasm/Cargo.toml`:

```toml
[package]
name = "recalc-wasm"
version = "0.1.0"
edition = "2021"

# wasm-bindgen bindings over the pure engine. The ONLY crate pulling wasm-bindgen;
# keeps p2p-sheets-recalc node-linkable. cdylib for the browser artifact; rlib so
# evaluate_json is unit-testable on the host target.
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
p2p-sheets-recalc = { workspace = true }
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = { workspace = true }
```

- [ ] **Step 2: Write the failing round-trip test**

`logic/crates/recalc-wasm/src/lib.rs` (test first):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluate_json_matches_native_chain() {
        // A1=1, A2=A1+4, A3=SUM(A1,A2) on sheet "s".
        let input = r#"{"cells":[
            {"sheet_id":"s","row":0,"col":0,"raw_value":"1"},
            {"sheet_id":"s","row":1,"col":0,"raw_value":"=A1+4"},
            {"sheet_id":"s","row":2,"col":0,"raw_value":"=SUM(A1,A2)"}
        ],"sheet_ids":["s"]}"#;
        let out = evaluate_json(input);
        // Parse back and look up A3 = 6.
        let parsed: Vec<OutputCell> = serde_json::from_str(&out).unwrap();
        let a3 = parsed.iter().find(|c| c.sheet_id == "s" && c.row == 2 && c.col == 0).unwrap();
        assert_eq!(a3.computed_value, "6");
    }

    #[test]
    fn evaluate_json_unknown_sheet_is_ref_error() {
        let input = r#"{"cells":[
            {"sheet_id":"s","row":0,"col":0,"raw_value":"=[gone]!A1"}
        ],"sheet_ids":["s"]}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        let c = parsed.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(c.computed_value, "#REF!");
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd logic && cargo test -p recalc-wasm`
Expected: FAIL to compile — `evaluate_json`, `OutputCell` not defined.

- [ ] **Step 4: Implement the boundary**

Prepend to `logic/crates/recalc-wasm/src/lib.rs`:

```rust
//! JSON + wasm-bindgen boundary over the pure recalc engine.

use std::collections::{BTreeMap, HashSet};

use p2p_sheets_recalc::recalc::{evaluate, CellRef, WorkbookInputs};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Deserialize)]
struct InputCell {
    sheet_id: String,
    row: u32,
    col: u32,
    raw_value: String,
}

#[derive(Deserialize)]
struct Input {
    cells: Vec<InputCell>,
    sheet_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct OutputCell {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    pub computed_value: String,
}

/// Native, unit-testable core: parse input JSON, run the pure engine, serialize
/// the full computed map back. Identical result to `recalc::evaluate`.
pub fn evaluate_json(input: &str) -> String {
    let parsed: Input = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return format!("{{\"error\":\"bad input: {e}\"}}"),
    };
    let cells: BTreeMap<CellRef, String> = parsed
        .cells
        .into_iter()
        .map(|c| (CellRef { sheet_id: c.sheet_id, row: c.row, col: c.col }, c.raw_value))
        .collect();
    let sheet_ids: HashSet<String> = parsed.sheet_ids.into_iter().collect();
    let computed = evaluate(&WorkbookInputs { cells, sheet_ids });
    let out: Vec<OutputCell> = computed
        .into_iter()
        .map(|(k, v)| OutputCell { sheet_id: k.sheet_id, row: k.row, col: k.col, computed_value: v })
        .collect();
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
}

/// Browser entry point. Same signature the future warm/incremental engine keeps.
#[wasm_bindgen]
pub fn evaluate(input: &str) -> String {
    evaluate_json(input)
}
```

Note: the `#[wasm_bindgen] evaluate` shadows the imported `recalc::evaluate` name at module scope. Import the pure fn under an alias to avoid the clash: change the import to `use p2p_sheets_recalc::recalc::{evaluate as recalc_evaluate, CellRef, WorkbookInputs};` and call `recalc_evaluate(&…)` inside `evaluate_json`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd logic && cargo test -p recalc-wasm`
Expected: PASS (both round-trip tests).

- [ ] **Step 6: Confirm the workspace still builds and the node bundle is intact**

Run: `cd logic && cargo test --workspace`
Expected: PASS.
Run: `cd logic && bash build-bundle.sh`
Expected: bundle builds (adding `recalc-wasm` as a member must not affect the spreadsheet service build).

- [ ] **Step 7: Commit**

```bash
git add logic/Cargo.toml logic/crates/recalc-wasm
git commit -m "feat(recalc-wasm): JSON + wasm-bindgen boundary over the pure engine"
```

---

### Task 3: WASM build script + committed browser artifact

Produce the browser artifact locally and commit it, so Vercel bundles it with no Rust.

**Files:**
- Create: `logic/build-recalc-wasm.sh`, `app/src/engine/recalc/*` (generated), `app/src/engine/.gitignore`-free (artifact IS committed)
- Modify: none

**Interfaces:**
- Consumes: `recalc-wasm` crate (Task 2).
- Produces: `app/src/engine/recalc/recalc_wasm.js`, `recalc_wasm_bg.wasm`, `recalc_wasm.d.ts` (committed). Import path used by Task 6: `../engine/recalc/recalc_wasm.js` default `init` + named `evaluate`.

- [ ] **Step 1: Ensure prerequisites (one-time, document in the script header)**

Run (if missing):
```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack   # or: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```
Verify: `wasm-pack --version` prints a version.

- [ ] **Step 2: Write the build script**

`logic/build-recalc-wasm.sh`:

```bash
#!/bin/bash
# Build the browser WASM recalc engine and commit the artifact into the client.
#
# Prereqs (one-time):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# The generated JS+wasm is committed under app/src/engine/recalc so Vercel needs
# no Rust toolchain (mirrors the committed-generated-client pattern). Re-run this
# whenever crates/recalc or crates/recalc-wasm change; CI verifies it is current.
set -e
cd "$(dirname "$0")"

if ! command -v wasm-pack > /dev/null; then
  echo "Error: wasm-pack not installed. Run: cargo install wasm-pack" >&2
  exit 1
fi

OUT_DIR="../app/src/engine/recalc"
wasm-pack build crates/recalc-wasm \
  --target web \
  --release \
  --out-dir "../$OUT_DIR" \
  --out-name recalc_wasm

# wasm-pack writes a package.json / .gitignore into the out dir we do not want in
# the client tree — remove them so only the JS + wasm + d.ts are committed.
rm -f "$OUT_DIR/package.json" "$OUT_DIR/.gitignore" "$OUT_DIR/README.md"
echo "recalc-wasm artifact written to app/src/engine/recalc/"
```

Make it executable: `chmod +x logic/build-recalc-wasm.sh`.

- [ ] **Step 3: Build the artifact**

Run: `bash logic/build-recalc-wasm.sh`
Expected: `app/src/engine/recalc/` contains `recalc_wasm.js`, `recalc_wasm_bg.wasm`, `recalc_wasm.d.ts` (and `recalc_wasm_bg.wasm.d.ts`). No `package.json`/`.gitignore` left behind.

- [ ] **Step 4: Verify the artifact bundles in a Vite build**

Add a temporary import to prove Vite resolves the `new URL(...import.meta.url)` wasm asset. In `app/src/engine/engine.ts` create the loader now (it is also Task 6's deliverable, created here so the build check is real):

```ts
// Lazy loader for the committed wasm-pack (--target web) recalc engine.
import init, { evaluate as wasmEvaluate } from './recalc/recalc_wasm.js';

let ready = false;
let initPromise: Promise<void> | null = null;

export function initEngine(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) {
    initPromise = init().then(() => {
      ready = true;
    });
  }
  return initPromise;
}

export function engineReady(): boolean {
  return ready;
}

/** Synchronous once initEngine() has resolved. Throws otherwise. */
export function evaluate(inputJson: string): string {
  if (!ready) throw new Error('recalc engine not initialized — await initEngine() first');
  return wasmEvaluate(inputJson);
}
```

Run: `cd app && pnpm build`
Expected: build succeeds; the `.wasm` appears as a fingerprinted asset in `dist/assets/`.

- [ ] **Step 5: Commit the artifact + script + loader**

```bash
git add logic/build-recalc-wasm.sh app/src/engine/recalc app/src/engine/engine.ts
git commit -m "build(recalc-wasm): wasm-pack build script + committed browser artifact + loader"
```

---

### Task 4: Node `get_all_cells` read method

Add a single-call read that returns every non-blank cell across all sheets with raw + computed values, for the client's warm store. `export_all` (metadata-only) is left as-is.

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` (add `get_all_cells`), `app/src/api/spreadsheet/SpreadsheetClient.ts` (regenerated)

**Interfaces:**
- Consumes: `recalc::{CellRef, WorkbookInputs, evaluate}`, the existing `Cell` struct + `self.cells`/`self.sheets`.
- Produces: node method `get_all_cells() -> app::Result<Vec<Cell>>`; client `getAllCells(): Promise<Cell[]>`.

- [ ] **Step 1: Write the failing node test**

Add to the node test module in `logic/crates/spreadsheet/src/lib.rs` (near `export_all_returns_sheets`):

```rust
#[test]
fn get_all_cells_spans_sheets_with_computed_values() {
    let mut app = make_app();
    app.call(|s| s.init_project("P".into())).unwrap();
    let s1 = app.call(|s| s.create_sheet("One".into())).unwrap();
    let s2 = app.call(|s| s.create_sheet("Two".into())).unwrap();
    app.call(|s| s.set_cell(s1.clone(), 0, 0, "10".into())).unwrap();
    app.call(|s| s.set_cell(s2.clone(), 0, 0, format!("=[{s1}]!A1*2"))).unwrap();

    let all = app.view(|s| s.get_all_cells()).unwrap();
    // Both sheets' cells present; cross-sheet computed value derived (20).
    let c2 = all.iter().find(|c| c.sheet_id == s2 && c.row == 0 && c.col == 0).unwrap();
    assert_eq!(c2.computed_value, "20");
    assert!(all.iter().any(|c| c.sheet_id == s1 && c.raw_value == "10"));
}
```

(Confirm the exact `make_app`/`set_cell`/`create_sheet` test helper signatures against the existing node tests and match them.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet get_all_cells`
Expected: FAIL — `get_all_cells` not found.

- [ ] **Step 3: Implement `get_all_cells`**

Add to the `impl Spreadsheet` block near `get_cells` in `logic/crates/spreadsheet/src/lib.rs`. It mirrors `get_cells` but evaluates the whole workbook once (no `sheet_closure` filter) and returns cells from every sheet:

```rust
pub fn get_all_cells(&self) -> app::Result<Vec<Cell>> {
    let mut all_inputs: std::collections::BTreeMap<recalc::CellRef, String> =
        std::collections::BTreeMap::new();
    let mut stored: Vec<CellData> = Vec::new();
    for (_k, d) in self
        .cells
        .entries()
        .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
    {
        if !d.raw_value.is_empty() {
            all_inputs.insert(
                recalc::CellRef { sheet_id: d.sheet_id.clone(), row: d.row, col: d.col },
                d.raw_value.clone(),
            );
        }
        stored.push(d);
    }
    let sheet_ids: std::collections::HashSet<String> = self
        .sheets
        .entries()
        .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
        .map(|(id, _)| id)
        .collect();
    let computed = recalc::evaluate(&recalc::WorkbookInputs { cells: all_inputs, sheet_ids });

    let mut out: Vec<Cell> = stored
        .into_iter()
        .filter_map(|d| {
            if d.raw_value.is_empty() && d.format.is_empty() {
                return None;
            }
            let cv = computed
                .get(&recalc::CellRef { sheet_id: d.sheet_id.clone(), row: d.row, col: d.col })
                .cloned()
                .unwrap_or_else(|| d.raw_value.clone());
            Some(Cell {
                id: d.id.clone(),
                sheet_id: d.sheet_id.clone(),
                row: d.row,
                col: d.col,
                raw_value: d.raw_value.clone(),
                computed_value: cv,
                format: d.format.clone(),
                updated_at: d.updated_at,
            })
        })
        .collect();
    out.sort_by_key(|c| (c.sheet_id.clone(), c.row, c.col));
    Ok(out)
}
```

Confirm `get_all_cells` is exported in the service ABI the same way `get_cells` is (same `#[app::logic]`/method-exposure mechanism — match how `get_cells` and `export_all` are surfaced; if there is an explicit method registration/attribute, add `get_all_cells` alongside).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet get_all_cells`
Expected: PASS.
Run: `cd logic && cargo test --workspace`
Expected: PASS.

- [ ] **Step 5: Rebuild the bundle + regenerate the client**

Run: `cd logic && bash build-bundle.sh`
Expected: bundle builds; `logic/crates/spreadsheet/res/abi.json` now includes `get_all_cells`.

Run: `cd app && pnpm codegen`
Expected: `src/api/spreadsheet/SpreadsheetClient.ts` regenerates with a new method:

```ts
public async getAllCells(): Promise<Cell[]> {
  const response = await this._mero.rpc.execute({ contextId: this._contextId, method: 'get_all_cells', argsJson: {}, executorPublicKey: this._executorPublicKey });
  return response as Cell[];
}
```

(If codegen reads the ABI from a path, confirm it points at the freshly built `abi.json`; the repo's codegen script `app/scripts/codegen.mjs` is the source of truth.)

- [ ] **Step 6: Commit**

```bash
git add logic/crates/spreadsheet app/src/api/spreadsheet/SpreadsheetClient.ts logic/crates/spreadsheet/res/abi.json
git commit -m "feat(node): get_all_cells — whole-workbook raw+computed read for the client warm store"
```

---

### Task 5: Pure client derive + pending-overlay module

The whole reconciliation + derivation logic, engine-agnostic (takes an `evaluate` fn), fully unit-tested. Tasks 6–8 are thin wiring over this.

**Files:**
- Create: `app/src/engine/derive.ts`, `app/src/engine/derive.test.ts`

**Interfaces:**
- Consumes: `Cell` from `../api/spreadsheet/SpreadsheetClient`.
- Produces: the `derive.ts` surface in *Global interfaces*.

- [ ] **Step 1: Write failing tests**

`app/src/engine/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  cellKey, snapshotFromCells, retireOverlay, buildEngineInput,
  deriveActiveCells, diffComputed,
  type Overlay, type OverlayEntry,
} from './derive';
import type { Cell } from '../api/spreadsheet/SpreadsheetClient';

const cell = (sheet: string, row: number, col: number, raw: string, computed = raw, format = ''): Cell => ({
  id: `${sheet}|${row}|${col}`, sheet_id: sheet, row, col,
  raw_value: raw, computed_value: computed, format, updated_at: 0,
});
const ov = (sheet: string, row: number, col: number, raw: string, format = ''): OverlayEntry =>
  ({ sheet_id: sheet, row, col, raw_value: raw, format });

// A stub engine: sums are not needed — echo raw, resolve one cross-sheet case.
const stubEval = (json: string): string => {
  const input = JSON.parse(json) as { cells: { sheet_id: string; row: number; col: number; raw_value: string }[] };
  return JSON.stringify(input.cells.map((c) => ({
    sheet_id: c.sheet_id, row: c.row, col: c.col,
    computed_value: c.raw_value.startsWith('=') ? 'DERIVED' : c.raw_value,
  })));
};

describe('overlay precedence', () => {
  it('overlay value overrides the snapshot in the engine input', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1')]);
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const input = JSON.parse(buildEngineInput(snap, overlay, ['s']));
    const a1 = input.cells.find((c: any) => c.row === 0 && c.col === 0);
    expect(a1.raw_value).toBe('9');
  });
});

describe('retireOverlay', () => {
  it('drops an overlay entry the snapshot now confirms (equal raw)', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '9')]);
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.has(cellKey('s', 0, 0))).toBe(false);
  });

  it('keeps an in-flight entry the snapshot has not caught up to', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1')]); // node still shows old value
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.get(cellKey('s', 0, 0))?.raw_value).toBe('9');
  });

  it('retires a confirmed clear (overlay blank, snapshot absent)', () => {
    const snap = snapshotFromCells([]); // cleared cell gone from node
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.has(cellKey('s', 0, 0))).toBe(false);
  });
});

describe('deriveActiveCells', () => {
  it('returns active-sheet cells with engine-computed values, overlay applied', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1'), cell('other', 0, 0, '5')]);
    const overlay: Overlay = new Map([[cellKey('s', 1, 0), ov('s', 1, 0, '=X')]]);
    const out = deriveActiveCells(snap, overlay, ['s', 'other'], 's', stubEval);
    // active sheet only
    expect(out.every((c) => c.sheet_id === 's')).toBe(true);
    const a2 = out.find((c) => c.row === 1 && c.col === 0)!;
    expect(a2.computed_value).toBe('DERIVED');
    expect(a2.raw_value).toBe('=X');
  });

  it('hides a fully-blank cleared cell but keeps a formatted-but-empty one', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '', '', 'bold')]);
    const overlay: Overlay = new Map([[cellKey('s', 1, 0), ov('s', 1, 0, '')]]); // cleared, no format
    const out = deriveActiveCells(snap, overlay, ['s'], 's', stubEval);
    expect(out.some((c) => c.row === 0 && c.col === 0)).toBe(true);  // formatted kept
    expect(out.some((c) => c.row === 1 && c.col === 0)).toBe(false); // blank hidden
  });
});

describe('diffComputed', () => {
  it('reports cells where node and derived computed values disagree', () => {
    const node = [cell('s', 0, 0, '=A', 'NODE')];
    const derived = [cell('s', 0, 0, '=A', 'DERIVED')];
    expect(diffComputed(node, derived)).toEqual([cellKey('s', 0, 0)]);
  });
  it('is empty when they agree', () => {
    const node = [cell('s', 0, 0, '=A', 'X')];
    const derived = [cell('s', 0, 0, '=A', 'X')];
    expect(diffComputed(node, derived)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && pnpm vitest run src/engine/derive.test.ts`
Expected: FAIL — `./derive` not found.

- [ ] **Step 3: Implement `derive.ts`**

`app/src/engine/derive.ts`:

```ts
import type { Cell } from '../api/spreadsheet/SpreadsheetClient';

export type OverlayEntry = {
  sheet_id: string;
  row: number;
  col: number;
  raw_value: string; // '' means cleared value
  format: string;    // '' means no/removed format
};
export type Overlay = Map<string, OverlayEntry>;
export type Snapshot = Map<string, Cell>;

export function cellKey(sheetId: string, row: number, col: number): string {
  return `${sheetId}|${row}|${col}`;
}

export function snapshotFromCells(cells: Cell[]): Snapshot {
  const m: Snapshot = new Map();
  for (const c of cells) m.set(cellKey(c.sheet_id, c.row, c.col), c);
  return m;
}

// The effective raw/format at a key: overlay wins over snapshot.
function effective(
  key: string,
  snapshot: Snapshot,
  overlay: Overlay,
): { sheet_id: string; row: number; col: number; raw_value: string; format: string } | null {
  const o = overlay.get(key);
  const s = snapshot.get(key);
  if (o) return { sheet_id: o.sheet_id, row: o.row, col: o.col, raw_value: o.raw_value, format: o.format };
  if (s) return { sheet_id: s.sheet_id, row: s.row, col: s.col, raw_value: s.raw_value, format: s.format };
  return null;
}

// All keys present in either map (union), so overlay-only new cells are included.
function unionKeys(snapshot: Snapshot, overlay: Overlay): string[] {
  const set = new Set<string>();
  for (const k of snapshot.keys()) set.add(k);
  for (const k of overlay.keys()) set.add(k);
  return [...set];
}

/**
 * Drop overlay entries the snapshot has caught up to. An entry is confirmed when
 * the snapshot's raw value for that key equals the overlay's (a persisted edit),
 * or the overlay is a clear ('') and the snapshot has no cell there (persisted
 * clear). In-flight entries — snapshot still shows the old/absent value — survive.
 */
export function retireOverlay(overlay: Overlay, snapshot: Snapshot): Overlay {
  const next: Overlay = new Map();
  for (const [key, entry] of overlay) {
    const s = snapshot.get(key);
    const confirmedWrite = s !== undefined && s.raw_value === entry.raw_value && s.format === entry.format;
    const confirmedClear = entry.raw_value === '' && entry.format === '' && s === undefined;
    if (confirmedWrite || confirmedClear) continue; // retired
    next.set(key, entry);
  }
  return next;
}

/** Engine input JSON for `snapshot ⊕ overlay`: every effective non-blank cell. */
export function buildEngineInput(snapshot: Snapshot, overlay: Overlay, sheetIds: string[]): string {
  const cells: { sheet_id: string; row: number; col: number; raw_value: string }[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.raw_value === '') continue; // blank cells are absent to the engine
    cells.push({ sheet_id: e.sheet_id, row: e.row, col: e.col, raw_value: e.raw_value });
  }
  return JSON.stringify({ cells, sheet_ids: sheetIds });
}

/**
 * Active-sheet cells with engine-computed values (overlay applied). Mirrors the
 * node's get_cells output filter: a fully-blank cell (no value AND no format) is
 * hidden; a formatted-but-empty cell is kept.
 */
export function deriveActiveCells(
  snapshot: Snapshot,
  overlay: Overlay,
  sheetIds: string[],
  activeSheetId: string,
  evaluate: (json: string) => string,
): Cell[] {
  const computed = new Map<string, string>();
  const outputs = JSON.parse(evaluate(buildEngineInput(snapshot, overlay, sheetIds))) as {
    sheet_id: string; row: number; col: number; computed_value: string;
  }[];
  for (const o of outputs) computed.set(cellKey(o.sheet_id, o.row, o.col), o.computed_value);

  const out: Cell[] = [];
  for (const key of unionKeys(snapshot, overlay)) {
    const e = effective(key, snapshot, overlay);
    if (!e || e.sheet_id !== activeSheetId) continue;
    if (e.raw_value === '' && e.format === '') continue; // fully blank → hidden
    const base = snapshot.get(key);
    out.push({
      id: base?.id ?? key,
      sheet_id: e.sheet_id,
      row: e.row,
      col: e.col,
      raw_value: e.raw_value,
      computed_value: computed.get(key) ?? e.raw_value,
      format: e.format,
      updated_at: base?.updated_at ?? 0,
    });
  }
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/** Dev-assert helper: keys where node-computed and WASM-derived values disagree. */
export function diffComputed(nodeActive: Cell[], derivedActive: Cell[]): string[] {
  const derived = new Map<string, string>();
  for (const c of derivedActive) derived.set(cellKey(c.sheet_id, c.row, c.col), c.computed_value);
  const bad: string[] = [];
  for (const c of nodeActive) {
    const k = cellKey(c.sheet_id, c.row, c.col);
    if (derived.has(k) && derived.get(k) !== c.computed_value) bad.push(k);
  }
  return bad;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && pnpm vitest run src/engine/derive.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + full unit run**

Run: `cd app && pnpm tsc --noEmit && pnpm test`
Expected: no type errors; the full vitest suite (existing + new) passes.

- [ ] **Step 6: Commit**

```bash
git add app/src/engine/derive.ts app/src/engine/derive.test.ts
git commit -m "feat(engine): pure client derive + pending-overlay reconciliation"
```

---

### Task 6: Wire the warm store + local derive into `useSpreadsheet` (read path)

Replace the active-sheet `get_cells` refresh with a whole-workbook `get_all_cells` fetch into a warm store, derive the active sheet's cells via WASM, and add the dev-mode agreement assert. Writes stay as-is (still `enqueue → refresh`) in this task; the optimistic path is Task 7.

**Files:**
- Modify: `app/src/hooks/useSpreadsheet.ts`

**Interfaces:**
- Consumes: `initEngine`, `engineReady`, `evaluate` (Task 3 `engine.ts`); `snapshotFromCells`, `retireOverlay`, `deriveActiveCells`, `diffComputed`, `cellKey`, `Overlay` (Task 5); `client.getAllCells()` (Task 4).
- Produces: `useSpreadsheet` now renders WASM-derived `cells`; holds refs `snapshotRef: Snapshot`, `overlayRef: Overlay`.

- [ ] **Step 1: Add engine init + warm-store refs**

At the top of the hook body add:

```ts
const snapshotRef = useRef<Snapshot>(new Map());
const overlayRef = useRef<Overlay>(new Map());
const [engineTick, setEngineTick] = useState(0); // bump to re-derive after init

useEffect(() => {
  void initEngine().then(() => setEngineTick((t) => t + 1));
}, []);
```

Import at the top:
```ts
import { initEngine, engineReady, evaluate as engineEvaluate } from '../engine/engine';
import {
  snapshotFromCells, retireOverlay, deriveActiveCells, diffComputed,
  type Snapshot, type Overlay,
} from '../engine/derive';
```

- [ ] **Step 2: Add a derive helper the hook uses to paint the active sheet**

Add inside the hook (after `activeSheetIdRef` is defined):

```ts
// Derive the active sheet's cells from the warm store ⊕ overlay and paint them.
// Before the engine is ready, fall back to the node computed values captured in
// the snapshot (pre-WASM initial paint — no flash of raw formulas).
const deriveAndSet = useCallback(() => {
  const active = activeSheetIdRef.current;
  if (!active) { setCells([]); return; }
  const sheetIds = [...new Set([...snapshotRef.current.values()].map((c) => c.sheet_id))];
  if (!engineReady()) {
    setCells([...snapshotRef.current.values()].filter((c) => c.sheet_id === active));
    return;
  }
  const derived = deriveActiveCells(
    snapshotRef.current, overlayRef.current, sheetIds, active, engineEvaluate,
  );
  setCells(derived);
  if (import.meta.env.DEV) {
    const nodeActive = [...snapshotRef.current.values()].filter((c) => c.sheet_id === active);
    const bad = diffComputed(nodeActive, derived);
    if (bad.length) console.error('[recalc] WASM/node disagreement at', bad, '— stale wasm artifact?');
  }
}, []);
```

- [ ] **Step 3: Rewrite `refresh` to fetch all cells into the warm store**

Replace the body of `refresh` so it fetches the whole workbook, updates the snapshot, retires confirmed overlay entries, and derives:

```ts
const refresh = useCallback(async () => {
  if (!client) return;
  setLoading(true);
  setError(null);
  try {
    const [fetchedSheets, fetchedCursors, fetchedFunctions, allCells] = await Promise.all([
      client.listSheets(),
      client.getCursors(),
      client.getFunctions(),
      client.getAllCells(),
    ]);
    snapshotRef.current = snapshotFromCells(allCells);
    overlayRef.current = retireOverlay(overlayRef.current, snapshotRef.current);
    setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
    setCursors(fetchedCursors);
    if (fetchedFunctions.length > 0) setFunctions(fetchedFunctions);
    deriveAndSet();
  } catch (err) {
    setError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    setLoading(false);
    setLoaded(true);
  }
}, [client, deriveAndSet]);
```

- [ ] **Step 4: Re-derive on tab switch and after engine init (no node refetch)**

Replace the Phase 1.5 tab-switch effect (the one that called `client.getCells({ sheet_id: activeSheetId })`) with a pure local re-derive — the warm store already holds every sheet:

```ts
// Tab switch / engine init: re-derive the active sheet from the warm store.
// No node round-trip — all sheets' inputs are already in snapshotRef.
useEffect(() => {
  deriveAndSet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeSheetId, engineTick, deriveAndSet]);
```

Keep the existing `useEffect(() => { void refresh(); }, [refresh])` and `useSubscription(contextId ? [contextId] : [], () => { void refresh(); })`.

- [ ] **Step 5: Typecheck + build + unit tests**

Run: `cd app && pnpm tsc --noEmit && pnpm test && pnpm build`
Expected: clean typecheck, all unit tests pass, production build succeeds (WASM bundled).

- [ ] **Step 6: Browser smoke (acceptance — no hook harness exists)**

Manual: open a workspace, confirm cells render (WASM-derived), tab switch shows the right sheet with correct cross-sheet values, and the dev console shows **no** `[recalc] WASM/node disagreement`. (This mirrors the Phase 1.5 acceptance method.)

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/useSpreadsheet.ts
git commit -m "feat(app): client derives active sheet via WASM from a warm full-workbook store"
```

---

### Task 7: Optimistic overlay writes (instant local echo)

Make edits paint instantly: write to the overlay + re-derive immediately, then fire the node write off the interactive path. The subscription/refresh (Task 6) already retires confirmed overlay entries.

**Files:**
- Modify: `app/src/hooks/useSpreadsheet.ts`

**Interfaces:**
- Consumes: `overlayRef`, `deriveAndSet`, `cellKey`, the existing `enqueue`, `client` mutation methods.
- Produces: `setCell`/`clearCell`/`setCellFormat`/`applyCellOps` update the overlay + paint synchronously before the node write resolves.

- [ ] **Step 1: Add an overlay-write helper**

```ts
import { cellKey } from '../engine/derive';

// Apply local ops to the overlay and repaint immediately (before the node write).
const applyOverlay = useCallback(
  (sheetId: string, edits: { row: number; col: number; raw_value?: string; format?: string; clear?: boolean }[]) => {
    for (const e of edits) {
      const key = cellKey(sheetId, e.row, e.col);
      const prev = overlayRef.current.get(key)
        ?? snapshotRef.current.get(key)
        ?? { sheet_id: sheetId, row: e.row, col: e.col, raw_value: '', format: '' };
      const next = e.clear
        ? { sheet_id: sheetId, row: e.row, col: e.col, raw_value: '', format: '' }
        : {
            sheet_id: sheetId, row: e.row, col: e.col,
            raw_value: e.raw_value ?? prev.raw_value,
            format: e.format ?? prev.format,
          };
      overlayRef.current.set(key, next);
    }
    deriveAndSet();
  },
  [deriveAndSet],
);
```

- [ ] **Step 2: Make `setCell` optimistic**

```ts
const setCell = useCallback(
  async (sheetId: string, row: number, col: number, rawValue: string) => {
    if (!client) return;
    applyOverlay(sheetId, [{ row, col, raw_value: rawValue }]);
    await enqueue(() =>
      rawValue.startsWith('=')
        ? client.setCellFormula({ sheet_id: sheetId, row, col, formula: rawValue })
        : client.setCell({ sheet_id: sheetId, row, col, raw_value: rawValue }),
    );
    // No await refresh() here — the subscription refresh reconciles + retires.
  },
  [client, applyOverlay, enqueue],
);
```

- [ ] **Step 3: Make `clearCell`, `setCellFormat`, `applyCellOps` optimistic**

```ts
const clearCell = useCallback(async (sheetId: string, row: number, col: number) => {
  if (!client) return;
  applyOverlay(sheetId, [{ row, col, clear: true }]);
  await enqueue(() => client.clearCell({ sheet_id: sheetId, row, col }));
}, [client, applyOverlay, enqueue]);

const setCellFormat = useCallback(async (sheetId: string, row: number, col: number, format: string) => {
  if (!client) return;
  applyOverlay(sheetId, [{ row, col, format }]);
  await enqueue(() => client.setCellFormat({ sheet_id: sheetId, row, col, format }));
}, [client, applyOverlay, enqueue]);

const applyCellOps = useCallback(async (sheetId: string, ops: CellOp[]) => {
  if (!client || ops.length === 0) return;
  applyOverlay(sheetId, ops.map((op) =>
    op.kind === 'Set'   ? { row: op.row, col: op.col, raw_value: op.raw_value }
  : op.kind === 'Format'? { row: op.row, col: op.col, format: op.format }
  :                       { row: op.row, col: op.col, clear: true },
  ));
  await enqueue(() => client.applyCellOps({ sheet_id: sheetId, ops }));
}, [client, applyOverlay, enqueue]);
```

- [ ] **Step 4: Typecheck + build + unit tests**

Run: `cd app && pnpm tsc --noEmit && pnpm test && pnpm build`
Expected: clean.

- [ ] **Step 5: Browser smoke (acceptance)**

Manual on a fresh workspace: typing a value paints **instantly** (no wait for a round-trip); `A1=10, A2=20, A3==A1+A2` shows `30` immediately; a cross-sheet `='Sheet 1'!A1` updates on the referencing sheet after the source changes and sync lands; no console disagreement; no flicker of a just-typed value. Use `read_network_requests` to confirm the paint precedes the `apply_cell_ops`/`set_cell` write.

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useSpreadsheet.ts
git commit -m "feat(app): optimistic overlay writes — local edits paint instantly, node write off-path"
```

---

### Task 8: CI staleness guard for the committed WASM artifact

Fail CI if someone changes the engine but forgets to regenerate the committed artifact.

**Files:**
- Modify: the repo CI workflow (locate under `.github/workflows/` — match the existing app CI job; if none builds the app, add a minimal job). Create `.github/workflows/recalc-wasm-freshness.yml` if no suitable workflow exists.

**Interfaces:**
- Consumes: `logic/build-recalc-wasm.sh` (Task 3).
- Produces: a CI check.

- [ ] **Step 1: Inspect existing CI**

Run: `ls .github/workflows/ 2>/dev/null && cat .github/workflows/*.yml | head -80`
Note the runner OS, how Rust is set up (if at all), and how the app is built, so the new job matches conventions.

- [ ] **Step 2: Add the freshness job**

`.github/workflows/recalc-wasm-freshness.yml` (adjust `runs-on`/toolchain to match the repo):

```yaml
name: recalc-wasm freshness
on:
  pull_request:
    paths:
      - 'logic/crates/recalc/**'
      - 'logic/crates/recalc-wasm/**'
      - 'app/src/engine/recalc/**'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - name: Install wasm-pack
        run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
      - name: Rebuild the committed artifact
        run: bash logic/build-recalc-wasm.sh
      - name: Fail if the committed artifact is stale
        run: git diff --exit-code -- app/src/engine/recalc
```

- [ ] **Step 3: Verify the guard logic locally**

Run: `bash logic/build-recalc-wasm.sh && git diff --exit-code -- app/src/engine/recalc`
Expected: exit 0 (clean) — the committed artifact matches a fresh build.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/recalc-wasm-freshness.yml
git commit -m "ci: fail when the committed recalc-wasm artifact is stale"
```

---

## Self-Review

**Spec coverage:**
- §4.1 pure crate (std-only, calimero-free) → Task 1. §4.2 node depends on it, tests green → Task 1 Steps 7–10. §4.3 `recalc-wasm` (only crate with wasm-bindgen) → Task 2.
- §5.1 stateless `evaluate` JSON boundary + shapes → Task 2. §5.2 `wasm-pack --target web`, committed artifact, no Rust on Vercel → Task 3; CI diff → Task 8.
- §6.1 warm full-workbook store via a single all-cells fetch → Task 4 (`get_all_cells`) + Task 6. §6.2 derive over `snapshot ⊕ overlay`, optimistic edit, sync retirement → Tasks 5–7. §6.3 cross-sheet `[id]!` handled by the shared engine → covered (engine unchanged) + Task 7 smoke.
- §7 node keeps computing; pre-WASM initial paint → Task 6 Step 2 (`engineReady()` fallback). §8 dev assert → Task 5 `diffComputed` + Task 6 Step 2; CI diff → Task 8.
- §9 testing: recalc suite moves → Task 1; recalc-wasm round-trip → Task 2; client pure tests → Task 5; no hook harness (tsc/build/smoke) → Tasks 6–7.
- **Correction vs spec:** the spec said "e.g. via `exportAll`"; `export_all` is metadata-only, so Task 4 adds `get_all_cells`. Consistent with the design's intent (one call for all raw inputs).

**Placeholder scan:** none — every code step carries full code or an exact move instruction. The two "match the existing pattern" notes (ABI method exposure in Task 4 Step 3; CI conventions in Task 8) point at concrete files to confirm, not vague work.

**Type consistency:** `cellKey`, `Snapshot`, `Overlay`, `OverlayEntry`, `deriveActiveCells`, `retireOverlay`, `buildEngineInput`, `diffComputed`, `initEngine`/`engineReady`/`evaluate` names are identical across Tasks 5–7. Engine JSON shapes match between Task 2 (Rust `InputCell`/`OutputCell`) and Task 5 (`buildEngineInput`/`deriveActiveCells`). `get_all_cells` (Rust) ↔ `getAllCells` (client) consistent across Tasks 4 and 6.
