# Recalc Perf — Financial Model Workflow (first slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first vertical slice of the merobox perf suite — a Financial-model (P&L) workflow that feeds heavy workbooks to two merod nodes and times node-side apply / derive / sync across a size sweep — establishing the shared harness the other three scenarios reuse.

**Architecture:** A pure Python load generator (`generators.py`) builds `apply_cell_ops` batches + expected invariants; a `bench.py` library wraps merobox's authenticated node client with timed calls, chunked apply, derive, sync-poll, and a reporter; a `driver_financial.py` orchestrates the sweep; a thin `.sh` wrapper lets a merobox `target: local` script step run it. The workflow YAML boots 2 nodes, installs the bundle, creates a context, joins node 2, then runs the driver. Pure code is unit-tested (pytest); the workflow is the e2e integration test against real dockerized merod nodes.

**Tech Stack:** Python 3 (pytest), merobox (`merobox.commands.client.get_client_for_node`, `calimero_client_py`), dockerized merod via merobox workflows.

## Global Constraints

- **Node-side only.** This measures the merod native `recalc` engine (`apply_cell_ops` / `get_cells` / `get_all_cells`), NOT the client WASM.
- **Node client:** `from merobox.commands.client import get_client_for_node`; `client, _rpc = get_client_for_node(node_name)`; call methods with `client.execute_function(context_id=<str>, method=<str>, args=<JSON string>)` (args is `json.dumps(dict)`). Do NOT hand-manage tokens or executor keys — the client does.
- **`local` script step runs `/bin/sh <script> <args>`** (no shebang) and injects each workflow dynamic value as an UPPERCASED env var (`spreadsheet_ctx` → `SPREADSHEET_CTX`). So the step target is a `.sh` wrapper that execs Python via merobox's interpreter.
- **CellOp wire shape:** `{"kind": "Set", "row": <int>, "col": <int>, "raw_value": <str>}` (also `{"kind":"Format",...,"format":<str>}`, `{"kind":"Clear","row","col"}`). `apply_cell_ops` args: `{"sheet_id": <str>, "ops": [CellOp, ...]}`.
- **Cross-sheet reference formula:** `=[<sheet_id>]!<A1>` (bracket-id form the engine resolves).
- **merod image:** `ghcr.io/calimero-network/merod:0.11.0-rc.8` (matches `test/spec-smoke.workflow.yml`). **Bundle:** `logic/res/p2p-sheets-1.0.0.mpk` (built by `logic/build-bundle.sh`; `service_name: spreadsheet`).
- **2 nodes**, `nuke_on_start: true`, `nuke_on_end: true`.
- **Do not push.** Commit locally per task.

---

## File Structure

```
test/perf/
  lib/
    generators.py         # PURE: build financial CellOp batches + expected invariants
    generators_test.py    # unit tests (pytest)
    bench.py              # node client + timed execute + chunked apply + derive + sync-poll + reporter
    bench_test.py         # unit tests for the PURE parts (chunking, markdown table)
    driver_financial.py   # orchestrates the financial sweep (uses generators + bench)
  perf-financial.sh       # /bin/sh wrapper: exec merobox-python driver_financial.py "$@"
  workflow-perf-financial.yml  # 2-node bootstrap + one local script step
  run-perf.sh             # build bundle if missing; run the financial workflow
  results/.gitignore      # ignore generated summary.json / financial.json
  README.md               # how to run + what it measures
```

---

## Global interfaces (names used across tasks)

`generators.py`:
- `a1(row: int, col: int) -> str` — 0-based (row,col) → A1 (e.g. (0,0)→"A1", (0,26)→"AA1").
- `set_op(row, col, raw) -> dict` → `{"kind":"Set","row":row,"col":col,"raw_value":str(raw)}`.
- `@dataclass DataSheet: ops: list[dict]; grand_total_cell: tuple[int,int]; input_sum: int`
- `financial_data_sheet(rows: int, cols: int) -> DataSheet` — inputs + per-row `=SUM` totals + per-col `=SUM` totals + grand total.
- `financial_summary(entries: list[tuple[str, tuple[int,int]]]) -> list[dict]` — for each `(sheet_id,(r,c))` a cross-ref cell `=[sheet_id]!<a1(r,c)>`, then a summary grand total `=SUM(<its ref cells>)`.
- `SUMMARY_TOTAL_CELL: tuple[int,int]` — coord of the summary grand-total cell (constant, e.g. `(0,1)` col B row 1 area — defined in Task 1).

