# Recalc Phase 2 — Client-side WASM engine (design)

**Status:** approved design, pre-plan
**Predecessors:** `2026-07-10-recalc-engine-architecture-design.md` (§8 sketches this),
`2026-07-10-read-refresh-scoping-design.md` (Phase 1.5, active-sheet client refresh).

---

## 1. Goal

Run the *same* pure evaluator in the browser client, so a local edit recomputes
in-process and paints instantly — **no node round-trip on the interactive path** —
while the node write that persists and syncs the edit happens off that path.

This realizes "one engine, two homes" from the architecture design §8.3: the pure
Rust evaluator compiles to both native (node) and WASM (client). Because both run
the identical deterministic function over the same inputs, **they agree by
construction** — there is no engine-to-engine reconciliation, only reconciliation
between a client's own optimistic edit and the sync that later confirms it.

### 1.1 What this delivers vs. today

Today every edit is `enqueue(write) → await refresh()`: the grid updates only after
the node commits *and* a `get_cells` round-trip returns computed values. Phase 2
removes that round-trip from the keystroke path.

| | Today | After Phase 2 |
|---|---|---|
| Paint after local edit | node commit + `get_cells` round-trip | in-process WASM re-derive (0 network) |
| Node write | blocks the paint | async, off the interactive path |
| Cross-sheet value | node derives, returns computed | client derives locally from warm inputs |

---

## 2. Scope

**In scope (this spec):** extract the pure engine into a shared crate; build it to
browser WASM and commit the artifact; make the client hold raw inputs and derive
locally with a flicker-free optimistic overlay.

**Deferred to later specs (unchanged from architecture §8/§9):**
- Warm **incremental** dependency graph with dirty propagation (this spec re-derives
  fully per change; the API is shaped so the incremental engine slots in behind it).
- Viewport-scoped compute/render.
- Parallel evaluation across independent DAG components.
- Removing the node's own computation (node keeps computing — see §7).

---

## 3. Decisions (locked in brainstorming)

1. **Full slice** — extraction + WASM build + client local echo ship together.
2. **Warm full-workbook inputs** — the client holds *all* sheets' raw cells in memory
   and derives any sheet in-process (§6.1). Simpler and correct for cross-sheet than
   tracking a per-sheet closure on the client.
3. **Pending-overlay reconciliation** — derive over `snapshot ⊕ overlay`; sync retires
   overlay entries as it echoes them back; flicker-free (§6.2).
4. **wasm-pack built locally, artifact committed** — Vercel bundles it with no Rust
   toolchain, mirroring the committed-generated-client precedent (§5.2).
5. **Node read path untouched** — the node keeps deriving `computed_value` for late
   joiners, verification, and the client's pre-WASM initial paint (§7).

---

## 4. Crate structure

**One engine, one implementation, two build targets.**

### 4.1 New crate `logic/crates/recalc` (pure)

- Contents: the `formula` module (parser + evaluator, moved out of the node's
  `lib.rs`, ~576 lines), the `recalc` module (`order`, `evaluate`, `sheet_closure`,
  ~346 lines), and the shared value types `CellRef` and `WorkbookInputs`.
- Dependencies: `std` + `serde` only. **No `calimero-sdk`, `calimero-storage`, or
  any node/env coupling.** (Verified: `recalc.rs` uses only `std::collections` +
  `crate::formula`; the `formula` module takes `&str` + a `get_value` closure with
  no SDK/env/storage references.) May reuse `p2p-sheets-types` if a shared type is
  needed — that crate's deps (`thiserror`, `bs58`, `borsh`, `serde`) are all
  WASM-compatible.
- This crate is the single source of truth for evaluation.

### 4.2 Node crate `p2p-sheets-spreadsheet`

- Depends on `recalc` as an `rlib`. Its inline `formula` and `recalc` modules are
  **deleted** and replaced by imports from the new crate.
- All existing tests (59+ crate tests, `tests/converge.rs`) must stay green. This is
  the largest mechanical change but is well-covered, so it is TDD-safe: the move is
  validated by the pre-existing suite going green against the extracted crate.
- The node's read path (`get_cells`, `export_all`, derive-on-read) is otherwise
  unchanged.

### 4.3 New crate `logic/crates/recalc-wasm` (bindings)

- A thin `wasm-bindgen` layer over `recalc`. `crate-type = ["cdylib"]`.
- Kept separate from `recalc` so the pure crate stays dependency-clean and
  node-linkable (the node never pulls in `wasm-bindgen`).
- Exposes exactly the §5.1 API.

---

## 5. WASM engine: API and delivery

### 5.1 API — stateless `evaluate`

One export, a pure function re-run on each change:

```
evaluate(inputs_json: string) → outputs_json: string
```

- **Input JSON** mirrors `WorkbookInputs`:
  `{ "cells": [{ "sheet_id": string, "row": number, "col": number, "raw_value": string }],
     "sheet_ids": [string] }`
- **Output JSON**: `[{ "sheet_id": string, "row": number, "col": number, "computed_value": string }]`

A JSON-string boundary (not typed `wasm-bindgen` structs) keeps the binding trivial:
`recalc::evaluate` already takes `WorkbookInputs` and returns
`BTreeMap<CellRef, String>`, so the binding is `serde_json::from_str` → `evaluate`
→ `serde_json::to_string`. `sheet_ids` carries the full set so unknown-sheet refs
resolve to `#REF!` exactly as on the node.

The signature is intentionally the shape a future **stateful warm engine** keeps
behind it (architecture §5.1 "same conceptual signature"), so the deferred
incremental version slots in without touching callers. Full re-derive per keystroke
is acceptable at workbook scale; the per-call JSON serialization is the cost the
incremental engine later removes.

