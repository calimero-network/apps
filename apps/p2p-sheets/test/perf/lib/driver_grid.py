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