`bench.py`:
- `node_client(node_name: str)` → the calimero client (via `get_client_for_node`).
- `timed_execute(client, cid: str, method: str, args: dict) -> tuple[Any, float]` → `(output, elapsed_ms)`.
- `apply_ops(client, cid: str, sheet_id: str, ops: list[dict], chunk_size: int = 2000) -> tuple[float, int]` → `(total_ms, n_chunks)`.
- `chunked(seq: list, size: int) -> list[list]` (pure).
- `derive_active(client, cid, sheet_id) -> tuple[list, float]` (get_cells); `derive_all(client, cid) -> tuple[list, float]` (get_all_cells).
- `wait_converged(client2, cid: str, min_cells: int, timeout_s: float = 60.0) -> float` — poll `get_all_cells` on node 2 until it has ≥ `min_cells`; returns ms (or raises on timeout).
- `format_summary(rows: list[dict]) -> str` (pure markdown table).

---

### Task 1: Financial load generator (pure, TDD)

**Files:**
- Create: `test/perf/lib/generators.py`, `test/perf/lib/generators_test.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `a1`, `set_op`, `DataSheet`, `financial_data_sheet`, `financial_summary`, `SUMMARY_TOTAL_CELL` (see Global interfaces).

- [ ] **Step 1: Write the failing tests**

`test/perf/lib/generators_test.py`:

```python
import re
from generators import (
    a1, set_op, financial_data_sheet, financial_summary, SUMMARY_TOTAL_CELL,
)


def test_a1_conversion():
    assert a1(0, 0) == "A1"
    assert a1(0, 25) == "Z1"
    assert a1(0, 26) == "AA1"
    assert a1(4, 2) == "C5"


def test_set_op_shape():
    assert set_op(1, 2, 7) == {"kind": "Set", "row": 1, "col": 2, "raw_value": "7"}


def test_data_sheet_counts_and_sum():
    # 3x4 inputs → rows=3,cols=4. Layout: inputs in rows 0..2 x cols 0..3;
    # per-row total in col 4; per-col total in row 3; grand total at (3,4).
    ds = financial_data_sheet(rows=3, cols=4)
    kinds = [o["kind"] for o in ds.ops]
    assert set(kinds) == {"Set"}
    inputs = [o for o in ds.ops if not o["raw_value"].startswith("=")]
    formulas = [o for o in ds.ops if o["raw_value"].startswith("=")]
    assert len(inputs) == 12          # 3*4 numeric inputs
    assert len(formulas) == 3 + 4 + 1  # 3 row totals + 4 col totals + grand total
    # input_sum equals the arithmetic sum of the numeric inputs
    assert ds.input_sum == sum(int(o["raw_value"]) for o in inputs)
    assert ds.grand_total_cell == (3, 4)
    # each row-total is a SUM over that row's input range
    row0_total = next(o for o in ds.ops if o["row"] == 0 and o["col"] == 4)
    assert row0_total["raw_value"] == "=SUM(A1:D1)"


def test_summary_cross_refs():
    ops = financial_summary([("sheet-abc", (3, 4)), ("sheet-def", (5, 2))])
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops}
    # one cross-ref per entry, using bracket-id form at the entry's grand-total cell
    assert formulas[(0, 0)] == "=[sheet-abc]!E4"
    assert formulas[(1, 0)] == "=[sheet-def]!C6"
    # summary grand total sums the two ref cells and lives at SUMMARY_TOTAL_CELL
    assert formulas[SUMMARY_TOTAL_CELL].startswith("=SUM(")
    assert "A1" in formulas[SUMMARY_TOTAL_CELL] and "A2" in formulas[SUMMARY_TOTAL_CELL]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'generators'`.

- [ ] **Step 3: Implement `generators.py`**

`test/perf/lib/generators.py`:

```python
"""Pure load generators for the perf workflows: build apply_cell_ops batches
and the expected correctness invariant. No I/O, no node calls."""
from dataclasses import dataclass


