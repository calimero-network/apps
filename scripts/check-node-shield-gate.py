#!/usr/bin/env python3
"""Assert every app's node shield gate ran and passed, from vitest's JSON report (needs pnpm: the frontend job).
An app that is not a signed-in product is in NOT_GATED with its reason."""

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

TEST_TITLE = "{app}: shows the node shield once signed in"
GATE_FILTER = "nodeShield.gate"  # vitest's file filter: only the gate test runs

NOT_GATED = {
    "conformance": "a rig that signs up with software passkeys to run its matrix, not a product with a signed-in screen",
}


def run_vitest(app_dir):
    """The gate's JSON report for the app at `app_dir`, or None when vitest wrote none."""
    with tempfile.TemporaryDirectory(prefix="node-shield-gate-") as tmp:
        out = os.path.join(tmp, "report.json")
        cmd = ["pnpm", "exec", "vitest", "run", GATE_FILTER, "--reporter=json", f"--outputFile={out}"]
        subprocess.run(cmd, cwd=app_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        try:
            with open(out, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None


def outcome(app, report):
    """None when `report` holds a passed test named for `app`, else what it holds instead."""
    title = TEST_TITLE.format(app=app)
    found = [
        a
        for t in (report or {}).get("testResults", [])
        for a in t.get("assertionResults", [])
        if a.get("title") == title
    ]
    if any(a.get("status") == "passed" for a in found):
        return None
    if not found:
        return "no such test ran"
    first = found[0]
    return f"it {first.get('status')}" + "".join(f": {m.splitlines()[0]}" for m in first.get("failureMessages", [])[:1])


def check(root=ROOT, not_gated=None, scope=None, run=run_vitest):
    """Every complaint, as lines to print. `scope`: the apps to run (default: all); `run(app_dir)`: its report."""
    not_gated = NOT_GATED if not_gated is None else not_gated
    errors = []
    apps_dir = os.path.join(root, "apps")
    apps = sorted(d for d in os.listdir(apps_dir) if os.path.isdir(os.path.join(apps_dir, d)))
    for listed in sorted(set(not_gated) - set(apps)):
        errors.append(f"{listed}: listed in check-node-shield-gate.py but there is no apps/{listed}")
    for app in apps if scope is None else [a for a in apps if a in scope]:
        if app in not_gated and not not_gated[app].strip():
            errors.append(f"{app}: NOT_GATED needs a reason")
        why = outcome(app, run(os.path.join(apps_dir, app, "app")))
        if app in not_gated and why is None:
            errors.append(f"{app}: its node shield gate passes; remove it from NOT_GATED")
        elif app not in not_gated and why is not None:
            errors.append(
                f"{app}: no passed test named '{TEST_TITLE.format(app=app)}' ({why}). Add a nodeShieldGate call "
                f"(@calimero-apps/passkey/testing) in nodeShield.gate.test.tsx, make it pass, or list the app "
                f"in scripts/check-node-shield-gate.py NOT_GATED with the reason it shows no shield"
            )
    return errors


def main():
    scope = {os.path.normpath(p).split(os.sep)[1] for p in sys.argv[1:]} or None  # apps/<name>/app
    errors = check(scope=scope)
    for e in errors:
        print(e)
    if not errors:
        print("check-node-shield-gate: every app's node shield gate ran and passed.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
