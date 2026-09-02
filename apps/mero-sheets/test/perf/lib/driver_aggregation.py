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
