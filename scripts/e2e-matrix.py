#!/usr/bin/env python3
"""Emit the e2e matrix: one {app, workflow, attempt_minutes, timeout_minutes} per scenario.

usage: e2e-matrix.py [ROOT] < '["app", ...]'
"""

import json
import pathlib
import sys

import yaml

BASE_ATTEMPT_MINUTES = 10  # a healthy scenario takes minutes; a hung one must not eat the job budget
JOB_OVERHEAD_MINUTES = 15  # setup, teardown and a retry gap around one attempt
MAX_JOB_MINUTES = 60


def fuzzy_minutes(workflow: pathlib.Path) -> int:
    steps = yaml.safe_load(workflow.read_text()).get("steps") or []
    return sum(s.get("duration_minutes", 0) for s in steps if s.get("type") == "fuzzy_test")


def matrix(root: pathlib.Path, apps: list) -> list:
    out = []
    for app in apps:
        for f in sorted(root.glob(f"apps/{app}/logic/workflows/*.yml")):
            attempt = BASE_ATTEMPT_MINUTES + fuzzy_minutes(f)
            job = min(attempt + JOB_OVERHEAD_MINUTES, MAX_JOB_MINUTES)
            out.append({"app": app, "workflow": f.stem, "attempt_minutes": attempt, "timeout_minutes": job})
    return out


if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1]
    print(json.dumps(matrix(root, json.load(sys.stdin)), separators=(",", ":")))
