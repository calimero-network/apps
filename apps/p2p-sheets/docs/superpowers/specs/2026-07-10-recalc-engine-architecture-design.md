# Recalculation Engine Architecture — Design

**Date:** 2026-07-10
**Status:** Design (pending review)
**Component:** `logic/crates/spreadsheet` (Rust WASM) + `app/` (React client)

---

## 1. Problem

The current recalculation model has two defects. The second (performance) is the
one that prompted this work; the first (correctness under collaboration) is the
more serious and is the real reason to re-architect.

### 1.1 Derived data lives in the merged CRDT (correctness bug)

`computed_value` is a field on `CellData`
(`logic/crates/spreadsheet/src/lib.rs:62`), and `CellData` is a per-cell CRDT
entry with **last-writer-wins merge** (`lib.rs:79`, which copies `computed_value`
on merge). But CRDT merges run inside the `Mergeable::merge` layer — a pure field
copy — with **no recompute afterward**. Concretely:

- Peer A edits `A1`. A's node runs `recompute_all`, stores fresh values, syncs the
  deltas.
- Peer B receives `A1`'s new raw + computed via LWW merge. Every formula on B that
  *depends* on `A1` (`=A1*10`, `=SUM(A1:A9)`) is **never recomputed** — merge does
  not trigger recomputation. B shows **stale values** until B itself makes an edit.
- Because `computed_value` is itself LWW-merged, two peers can converge on a
  computed value that does not match the merged inputs — a value A computed against
  a precedent B has since overwritten. **The workbook can converge to an
  arithmetically inconsistent state.**

For a single-user app this is invisible. For a collaborative spreadsheet it is the
defining bug. The root cause is storing **derived** data inside replicated,
LWW-merged state.

### 1.2 Whole-workbook fixed-point recompute (performance)

`recompute_all` (`lib.rs:565`) re-evaluates *every* formula cell in the workbook,
iterating up to `max_iter` times until values stop changing. It runs on every
`set_cell` (`lib.rs:414`), `set_cell_formula` (`lib.rs:471`), and `clear_cell`
(`lib.rs:555`). Cost per mutation is `O(cells × iterations)`. The `max_iter` sweep
exists only because the engine does not know a correct evaluation order, so it
brute-forces convergence — which is also what forces the heuristic `#CYCLE!`
detection.

On top of the node-side cost sits a client-side amplifier: every range operation
(paste / fill / delete / format across K cells) issues K separate mutations, each
triggering a full `recompute_all` + a full `refresh()` + a CRDT commit that fans
out K sync events to every peer. A K-cell operation is ~2K round trips.

---

## 2. Runtime constraints (confirmed against `core/`)

Three facts about the Calimero runtime shape the solution. All were confirmed at
high confidence by reading `core/` source.

1. **WASM memory is fresh per call.** Every RPC execute builds a new `wasmer::Store`
   + `Instance`; state is deserialized at method entry and linear memory is
   discarded on return (`core/crates/runtime/src/lib.rs:325,406`; guest state
   fetched per call at `core/crates/sdk/macros/src/logic/method.rs:201` and written
   back only for mutations at `:250-255`).
   → **An in-memory cache — e.g. a persistent dependency graph — cannot survive
   across calls inside the node.**

2. **No post-merge / sync hook exists.** Merges terminate inside `Mergeable::merge`
   with no app-level callback. The full `#[app::*]` attribute set is
   `logic, state, private, init, xcall, view, destroy, migrate, migration_check,
   event` (`core/crates/sdk/macros/src/lib.rs:78-305`) — nothing for remote-sync
   reconciliation.
   → **App code cannot react to "state just changed from a remote sync." Derived
   values must be recomputed lazily on read.**

