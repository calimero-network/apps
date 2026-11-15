#!/usr/bin/env python3
"""Assert scripts/check-node-shield-gate.py reads results the way it claims to: a skipped, missing, renamed or failed gate fails, a stale NOT_GATED entry fails."""

import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("check_node_shield_gate", os.path.join(HERE, "..", "check-node-shield-gate.py"))
chk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chk)

failures = []


def report(title, status="passed", failure=None):
    gate = {"title": title, "status": status, "failureMessages": [failure] if failure else []}
    return {"testResults": [{"assertionResults": [gate]}]}


def passing(app):
    return report(f"{app}: shows the node shield once signed in")


def errors_for(reports, not_gated, scope=None):
    """`reports`: app -> the report vitest wrote for it (None: none written)."""
    with tempfile.TemporaryDirectory(prefix="node-shield-gate-") as root:
        for app in reports:
            os.makedirs(os.path.join(root, "apps", app, "app"))
        return chk.check(root, not_gated, scope, run=lambda d: reports[os.path.basename(os.path.dirname(d))])


def expect(label, errors, needles):
    if len(errors) != len(needles) or not all(any(n in e for e in errors) for n in needles):
        failures.append(f"{label}: expected errors naming {needles}, got {errors}")


expect("a clean fleet", errors_for({"a": passing("a"), "rig": None}, {"rig": "a rig"}), [])
expect("no report at all (deleted, excluded or renamed file)", errors_for({"a": None}, {}), ["a: no passed test"])
expect("a skipped gate", errors_for({"a": report("a: shows the node shield once signed in", "skipped")}, {}), ["a: no passed test"])
expect(
    "a failed gate says why",
    errors_for({"a": report("a: shows the node shield once signed in", "failed", "a rendered 0 node shields\n at x")}, {}),
    ["a: no passed test named 'a: shows the node shield once signed in' (it failed: a rendered 0 node shields)"],
)
expect("a gate that ran another app's name", errors_for({"a": passing("b")}, {}), ["a: no passed test"])
expect("an app outside the scope is not run", errors_for({"a": passing("a"), "b": None}, {}, scope={"a"}), [])
expect("an entry for an app whose gate passes", errors_for({"a": passing("a")}, {"a": "no shield"}), ["a: its node shield gate passes"])
expect("an entry for an app that does not exist", errors_for({"a": passing("a")}, {"gone": "removed"}), ["gone: listed"])
expect("an entry with no reason", errors_for({"rig": None}, {"rig": " "}), ["rig: NOT_GATED needs a reason"])

if failures:
    print("check-node-shield-gate.py does not behave as documented:\n")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("check-node-shield-gate.py: fails a skipped, failed, missing or renamed gate and a stale NOT_GATED entry")
