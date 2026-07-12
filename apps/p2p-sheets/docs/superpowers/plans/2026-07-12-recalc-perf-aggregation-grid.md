# Recalc perf — Aggregation dashboard + Dense grid scenarios (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining two perf scenarios from the 4-scenario spec — **Aggregation dashboard** (§4.3) and **Dense dependency grid** (§4.4) — on the already-proven `test/perf/` harness, each with a pure TDD generator plus driver/workflow/runner plumbing and an e2e run.

**Architecture:** Each scenario is a structural mirror of the shipped amortization slice: a pure generator in `test/perf/lib/generators.py` (unit-tested), a driver `test/perf/lib/driver_<scenario>.py`, a `/bin/sh` wrapper, a 2-node merobox workflow YAML (distinct ports), a `run-perf.sh` case, and a README findings row. `bench.py` is reused **entirely and untouched** (`node_client`, `timed_execute`, `apply_ops` chunk=40, `derive_active`, `derive_all`, `wait_converged`, `format_summary`).

**Tech Stack:** Python (stdlib only) + pytest for generators; merobox bootstrap YAML; merod node RPC (`apply_cell_ops`, `get_cells`, `get_all_cells`, `init_project`, `create_sheet`); Docker for the e2e.

## Global Constraints

- **Reuse `bench.py` verbatim** — no edits to `test/perf/lib/bench.py`. Both drivers import it and call `node_client`, `timed_execute`, `apply_ops` (chunk defaults to `APPLY_CHUNK=40`), `derive_active`, `derive_all`, `wait_converged`, `format_summary`.
- **Do not touch the financial or amortization slices** — their generators, drivers, workflows, and the financial/amortization `run-perf.sh` cases stay byte-for-byte unchanged. All work is additive.
- **`CellOp` wire shape** is `{"kind": "Set", "row": <int>, "col": <int>, "raw_value": <str>}` (via `generators.set_op`). Only `Set` ops are used.
- **Engine cell-ref limits (verified in `logic/crates/recalc/src/formula.rs`):**
  - `parse_cell_ref` accepts **single-letter columns only** (A..Z). Any individual ref to a column ≥ 26 (AA, AB, …) fails to parse → the dense grid MUST keep `cols <= 26`.
  - Whole-column range `A:A` expands only to `MAX_ROWS = 1000`. The aggregation panel MUST use **explicit** ranges (`A1:A{N}`), never `A:A`, so sizes > 1000 stay exact.