3. **No gas / fuel limit; reads run the same path as writes.** There is no
   metering, fuel, or execution timeout on WASM. Only structural limits apply —
   memory pages, stack depth, value sizes (`core/crates/runtime/src/logic.rs:176-228`).
   Views (`#[app::view]`, `&self`) run the same `Module::run` path as mutations,
   differing only in taking a read lock and skipping `commit()`.
   → **`&self` queries may do non-trivial compute unmetered — but an accidental
   infinite loop would hang the node, so termination must be guaranteed by design,
   not by a meter.**

**Consequences.** Facts 1 and 2 mean the only correct place to compute derived
values on the node is **lazily, on read**. Fact 3 means that is permitted and
that a **terminating** evaluator (a single pass over a cycle-free graph) is
required — the DAG is a safety property, not merely a performance one.

---

## 3. Architecture principle

> **Inputs are the CRDT source of truth. Computed values are a deterministic
> function of inputs and are never stored in, or merged through, the CRDT.**

The replicated `CellData` holds only inputs — `raw_value`, `format`, and sheet
metadata. Computed values are derived locally, deterministically, from the merged
input state. Every peer computing the same pure function over the same merged
inputs converges by construction. This eliminates §1.1 at the root, and §1.2
follows because writes no longer recompute.

Concretely (**Approach A — derive-on-read**):

- **Writes** store the raw input and emit an event. **No recompute.** → O(1) node
  work per write.
- **Reads** (`get_cells`) build a dependency graph from the current merged inputs,
  evaluate once in topological order, and return computed values — storing nothing.
- Correctness under merge is free: every read derives from whatever inputs have
  merged in. No post-merge hook is needed (which is fortunate — none exists).
- Cycle detection is exact (a structural fact from the topological sort), retiring
  `max_iter`.

Two alternatives were rejected:

- **B — derive + in-memory incremental cache with a merge hook.** Requires warm
  node memory (Fact 1 ✗) and a post-merge hook (Fact 2 ✗). **Not buildable on this
  runtime as a node-side design.** Its ideas re-emerge, correctly placed, in
  Phase 2 (client-side).
- **C — keep `computed_value` in the CRDT, add a merge-hook recompute.** Still
  stores derived data in replicated state (fragile) *and* needs the missing hook.
  Rejected.

Because Fact 1 forbids a warm node cache, derive-on-read is not a stepping stone —
it is the **correct terminal node-side architecture** for this runtime. Node-side
scaling is achieved by **computing less per read** (scoping — §6.3), not by
caching. Interactive speed, and the path to beating Google, live in the **client**
(Phase 2, §8), where memory *is* long-lived.

---

## 4. Component map

| File | Responsibility | Change |
|---|---|---|
| `logic/crates/spreadsheet/src/recalc.rs` (new) | Pure evaluator: inputs → computed values. Dependency graph, topo sort, single-pass eval, exact cycle detection. No I/O, no `self`. | **Create** |
| `logic/crates/spreadsheet/src/lib.rs` | State + methods. Drop `computed_value` from stored `CellData`; delete `recompute_all`; writes store raw only; `get_cells` derives via `recalc`; add `apply_cell_ops` batch. | **Modify** |
| `app/src/hooks/useSpreadsheet.ts` | Range ops call the batch API; `refresh()` refreshes the active sheet, not every sheet. | **Modify** |
| `app/src/api/spreadsheet/SpreadsheetClient.ts` | Add `applyCellOps` RPC binding. | **Modify** |
| `app/src/pages/app/AppPage.tsx` | Range handlers (paste/fill/delete/format) build one op list and call the batch API once. | **Modify** |

---

## 5. § 1 — The pure evaluator (`recalc` module)

A standalone, pure module. Given a snapshot of workbook inputs, it returns the
computed value for every cell. No CRDT, no I/O, no `self`. This is the seam every
other piece plugs into — and the exact module Phase 2 ports to the client.

### 5.1 Interface (conceptual)

