#!/usr/bin/env python3
"""Assert every contract method is exercised by at least one merobox scenario.

WHY THIS EXISTS

`Build WASM` proves a contract COMPILES. `Rust (fmt, clippy, test)` proves its
unit tests pass in-process, against a single in-memory store with no node, no
peer and no replication. Neither says a method works when a real node calls it
over the wire.

merobox is the only tier in this repo that does: real merod containers, real
contexts, real gossip. So a method no scenario ever calls has never been
executed against a node at all — and this fleet's history is almost entirely
bugs that only exist at that boundary:

  * an argument name that is camelCase on one route and snake_case on another
  * `init` taking a parameter the frontend did not send (a guest panic, HTTP 400)
  * a method that needs a capability the caller's role never granted (403)
  * a borsh layout change that makes every stored value unreadable
  * a CRDT that converges on values but not on root hashes

None of those are visible to `cargo test`, and none are visible to a mocked
frontend suite either — `check-admin-wire.py` exists because the vitest tests
assert the keys that SHOULD be present and never that nothing else is.

WHAT IT CHECKS

For each app, the set of public methods in the committed `res/abi.json`, minus
`init` (which every scenario exercises implicitly by creating a context), minus
anything listed in EXEMPT below with a reason. Every remaining method must
appear by name somewhere under `logic/workflows/`.

⚠️ THIS IS A NAME MATCH, NOT PROOF OF A PASSING ASSERTION. A method named only
in a comment counts. That is a deliberate floor rather than a ceiling: the check
is cheap, it runs without Docker, and it catches the case that actually happens
— a method added to the contract and never wired into any scenario. Making it
stricter means parsing merobox's step schema, which is a moving target; the
scenarios themselves are what assert behaviour.

THE BASELINE

`baseline.json` beside this script records the gap as it stood when the check
landed: 94 methods across 16 apps, none of which had ever been called by a
node. The check FAILS on anything not in the baseline, so the gap can shrink
and can never grow. Closing a baseline entry means deleting the line — do that
in the same PR as the scenario that covers it.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = pathlib.Path(__file__).resolve().parent / "merobox-coverage-baseline.json"

# Methods that are deliberately not merobox-testable, with the reason. Keep this
# SHORT: an entry here is a permanent exemption, not a to-do.
EXEMPT = {
    # `init` runs on every `create_context` in every scenario. Naming it would
    # be noise in sixteen files.
    "*": {"init"},
}


def methods_of(abi_path: pathlib.Path) -> list[str]:
    try:
        abi = json.loads(abi_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"::error::{abi_path}: cannot read ABI: {exc}")
        raise SystemExit(1) from exc
    return [m["name"] for m in (abi.get("methods") or []) if m.get("name")]


def main() -> int:
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    failed = False
    shrunk: list[str] = []

    for abi_path in sorted(ROOT.glob("apps/*/logic/res/abi.json")):
        app = abi_path.parts[-4]
        workflows = ROOT / "apps" / app / "logic" / "workflows"
        if not workflows.is_dir():
            # An app with no scenarios at all is a separate problem, and one the
            # CI matrices already surface — do not double-report it here.
            continue

        blob = "\n".join(
            p.read_text(errors="ignore") for p in workflows.rglob("*.yml")
        )
        exempt = EXEMPT.get("*", set()) | EXEMPT.get(app, set())
        allowed = set(baseline.get(app, []))

        missing = [
            m
            for m in methods_of(abi_path)
            if m not in exempt and m not in blob
        ]
        new = sorted(set(missing) - allowed)
        fixed = sorted(allowed - set(missing))

        if new:
            failed = True
            print(f"::error::{app}: {len(new)} method(s) no merobox scenario calls:")
            for m in new:
                print(f"::error::  {app}.{m}")
        if fixed:
            shrunk.append(f"  {app}: {', '.join(fixed)}")

    if shrunk:
        # Not a failure — but the baseline must not keep claiming a gap that is
        # closed, or it silently re-permits a regression.
        print("::error::the baseline lists methods that ARE now covered.")
        print("::error::delete these lines from merobox-coverage-baseline.json:")
        print("\n".join(shrunk))
        failed = True

    if not failed:
        total = sum(len(v) for v in baseline.values())
        print(f"every contract method is covered, or baselined ({total} baselined)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
