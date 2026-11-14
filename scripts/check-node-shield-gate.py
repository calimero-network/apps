#!/usr/bin/env python3
"""Assert every app under apps/ has a node-shield gate, or a reason to go without.

Every app that signs in shows the node shield (`@calimero-apps/passkey`): the
chip that says what the browser's check of the node verified. An app gets it
from `usePasskeySession`, or by calling `bindNodeShield` where it connects
itself. Nothing throws when an app stops doing either, so each app carries
`nodeShield.gate.test.ts(x)` under its `app/`: one `nodeShieldGate(...)` call
(`@calimero-apps/passkey/testing`) that mounts the app's real session layer
signed in, with a fake client, and fails unless the shield is on the page.
The frontend job runs it with the app's other tests.

This check is the other half: it fails an app with no gate test, which is how a
NEW app cannot skip the gate. An app that is not a signed-in product goes in
NOT_GATED with its reason, never silently. An entry for an app that has a gate
test, or for one that does not exist, fails too, so the list only shrinks.

Stdlib only: this runs in the always-on `metadata` job.
"""

import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

GATE_TESTS = ("nodeShield.gate.test.ts", "nodeShield.gate.test.tsx")
SKIP_DIRS = {"node_modules", "dist", "dist-types", "build", "target"}

NOT_GATED = {
    "conformance": "a rig that signs up with software passkeys to run its matrix, not a product with a signed-in screen",
}


def has_gate_test(app_dir):
    for dirpath, dirnames, filenames in os.walk(app_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if any(f in GATE_TESTS for f in filenames):
            return True
    return False


def check(root=ROOT, not_gated=None):
    """Every complaint, as lines to print; empty when every app is gated or listed."""
    not_gated = NOT_GATED if not_gated is None else not_gated
    errors = []
    apps_dir = os.path.join(root, "apps")
    apps = sorted(d for d in os.listdir(apps_dir) if os.path.isdir(os.path.join(apps_dir, d)))
    for listed in sorted(set(not_gated) - set(apps)):
        errors.append(f"{listed}: listed in check-node-shield-gate.py but there is no apps/{listed}")
    for app in apps:
        gated = has_gate_test(os.path.join(apps_dir, app, "app"))
        if app in not_gated:
            if not not_gated[app].strip():
                errors.append(f"{app}: NOT_GATED needs a reason")
            if gated:
                errors.append(f"{app}: has a node-shield gate test; remove it from NOT_GATED")
        elif not gated:
            errors.append(
                f"{app}: no node shield gate. Add apps/{app}/app/src/nodeShield.gate.test.tsx "
                f"(a nodeShieldGate call, @calimero-apps/passkey/testing), or list the app in "
                f"scripts/check-node-shield-gate.py NOT_GATED with the reason it shows no shield"
            )
    return errors


def main():
    errors = check()
    if errors:
        print("Every app must render the node shield:\n")
        for e in errors:
            print(f"  {e}")
        return 1
    apps = [d for d in os.listdir(os.path.join(ROOT, "apps")) if os.path.isdir(os.path.join(ROOT, "apps", d))]
    print(f"check-node-shield-gate: {len(apps) - len(NOT_GATED)} apps have a gate test; {len(NOT_GATED)} listed with a reason.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