def a1(row: int, col: int) -> str:
    """0-based (row, col) -> A1 string. (0,0)->A1, (0,26)->AA1."""
    s = ""
    c = col
    while True:
        s = chr(ord("A") + (c % 26)) + s
        c = c // 26 - 1
        if c < 0:
            break
    return f"{s}{row + 1}"


def set_op(row: int, col: int, raw) -> dict:
    return {"kind": "Set", "row": row, "col": col, "raw_value": str(raw)}


@dataclass
class DataSheet:
    ops: list          # list[CellOp dict]
    grand_total_cell: tuple  # (row, col)
    input_sum: int


def financial_data_sheet(rows: int, cols: int) -> DataSheet:
    """A P&L data sheet: `rows`x`cols` numeric inputs, a per-row SUM total in the
    column after the inputs, a per-col SUM total in the row after the inputs, and
    a grand total at their intersection. Inputs are a deterministic 1..N ramp so
    the invariant is exact."""
    ops = []
    total_col = cols       # totals column sits just past the inputs
    total_row = rows       # totals row sits just past the inputs
    input_sum = 0
    n = 0
    for r in range(rows):
        for c in range(cols):
            n += 1
            input_sum += n
            ops.append(set_op(r, c, n))
    # per-row totals: =SUM(A{r}:<lastcol>{r})
    for r in range(rows):
        ops.append(set_op(r, total_col, f"=SUM({a1(r,0)}:{a1(r,cols-1)})"))
    # per-col totals: =SUM(<col>1:<col>{rows})
    for c in range(cols):
        ops.append(set_op(total_row, c, f"=SUM({a1(0,c)}:{a1(rows-1,c)})"))
    # grand total: sum of the row totals
    ops.append(set_op(total_row, total_col,
                      f"=SUM({a1(0,total_col)}:{a1(rows-1,total_col)})"))
    return DataSheet(ops=ops, grand_total_cell=(total_row, total_col), input_sum=input_sum)


# Summary sheet: cross-ref cells go in column A (rows 0..k-1); the grand total
# lives in column B, row 0 — a fixed, out-of-the-way coordinate.
SUMMARY_TOTAL_CELL = (0, 1)


def financial_summary(entries) -> list:
    """entries: list[(sheet_id, (row,col))]. One cross-ref cell per entry in
    column A referencing that sheet's grand total, then a grand SUM over those
    ref cells at SUMMARY_TOTAL_CELL."""
    ops = []
    for i, (sheet_id, (r, c)) in enumerate(entries):
        ops.append(set_op(i, 0, f"=[{sheet_id}]!{a1(r, c)}"))
    first = a1(0, 0)
    last = a1(len(entries) - 1, 0)
    ops.append(set_op(SUMMARY_TOTAL_CELL[0], SUMMARY_TOTAL_CELL[1],
                      f"=SUM({first}:{last})"))
    return ops
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd test/perf/lib && python3 -m pytest generators_test.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add test/perf/lib/generators.py test/perf/lib/generators_test.py
git commit -m "feat(perf): pure financial-model load generator + invariants"
```

---

### Task 2: bench.py — node client, timed execute, chunked apply, derive, sync, reporter

**Files:**
- Create: `test/perf/lib/bench.py`, `test/perf/lib/bench_test.py`

**Interfaces:**
- Consumes: `merobox.commands.client.get_client_for_node`.
- Produces: `node_client`, `timed_execute`, `apply_ops`, `chunked`, `derive_active`, `derive_all`, `wait_converged`, `format_summary` (see Global interfaces).

- [ ] **Step 1: Write failing tests for the pure helpers**

`test/perf/lib/bench_test.py`:

```python
from bench import chunked, format_summary


