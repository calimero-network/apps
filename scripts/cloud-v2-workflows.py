#!/usr/bin/env python3
"""Run the apps' ported workflows (apps/*/logic/workflows/cloud-v2/*.yml).

Each runs on its own 3-node merod-v2 cluster through merobox's cloud-v2 backend.
Needs MEROD_V2_BINARY and the contracts built
(cargo build --workspace --target wasm32-unknown-unknown --profile app-release);
APPS_WASM_DIR defaults to that target directory.

Usage: scripts/cloud-v2-workflows.py [--json out.json] [workflow.yml ...]
Exit status is non-zero when a workflow in cloud-v2-workflows-baseline.json fails.

The ports come from `merobox cloud port` (regenerate with
scripts/port-workflows-to-cloud-v2.sh); each file's header lists what it dropped.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = Path(__file__).with_name("cloud-v2-workflows-baseline.json")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("workflows", nargs="*", type=Path)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    os.environ.setdefault(
        "APPS_WASM_DIR", str(ROOT / "target/wasm32-unknown-unknown/app-release")
    )
    from merobox.cloud_v2 import run_workflow

    files = args.workflows or sorted(ROOT.glob("apps/*/logic/workflows/cloud-v2/*.yml"))
    results = []
    for f in files:
        rel = str(f.resolve().relative_to(ROOT))
        start = time.time()
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                ok = run_workflow(str(f))
        except Exception as e:  # a crash in the harness is a failure, not an abort
            ok = False
            buf.write(f"\n{type(e).__name__}: {e}")
        took = round(time.time() - start, 1)
        out = buf.getvalue()
        reason = "" if ok else (out.strip().splitlines() or ["?"])[-1][:300]
        results.append({"workflow": rel, "ok": ok, "seconds": took, "reason": reason})
        print(f"{'ok  ' if ok else 'FAIL'} {took:6.1f}s  {rel}  {reason}", flush=True)
        if args.verbose and not ok:
            print(out)
    if args.json:
        args.json.write_text(json.dumps(results, indent=2) + "\n")
    passed = {r["workflow"] for r in results if r["ok"]}
    baseline = set(json.loads(BASELINE.read_text())) if BASELINE.exists() else set()
    regressed = sorted(baseline & {r["workflow"] for r in results} - passed)
    print(f"\n{len(passed)}/{len(results)} ported workflows pass")
    if regressed:
        print("REGRESSED:", *regressed, sep="\n  ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
