#!/usr/bin/env python3
"""Every `create_mesh` step must be preceded by a settle.

`create_mesh` JOINS INTERNALLY, so it races core's KeyDelivery window exactly
like an explicit `join_namespace` — and unlike a join it has no step boundary to
retry at, so losing the race loses the whole scenario. The CI runner retries a
scenario three times; `authored-shared.yml` lost all three repeatedly, reddening
main and every open PR.

The `join_namespace` scenarios were given a 12s settle long ago. The
`create_mesh` ones were missed, and nothing noticed because the symptom is a
flake rather than a failure. This asserts the settle is there so the next
scenario to be written cannot quietly omit it.

See apps/scaffolding-e2e/logic/workflows/group-late-joiner.yml for why 12s and
not 5s, and why merobox offers no wait-for-connectivity gate to use instead.
"""

import glob
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIN_SETTLE = 5  # anything less merely doubles a budget that was already short

failures = []
checked = 0

for f in sorted(glob.glob(str(ROOT / "apps/*/logic/**/*.yml"), recursive=True)):
    try:
        doc = yaml.safe_load(open(f))
    except yaml.YAMLError as e:
        failures.append(f"{f}: not valid YAML: {e}")
        continue
    steps = (doc or {}).get("steps") or []
    for i, step in enumerate(steps):
        if not isinstance(step, dict) or step.get("type") != "create_mesh":
            continue
        checked += 1
        rel = pathlib.Path(f).relative_to(ROOT)
        prev = steps[i - 1] if i else {}
        if not isinstance(prev, dict) or prev.get("type") != "wait":
            failures.append(
                f"{rel}: `create_mesh` at step #{i} is not preceded by a `wait` — "
                f"it will race KeyDelivery and lose the whole scenario"
            )
        elif (prev.get("seconds") or 0) < MIN_SETTLE:
            failures.append(
                f"{rel}: the wait before `create_mesh` at step #{i} is "
                f"{prev.get('seconds')}s, under the {MIN_SETTLE}s floor"
            )

if failures:
    print("create_mesh steps missing a settle:\n")
    for x in failures:
        print(f"  ✗ {x}")
    sys.exit(1)

print(f"ok: all {checked} `create_mesh` steps are preceded by a settle")