def test_chunked_splits_evenly_and_remainder():
    assert chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert chunked([], 2) == []
    assert chunked([1, 2], 5) == [[1, 2]]


def test_format_summary_is_markdown_table_with_rows():
    rows = [
        {"size": "small", "input_cells": 12, "formula_cells": 8,
         "apply_ms": 5.1, "derive_active_ms": 1.2, "derive_all_ms": 1.4,
         "sync_ms": 30.0, "correct": True},
    ]
    out = format_summary(rows)
    assert "| size | input_cells |" in out          # header
    assert "| small | 12 |" in out                    # row
    assert out.count("\n") >= 3                        # header + separator + >=1 row
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd test/perf/lib && python3 -m pytest bench_test.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'bench'`.

- [ ] **Step 3: Implement `bench.py`**

`test/perf/lib/bench.py`:

```python
"""Node-side timing harness for the perf workflows. Wraps merobox's authenticated
node client with timed calls, chunked apply, derive, sync-poll, and a reporter."""
import json
import time

from merobox.commands.client import get_client_for_node

COLUMNS = ["size", "input_cells", "formula_cells", "apply_ms",
           "derive_active_ms", "derive_all_ms", "sync_ms", "correct"]


def chunked(seq, size):
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def node_client(node_name):
    client, _rpc = get_client_for_node(node_name)
    return client


def _output(res):
    """Normalize execute_function's return to the method's `output` payload.
    The client may return a dict {"output": ...} / {"result": {"output": ...}}
    or an object; unwrap defensively."""
    if isinstance(res, dict):
        if "output" in res:
            return res["output"]
        if "result" in res and isinstance(res["result"], dict):
            return res["result"].get("output", res["result"])
        return res
    return getattr(res, "output", res)


def timed_execute(client, cid, method, args):
    t0 = time.perf_counter()
    res = client.execute_function(context_id=cid, method=method, args=json.dumps(args))
    ms = (time.perf_counter() - t0) * 1000.0
    return _output(res), ms


def apply_ops(client, cid, sheet_id, ops, chunk_size=2000):
    """Apply ops via apply_cell_ops. One call when it fits chunk_size, else split
    into chunks (each a commit) — total wall-clock summed. Returns (ms, n_chunks)."""
    batches = chunked(ops, chunk_size) if chunk_size and len(ops) > chunk_size else [ops]
    total = 0.0
    for batch in batches:
        _, ms = timed_execute(client, cid, "apply_cell_ops",
                              {"sheet_id": sheet_id, "ops": batch})
        total += ms
    return total, len(batches)


def derive_active(client, cid, sheet_id):
    out, ms = timed_execute(client, cid, "get_cells", {"sheet_id": sheet_id})
    return out, ms


def derive_all(client, cid):
    out, ms = timed_execute(client, cid, "get_all_cells", {})
    return out, ms


def wait_converged(client2, cid, min_cells, timeout_s=60.0):
    """Poll node 2's get_all_cells until it reports >= min_cells. Returns ms."""
    t0 = time.perf_counter()
    while True:
        out, _ = timed_execute(client2, cid, "get_all_cells", {})
        if isinstance(out, list) and len(out) >= min_cells:
            return (time.perf_counter() - t0) * 1000.0
        if time.perf_counter() - t0 > timeout_s:
            raise TimeoutError(
                f"node 2 did not reach {min_cells} cells within {timeout_s}s "
                f"(saw {len(out) if isinstance(out, list) else out})")
        time.sleep(0.25)


def format_summary(rows):
    header = "| " + " | ".join(COLUMNS) + " |"
    sep = "| " + " | ".join("---" for _ in COLUMNS) + " |"
    lines = [header, sep]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(c, "")) for c in COLUMNS) + " |")
    return "\n".join(lines)
```

- [ ] **Step 4: Run to verify the pure tests pass**

Run: `cd test/perf/lib && python3 -m pytest bench_test.py -q`
Expected: PASS (2 tests). (The live functions — `node_client`, `timed_execute`, `apply_ops`, `derive_*`, `wait_converged` — are covered by the Task 4 e2e, not unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add test/perf/lib/bench.py test/perf/lib/bench_test.py
git commit -m "feat(perf): bench harness — timed execute, chunked apply, derive, sync-poll, reporter"
```

