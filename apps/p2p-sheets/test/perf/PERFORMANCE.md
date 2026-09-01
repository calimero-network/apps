# p2p-sheets — recalc engine performance report

Benchmark results for the **node-side** recalc engine of p2p-sheets, measured by
the merobox workflows in this directory. See [`README.md`](./README.md) for how
to run them and how the harness is built.

> **One-line takeaway:** derive-on-read and p2p sync are cheap and scale with
> cell count regardless of dependency shape (~150–210 ms and ~0.3–0.7 s at
> ~3–4k cells). The **only** bottleneck is bulk `apply_cell_ops`, which is
> O(N²) today because the node caps ops per CRDT commit — a node-config lever,
> not an app-logic one.

---

## Environment

| | |
|---|---|
| merod image | `ghcr.io/calimero-network/merod:0.11.0-rc.8` |
| Topology | 2 dockerized nodes; apply/derive timed on node 1, convergence on node 2 |
| Transport | node RPC (`apply_cell_ops`, `get_cells`, `get_all_cells`) |
| Apply batching | `bench.APPLY_CHUNK = 40` ops per `apply_cell_ops` commit |
| Numbers below | a single representative run; treat as order-of-magnitude, not SLA |

What is measured: the **node/server-side native `recalc` engine** — batch write
throughput, derive-on-read latency, and multi-node CRDT convergence. What is
**not** measured: the client-side WASM instant-echo engine (browser-only; a
separate Playwright concern).

---

## Methodology

Each scenario runs a **size sweep** (~100 / ~1k / ~3k cells). For every size the
driver: creates a fresh sheet, generates a deterministic `CellOp` batch, applies
it (timed, chunked), derives the active sheet and the whole workbook (each
timed), polls node 2 until it holds every cell node 1 wrote (timed), and asserts
an **exact closed-form invariant** on the result. A run that computes a wrong
value fails — these are correctness tests that happen to also record timings.

Metrics per row:

- **apply** — wall-clock of the full `apply_cell_ops` batch (summed across the
  ≤40-op chunks needed to stay under the node's per-commit caps).
- **derive (active)** — `get_cells(sheet)`, scoped derive-on-read.
- **derive (whole wb)** — `get_all_cells`, whole-workbook derive-on-read.
- **sync** — time for node 2 to converge to node 1's full cell set.
- **correct** — the scenario's invariant held (all runs below: ✅).

---

## Results

### Financial model (P&L) — cross-sheet closure + many aggregates

Line-items × months grids with per-row/per-column `SUM` subtotals and a summary
sheet cross-referencing each data sheet's grand total. Invariant: summary grand
total == Σ all inputs.

| size | cells (input + formula) | apply | derive (active) | derive (whole wb) | sync |
|---|---|---|---|---|---|
| small | 38 (25 + 13) | 30 ms | 5 ms | 5 ms | 376 ms |
| medium | 628 (540 + 88) | 967 ms | 18 ms | 27 ms | 348 ms |
| large | 4036 (3750 + 286) | **37.6 s** | 122 ms | 163 ms | 680 ms |

### Cascading calc (amortization) — deep dependency chain

A single column, `A[n] = A[n-1] + step` — every cell depends on the previous
one, so derive is a `depth`-long topological chain (worst case for serial
recompute). Invariant: final cell == `principal + (depth-1)·step`.

| size (depth) | cells | apply | derive (active) | derive (whole wb) | sync |
|---|---|---|---|---|---|
| 100 | 100 | 72 ms | 6 ms | 6 ms | 356 ms |
| 1000 | 1000 | 2.3 s | 48 ms | 45 ms | 92 ms |
| 3000 | 3000 | **27.4 s** | 153 ms | 166 ms | 361 ms |

### Aggregation dashboard — wide single-hop fan-in

A column-A ramp (1..N) plus a 5-cell `SUM`/`AVERAGE`/`COUNT`/`MAX`/`MIN` panel
over an explicit `A1:A{N}` range. Every aggregate fans in over the whole input
range — the opposite dependency shape to the amortization chain. Invariant: all
five aggregates match their closed forms (e.g. large: sum = 4 501 500, average =
1500.5, count = 3000, max = 3000, min = 1).

| size (inputs) | cells | apply | derive (active) | derive (whole wb) | sync |
|---|---|---|---|---|---|
| 100 | 105 | 83 ms | 6 ms | 9 ms | 348 ms |
| 1000 | 1005 | 2.4 s | 43 ms | 45 ms | 366 ms |
| 3000 | 3005 | **27.3 s** | 144 ms | 155 ms | 699 ms |

### Dense grid — wide fan-out, O(N) formula cells

An R×C cumulative prefix-sum table where every cell = `up + left − diag + 1`
(so `P(r,c) = (r+1)(c+1)`). Unlike aggregation's handful of formula cells, here
*every* cell is a formula depending on up to three neighbors. Invariant:
bottom-right cell == `R·C`.

| size (R×C) | cells | apply | derive (active) | derive (whole wb) | sync |
|---|---|---|---|---|---|
| 10×10 | 100 | 67 ms | 7 ms | 5 ms | 360 ms |
| 32×26 | 832 | 1.7 s | 42 ms | 45 ms | 58 ms |
| 120×26 | 3120 | **27.1 s** | 191 ms | 213 ms | 307 ms |

---

## What the numbers say

### 1. Derive-on-read is cheap and shape-agnostic

At ~3k cells the whole-workbook derive lands at **155–213 ms across every
dependency shape** — a 3000-deep serial chain (166 ms), a wide fan-in over 3000
inputs (155 ms), and 3120 fully-formula grid cells with diagonal fan-out
(213 ms). The topological sort and pure evaluator don't care whether the graph
is deep, wide, or dense; cost tracks total cell count, not structure. This is
the core win of the inputs-only-CRDT + derive-on-read design: reads stay fast as
the workbook grows.

### 2. Sync is fast

Node-2 convergence of a fresh ~3k-cell workbook is **0.3–0.7 s** end to end.
The p2p differentiator holds up: a heavy sheet reaches a peer in well under a
second. (Sync time is dominated by CRDT propagation and settling, not by cell
count in this range — hence the spread.)

### 3. Bulk apply is the sole bottleneck — and it's O(N²)

`apply_cell_ops` dominates by two orders of magnitude at the large sizes (tens
of seconds vs. tens/hundreds of ms). The cause is **not** the recalc engine; it
is how large batches map onto CRDT commits.

**Root cause.** The node runtime caps each commit at `max_events = 100` and
`max_registers = 100`. A single `apply_cell_ops` of thousands of ops blows both
caps, so the harness splits the batch into commits of ≤ 40 ops
(`bench.APPLY_CHUNK = 40`). A ~3–4k-cell load therefore becomes ~75–100 separate
CRDT commits, and each commit's cost grows with the total state already in the
context → roughly **O(N²)** overall. The large financial sweep (4036 cells,
~37.6 s) is the clearest instance; the 3k sweeps land at ~27 s.

Note the shape-independence here too: amortization, aggregation, and grid all
apply ~3k cells in ~27 s regardless of formula structure — apply cost is driven
by op count and commit chunking, not by the dependency graph.

---

## Fixed, and the open lever

**Fixed (app-side).** `apply_cell_ops` originally emitted one event *per cell*,
which hit the `max_events = 100` cap first and also caused N client refreshes per
batch. It now emits a **single** `CellsChanged { sheet_id, count }` event per
batch (see `logic/crates/spreadsheet/src/{lib,events}.rs`). That removes events
as the binding cap and cuts client refreshes from N to 1.

**Still open (node-side).** With events collapsed, `max_registers = 100` is now
the binding cap — it limits a batch to ~90 ops, so `APPLY_CHUNK` stays at 40.
Raising the node's `VMLimits` (`max_registers` / `max_events`), via merod config
or core, would let bulk applies use far larger commits and collapse the ~27–37 s
into far fewer, larger commits. This is the single change that would move the
apply numbers; it is out of app-logic scope.

Everything else in this report is already where you'd want it.

---

## Reproducing

```bash
# fast pipeline check (tiny sizes, all scenarios)
PERF_SMOKE=1 bash test/perf/run-perf.sh

# full sweep, one scenario or all
bash test/perf/run-perf.sh aggregation
bash test/perf/run-perf.sh            # all four, sequentially
```

Each run rewrites `test/perf/results/<scenario>.json` (gitignored scratch) and
prints a per-scenario markdown table. Numbers vary with host hardware, Docker
resources, and merod version — re-run locally for figures you can trust on your
machine.

## Caveats

- Single-run numbers, not averaged; the large `apply` figures in particular
  carry run-to-run variance from Docker/CRDT scheduling.
- Sizes are capped at ~3–4k cells precisely because apply is O(N²) today; once
  the `VMLimits` lever lands, the sweep can be pushed to the ~10k targets in the
  original design without multi-minute applies.
- Aggregation deliberately uses explicit `A1:A{N}` ranges rather than
  whole-column `A:A` (the engine caps `A:A` expansion at `MAX_ROWS = 1000`).
- The dense grid uses the bounded prefix-sum recurrence rather than the pure
  `up + left` binomial form, whose values overflow f64 exact-integer range past
  ~27 rows and would make the invariant uncheckable.