### 5.2 Build & delivery

- Script `logic/build-recalc-wasm.sh`: runs `wasm-pack build --target web` on
  `recalc-wasm`, copies the generated `.wasm` + JS glue into a committed client
  location (e.g. `app/src/engine/recalc/`).
- The client imports the generated glue and calls its `init()` once, then `evaluate`.
  Vite bundles the `.wasm` (via `vite-plugin-wasm` + top-level-await, or the
  `--target web` glue's own async init). **Vercel needs no Rust toolchain** — it just
  bundles the committed artifact.
- Idempotent + documented; re-run when `recalc`/`recalc-wasm` changes.
- **CI staleness guard:** rebuild the WASM and `git diff --exit-code` the committed
  artifact — the build fails if the artifact was not regenerated after an engine
  change.

---

## 6. Client data flow

The interactive path no longer round-trips the node. Shape (inside `useSpreadsheet`
or a dedicated `useWorkbook`/engine module):

### 6.1 Warm input store

On context open, `exportAll()` loads **all** sheets' raw cells into an in-memory
input map — the **last-synced snapshot**. `exportAll` also returns the node's
`computed_value`, used for the pre-WASM initial paint (§7).

### 6.2 Derive + optimistic overlay

- The grid renders from `computed = evaluate(snapshot ⊕ overlay)` via WASM — **not**
  from the node's `computed_value` (once the engine is ready).
- **Local edit:** write the cell into the **pending overlay**, re-derive, paint
  instantly (zero network). Then fire the node write (`applyCellOps`/`setCell`)
  through the existing mutation queue, off the interactive path.
- **Sync event** (`useSubscription`): refetch inputs (full workbook via `exportAll`),
  replace the snapshot, and **drop each overlay entry the fresh snapshot now confirms**
  (its raw value matches). Overlay entries for not-yet-persisted keystrokes survive a
  racing refetch → no flicker. Re-derive.

The overlay is the entire reconciliation mechanism: derive over `snapshot ⊕ overlay`,
and let sync retire overlay entries as it echoes them back. Both engines being
identical means the retired entry and the snapshot agree by construction.

**Relationship to Phase 1.5.** Phase 1.5 narrowed the refresh to the *active sheet*
(`get_cells(active)`) because the node derived cross-sheet refs internally and
returned only what the active sheet needed. Phase 2 deliberately **supersedes** that:
the client now derives cross-sheet refs itself, so it must hold every sheet's raw
inputs — the refresh path becomes a full-workbook `exportAll` (raw inputs, plus the
node's `computed_value` for the dev assert and pre-WASM paint). This is a conscious
trade: more raw data per refresh (inputs-only, no per-sheet compute scoping) in
exchange for a zero-round-trip keystroke path. Phase 1.5's sheet-level *node* read
scoping (`sheet_closure` / `get_cells`) stays in place for any consumer still calling
`get_cells`; only the client's own refresh path changes.

### 6.3 Cross-sheet & name/id translation

Inputs carry `[id]!` formulas as stored; the WASM engine resolves them exactly like
the node (same code). The client's existing name↔id translation for the formula bar
(`idsToNames`/`namesToIds`) is unchanged and orthogonal — it operates on display
strings, not on what the engine evaluates.

---

## 7. Node role & initial paint

The node read path is **unchanged**. It keeps deriving `computed_value` on
`get_cells`/`export_all`. Rationale:

- Authoritative convergent computation for late joiners, verification, and any
  non-WASM consumer.
- Zero risk to Phase 1/1.5 behavior.
- Essentially free (the node already does it).
- **Pre-WASM initial paint:** on first load, before the WASM engine instantiates, the
  client paints the node-computed values from `exportAll`, then swaps to WASM-derived
  once `init()` resolves — no flash of raw formulas.

---

## 8. Staleness guard (dev)

Both engines are one source compiled two ways, so they must agree; the only way they
diverge is a **stale committed WASM artifact**. Guard that one new failure mode:

- **Dev runtime assert** (`import.meta.env.DEV` only, stripped from prod): on each
  refresh, compare WASM-derived values against the node's `computed_value`;
  `console.error` on mismatch, naming the divergent cells.
- **CI diff** (§5.2): rebuild + `git diff --exit-code` on the committed artifact.

---

## 9. Testing strategy (detail in the plan)

- **`recalc` crate:** keeps its full existing suite, which moves with it — precedent
  extraction, topo order, single-pass chains, exact cycle detection, error
  propagation, cross-sheet `[id]!`, unknown-sheet `#REF!`, blank-cell semantics,
  determinism (insertion-order independence). Green suite validates the extraction.
- **`recalc-wasm`:** a round-trip test — JSON in → JSON out equals native
  `recalc::evaluate` over the same inputs (guards the serde boundary).
- **Client (pure unit tests, node-env vitest, no React-hook harness):**
  - pending-overlay merge: `derive(snapshot ⊕ overlay)` uses overlay over snapshot;
  - overlay retirement: a sync snapshot that matches an overlay entry drops it; a
    non-matching (in-flight) entry survives;
  - input-store update from an `exportAll` result.
- **Living guards:** the dev assert (§8) and the CI staleness diff (§5.2).

---

## 10. Non-goals / deferred

- Warm **incremental** graph + dirty propagation (this spec re-derives fully).
- Viewport-scoped compute/render.
- Parallel evaluation.
- Removing node-side computation.
- In-place state migration (state is wiped at deploy per standing decision).
