# Recalc performance workflows (merobox) — design

**Status:** approved design, pre-plan
**Related:** `2026-07-10-recalc-engine-architecture-design.md` (the engine under test),
`2026-07-11-recalc-phase2-client-wasm-design.md` (client WASM — explicitly NOT what this measures).

---

## 1. Goal

A suite of merobox workflows that feed a p2p-sheets spreadsheet with realistic,
computationally heavy workbooks and measure how the engine performs — each
workflow doubling as **a believable demo** ("here's a real financial model / a
10k-cell sheet") and **a rough benchmark** (apply / derive / sync timings across
a size sweep).

### 1.1 What this measures — and what it does NOT

merobox drives the **merod node** over its RPC/admin API, so these workflows
measure the **node-side native `recalc` engine**:

- `apply_cell_ops` batch mutation throughput (write + single CRDT commit),
- `get_cells` / `get_all_cells` **derive-on-read** latency as the workbook grows,
- cross-sheet closure scaling,
- multi-node **sync convergence** of a heavy sheet.

It does **NOT** measure the client-side WASM instant-echo (browser-only — that
would be a Playwright harness, out of scope here). Both are legitimate but
distinct engines; this suite is the node/server-side story.

---

## 2. Decisions (locked in brainstorming)

1. **Both layered** — each workflow is a realistic heavy scenario AND records timings.
2. **Four scenarios** — Financial model (P&L), Cascading calc (amortization),
   Aggregation dashboard, Dense dependency grid (§4).
3. **Mechanism** — standard merobox bootstrap steps for orchestration + a `local`
   script step (host Python) for load generation and precise timing (§3).
4. **Size sweep** — each scenario runs at ~3 sizes (~100 / ~1k / ~10k cells,
   tuned per scenario) for a scaling curve.
5. **Two nodes + sync** — apply/derive measured on node 1; convergence measured
   on node 2.

---

## 3. Architecture & mechanism

A self-contained suite under `test/perf/`, reusing the `test/spec-smoke.workflow.yml`
bootstrap pattern (2 dockerized merod nodes, `install_application`,
`create_namespace`, `create_context`, `join_namespace`).

### 3.1 Layout

```
test/perf/
  lib/
    generators.py     # pure: build CellOp[] per scenario+size, + expected result
    generators_test.py
    bench.py          # node client + timed execute, sweep driver, reporter
  workflow-perf-financial.yml
  workflow-perf-amortization.yml
  workflow-perf-aggregation.yml
  workflow-perf-grid.yml
  run-perf.sh         # build bundle if needed; run all 4; aggregate summary
  results/            # summary.md + summary.json (generated)
  README.md           # how to run + what it measures
```

### 3.2 Load generation + timing (`local` script)

Each workflow YAML is thin: bootstrap → **one `local` script step** → done. The
script (host Python) owns the whole sweep for its scenario:

- Gets an **authenticated** client per node via merobox's own helper —
  `get_client_for_rpc_url(get_node_rpc_url(node), node_name=node)` (from
  `merobox.commands.client` / `merobox.commands.utils`) — the same token-caching,
  401-refreshing path merobox's `call` step uses. No bespoke auth. The node names
  and context id flow in from the workflow via the script step's args/env
  (resolved from `{{dynamic}}` values like `{{spreadsheet_ctx}}`).
- A **timed execute** wrapper: `execute(node_client, context_id, method, args) ->
  (result, elapsed_ms)` using `time.perf_counter()` around the call.
- For each size in the sweep: create a fresh sheet, build the batch from
  `generators.py`, apply it (timed), derive (timed), measure sync (§5), assert
  correctness, append a result row.
- Emit the per-scenario table and write partial results for the runner to
  aggregate.

`generators.py` is **pure** (no I/O): given a size it returns
`(ops: list[CellOp], expected: <invariant value>)`. `CellOp` mirrors the ABI
enum shape used by `apply_cell_ops` (`{"kind": "Set", "row", "col", "raw_value"}`,
`{"kind": "Format", ...}`, `{"kind": "Clear", ...}`).

### 3.3 Metrics (per scenario × size)

- `input_cells`, `formula_cells`
- `apply_ms` — `apply_cell_ops` batch (write + one commit)
- `derive_active_ms` — `get_cells(active_sheet)` (scoped derive-on-read)
- `derive_all_ms` — `get_all_cells` (whole-workbook derive)
- `sync_ms` — node-2 convergence (§5)
- `correct` — invariant assertion passed (bool)

### 3.4 Reporting