- **Exact invariants only** — integer/rational closed forms, compared numeric-tolerantly (`abs(float(got) - float(expected)) < 0.5`, and for the fractional AVERAGE a tolerance of `< 1e-6`). No f64-drift-prone recurrences.
- **Ports are per-scenario and must not collide.** Existing: financial `13428/13528`, amortization `13628/13728`. New: aggregation `13828/13928`, grid `14028/14128`.
- **Bundle path** is `logic/res/p2p-sheets-1.0.0.mpk`; merod image `ghcr.io/calimero-network/merod:0.11.0-rc.8`; node prefix `app-node`, count 2, `nuke_on_start/end: true`, `wait_timeout: 90`.
- **Modest size sweep** — apply is the known O(N²) bottleneck (chunked commits under the node's per-commit event/register caps), so top size ≈ 3000 cells, matching amortization. The interesting metric is **derive latency** (range expansion for aggregation; fan-out for the grid).

---

## File Structure

- `test/perf/lib/generators.py` — **add** `aggregation_dashboard` (Task 1) and `dense_grid` (Task 3). Existing functions untouched.
- `test/perf/lib/generators_test.py` — **add** tests for the two new generators. Existing tests untouched.
- `test/perf/lib/driver_aggregation.py` — **new** (Task 2). Mirror of `driver_amortization.py`.
- `test/perf/lib/driver_grid.py` — **new** (Task 4). Mirror of `driver_amortization.py`.
- `test/perf/perf-aggregation.sh`, `test/perf/perf-grid.sh` — **new** `/bin/sh` wrappers (Tasks 2, 4).
- `test/perf/workflow-perf-aggregation.yml`, `test/perf/workflow-perf-grid.yml` — **new** workflows (Tasks 2, 4).
- `test/perf/run-perf.sh` — **extend** the `case` with `aggregation`, `grid`, and add both to `all` (Tasks 2, 4).
- `test/perf/README.md` — **add** a scenarios line + a findings section per scenario (Tasks 2, 4).

---

## Task 1: Aggregation generator (pure, TDD)

**Files:**
- Modify: `test/perf/lib/generators.py` (append one function)
- Test: `test/perf/lib/generators_test.py` (append tests)

**Interfaces:**
- Consumes: existing `a1(row, col) -> str` and `set_op(row, col, raw) -> dict` from the same module.
- Produces: `aggregation_dashboard(size: int) -> (ops: list[dict], expected: dict, agg_cells: dict)` where `expected` maps `{"sum","average","count","max","min"}` → closed-form values and `agg_cells` maps the same keys → `(row, col)` coordinates. Task 2's driver consumes both dicts.

- [ ] **Step 1: Write the failing tests**

Append to `test/perf/lib/generators_test.py`:

```python
def test_aggregation_dashboard_shape_and_invariant():
    from generators import aggregation_dashboard
    ops, expected, cells = aggregation_dashboard(size=4)
    # 4 numeric inputs in column A rows 0..3, values 1..4
    inputs = [o for o in ops if not o["raw_value"].startswith("=")]
    assert [o["raw_value"] for o in inputs] == ["1", "2", "3", "4"]
    assert all(o["col"] == 0 for o in inputs)
    # 5 aggregation formulas over the EXPLICIT range A1:A4 (never whole-column A:A)
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops if o["raw_value"].startswith("=")}
    assert formulas[cells["sum"]] == "=SUM(A1:A4)"
    assert formulas[cells["average"]] == "=AVERAGE(A1:A4)"
    assert formulas[cells["count"]] == "=COUNT(A1:A4)"
    assert formulas[cells["max"]] == "=MAX(A1:A4)"
    assert formulas[cells["min"]] == "=MIN(A1:A4)"
    assert not any("A:A" in v for v in formulas.values())
    # closed forms for inputs 1..N
    assert expected["sum"] == 10        # 4*5/2
    assert expected["average"] == 2.5   # (4+1)/2
    assert expected["count"] == 4
    assert expected["max"] == 4
    assert expected["min"] == 1


def test_aggregation_dashboard_large_uses_explicit_range():
    from generators import aggregation_dashboard
    ops, expected, cells = aggregation_dashboard(size=2000)
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops if o["raw_value"].startswith("=")}
    # explicit endpoints past MAX_ROWS=1000 keep the sum exact
    assert formulas[cells["sum"]] == "=SUM(A1:A2000)"
    assert expected["sum"] == 2000 * 2001 // 2
    # input block + 5 aggregation cells
    assert len(ops) == 2000 + 5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -k aggregation -v`
Expected: FAIL with `ImportError: cannot import name 'aggregation_dashboard'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `test/perf/lib/generators.py`:

```python
def aggregation_dashboard(size: int):
    """A single column of `size` numeric inputs (values 1..size in column A, rows
    0..size-1) plus a 5-cell aggregation panel in column C over the range A1:A{size}:
    SUM, AVERAGE, COUNT, MAX, MIN.

    Uses an EXPLICIT range (A1:A{size}), not whole-column A:A: the engine caps
    whole-column expansion at MAX_ROWS=1000, so A:A would silently drop inputs once
    size>1000. Explicit endpoints keep every aggregate exact at any size.

    Inputs are the exact ramp 1..size so each aggregate has a closed form. Returns
    (ops, expected, agg_cells): `expected` maps {"sum","average","count","max","min"}
    to closed-form values, `agg_cells` maps the same keys to (row, col) coords."""
    ops = [set_op(r, 0, r + 1) for r in range(size)]
    rng = f"{a1(0, 0)}:{a1(size - 1, 0)}"  # A1:A{size}
    agg_col = 2  # column C — clear of the column-A data block
    panel = [
        ("sum", f"=SUM({rng})"),
        ("average", f"=AVERAGE({rng})"),
        ("count", f"=COUNT({rng})"),
        ("max", f"=MAX({rng})"),
        ("min", f"=MIN({rng})"),
    ]
    agg_cells = {}
    for i, (key, formula) in enumerate(panel):
        ops.append(set_op(i, agg_col, formula))
        agg_cells[key] = (i, agg_col)
    expected = {
        "sum": size * (size + 1) // 2,
        "average": (size + 1) / 2,
        "count": size,
        "max": size,
        "min": 1,
    }
    return ops, expected, agg_cells
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -v`
Expected: PASS — the two new aggregation tests plus all existing tests (financial + amortization) green.

- [ ] **Step 5: Commit**

```bash
git add test/perf/lib/generators.py test/perf/lib/generators_test.py
git commit -m "$(cat <<'EOF'
test(perf): aggregation_dashboard generator (SUM/AVERAGE/COUNT/MAX/MIN, exact ramp)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Aggregation driver + workflow + runner + e2e

**Files:**
- Create: `test/perf/lib/driver_aggregation.py`
- Create: `test/perf/perf-aggregation.sh`
- Create: `test/perf/workflow-perf-aggregation.yml`
- Modify: `test/perf/run-perf.sh`
- Modify: `test/perf/README.md`

**Interfaces:**
- Consumes: `generators.aggregation_dashboard` (Task 1); `bench.{node_client,timed_execute,apply_ops,derive_active,derive_all,wait_converged,format_summary}`.
- Produces: `test/perf/results/aggregation.json`; a `run-perf.sh aggregation` case.

- [ ] **Step 1: Create the driver**

Create `test/perf/lib/driver_aggregation.py` (mirror of `driver_amortization.py`; note it validates ALL FIVE aggregates):

```python
#!/usr/bin/env python3
"""Aggregation-dashboard perf sweep. Invoked by perf-aggregation.sh inside a
merobox `target: local` script step. Reads the context id from env SPREADSHEET_CTX
(or argv[1]) and two node names from argv[2:] (default app-node-1/2). One sheet:
a column-A data ramp + a 5-cell SUM/AVERAGE/COUNT/MAX/MIN panel over A1:A{N}."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # find generators/bench

import generators as g
import bench as b

# Size = number of column-A inputs. Modest top end (apply is the known O(N^2)
# bottleneck); the interesting metric is derive latency over a wide range.
SIZES = [
    {"label": "small", "size": 100},
    {"label": "medium", "size": 1000},
    {"label": "large", "size": 3000},
]
SMOKE = [{"label": "smoke", "size": 10}]


def _num(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def run():
    cid = os.environ.get("SPREADSHEET_CTX") or (sys.argv[1] if len(sys.argv) > 1 else "")
    node1 = sys.argv[2] if len(sys.argv) > 2 else "app-node-1"
    node2 = sys.argv[3] if len(sys.argv) > 3 else "app-node-2"
    if not cid:
        print("ERROR: no context id (SPREADSHEET_CTX / argv[1])", file=sys.stderr)
        return 1

    c1 = b.node_client(node1)
    c2 = b.node_client(node2)
    b.timed_execute(c1, cid, "init_project", {"name": "Perf: Aggregation"})

    sizes = SMOKE if os.environ.get("PERF_SMOKE") == "1" else SIZES
    rows_out = []
    ok = True
    cumulative_cells = 0

    for spec in sizes:
        size = spec["size"]
        out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": f"{spec['label']} Agg"})
        sheet_id = out if isinstance(out, str) else (out.get("id", out) if isinstance(out, dict) else out)
        if not isinstance(sheet_id, str) or not sheet_id:
            raise RuntimeError(f"unexpected create_sheet return: {out!r}")

        ops, expected, agg_cells = g.aggregation_dashboard(size)
        apply_ms, _ = b.apply_ops(c1, cid, sheet_id, ops)

        cells, derive_active_ms = b.derive_active(c1, cid, sheet_id)
        cells = json.loads(cells) if isinstance(cells, str) else cells
        _all, derive_all_ms = b.derive_all(c1, cid)
        cumulative_cells += size + 5  # inputs + 5 aggregation cells

        try:
            sync_ms = b.wait_converged(c2, cid, min_cells=cumulative_cells)
        except TimeoutError as e:
            print(f"  sync timeout: {e}", file=sys.stderr)
            sync_ms = -1.0

        # Correctness: every one of the 5 aggregates matches its closed form.
        by_coord = {(cell.get("row"), cell.get("col")): cell.get("computed_value")
                    for cell in (cells or [])}
        correct = True
        details = []
        for key, coord in agg_cells.items():
            got = _num(by_coord.get(coord))
            want = float(expected[key])
            tol = 1e-6 if key == "average" else 0.5
            hit = got is not None and abs(got - want) < tol
            correct = correct and hit
            details.append(f"{key}={by_coord.get(coord)}(want {expected[key]})")
        ok = ok and correct and sync_ms >= 0

        rows_out.append({
            "size": spec["label"], "input_cells": size, "formula_cells": 5,
            "apply_ms": round(apply_ms, 1),
            "derive_active_ms": round(derive_active_ms, 1),
            "derive_all_ms": round(derive_all_ms, 1),
            "sync_ms": round(sync_ms, 1), "correct": correct,
        })
        print(f"[{spec['label']}] size={size} apply={apply_ms:.0f}ms "
              f"derive_active={derive_active_ms:.0f}ms sync={sync_ms:.0f}ms "
              f"correct={correct} :: " + " ".join(details))

    print("\n" + b.format_summary(rows_out))
    results_dir = Path(__file__).resolve().parents[1] / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "aggregation.json").write_text(json.dumps(rows_out, indent=2))
    print(f"\nwrote {results_dir / 'aggregation.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 2: Create the `/bin/sh` wrapper**

Create `test/perf/perf-aggregation.sh`:

```sh
#!/bin/sh
# merobox `target: local` step entry. Runs the aggregation driver under merobox's
# own Python (has merobox + calimero_client_py), falling back to python3.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_aggregation.py"

PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
```

- [ ] **Step 3: Create the workflow YAML**

Create `test/perf/workflow-perf-aggregation.yml` — copy `workflow-perf-amortization.yml` and change only: `name`, `description`, `base_port: 13828`, `base_rpc_port: 13928`, the script step `name`, and `script: ./test/perf/perf-aggregation.sh`:

```yaml
# Aggregation-dashboard perf workflow. Boots 2 merod nodes, installs the
# p2p-sheets bundle, creates a shared context, joins node 2, then runs the
# aggregation size sweep via a local script step. Pre-flight: bash logic/build-bundle.sh.
name: p2p-sheets perf — aggregation
description: Wide SUM/AVERAGE/COUNT/MAX/MIN aggregates over a large range; time node-side apply/derive/sync across a size sweep.
log_level: info
nodes:
  count: 2
  prefix: app-node
  image: ghcr.io/calimero-network/merod:0.11.0-rc.8
  base_port: 13828
  base_rpc_port: 13928
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

  - type: script
    name: Run aggregation perf sweep (local)
    target: local
    script: ./test/perf/perf-aggregation.sh
    args:
      - '{{spreadsheet_ctx}}'
      - 'app-node-1'
      - 'app-node-2'
```

- [ ] **Step 4: Extend `run-perf.sh`**

In `test/perf/run-perf.sh`, update the usage comment and the `case`. Change the header comment's Usage line to include the new scenarios, and replace the `case` block so `aggregation` is dispatchable and included in `all`:

```bash
case "$SCENARIO" in
  financial)   run_one workflow-perf-financial.yml ;;
  amortization) run_one workflow-perf-amortization.yml ;;
  aggregation) run_one workflow-perf-aggregation.yml ;;
  all)         run_one workflow-perf-financial.yml; run_one workflow-perf-amortization.yml; run_one workflow-perf-aggregation.yml ;;
  *) echo "unknown scenario: $SCENARIO (want financial|amortization|aggregation|all)" >&2; exit 2 ;;