---

### Task 3: Financial driver + shell wrapper

**Files:**
- Create: `test/perf/lib/driver_financial.py`, `test/perf/perf-financial.sh`

**Interfaces:**
- Consumes: `generators` (Task 1), `bench` (Task 2). Reads env `SPREADSHEET_CTX`; argv `[context_id?, node1, node2]`.
- Produces: writes `test/perf/results/financial.json`; prints a markdown table. Exit code 0 on success (all sizes correct), 1 on any incorrect/failed size.

- [ ] **Step 1: Write the driver**

`test/perf/lib/driver_financial.py`:

```python
#!/usr/bin/env python3
"""Financial-model perf sweep. Invoked by perf-financial.sh inside a merobox
`target: local` script step. Reads the context id from env SPREADSHEET_CTX (or
argv[1]) and the two node names from argv[2:] (default app-node-1/2)."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # find generators/bench

import generators as g
import bench as b

# Size sweep — one-line editable. Kept modest for the first slice; push rows/cols
# /sheets up (toward ~10k cells) once the pipeline is validated.
SIZES = [
    {"label": "small",  "sheets": 1, "rows": 5,  "cols": 5},
    {"label": "medium", "sheets": 3, "rows": 15, "cols": 12},
    {"label": "large",  "sheets": 5, "rows": 30, "cols": 25},
]
# A tiny size used by the e2e smoke run (env PERF_SMOKE=1 collapses the sweep).
SMOKE = [{"label": "smoke", "sheets": 1, "rows": 4, "cols": 4}]


def run():
    cid = os.environ.get("SPREADSHEET_CTX") or (sys.argv[1] if len(sys.argv) > 1 else "")
    node1 = sys.argv[2] if len(sys.argv) > 2 else "app-node-1"
    node2 = sys.argv[3] if len(sys.argv) > 3 else "app-node-2"
    if not cid:
        print("ERROR: no context id (SPREADSHEET_CTX / argv[1])", file=sys.stderr)
        return 1

    c1 = b.node_client(node1)
    c2 = b.node_client(node2)
    b.timed_execute(c1, cid, "init_project", {"name": "Perf: Financial"})

    sizes = SMOKE if os.environ.get("PERF_SMOKE") == "1" else SIZES
    rows_out = []
    ok = True
    total_cells_seen = 0

    for spec in sizes:
        apply_ms = 0.0
        entries = []          # (sheet_id, grand_total_cell) for the summary
        expected = 0
        input_cells = 0
        formula_cells = 0

        for s in range(spec["sheets"]):
            out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": f"Data {s+1}"})
            sheet_id = out if isinstance(out, str) else out.get("id", out)
            ds = g.financial_data_sheet(spec["rows"], spec["cols"])
            ms, _ = b.apply_ops(c1, cid, sheet_id, ds.ops)
            apply_ms += ms
            entries.append((sheet_id, ds.grand_total_cell))
            expected += ds.input_sum
            input_cells += spec["rows"] * spec["cols"]
            formula_cells += len(ds.ops) - spec["rows"] * spec["cols"]

        out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": "Summary"})
        summary_id = out if isinstance(out, str) else out.get("id", out)
        summary_ops = g.financial_summary(entries)
        ms, _ = b.apply_ops(c1, cid, summary_id, summary_ops)
        apply_ms += ms
        formula_cells += len(summary_ops)

        # Derive (node 1)
        summary_cells, derive_active_ms = b.derive_active(c1, cid, summary_id)
        all_cells, derive_all_ms = b.derive_all(c1, cid)
        total_cells_seen = len(all_cells) if isinstance(all_cells, list) else total_cells_seen

        # Sync convergence (node 2 sees the full workbook)
        try:
            sync_ms = b.wait_converged(c2, cid, min_cells=total_cells_seen)
        except TimeoutError as e:
            print(f"  sync timeout: {e}", file=sys.stderr)
            sync_ms = -1.0

        # Correctness: summary grand total == sum of all data-sheet input sums
        st_r, st_c = g.SUMMARY_TOTAL_CELL
        got = None
        for cell in (summary_cells or []):
            if cell.get("row") == st_r and cell.get("col") == st_c:
                got = cell.get("computed_value")
                break
        correct = (got is not None and str(got) == str(expected))
        ok = ok and correct and sync_ms >= 0

        rows_out.append({
            "size": spec["label"], "input_cells": input_cells,
            "formula_cells": formula_cells, "apply_ms": round(apply_ms, 1),
            "derive_active_ms": round(derive_active_ms, 1),
            "derive_all_ms": round(derive_all_ms, 1),
            "sync_ms": round(sync_ms, 1), "correct": correct,
        })
        print(f"[{spec['label']}] cells~{input_cells+formula_cells} "
              f"apply={apply_ms:.0f}ms derive_all={derive_all_ms:.0f}ms "
              f"sync={sync_ms:.0f}ms correct={correct} (want {expected}, got {got})")

    print("\n" + b.format_summary(rows_out))
    results_dir = Path(__file__).resolve().parents[1] / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / "financial.json").write_text(json.dumps(rows_out, indent=2))
    print(f"\nwrote {results_dir / 'financial.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 2: Verify it imports/compiles**

Run: `cd test/perf/lib && python3 -m py_compile driver_financial.py generators.py bench.py`
Expected: no output (compiles). (Full behavior is verified by the Task 4 e2e — it needs live nodes.)

- [ ] **Step 3: Write the shell wrapper**

`test/perf/perf-financial.sh`:

```bash
#!/bin/sh
# merobox `target: local` step entry. Runs the financial driver under merobox's
# own Python (guaranteed to have merobox + calimero_client_py), falling back to
# python3. The workflow passes the context id as SPREADSHEET_CTX (env) and the
# node names as positional args.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_financial.py"

