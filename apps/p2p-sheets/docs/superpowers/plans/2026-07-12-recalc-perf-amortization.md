# Recalc Perf — Amortization (cascading-calc) scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second perf scenario — a deep single-column dependency chain (amortization / cascading calc) — on the proven harness, to measure how the recalc engine's topological-sort scales with chain depth.

**Architecture:** A pure generator builds a `depth`-long chain `A1=principal; A[n]=A[n-1]+step` (integer recurrence → exact invariant) plus its expected final value. A driver (mirroring `driver_financial.py`) applies the chain to one sheet, times apply / derive / node-2 sync across a depth sweep, and asserts the last cell equals the closed form. Reuses `bench.py` entirely. A workflow YAML (copy of the financial one) runs it via a `local` script step.

**Tech Stack:** Python 3 (pytest), merobox (`get_client_for_node` etc.), dockerized merod via merobox.

## Global Constraints

- **Node-side only** (native `recalc` engine), reuse `bench.py` unchanged: `node_client`, `timed_execute` (raises on a node error envelope), `apply_ops` (chunks to `APPLY_CHUNK=40` under the runtime event/register caps), `derive_active`, `derive_all`, `wait_converged`, `format_summary`.
- **CellOp wire shape:** `{"kind": "Set", "row": <int>, "col": <int>, "raw_value": <str>}` (via `generators.set_op`).
- **Same-sheet reference:** a formula references the cell above with `=<A1>±k` (e.g. `=A1-1000`); `generators.a1(row, col)` builds the A1 string (0-based).
- **Integer recurrence (deviation from spec §4.2, deliberate):** the spec sketched a *float* amortization `A[n]=A[n-1]*(1+rate)-payment` with tolerance. We use an *integer* recurrence `A[n]=A[n-1]+step` instead: it stresses the identical thing that matters here (topological chain depth) but gives an **exact** invariant with no f64 drift between the Rust engine and the Python oracle over thousands of iterations. `step` may be negative (a declining balance), so it still reads as amortization.
- **merod image** `ghcr.io/calimero-network/merod:0.11.0-rc.8`; **bundle** `logic/res/p2p-sheets-1.0.0.mpk`; `service_name: spreadsheet`; **2 nodes**; `nuke_on_start`/`nuke_on_end: true`.
- **Docker** must be running for the Task 2 e2e. **Do not push.**

## File Structure

```
test/perf/
  lib/
    generators.py         # ADD amortization_chain() + its test
    generators_test.py    # ADD amortization tests
    driver_amortization.py    # NEW — the amortization sweep driver
  perf-amortization.sh    # NEW — /bin/sh wrapper (copy of perf-financial.sh, new driver)
  workflow-perf-amortization.yml  # NEW — copy of financial workflow, new script + ports
  run-perf.sh             # MODIFY — run both scenarios (arg-selectable)
  README.md               # MODIFY — amortization row/note
```

---

## Global interfaces (names used across tasks)

`generators.py` (existing: `a1`, `set_op`, `DataSheet`, `financial_data_sheet`, `SUMMARY_TOTAL_CELL`, `financial_summary`) — ADD:
- `amortization_chain(depth: int, principal: int = 1_000_000, step: int = -1_000) -> tuple[list[dict], int, tuple[int, int]]`
  → `(ops, expected_final, last_cell)` where `ops` is the CellOp list (`A1=principal`, then `A[n]=A[n-1]±|step|`), `expected_final = principal + (depth - 1) * step`, and `last_cell = (depth - 1, 0)`.

---

### Task 1: Amortization chain generator (pure, TDD)

**Files:**
- Modify: `test/perf/lib/generators.py` (append), `test/perf/lib/generators_test.py` (append)

**Interfaces:**
- Consumes: existing `a1`, `set_op` in the same module.
- Produces: `amortization_chain` (see Global interfaces).

- [ ] **Step 1: Write the failing test (append to `generators_test.py`)**

```python
def test_amortization_chain_shape_and_invariant():
    from generators import amortization_chain
    ops, final, last = amortization_chain(depth=4, principal=100, step=-10)
    # first cell is the literal principal; the rest reference the row above
    assert ops[0] == {"kind": "Set", "row": 0, "col": 0, "raw_value": "100"}
    assert ops[1]["raw_value"] == "=A1-10"   # A2 = A1 - 10
    assert ops[2]["raw_value"] == "=A2-10"   # A3 = A2 - 10
    assert ops[3]["raw_value"] == "=A3-10"   # A4 = A3 - 10
    assert len(ops) == 4
    # exact closed form: principal + (depth-1)*step
    assert final == 100 + 3 * (-10)          # 70
    assert last == (3, 0)


def test_amortization_chain_positive_step_uses_plus():
    from generators import amortization_chain
    ops, final, _ = amortization_chain(depth=3, principal=0, step=5)
    assert ops[1]["raw_value"] == "=A1+5"
    assert ops[2]["raw_value"] == "=A2+5"
    assert final == 0 + 2 * 5                 # 10
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -q`
Expected: FAIL — `cannot import name 'amortization_chain'`.