esac
```

Also update the usage comment line to: `# Usage: run-perf.sh [financial|amortization|aggregation|all]   (default: all)`

- [ ] **Step 5: Make the wrapper executable**

Run: `chmod +x test/perf/perf-aggregation.sh`

- [ ] **Step 6: Run the e2e (smoke first, then full sweep)**

Requires Docker running. From the repo root:

Run: `PERF_SMOKE=1 bash test/perf/run-perf.sh aggregation`
Expected: workflow boots 2 nodes, applies the smoke sheet (size=10), prints `[smoke] size=10 ... correct=True` with all five aggregates matching (sum=55, average=5.5, count=10, max=10, min=1), writes `results/aggregation.json`, exit 0.

Then the full sweep:

Run: `bash test/perf/run-perf.sh aggregation`
Expected: all three sizes `correct=True`; a markdown summary table; exit 0. Record the apply/derive/sync numbers.

If a size fails correctness, STOP and debug (do not tune tolerances to force green). Likely suspects: wrong range endpoints, or `computed_value` string parse — investigate via the printed `details`.

- [ ] **Step 7: Add README findings**

In `test/perf/README.md`: add the aggregation scenario to the Scenarios list, and append a "Findings (aggregation)" section with the size×metric table from Step 6 and a one-line takeaway (range-derive latency vs. size).

