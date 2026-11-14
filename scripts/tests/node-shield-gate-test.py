#!/usr/bin/env python3
"""Assert scripts/check-node-shield-gate.py catches what it claims to.

A new app with no gate test, an allowlist entry that outlived its reason and
one with no reason are each silent in the app tests, so the check gets its own.

Stdlib only: this runs in the always-on `metadata` job.
"""

import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, "..", "check-node-shield-gate.py")

spec = importlib.util.spec_from_file_location("check_node_shield_gate", CHECKER)
chk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chk)

failures = []


def tree(apps):
    """`apps`: name -> path of a file under its `app/` (None: an app with no gate test)."""
    root = tempfile.mkdtemp(prefix="node-shield-gate-")
    for app, gate in apps.items():
        src = os.path.join(root, "apps", app, "app", "src")
        os.makedirs(src)
        with open(os.path.join(src, "App.test.tsx"), "w") as fh:
            fh.write("")
        if gate:
            path = os.path.join(root, "apps", app, "app", gate)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as fh:
                fh.write("")
    return root


def expect(label, apps, not_gated, needles):
    errors = chk.check(tree(apps), not_gated)
    if len(errors) != len(needles) or not all(any(n in e for e in errors) for n in needles):
        failures.append(f"{label}: expected errors naming {needles}, got {errors}")


expect("a clean fleet", {"a": "src/nodeShield.gate.test.tsx", "b": "tests/nodeShield.gate.test.ts", "rig": None}, {"rig": "a rig"}, [])
expect("a new app with no gate test", {"a": "src/nodeShield.gate.test.tsx", "new": None}, {}, ["new: no node shield gate"])
expect("a gate test in node_modules does not count", {"a": "node_modules/x/nodeShield.gate.test.ts"}, {}, ["a: no node shield gate"])
expect("an entry for an app that is gated", {"a": "src/nodeShield.gate.test.tsx"}, {"a": "no shield"}, ["a: has a node-shield gate test"])
expect("an entry for an app that does not exist", {"a": "src/nodeShield.gate.test.tsx"}, {"gone": "was removed"}, ["gone: listed"])
expect("an entry with no reason", {"rig": None}, {"rig": "  "}, ["rig: NOT_GATED needs a reason"])

real = chk.check()
if real:
    failures.append("the repository itself: " + "; ".join(real))

if failures:
    print("check-node-shield-gate.py does not behave as documented:\n")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("check-node-shield-gate.py: fails an app with no gate test, a stale or reasonless NOT_GATED entry, and passes the fleet")