- [ ] **Step 3: Implement (append to `generators.py`)**

```python
def amortization_chain(depth: int, principal: int = 1_000_000, step: int = -1_000):
    """A deep single-column dependency chain (stresses topological-sort depth):
    A1 = principal; A[n] = A[n-1] + step, for n = 1..depth-1.

    Integer recurrence — the invariant is EXACT (no f64 drift over the chain),
    while still exercising the same chain-depth eval a float amortization would.
    `step` may be negative (a declining balance). Returns (ops, expected_final,
    last_cell) where expected_final = principal + (depth-1)*step and last_cell is
    the (row, col) of the final cell."""
    ops = [set_op(0, 0, principal)]
    sign = "+" if step >= 0 else "-"
    mag = abs(step)
    for n in range(1, depth):
        # reference the cell directly above (a1(n-1, 0)) and add/subtract step
        ops.append(set_op(n, 0, f"={a1(n - 1, 0)}{sign}{mag}"))
    expected_final = principal + (depth - 1) * step
    return ops, expected_final, (depth - 1, 0)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -q`
Expected: PASS (existing financial tests + the 2 new amortization tests).

- [ ] **Step 5: Commit**

```bash
git add test/perf/lib/generators.py test/perf/lib/generators_test.py
git commit -m "feat(perf): amortization deep-chain generator + exact invariant"
```

---

### Task 2: Amortization driver, workflow, runner + e2e

**Files:**
- Create: `test/perf/lib/driver_amortization.py`, `test/perf/perf-amortization.sh`, `test/perf/workflow-perf-amortization.yml`
- Modify: `test/perf/run-perf.sh`, `test/perf/README.md`

**Interfaces:**
- Consumes: `generators.amortization_chain` (Task 1); `bench` (`node_client`, `timed_execute`, `apply_ops`, `derive_active`, `derive_all`, `wait_converged`, `format_summary`); the workflow's `SPREADSHEET_CTX` env + node-name args.
- Produces: `test/perf/results/amortization.json` on success.

- [ ] **Step 1: Write the driver**

`test/perf/lib/driver_amortization.py`:

```python
#!/usr/bin/env python3
"""Amortization (deep-chain) perf sweep. Invoked by perf-amortization.sh inside a
merobox `target: local` script step. Reads the context id from env
SPREADSHEET_CTX (or argv[1]) and the two node names from argv[2:] (default
app-node-1/2). One sheet, one column, a `depth`-deep dependency chain per size."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # find generators/bench

import generators as g
import bench as b

# Depth sweep — modest, since APPLY is the known bottleneck (chunked commits under
# the node's per-commit caps); the interesting metric here is DERIVE latency of a
# deep chain. Push depths up once you want a bigger derive stress.
SIZES = [
    {"label": "small",  "depth": 100},
    {"label": "medium", "depth": 1000},
    {"label": "large",  "depth": 3000},
]
SMOKE = [{"label": "smoke", "depth": 10}]


def run():
    cid = os.environ.get("SPREADSHEET_CTX") or (sys.argv[1] if len(sys.argv) > 1 else "")
    node1 = sys.argv[2] if len(sys.argv) > 2 else "app-node-1"
    node2 = sys.argv[3] if len(sys.argv) > 3 else "app-node-2"
    if not cid:
        print("ERROR: no context id (SPREADSHEET_CTX / argv[1])", file=sys.stderr)
        return 1

    c1 = b.node_client(node1)
    c2 = b.node_client(node2)
    b.timed_execute(c1, cid, "init_project", {"name": "Perf: Amortization"})

    sizes = SMOKE if os.environ.get("PERF_SMOKE") == "1" else SIZES
    rows_out = []
    ok = True
    cumulative_cells = 0

    for spec in sizes:
        depth = spec["depth"]
        out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": f"{spec['label']} Chain"})
        sheet_id = out if isinstance(out, str) else (out.get("id", out) if isinstance(out, dict) else out)
        if not isinstance(sheet_id, str) or not sheet_id:
            raise RuntimeError(f"unexpected create_sheet return: {out!r}")

        ops, expected, (lr, lc) = g.amortization_chain(depth)
        apply_ms, _ = b.apply_ops(c1, cid, sheet_id, ops)

        # Derive (node 1). derive_all is timed only.
        cells, derive_active_ms = b.derive_active(c1, cid, sheet_id)
        cells = json.loads(cells) if isinstance(cells, str) else cells
        _all, derive_all_ms = b.derive_all(c1, cid)
        cumulative_cells += depth  # one non-blank cell per chain row

        # Sync: node 2 must hold every cell node 1 has written so far.
        try:
            sync_ms = b.wait_converged(c2, cid, min_cells=cumulative_cells)
        except TimeoutError as e:
            print(f"  sync timeout: {e}", file=sys.stderr)
            sync_ms = -1.0

        # Correctness: the last cell equals the closed form (numeric-tolerant —
        # computed_value is a string like "70").
        got = None
        for cell in (cells or []):
            if cell.get("row") == lr and cell.get("col") == lc:
                got = cell.get("computed_value")
                break
        correct = False
        if got is not None:
            try:
                correct = abs(float(got) - float(expected)) < 0.5
            except (ValueError, TypeError):
                correct = False
        ok = ok and correct and sync_ms >= 0

        rows_out.append({
            "size": spec["label"], "input_cells": 1, "formula_cells": depth - 1,
            "apply_ms": round(apply_ms, 1),
            "derive_active_ms": round(derive_active_ms, 1),
            "derive_all_ms": round(derive_all_ms, 1),
            "sync_ms": round(sync_ms, 1), "correct": correct,
        })
        print(f"[{spec['label']}] depth={depth} apply={apply_ms:.0f}ms "
              f"derive_active={derive_active_ms:.0f}ms sync={sync_ms:.0f}ms "
              f"correct={correct} (want {expected}, got {got})")

    print("\n" + b.format_summary(rows_out))
    results_dir = Path(__file__).resolve().parents[1] / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "amortization.json").write_text(json.dumps(rows_out, indent=2))
    print(f"\nwrote {results_dir / 'amortization.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 2: Verify it compiles**

Run: `cd test/perf/lib && python3 -m py_compile driver_amortization.py generators.py bench.py`
Expected: no output.

- [ ] **Step 3: Write the shell wrapper**

`test/perf/perf-amortization.sh` (identical to `perf-financial.sh` except the driver name):

```bash
#!/bin/sh
# merobox `target: local` step entry. Runs the amortization driver under merobox's
# own Python (has merobox + calimero_client_py), falling back to python3.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_amortization.py"

PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
```

Make executable: `chmod +x test/perf/perf-amortization.sh`.

- [ ] **Step 4: Write the workflow YAML**

`test/perf/workflow-perf-amortization.yml` — a copy of `workflow-perf-financial.yml` with a new name/description, the amortization script, and **distinct ports** (so it can't collide with the financial workflow's `134xx`):

```yaml
# Amortization (deep-chain) perf workflow. Boots 2 merod nodes, installs the
# p2p-sheets bundle, creates a shared context, joins node 2, then runs the
# amortization depth sweep via a local script step. Pre-flight: bash logic/build-bundle.sh.
name: p2p-sheets perf — amortization
description: Deep single-column dependency chains; time node-side apply/derive/sync across a depth sweep.
log_level: info
nodes:
  count: 2
  prefix: app-node
  image: ghcr.io/calimero-network/merod:0.11.0-rc.8
  base_port: 13628
  base_rpc_port: 13728
nuke_on_start: true
nuke_on_end: true
wait_timeout: 90

steps:
  - type: install_application
    name: Install bundle on app-node-1
    node: app-node-1
    dev: true
    path: ./logic/res/p2p-sheets-1.0.0.mpk
    outputs:
      app_id: applicationId

  - type: install_application
    name: Install bundle on app-node-2
    node: app-node-2
    dev: true
    path: ./logic/res/p2p-sheets-1.0.0.mpk

  - type: create_namespace
    name: Create namespace on app-node-1
    node: app-node-1
    application_id: '{{app_id}}'
    outputs:
      namespace_id: namespaceId

  - type: create_context
    name: Create spreadsheet context on app-node-1
    node: app-node-1
    application_id: '{{app_id}}'
    group_id: '{{namespace_id}}'
    service_name: spreadsheet
    outputs:
      spreadsheet_ctx: contextId

  - type: create_namespace_invitation
    name: Issue namespace invitation from app-node-1
    node: app-node-1
    namespace_id: '{{namespace_id}}'
    outputs:
      invitation: invitation

  - type: join_namespace
    name: app-node-2 joins namespace
    node: app-node-2
    namespace_id: '{{namespace_id}}'
    invitation: '{{invitation}}'

  # The driver authenticates itself (bench.node_client → unauthenticated client
  # for these local no-embedded-auth nodes) before calling the node.
  - type: script
    name: Run amortization perf sweep (local)
    target: local
    script: ./test/perf/perf-amortization.sh
    args:
      - '{{spreadsheet_ctx}}'
      - 'app-node-1'
      - 'app-node-2'