# Prefer merobox's interpreter (from its console-script shebang); else python3.
PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
```

Make executable: `chmod +x test/perf/perf-financial.sh`.

- [ ] **Step 4: Commit**

```bash
git add test/perf/lib/driver_financial.py test/perf/perf-financial.sh
git commit -m "feat(perf): financial sweep driver + local-step shell wrapper"
```

---

### Task 4: Workflow YAML, runner, README, and e2e run

**Files:**
- Create: `test/perf/workflow-perf-financial.yml`, `test/perf/run-perf.sh`, `test/perf/README.md`, `test/perf/results/.gitignore`

**Interfaces:**
- Consumes: the bundle `logic/res/p2p-sheets-1.0.0.mpk`; `perf-financial.sh` (Task 3).
- Produces: a runnable e2e workflow; `test/perf/results/financial.json` on success.

- [ ] **Step 1: Write the workflow YAML**

`test/perf/workflow-perf-financial.yml`:

```yaml
# Financial-model perf workflow. Boots 2 merod nodes, installs the p2p-sheets
# bundle, creates a shared context, joins node 2, then runs the financial sweep
# (build -> timed apply -> timed derive -> node-2 sync -> correctness) via a
# local script step. Pre-flight: `bash logic/build-bundle.sh`.
name: p2p-sheets perf — financial model
description: Feed heavy P&L workbooks and time node-side apply/derive/sync across a size sweep.
log_level: info
nodes:
  count: 2
  prefix: app-node
  image: ghcr.io/calimero-network/merod:0.11.0-rc.8
  base_port: 13428
  base_rpc_port: 13528
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
    name: Run financial perf sweep (local)
    target: local
    script: ./test/perf/perf-financial.sh
    args:
      - '{{spreadsheet_ctx}}'
      - 'app-node-1'
      - 'app-node-2'
```

- [ ] **Step 2: Write the runner + gitignore + README**

`test/perf/run-perf.sh`:

```bash
#!/usr/bin/env bash
# Build the bundle if missing, then run the financial perf workflow.
# Env: PERF_SMOKE=1 collapses the size sweep to a tiny smoke size.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MPK="logic/res/p2p-sheets-1.0.0.mpk"
if [ ! -f "$MPK" ]; then
  echo "Bundle missing — building..."
  bash logic/build-bundle.sh
