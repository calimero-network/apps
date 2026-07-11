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
    cumulative_cells = 0

    for spec in sizes:
        apply_ms = 0.0
        entries = []          # (sheet_id, grand_total_cell) for the summary
        expected = 0
        input_cells = 0
        formula_cells = 0

        for s in range(spec["sheets"]):
            out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": f"Data {s+1}"})
            sheet_id = out if isinstance(out, str) else out.get("id", out)
            if not isinstance(sheet_id, str) or not sheet_id:
                raise RuntimeError(f"unexpected create_sheet return: {out!r}")
            ds = g.financial_data_sheet(spec["rows"], spec["cols"])
            ms, _ = b.apply_ops(c1, cid, sheet_id, ds.ops)
            apply_ms += ms
            entries.append((sheet_id, ds.grand_total_cell))
            expected += ds.input_sum
            input_cells += spec["rows"] * spec["cols"]
            formula_cells += len(ds.ops) - spec["rows"] * spec["cols"]

        out, _ = b.timed_execute(c1, cid, "create_sheet", {"name": "Summary"})
        summary_id = out if isinstance(out, str) else out.get("id", out)
        if not isinstance(summary_id, str) or not summary_id:
            raise RuntimeError(f"unexpected create_sheet return: {out!r}")
        summary_ops = g.financial_summary(entries)
        ms, _ = b.apply_ops(c1, cid, summary_id, summary_ops)
        apply_ms += ms
        formula_cells += len(summary_ops)
        # Cumulative non-blank cells written so far (== what node 2 must converge
        # to). Tracked independently of derive_all's return shape so the sync gate
        # can never silently collapse to min_cells=0.
        cumulative_cells += input_cells + formula_cells

        # Derive (node 1)
        summary_cells, derive_active_ms = b.derive_active(c1, cid, summary_id)
        _all_cells, derive_all_ms = b.derive_all(c1, cid)  # timing only

        # Sync convergence (node 2 sees the full workbook)
        try:
            sync_ms = b.wait_converged(c2, cid, min_cells=cumulative_cells)
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
        correct = False
        if got is not None:
            try:
                correct = abs(float(got) - float(expected)) < 0.5
            except (ValueError, TypeError):
                correct = False
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
