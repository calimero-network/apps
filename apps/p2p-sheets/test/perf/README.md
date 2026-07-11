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
    bash test/perf/run-perf.sh

Results are written to `test/perf/results/financial.json` and printed as a
markdown table. Each row: input/formula cell counts, apply ms, derive ms
(active sheet + whole workbook), node-2 sync ms, and a correctness flag
(summary grand total == sum of inputs).

## Scenarios

- **Financial model (P&L)** — `workflow-perf-financial.yml` — line items × months
  with row/col subtotals and a cross-sheet summary. (First slice.)
- Amortization / aggregation / dense-grid — planned, same harness.