- [ ] **Step 8: Commit**

```bash
git add test/perf/lib/driver_aggregation.py test/perf/perf-aggregation.sh \
        test/perf/workflow-perf-aggregation.yml test/perf/run-perf.sh \
        test/perf/README.md test/perf/results/aggregation.json
git commit -m "$(cat <<'EOF'
feat(perf): aggregation-dashboard scenario (e2e green)

Wide SUM/AVERAGE/COUNT/MAX/MIN over an explicit A1:A{N} range (whole-column
A:A caps at MAX_ROWS=1000, so explicit endpoints keep large sizes exact).
Driver validates all five aggregates against closed forms. Ports 13828/13928.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Dense-grid generator (pure, TDD)

**Files:**
- Modify: `test/perf/lib/generators.py` (append one function)
- Test: `test/perf/lib/generators_test.py` (append tests)

**Interfaces:**
- Consumes: existing `a1`, `set_op`.
- Produces: `dense_grid(rows: int, cols: int) -> (ops: list[dict], expected_bottom_right: int, last_cell: tuple)`. Task 4's driver consumes all three.

**Design note (deviations from spec §4.4, intentional):**
1. The spec's pure `up + left` binomial recurrence produces `C(r+c, r)` — which exceeds f64 exact-integer range (`2^53`) past ~27 rows, so its bottom-right invariant can't be verified. This uses an **inclusion-exclusion prefix-sum** instead: `P(r,c) = up + left − diag + 1` with `P(0,0)=1`, giving `P(r,c) = (r+1)(c+1)` exactly, bottom-right `= rows*cols` — bounded and exact at any size, with the same up/left fan-out plus one diagonal ref (an *extra* precedent, so if anything a heavier derive).
2. `cols` is capped at 26 — the engine's `parse_cell_ref` only accepts single-letter columns; grow rows (not cols) for cell count.
3. Seeds (row 0 / col 0) are a `1..n` ramp via `=neighbor+1` formulas rather than constant 1s — a consequence of the prefix-sum reformulation; it also maximizes formula count (only `P(0,0)` is a literal), which is exactly the "total formula count" stress the scenario targets.

- [ ] **Step 1: Write the failing tests**

Append to `test/perf/lib/generators_test.py`:

```python
def test_dense_grid_shape_and_invariant():
    from generators import dense_grid
    ops, expected, last = dense_grid(rows=3, cols=3)
    by_coord = {(o["row"], o["col"]): o["raw_value"] for o in ops}
    assert by_coord[(0, 0)] == "1"           # sole literal seed
    assert by_coord[(0, 1)] == "=A1+1"       # row-0 ramp: left + 1
    assert by_coord[(0, 2)] == "=B1+1"
    assert by_coord[(1, 0)] == "=A1+1"       # col-0 ramp: up + 1
    assert by_coord[(2, 0)] == "=A2+1"
    assert by_coord[(1, 1)] == "=B1+A2-A1+1"  # up + left - diag + 1
    assert by_coord[(2, 2)] == "=C2+B3-B2+1"
    assert len(ops) == 9                      # 3x3, one op per cell
    # P(r,c) = (r+1)(c+1) -> bottom-right = rows*cols
    assert expected == 9
    assert last == (2, 2)