```

- [ ] **Step 5: Extend the runner**

Replace `test/perf/run-perf.sh` with a scenario-selectable version (default: both):

```bash
#!/usr/bin/env bash
# Build the bundle if missing, then run one or all perf workflows.
# Usage: run-perf.sh [financial|amortization|all]   (default: all)
# Env:   PERF_SMOKE=1 collapses each sweep to a tiny smoke size.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SCENARIO="${1:-all}"

MPK="logic/res/p2p-sheets-1.0.0.mpk"
if [ ! -f "$MPK" ]; then
  echo "Bundle missing — building..."
  bash logic/build-bundle.sh
fi

run_one() {
  local wf="$1"
  echo "Running $wf (PERF_SMOKE=${PERF_SMOKE:-0})..."
  PERF_SMOKE="${PERF_SMOKE:-0}" merobox bootstrap run "test/perf/$wf"
}

case "$SCENARIO" in
  financial)   run_one workflow-perf-financial.yml ;;
  amortization) run_one workflow-perf-amortization.yml ;;
  all)         run_one workflow-perf-financial.yml; run_one workflow-perf-amortization.yml ;;
  *) echo "unknown scenario: $SCENARIO (want financial|amortization|all)" >&2; exit 2 ;;
esac
```

- [ ] **Step 6: README row**

In `test/perf/README.md`, under "## Scenarios" replace the "planned" line for amortization:

```markdown
- **Cascading calc (amortization)** — `workflow-perf-amortization.yml` — a deep
  single-column dependency chain (`A[n]=A[n-1]+step`, integer recurrence for an
  exact invariant); stresses topological-sort chain depth.
- Aggregation / dense-grid — planned, same harness.
```

And in "## Run", note scenario selection:

```markdown
    bash test/perf/run-perf.sh                 # all scenarios
    bash test/perf/run-perf.sh amortization    # just one
```

- [ ] **Step 7: Run the e2e smoke and verify**

Requires Docker running.
Run: `PERF_SMOKE=1 bash test/perf/run-perf.sh amortization`
Expected: the workflow boots 2 nodes, installs, creates the context, joins node 2, runs the driver; the driver prints a `[smoke] depth=10 … correct=True` line and a markdown table; the workflow ends green; `test/perf/results/amortization.json` exists with one `smoke` row where `"correct": true` and `sync_ms >= 0`.

If Docker is unavailable, STOP and report BLOCKED (Task 1 tests still pass and all files are complete/inspectable).

- [ ] **Step 8: Run the full amortization sweep (records the numbers)**

Run: `bash test/perf/run-perf.sh amortization`
Expected: three rows (small/medium/large, depths 100/1000/3000), all `correct=true`, with apply/derive/sync timings; `amortization.json` updated. (Apply will be slow at depth 3000 — ~75 chunked commits — as expected; the derive_active/derive_all timings are the deep-chain result of interest.)

- [ ] **Step 9: Commit**

```bash
git add test/perf/lib/driver_amortization.py test/perf/perf-amortization.sh test/perf/workflow-perf-amortization.yml test/perf/run-perf.sh test/perf/README.md
git commit -m "feat(perf): amortization deep-chain workflow + driver + runner wiring"
```

---

## Self-Review

**Spec coverage (amortization slice, §4.2):** deep single-column chain → Task 1 `amortization_chain`. Stresses topo-sort depth → the chain structure. Exact invariant (integer recurrence, deviation noted with rationale in Global Constraints) → `expected_final`; correctness assert reads the last cell numeric-tolerant → Task 2 driver. Depth sweep + 2-node sync + reporting → Task 2 driver + workflow + runner. e2e integration test → Task 2 Steps 7–8.

**Placeholder scan:** none — full code in every code step; sizes/depths concrete; `create_sheet`/`derive_active` return-shape handled defensively (isinstance unwrap + `json.loads` if str). Ports (`136xx`) chosen distinct from the financial workflow (`134xx`).

**Type consistency:** `amortization_chain(depth, principal, step) -> (ops, expected_final, last_cell)` used identically in Task 1 and Task 2. Reuses the exact `bench` names verified present (`node_client`, `timed_execute`, `apply_ops`, `derive_active`, `derive_all`, `wait_converged`, `format_summary`) and `generators` names (`a1`, `set_op`). Env var `SPREADSHEET_CTX` matches the workflow output key `spreadsheet_ctx`. Bundle path + merod image match the financial workflow.