The script prints a per-scenario console table; `run-perf.sh` aggregates all four
into `test/perf/results/summary.md` (a scenario × size × metrics markdown table,
paste-ready for a demo/README) and `summary.json` (raw numbers).

---

## 4. The four scenarios

Each builds a believable sheet stressing one engine dimension, with a cheap
correctness invariant. Sizes are per-scenario config dicts at the top of each
workflow's script.

### 4.1 Financial model (P&L)
Line items × months grid of numeric inputs; per-row totals (`=SUM` across the
row), per-month totals (`=SUM` down the column); a **summary sheet** whose cells
cross-reference each data sheet's grand total (`=[sheetId]!<total cell>`).
- **Stresses:** cross-sheet closure + many aggregates.
- **Sweep:** number of line-items × months (→ ~100 / ~1k / ~10k input cells),
  and number of data sheets feeding the summary.
- **Invariant:** summary grand total == Σ all inputs.

### 4.2 Cascading calc (amortization)
A single column: `A1 = principal`, `A[n] = A[n-1] * (1 + rate) - payment`, for
thousands of rows.
- **Stresses:** topological sort + chain depth (each cell depends on the prior).
- **Sweep:** chain depth (~100 / ~1k / ~10k rows).
- **Invariant:** final balance within tolerance of the closed-form amortization
  value for those inputs.

### 4.3 Aggregation dashboard
A large data block of numeric inputs (up to ~10k cells) + a panel of wide
aggregations: `=SUM(A1:A10000)`, `=AVERAGE(...)`, `=COUNT(...)`, `=MAX(...)`,
`=MIN(...)` over large ranges (incl. whole-column `A:A` forms).
- **Stresses:** range expansion + big-aggregate evaluation.
- **Sweep:** data block size (~100 / ~1k / ~10k input cells).
- **Invariant:** for inputs `1..N`, `SUM == N(N+1)/2` (and matching AVERAGE/COUNT/MAX).

### 4.4 Dense dependency grid
An N×N grid where each cell equals the sum of its up and left neighbors (a
cumulative table); row 0 / col 0 seeded with 1s.
- **Stresses:** total formula count + dependency fan-out in one derive pass.
- **Sweep:** N (→ ~100 / ~1k / ~10k formula cells).
- **Invariant:** bottom-right cell == the known closed-form value (binomial
  cumulative sum) for that N.

---

## 5. Two-node sync measurement

After applying a scenario's batch on **node 1**, the script measures convergence
on **node 2**: it polls node 2 (a cheap probe — e.g. `get_all_cells` cell count,
or `get_cells` on the active sheet compared to node 1's derived result) until
node 2 matches node 1, timing the interval → `sync_ms`. This is the p2p
differentiator ("a 10k-cell sheet syncs to a peer in X ms"). It uses the same
convergence semantics as merobox's `wait_for_sync`, but timed in-script to yield
a number, with a timeout guard (records a failure/`sync_ms = timeout` rather than
hanging).

---

## 6. Testing the harness

- `generators.py` is pure and unit-tested (`generators_test.py`): correct op
  counts, correct formula shapes, and the expected-invariant math for each
  scenario at a couple of small sizes. Run with the merobox repo's test runner
  (pytest) or standalone.
- The workflows are the integration test: each runs the sweep and asserts the
  correctness invariant at every size (a run that computes the wrong total fails,
  not just a slow one).
- A **smoke size** (e.g. ~10 cells) runs fast for dev/CI; the large sizes are
  on-demand via `run-perf.sh`.

---

## 7. Non-goals / deferred

- Client-side WASM timing (browser/Playwright — different engine, separate harness).
- Micro-optimizing the recalc engine (this measures; it does not tune).
- Wiring the heavy sizes into the default CI gate (they're expensive; a smoke
  size could be added to CI later).
- Head-to-head comparison against Google Sheets / Excel.
- Fault/network-partition perf (merobox supports it; out of scope for v1).

---

## 8. Open dependencies / assumptions

- **Bundle present:** `run-perf.sh` ensures `logic/res/p2p-sheets-<version>.mpk`
  exists (runs `logic/build-bundle.sh` if missing), matching `spec-smoke`'s
  pre-flight.
- **merobox importable from the `local` script:** the script imports
  `merobox.commands.client` / `merobox.commands.utils`; the plan confirms these
  entry points against the installed merobox and pins the exact call signatures.
- **`apply_cell_ops` accepts large batches:** the engine's batch path (Phase 1)
  applies an arbitrary-length `ops` array in one commit; the sweep's top size is
  chosen to stay within any node request-size limits (the plan verifies and, if
  needed, chunks the largest batch while still timing the aggregate).