def test_dense_grid_rectangular_and_bottom_right():
    from generators import dense_grid
    ops, expected, last = dense_grid(rows=5, cols=4)
    assert len(ops) == 20
    assert expected == 20      # 5*4
    assert last == (4, 3)


def test_dense_grid_rejects_multiletter_columns():
    import pytest
    from generators import dense_grid
    with pytest.raises(ValueError):
        dense_grid(rows=3, cols=27)  # col 26 = "AA" — parser can't read it
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -k dense_grid -v`
Expected: FAIL with `ImportError: cannot import name 'dense_grid'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `test/perf/lib/generators.py`:

```python
def dense_grid(rows: int, cols: int):
    """An R×C cumulative prefix-sum table (stresses total formula count + per-cell
    dependency fan-out in one derive pass). Each interior cell is
    P(r,c) = up + left - diag + 1 (inclusion-exclusion), row 0 and col 0 are
    `=neighbor+1` ramps, and P(0,0)=1 is the sole literal. Hence P(r,c)=(r+1)(c+1)
    exactly and the bottom-right cell = rows*cols.

    Deviations from the spec's pure up+left binomial recurrence: (1) the binomial
    form C(r+c,r) overflows f64 exact-integer range past ~27 rows, so this
    prefix-sum keeps the invariant exact at any size (same up/left fan-out + 1 diag
    ref). (2) cols is capped at 26 — the engine's cell-ref parser only accepts
    single-letter columns (A..Z); grow rows for larger cell counts.

    Ops are emitted row-major so every precedent precedes its dependant. Returns
    (ops, expected_bottom_right, last_cell)."""
    if cols > 26:
        raise ValueError(f"cols must be <= 26 (single-letter columns), got {cols}")
    ops = []
    for r in range(rows):
        for c in range(cols):
            if r == 0 and c == 0:
                ops.append(set_op(0, 0, 1))
            elif r == 0:
                ops.append(set_op(0, c, f"={a1(0, c - 1)}+1"))
            elif c == 0:
                ops.append(set_op(r, 0, f"={a1(r - 1, 0)}+1"))
            else:
                up, left, diag = a1(r - 1, c), a1(r, c - 1), a1(r - 1, c - 1)
                ops.append(set_op(r, c, f"={up}+{left}-{diag}+1"))
    return ops, rows * cols, (rows - 1, cols - 1)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -v`