fi

echo "Running financial perf workflow (PERF_SMOKE=${PERF_SMOKE:-0})..."
PERF_SMOKE="${PERF_SMOKE:-0}" merobox bootstrap run test/perf/workflow-perf-financial.yml
```

`test/perf/results/.gitignore`:

```
*.json
*.md
!.gitignore
```

`test/perf/README.md`:

```markdown
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
```

- [ ] **Step 3: Run the e2e smoke and verify**

Pre-flight (once): `bash logic/build-bundle.sh` (produces the `.mpk`).
Requires Docker running.

Run: `PERF_SMOKE=1 bash test/perf/run-perf.sh`
Expected: the workflow boots 2 nodes, installs, creates the context, joins node 2, runs the driver; the driver prints a `[smoke] … correct=True` line and a markdown table; the workflow ends green (nuke_on_end); `test/perf/results/financial.json` exists with one `smoke` row where `"correct": true` and `sync_ms >= 0`.

If Docker is unavailable in this environment, STOP and report BLOCKED (the pure Tasks 1–2 tests still pass and the workflow/driver are complete and inspectable).

- [ ] **Step 4: Run the full sweep (optional, records the demo numbers)**

Run: `bash test/perf/run-perf.sh`
Expected: three rows (small/medium/large), all `correct=true`, with apply/derive/sync timings; `financial.json` updated. If the `large` size's `apply_cell_ops` batch is rejected for size, `apply_ops`'s chunking (chunk_size=2000) already handles it — confirm the run still completes and note the chunking in the report.

- [ ] **Step 5: Commit**

```bash
git add test/perf/workflow-perf-financial.yml test/perf/run-perf.sh test/perf/README.md test/perf/results/.gitignore
git commit -m "feat(perf): financial workflow + runner + README (first e2e slice)"
```

---

## Self-Review

**Spec coverage (financial slice of the spec):**
- §3.1 layout → Tasks 1–4 create exactly the `test/perf/` tree (financial slice; other 3 scenarios deferred as designed).
- §3.2 mechanism (authenticated node client via merobox, timed execute, `local` .sh wrapper) → Task 2 (`node_client`/`timed_execute`) + Task 3 (`perf-financial.sh`). §3.2 chunking → Task 2 `apply_ops(chunk_size)`.
- §3.3 metrics (input/formula cells, apply_ms, derive_active_ms, derive_all_ms, sync_ms, correct) → Task 3 driver rows; §3.4 reporting (console table + `results/financial.json`) → Task 2 `format_summary` + Task 3 write.
- §4.1 financial scenario (inputs + row/col totals + cross-sheet summary; invariant summary total == Σ inputs) → Task 1 generator + Task 3 assert. Size sweep (§2.4) → Task 3 `SIZES`.
- §5 two-node sync convergence timed → Task 2 `wait_converged` + Task 3.
- §6 harness tests (pure generator + bench unit tests; workflow as e2e) → Tasks 1, 2, 4.
- §8 unknowns resolved: merobox importable (verified in planning), `get_client_for_node`/`execute_function` signatures pinned (Global Constraints), batch chunking built in (Task 2).

**Placeholder scan:** none — every code step carries full code; sizes are concrete; the one runtime-shape uncertainty (`execute_function` return / `create_sheet` return) is handled defensively in code (`_output`, `isinstance` unwrap), not left as a TODO.

**Type consistency:** `set_op`/CellOp shape identical in generators + tests + driver. `financial_data_sheet`/`financial_summary`/`SUMMARY_TOTAL_CELL`/`DataSheet.grand_total_cell` names match across Task 1 and Task 3. `node_client`/`timed_execute`/`apply_ops`/`derive_active`/`derive_all`/`wait_converged`/`format_summary`/`chunked` names match across Task 2 and Task 3. Env var `SPREADSHEET_CTX` matches the workflow output key `spreadsheet_ctx` (uppercased by the script step). Bundle path and merod image match `spec-smoke`.