```rust
pub struct CellRef { pub sheet_id: String, pub row: u32, pub col: u32 }

pub struct WorkbookInputs {
    /// Raw user input per cell (literal or formula). Absent key = empty cell.
    pub cells: BTreeMap<CellRef, String>,
    /// Valid sheet ids; a ref to an id not in this set evaluates to `#REF!`.
    pub sheet_ids: HashSet<String>,
}

/// Deterministic: identical inputs → identical outputs on every peer.
/// Only formula cells differ from their input; literals map to themselves.
pub fn evaluate(inputs: &WorkbookInputs) -> BTreeMap<CellRef, String>;
```

The interface never changes when scoping (§6.3) or the client engine (§8) are
added — those choose *which inputs to feed* and *which outputs to keep*, not what
`evaluate` does.

### 5.2 Three phases

1. **Precedent extraction.** Parse each formula and collect the cell refs it reads:
   single refs, ranges expanded to member cells, and cross-sheet `[id]!` refs.
   Reuses the existing reference-scanning logic (the same `[id]!` / quote / range
   handling already in `lib.rs`). Produces directed edges `precedent → dependent`.
2. **Topological order (Kahn's algorithm, iterative).** Order cells so each is
   evaluated after its precedents. Kahn's algorithm is used specifically because
   Fact 3 (stack limit, no fuel) forbids deep recursive DFS. Any cell that never
   reaches in-degree 0 is in — or downstream of — a cycle and is stamped `#CYCLE!`.
3. **Single-pass evaluation.** Evaluate cells in topological order using the
   **existing** expression evaluator (`parse_add/mul/factor`, `try_function`, cell
   lookups). Cell lookups resolve against already-computed outputs. One pass; no
   fixed-point sweep.

### 5.3 Properties

- **Deterministic & pure** → all peers converge; unit-testable in isolation with
  plain Rust tests (no node, no CRDT).
- **Guaranteed termination** → a single pass over a DAG (cycles stamped, never
  followed) cannot loop. This is what makes it safe under Fact 3's missing fuel
  meter, and strictly safer than the old `max_iter` guard.
- **Exact cycles** → `#CYCLE!` iff a cell is in or downstream of a dependency cycle
  (a strongly-connected component), not a convergence heuristic.
- **Cache-ready / port-ready** → an incremental variant (Phase 2, in the warm
  client) keeps the graph + last outputs and, given a dirty set, re-evaluates only
  the affected subgraph behind the same conceptual signature.

### 5.4 Edge cases (must be pinned by tests)

- Blank / absent cell → `0` for numeric contexts, empty for text — matches current
  `cell_num` behavior.
- Range members expand individually in v1. Block/range-dependency compression is a
  large-scale upgrade, explicitly deferred (§9).
- Unknown sheet id in a ref → `#REF!` (current behavior preserved).
- **Error propagation.** A cell reading a `#DIV/0!` / `#REF!` / `#CYCLE!` /
  `#VALUE!` / … precedent yields an error itself. Topological order makes this
  well-defined (the precedent is computed first), unlike the old sweep. Existing
  error tokens are preserved: `#REF! #VALUE! #DIV/0! #NAME? #NUM! #NULL! #N/A
  #CYCLE!`.

---

## 6. § 2 & § 3 — Data model and read/write rewiring

### 6.1 § 2 — Inputs-only CRDT data model

Remove `computed_value` from the stored, replicated `CellData`:

- `CellData` (`lib.rs:62`) keeps: `id, sheet_id, row, col, raw_value, format,
  updated_at`. **Drop `computed_value`.**
- `Mergeable for CellData` (`lib.rs:79`) stops copying `computed_value` on merge.
- The **view** type `Cell` (`lib.rs:137`) **keeps** `computed_value` — it is now
  filled at read time by the evaluator, not read from storage. The ABI surface the
  client consumes is unchanged.

**Migration.** Removing a borsh field is a state-schema change. Per the standing
decision to wipe namespaces at deploy ("nuke them all", user-approved), existing
state is discarded on redeploy; no in-place migration is written. The
`#[app::migrate]` path is not used.