Expected: PASS — the three new dense-grid tests plus all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add test/perf/lib/generators.py test/perf/lib/generators_test.py
git commit -m "$(cat <<'EOF'
test(perf): dense_grid generator (prefix-sum table, exact bottom-right=R*C)

Prefix-sum recurrence (up+left-diag+1) instead of the binomial up+left form,
which overflows f64 exactness past ~27 rows. Cols capped at 26 (single-letter
column parser). Bottom-right invariant = rows*cols.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Dense-grid driver + workflow + runner + e2e

**Files:**
- Create: `test/perf/lib/driver_grid.py`
- Create: `test/perf/perf-grid.sh`
- Create: `test/perf/workflow-perf-grid.yml`
- Modify: `test/perf/run-perf.sh`
- Modify: `test/perf/README.md`

**Interfaces:**
- Consumes: `generators.dense_grid` (Task 3); the same `bench` functions.
- Produces: `test/perf/results/grid.json`; a `run-perf.sh grid` case.

**Sizing:** `cols` fixed at ≤ 26; grow rows for cell count. Sweep: small `10×10` (100 cells), medium `32×26` (832), large `120×26` (3120) — top end ≈ amortization's, since apply dominates. Smoke: `4×4` (16). `input_cells = 1` (the sole literal seed), `formula_cells = rows*cols - 1`.

- [ ] **Step 1: Create the driver**

Create `test/perf/lib/driver_grid.py`:

```python
#!/usr/bin/env python3
"""Dense-grid (cumulative prefix-sum) perf sweep. Invoked by perf-grid.sh inside a
merobox `target: local` script step. Reads the context id from env SPREADSHEET_CTX
(or argv[1]) and two node names from argv[2:] (default app-node-1/2). One sheet per
size: an R×C table where each cell = up+left-diag+1, bottom-right = R*C."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # find generators/bench

import generators as g
import bench as b

# cols<=26 (single-letter column parser); grow rows for cell count. Top end
# matches amortization (apply is the known O(N^2) bottleneck); the metric of
# interest is derive fan-out over every filled cell.
SIZES = [
    {"label": "small", "rows": 10, "cols": 10},
    {"label": "medium", "rows": 32, "cols": 26},
    {"label": "large", "rows": 120, "cols": 26},
]
SMOKE = [{"label": "smoke", "rows": 4, "cols": 4}]


def run():
    cid = os.environ.get("SPREADSHEET_CTX") or (sys.argv[1] if len(sys.argv) > 1 else "")
    node1 = sys.argv[2] if len(sys.argv) > 2 else "app-node-1"
    node2 = sys.argv[3] if len(sys.argv) > 3 else "app-node-2"
    if not cid:
        print("ERROR: no context id (SPREADSHEET_CTX / argv[1])", file=sys.stderr)
        return 1

    c1 = b.node_client(node1)
    c2 = b.node_client(node2)
    b.timed_execute(c1, cid, "init_project", {"name": "Perf: Dense Grid"})

    sizes = SMOKE if os.environ.get("PERF_SMOKE") == "1" else SIZES
    rows_out = []
    ok = True
    cumulative_cells = 0

    for spec in sizes:
        nrows, ncols = spec["rows"], spec["cols"]
        n_cells = nrows * ncols
        out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": f"{spec['label']} Grid"})
        sheet_id = out if isinstance(out, str) else (out.get("id", out) if isinstance(out, dict) else out)
        if not isinstance(sheet_id, str) or not sheet_id:
            raise RuntimeError(f"unexpected create_sheet return: {out!r}")

        ops, expected, (lr, lc) = g.dense_grid(nrows, ncols)
        apply_ms, _ = b.apply_ops(c1, cid, sheet_id, ops)

        cells, derive_active_ms = b.derive_active(c1, cid, sheet_id)
        cells = json.loads(cells) if isinstance(cells, str) else cells
        _all, derive_all_ms = b.derive_all(c1, cid)
        cumulative_cells += n_cells  # every cell in the grid is filled

        try:
            sync_ms = b.wait_converged(c2, cid, min_cells=cumulative_cells)
        except TimeoutError as e:
            print(f"  sync timeout: {e}", file=sys.stderr)
            sync_ms = -1.0

        # Correctness: bottom-right cell equals rows*cols (numeric-tolerant).
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
            "size": spec["label"], "input_cells": 1, "formula_cells": n_cells - 1,
            "apply_ms": round(apply_ms, 1),
            "derive_active_ms": round(derive_active_ms, 1),
            "derive_all_ms": round(derive_all_ms, 1),
            "sync_ms": round(sync_ms, 1), "correct": correct,
        })
        print(f"[{spec['label']}] {nrows}x{ncols}={n_cells} apply={apply_ms:.0f}ms "
              f"derive_active={derive_active_ms:.0f}ms sync={sync_ms:.0f}ms "
              f"correct={correct} (want {expected}, got {got})")

    print("\n" + b.format_summary(rows_out))
    results_dir = Path(__file__).resolve().parents[1] / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "grid.json").write_text(json.dumps(rows_out, indent=2))
    print(f"\nwrote {results_dir / 'grid.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 2: Create the `/bin/sh` wrapper**

Create `test/perf/perf-grid.sh`:

```sh
#!/bin/sh
# merobox `target: local` step entry. Runs the dense-grid driver under merobox's
# own Python (has merobox + calimero_client_py), falling back to python3.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_grid.py"

PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
```

- [ ] **Step 3: Create the workflow YAML**

Create `test/perf/workflow-perf-grid.yml` — copy `workflow-perf-amortization.yml`, change only `name`, `description`, `base_port: 14028`, `base_rpc_port: 14128`, script step `name`, and `script: ./test/perf/perf-grid.sh`:

```yaml
# Dense-grid perf workflow. Boots 2 merod nodes, installs the p2p-sheets bundle,
# creates a shared context, joins node 2, then runs the grid size sweep via a
# local script step. Pre-flight: bash logic/build-bundle.sh.
name: p2p-sheets perf — dense grid
description: R×C cumulative prefix-sum table (up+left-diag+1); time node-side apply/derive/sync across a size sweep.
log_level: info
nodes:
  count: 2
  prefix: app-node
  image: ghcr.io/calimero-network/merod:0.11.0-rc.8
  base_port: 14028
  base_rpc_port: 14128
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

  - type: script
    name: Run dense-grid perf sweep (local)
    target: local
    script: ./test/perf/perf-grid.sh
    args:
      - '{{spreadsheet_ctx}}'
      - 'app-node-1'
      - 'app-node-2'
