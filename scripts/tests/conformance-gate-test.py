#!/usr/bin/env python3
"""The conformance rig runs on the changes that can break it, and only from
the `changes` job's verdict.

A gate that stops matching is silent: the job reads "skipping" and the PR looks
green. So the four things that make it run are asserted here:

  * ci.yml's paths filter has a `conformance` entry listing exactly the paths
    the rig depends on;
  * the `changes` job exposes it as an output;
  * the `conformance` job is gated on that output and calls conformance.yml;
  * conformance.yml still runs nightly and by hand with an optional core ref.

Run: python3 scripts/tests/conformance-gate-test.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CI = (ROOT / ".github/workflows/ci.yml").read_text()
RIG = (ROOT / ".github/workflows/conformance.yml").read_text()

WANT_PATHS = [
    "apps/conformance/**",
    "packages/**",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".github/workflows/conformance.yml",
]

failures = []


def check(name, ok):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)


def filter_paths(text, name):
    """The globs listed under `<name>:` in the paths-filter block."""
    m = re.search(rf"^            {name}:\n((?:              - '[^']+'\n)+)", text, re.M)
    return re.findall(r"- '([^']+)'", m.group(1)) if m else None


def job_block(text, name):
    m = re.search(rf"^  {name}:\n(.*?)(?=^  [a-z0-9-]+:\n|\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


check("the conformance filter lists exactly the rig's paths", filter_paths(CI, "conformance") == WANT_PATHS)
check("the changes job exposes it as an output", re.search(r"^      conformance: .*steps\.filter\.outputs\.conformance", CI, re.M) is not None)

job = job_block(CI, "conformance")
check("the conformance job needs the changes job", re.search(r"^    needs: changes$", job, re.M) is not None)
check("the conformance job is gated on that output", re.search(r"^    if: needs\.changes\.outputs\.conformance == 'true'$", job, re.M) is not None)
check("the conformance job calls conformance.yml", "uses: ./.github/workflows/conformance.yml" in job)

check("conformance.yml is callable", re.search(r"^  workflow_call:", RIG, re.M) is not None)
check("conformance.yml runs nightly", re.search(r"^  schedule:\n    - cron: ", RIG, re.M) is not None)
dispatch = re.search(r"^  workflow_dispatch:\n(.*?)(?=^\S|^permissions)", RIG, re.M | re.S)
check("conformance.yml takes a core ref by hand", dispatch is not None and "core_ref:" in dispatch.group(1))

if failures:
    print(f"\n{len(failures)} conformance gate check(s) failed")
    sys.exit(1)
print("ok")