### 6.2 § 3 — Write path

`set_cell`, `set_cell_formula`, `clear_cell`:

- Store `raw_value` (and `format` where relevant). Do **not** set a computed value
  and do **not** call any recompute.
- Emit the existing `CellUpdated` / `CellCleared` events unchanged.
- Delete `recompute_all` entirely.

Result: writes are O(1) node work; the write lock is held only long enough to store
one field. `clear_cell` keeps its soft-clear semantics (blank in place, never
tombstone the deterministic key) — that behavior is orthogonal and preserved.

### 6.3 § 3 — Read path (`get_cells`)

`get_cells(sheet_id)` (`lib.rs:682`) becomes:

1. Build `WorkbookInputs` from the stored cells + sheet ids.
2. `recalc::evaluate(&inputs)`.
3. Return the requested sheet's cells as `Cell` views with `computed_value` filled
   from the evaluation result.

**v1 decision: full-workbook eval on read.** Correctness requires the full input
set (a requested sheet's formulas may reference other sheets), so `get_cells`
evaluates the whole workbook and returns the requested sheet. This is the simplest
provably-correct design and the same compute *order* as today's `recompute_all`,
merely relocated from write time to read time.

**Node-side scoping is the read-cost lever, deferred to §9.** The optimization
computes only the cells **reverse-reachable from the requested sheet** (the sheet
plus its transitive precedents), bounding node read cost to what is on screen. It
is a caller-side choice of which inputs to feed `evaluate` — it does not change the
evaluator — so it can be added later without touching the seam. v1 does not build
it; the client-side refresh change (§6.4) already reduces the *number* of read
calls, which is the larger near-term win.

`export_all` (`lib.rs:797`) returns only sheets today and needs no change; if a
future full-data export is added it derives the same way.

### 6.4 § 3 — Client refresh

`refresh()` (`useSpreadsheet.ts:151`) currently fetches **every** sheet's cells
(`fetchedSheets.map(getCells)`, line 166). Change it to fetch the **active sheet**
only, so read compute stays bounded to what is displayed. Non-active sheets are
fetched on tab switch. This is the client-side half of §6.3's scoping and the
concrete reason reads do not get slower on large books.

---

## 7. § 4 — Batch mutation API

Derive-on-read removes the K *recomputes* from a range op, but K writes are still K
CRDT commits fanning out K sync events. The batch API collapses them.

### 7.1 Node

```rust
pub enum CellOp {
    Set    { row: u32, col: u32, raw_value: String }, // literal or formula
    Format { row: u32, col: u32, format: String },
    Clear  { row: u32, col: u32 },
}

/// Apply every op to `sheet_id` in order, emit one event per changed cell,
/// commit once. No recompute (derive-on-read handles values).
pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()>;
```

One mutation → one CRDT commit → one sync event per peer, regardless of K. Ops
reuse the existing per-op storage logic (set/format/clear) minus the deleted
recompute.

### 7.2 Client

- `SpreadsheetClient.applyCellOps(sheet_id, ops)` → one `rpc.execute`.
- Range handlers in `AppPage.tsx` (`handlePaste`, `handleFill`, `handleDelete`,
  `applyFormat`) build one `ops` array and call `applyCellOps` once, then `refresh()`
  once — replacing their per-cell `await ss.setCell/clearCell/setCellFormat` loops.

### 7.3 Net effect on a K-cell range op

| | Today | After |
|---|---|---|
| Mutation RPCs | K (× up to 2 for value+format) | 1 |
| Node recomputes | K full-workbook sweeps | 0 (derive-on-read) |
| CRDT commits / sync events per peer | K | 1 |
| Client refreshes | K | 1 |

---

## 8. Phase 2 — The path to faster-than-Google (documented, not built here)

Phase 1 (§§5–7) ships correctness and removes the write-time recompute. Phase 2 is
what turns the architecture into a competitive-speed product. It is **enabled** by
Phase 1's seams (the pure evaluator and the inputs-only CRDT), not a rewrite of
them. Documented here so the foundation is built with it in mind; scheduled
separately.

### 8.1 Where Google's speed comes from, and its floor

Google Sheets is fast because of an incremental dependency graph (warm, only dirty
cells recompute), viewport-only compute and render, a client-side (WASM) calc
engine so most recalc never round-trips a server, and parallel recalc. Its
structural **floor** is that collaboration always routes through Google's
datacenter — every edit and every propagation pays a cloud round trip (tens to
100ms+), which the speed of light forbids beating.

### 8.2 The structural edge: locality

Calimero is p2p. Two collaborators on a LAN or geographically close can sync
**peer-to-peer without a datacenter hop** (~1ms on a LAN) — a collaboration
propagation latency Google's client↔server architecture cannot reach.

### 8.3 The move: one engine, two homes

The §5 evaluator is a pure function. **Compile that same Rust module to WASM and
run it in the browser client too.**

- **Client (warm, long-lived):** holds an incremental dependency graph in memory.
  A local edit recomputes only dirty dependents in-process, **zero network**, and
  paints instantly — matching Google's optimistic local echo. The node write to
  persist + sync happens asynchronously off the interactive path.
- **Node (fresh-per-call):** runs the *identical* pure engine as the authoritative,
  convergent, durable computation — for late joiners, verification, and sync.
- Because both run **the same deterministic function over the same inputs, they
  agree by construction** — no operational-transform reconciliation, no
  divergence-repair. Consistency that Google spends real engineering to maintain is
  free from purity.

Fact 1's "no warm node memory" stops mattering: the warm incremental engine lives
in the client, where memory is long-lived — exactly where Google's warm engine
lives too. The node need only be a fast convergent sync substrate, which
derive-on-read makes it.

### 8.4 What Phase 2 adds

- The `recalc` crate compiled to WASM and loaded by the client (single source of
  truth; no second engine to keep in sync).
- A client-side warm incremental graph with dirty propagation.
- Viewport-scoped compute and render.
- (Optional, later) parallel evaluation across independent DAG components.

### 8.5 Honest limits

Head-to-head **single-user raw throughput** on a pathological megasheet (1M
volatile cells, full recalc) is hard to beat frontally against Google's years of
parallel-WASM and range-compression work. Our win is the **collaborative,
interactive** case: locality + local-first + deterministic one-engine simplicity.

---

## 9. Non-goals / deferred

- Node-side read scoping (reverse-reachability from the requested sheet); v1
  evaluates the full workbook on read (§6.3).
- Block/range-dependency compression (ranges expand to member cells in v1).
- Opt-in iterative calculation (Excel/Sheets-style bounded iteration); v1 rejects
  cycles with `#CYCLE!`.
- In-place state migration (state is wiped at deploy per standing decision).
- Phase 2 (client engine) — designed here, scheduled separately.
- Non-active-sheet eager computation.

## 10. Testing strategy (detail in the plan)

- **`recalc` unit tests (pure Rust):** precedent extraction, topo order, single-pass
  chains, exact cycle detection (self-ref, mutual, long acyclic chain still
  converges), error propagation through the graph, cross-sheet `[id]!` refs,
  unknown-sheet → `#REF!`, blank-cell semantics. These replace and extend the
  existing cycle tests.
- **`lib.rs` integration tests:** writes store raw only (no stored computed value);
  `get_cells` derives correct values; `apply_cell_ops` applies a mixed op batch and
  commits once; rename does not change values.
- **Determinism:** identical inputs in different insertion orders → identical
  outputs (guards against map-iteration-order nondeterminism).
- **Client:** batch handlers issue one `applyCellOps` + one refresh; `refresh`
  fetches the active sheet only.
