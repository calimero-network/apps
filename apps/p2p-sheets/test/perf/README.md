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

Results are written to `test/perf/results/financial.json` and printed as a
markdown table. Each row: input/formula cell counts, apply ms, derive ms
(active sheet + whole workbook), node-2 sync ms, and a correctness flag
(summary grand total == sum of inputs).

## Scenarios

- **Financial model (P&L)** — `workflow-perf-financial.yml` — line items × months
  with row/col subtotals and a cross-sheet summary. (First slice.)
- **Cascading calc (amortization)** — `workflow-perf-amortization.yml` — a deep
  single-column dependency chain (`A[n]=A[n-1]+step`, integer recurrence for an
  exact invariant); stresses topological-sort chain depth.
- Aggregation / dense-grid — planned, same harness.

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
