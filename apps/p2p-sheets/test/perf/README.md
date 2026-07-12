# p2p-sheets perf workflows

merobox workflows that feed heavy workbooks to two merod nodes and time the
**node-side** recalc engine: `apply_cell_ops` throughput, `get_cells` /
`get_all_cells` derive latency, and node-2 sync convergence — across a size
sweep. (This does NOT measure the client-side WASM engine — that's browser-only.)

## Run

Requires Docker running and network access to pull the merod image.

    # smoke (tiny, fast — validates the pipeline)
    PERF_SMOKE=1 bash test/perf/run-perf.sh

    # full sweep
    bash test/perf/run-perf.sh                 # all scenarios
    bash test/perf/run-perf.sh amortization    # just one

Each scenario writes its own `test/perf/results/<scenario>.json`
(`financial.json`, `amortization.json`, `aggregation.json`) and prints a
markdown table. Each row:
input/formula cell counts, apply ms, derive ms (active sheet + whole workbook),
node-2 sync ms, and a correctness flag (the scenario's invariant held).

## Scenarios

- **Financial model (P&L)** — `workflow-perf-financial.yml` — line items × months
  with row/col subtotals and a cross-sheet summary. (First slice.)
- **Cascading calc (amortization)** — `workflow-perf-amortization.yml` — a deep
  single-column dependency chain (`A[n]=A[n-1]+step`, integer recurrence for an
  exact invariant); stresses topological-sort chain depth.
- **Aggregation dashboard** — `workflow-perf-aggregation.yml` — a column-A data
  ramp (1..N) plus a 5-cell SUM/AVERAGE/COUNT/MAX/MIN panel over an explicit
  `A1:A{N}` range; validates all five aggregates against closed forms.

## Findings (financial model, 2-node, merod 0.11.0-rc.8)

| size | cells | apply | derive (whole workbook) | node-2 sync |
|---|---|---|---|---|
| small | 38 | 30 ms | 5 ms | 376 ms |
| medium | 628 | 966 ms | 27 ms | 348 ms |
| large | 4036 | **37.6 s** | 163 ms | 680 ms |

**Derive-on-read and p2p sync scale excellently** — 4036 cells derive in 163 ms
and converge on the peer in 680 ms. **Bulk apply is the bottleneck.**

Root cause: `apply_cell_ops` must be split into commits of ≤~40 ops because the
node runtime caps per-commit **events** (`max_events` = 100) and **registers**
(`max_registers` = 100). Each cell op emitted its own event and consumes
registers, so a big batch overflowed. So a 4036-cell load becomes ~100 separate
CRDT commits, and each commit's cost grows with total state → roughly O(N²).

- **Fixed (app):** `apply_cell_ops` now emits ONE `CellsChanged` event per batch
  instead of one per cell (commit `perf(spreadsheet): apply_cell_ops emits one
  batch event`). Removes the event cap and cuts client refreshes from N to 1.
- **Still open (node):** `max_registers = 100` still binds batch size at ~90 ops,
  so `bench.APPLY_CHUNK` stays at 40. Raising the node's `VMLimits`
  (`max_registers`/`max_events`) — via merod config or core — would let bulk
  applies use far larger commits and collapse the 37 s. Out of app scope.

## Findings (amortization / deep chain, 2-node)

A single column, `A[n] = A[n-1] + step` — every cell depends on the prior, so
derive is a `depth`-long topological chain (the worst case for serial recompute).

| depth | apply | derive (active sheet) | node-2 sync |
|---|---|---|---|
| 100 | 72 ms | 6 ms | 356 ms |
| 1000 | 2.3 s | 48 ms | 92 ms |
| 3000 | 27.4 s | **153 ms** | 361 ms |

**The topological sort scales beautifully** — a 3000-deep dependency chain derives
in **153 ms**. Deep chains are not a problem for the derive-on-read engine. Apply
is again the sole bottleneck (same `APPLY_CHUNK`/commit-count cause as above), so
the depth sweep is kept ≤3000.

## Findings (aggregation dashboard, 2-node)

A column-A ramp (1..N) plus a 5-cell SUM/AVERAGE/COUNT/MAX/MIN panel over an
explicit `A1:A{N}` range — every aggregate is a wide, single-hop fan-in over the
whole input range (the opposite shape from amortization's deep chain).

| size | input cells | apply | derive (active sheet) | derive (whole workbook) | node-2 sync |
|---|---|---|---|---|---|
| small | 100 | 82.6 ms | 6.3 ms | 9.1 ms | 348.4 ms |
| medium | 1000 | 2.4 s | 42.8 ms | 44.9 ms | 365.8 ms |
| large | 3000 | 27.3 s | **143.7 ms** | 154.8 ms | 698.7 ms |

All three sizes validate exactly against closed forms for all five aggregates
(e.g. large: sum=4501500, average=1500.5, count=3000, max=3000, min=1).

**Wide-range aggregation derives just as cheaply as the deep chain** — a
5-cell panel fanning in over 3000 inputs recomputes in **144 ms**, essentially
the same order of magnitude as amortization's 3000-deep chain (153 ms) despite
the very different dependency shape (wide fan-in vs. deep chain). Apply remains
the dominant cost and the sole bottleneck, for the same `APPLY_CHUNK`-driven
O(N²) commit-count reason documented above.
