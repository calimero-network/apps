---
title: Perf suite
layout: default
nav_order: 5
---

# mero-sheets perf suite

merobox workflows that feed heavy workbooks to two merod nodes and time the
**node-side** recalc engine: `apply_cell_ops` throughput, `get_cells` /
`get_all_cells` derive-on-read latency, and node-2 sync convergence — across a
size sweep, each scenario doubling as a believable demo and a rough benchmark.

- **Results & analysis:** [Performance](performance).
- **Engine design:** [Architecture](architecture).

This measures the **server-side** engine only. The client-side WASM instant-echo
engine is browser-only and out of scope here.

## Quickstart

Requires Docker running and network access to pull the merod image.

```bash
# smoke — tiny sizes, fast; validates the whole pipeline
PERF_SMOKE=1 bash test/perf/run-perf.sh

# full sweep
bash test/perf/run-perf.sh                 # all four scenarios, sequentially
bash test/perf/run-perf.sh aggregation     # just one: financial|amortization|aggregation|grid
```

Each scenario prints a markdown table and writes
`test/perf/results/<scenario>.json` (gitignored scratch). Each row carries:
input/formula cell counts, apply ms, derive ms (active sheet + whole workbook),
node-2 sync ms, and a correctness flag (the scenario's exact invariant held).

## Scenarios

Each builds a believable sheet stressing one engine dimension, with a cheap
exact invariant so a wrong answer fails the run.

| Scenario | Workflow | Stresses | Invariant |
|---|---|---|---|
| **Financial model (P&L)** | `workflow-perf-financial.yml` | cross-sheet closure + many `SUM` aggregates | summary grand total == Σ all inputs |
| **Cascading calc (amortization)** | `workflow-perf-amortization.yml` | topological-sort chain depth (`A[n]=A[n-1]+step`) | final cell == `principal + (depth-1)·step` |
| **Aggregation dashboard** | `workflow-perf-aggregation.yml` | wide range fan-in (`SUM`/`AVERAGE`/`COUNT`/`MAX`/`MIN` over `A1:A{N}`) | all five aggregates == closed forms for inputs 1..N |
| **Dense grid** | `workflow-perf-grid.yml` | O(N) formula cells + diagonal fan-out (`up+left−diag+1`) | bottom-right cell == `R·C` |

## Layout

```
test/perf/
  lib/
    generators.py        # pure: build CellOp[] per scenario + expected invariant
    generators_test.py   # pytest for the generators (pure, no Docker)
    bench.py             # node client + timed execute, chunked apply, derive, sync-poll, reporter
    bench_test.py        # pytest for the reporter/helpers
    driver_<scenario>.py # one per scenario: runs its size sweep, asserts, writes results
  perf-<scenario>.sh     # /bin/sh entry the workflow's `local` step execs
  workflow-perf-<scenario>.yml  # 2-node bootstrap + one local script step
  run-perf.sh            # builds the bundle if missing; dispatches one or all scenarios
  results/               # <scenario>.json scratch (gitignored)
  README.md              # this file
  PERFORMANCE.md         # results + analysis
```

## How it works

1. **Bootstrap (workflow YAML).** Each workflow boots 2 merod nodes, installs the
   `mero-sheets` bundle on both, creates a namespace + shared context on node 1,
   and joins node 2 — the same pattern as `test/spec-smoke.workflow.yml`.
2. **Load + timing (`local` script).** A single `target: local` step runs
   `perf-<scenario>.sh`, which execs `driver_<scenario>.py` under merobox's own
   Python. The driver gets an (unauthenticated — these local nodes have no
   embedded auth) client per node via `bench.node_client`, then for each size:
   generates the batch from `generators.py`, applies it via `bench.apply_ops`
   (chunked to `APPLY_CHUNK = 40` to stay under the node's per-commit caps),
   derives, polls node 2 for convergence, and asserts the invariant.
3. **Report.** The driver prints a `bench.format_summary` table and writes the
   per-scenario results JSON; `run-perf.sh` orchestrates which scenarios run.

`generators.py` is pure and unit-tested — no Docker needed to test the load-shape
and invariant math:

```bash
cd test/perf/lib && python3 -m pytest -v
```

## Adding a scenario

The four scenarios are deliberately parallel; a new one is a mechanical mirror:

1. Add a pure generator to `generators.py` (`(ops, expected, coord)`), TDD'd in
   `generators_test.py`.
2. Copy `driver_amortization.py` → `driver_<scenario>.py`; swap the generator
   call and the correctness check.
3. Copy `perf-amortization.sh` → `perf-<scenario>.sh` (point it at the new
   driver) and `chmod +x` it.
4. Copy `workflow-perf-amortization.yml` → `workflow-perf-<scenario>.yml`; change
   `name`, `description`, the script path, and **the ports** (see below).
5. Add a `case` to `run-perf.sh` and include it in `all`.
6. Run the e2e, then add a results section to `PERFORMANCE.md`.

**Port allocation** (each scenario gets its own, 100 apart, to avoid collisions):

| scenario | base_port | base_rpc_port |
|---|---|---|
| financial | 13428 | 13528 |
| amortization | 13628 | 13728 |
| aggregation | 13828 | 13928 |
| grid | 14028 | 14128 |

**Engine limits worth knowing** (`logic/crates/recalc/src/formula.rs`): cell refs
parse **single-letter columns only** (A–Z), and whole-column `A:A` range
expansion caps at `MAX_ROWS = 1000` — prefer explicit ranges past 1000 rows and
keep grids ≤ 26 columns.