```

- [ ] **Step 4: Extend `run-perf.sh`**

In `test/perf/run-perf.sh`, add `grid` to the `case` and to `all`, and update the usage/error text:

```bash
case "$SCENARIO" in
  financial)   run_one workflow-perf-financial.yml ;;
  amortization) run_one workflow-perf-amortization.yml ;;
  aggregation) run_one workflow-perf-aggregation.yml ;;
  grid)        run_one workflow-perf-grid.yml ;;
  all)         run_one workflow-perf-financial.yml; run_one workflow-perf-amortization.yml; run_one workflow-perf-aggregation.yml; run_one workflow-perf-grid.yml ;;
  *) echo "unknown scenario: $SCENARIO (want financial|amortization|aggregation|grid|all)" >&2; exit 2 ;;
esac
```

Update the usage comment to: `# Usage: run-perf.sh [financial|amortization|aggregation|grid|all]   (default: all)`

- [ ] **Step 5: Make the wrapper executable**

Run: `chmod +x test/perf/perf-grid.sh`

- [ ] **Step 6: Run the e2e (smoke, then full sweep)**

Requires Docker. From repo root:

Run: `PERF_SMOKE=1 bash test/perf/run-perf.sh grid`
Expected: `[smoke] 4x4=16 ... correct=True (want 16, got 16)`, writes `results/grid.json`, exit 0.

Then: `bash test/perf/run-perf.sh grid`
Expected: all three sizes `correct=True` (bottom-right = rows*cols: 100, 832, 3120); summary table; exit 0. Record numbers.

If a size fails correctness, STOP and debug — do not loosen the tolerance. Likely suspect: a formula ref shape or topological ordering issue in the generator (but Task 3's tests should have caught that) or a `computed_value` parse.

- [ ] **Step 7: Add README findings**

In `test/perf/README.md`: add the dense-grid scenario to the Scenarios list, and append a "Findings (dense grid)" section with the size×metric table and a one-line takeaway (fan-out derive cost).

- [ ] **Step 8: Commit**

```bash
git add test/perf/lib/driver_grid.py test/perf/perf-grid.sh \
        test/perf/workflow-perf-grid.yml test/perf/run-perf.sh \
        test/perf/README.md test/perf/results/grid.json
git commit -m "$(cat <<'EOF'
feat(perf): dense-grid scenario (prefix-sum table, e2e green)

R×C cumulative table (up+left-diag+1), bottom-right invariant = rows*cols.
Cols capped at 26 (single-letter cell-ref parser); rows grow for cell count.
Ports 14028/14128.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

- **Spec coverage:** §4.3 Aggregation → Tasks 1-2 (SUM/AVERAGE/COUNT/MAX/MIN over a large range, invariant SUM=N(N+1)/2 and matching aggregates). §4.4 Dense grid → Tasks 3-4 (cumulative table, bottom-right invariant). §5 two-node sync → both drivers via `wait_converged`. §3.4 reporting → per-scenario `results/*.json` + `format_summary` table. Whole-column `A:A` form (§4.3) intentionally dropped in favor of explicit ranges — documented deviation (MAX_ROWS=1000 cap); binomial recurrence (§4.4) replaced by exact prefix-sum — documented deviation (f64 overflow).
- **Placeholder scan:** none — every step has concrete code or an exact command.
- **Type consistency:** `aggregation_dashboard` returns `(ops, expected: dict, agg_cells: dict)`; driver consumes `expected[key]`/`agg_cells[key]` with matching keys `sum/average/count/max/min`. `dense_grid` returns `(ops, expected: int, last_cell: tuple)`; driver unpacks `(ops, expected, (lr, lc))`. Both match `bench` signatures used verbatim by the amortization driver.
