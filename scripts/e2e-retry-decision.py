#!/usr/bin/env python3
"""Decide whether a failed merobox attempt is worth retrying.

usage: e2e-retry-decision.py WORKFLOW.yml MEROBOX_LOG EXIT_CODE
Exit 0 = retry, 1 = fail now; stdout says why.
"""

import re
import sys

import yaml

# Steps that join lose the cold-join KeyDelivery race; `create_mesh` joins internally.
JOINING = {"create_mesh", "join_namespace", "join_group"}
TIMED_OUT = {124, 137}  # timeout(1) after TERM, and after KILL
FAILED_STEP = re.compile(r"❌ Step '(.*)' failed(?: with error:.*)?$")


def failing_step(log: str):
    names = [m.group(1) for m in map(FAILED_STEP.search, log.splitlines()) if m]
    return names[-1] if names else None


def step_type(workflow: str, name: str):
    steps = yaml.safe_load(open(workflow)).get("steps") or []
    # merobox names an unnamed step "Step <1-based index>"
    types = [s.get("type") for i, s in enumerate(steps, 1) if s.get("name", f"Step {i}") == name]
    return types[0] if len(types) == 1 else None


def decide(workflow: str, log: str, exit_code: int):
    if exit_code in TIMED_OUT:
        return False, "the attempt timed out, which is not the join race"
    name = failing_step(log)
    if name is None:
        return False, "merobox reported no failing step"
    kind = step_type(workflow, name)
    if kind is None:
        return False, f"step '{name}' is not uniquely named in {workflow}"
    if kind in JOINING:
        return True, f"step '{name}' ({kind}) joins, so this is the cold-join race"
    return False, f"step '{name}' ({kind}) failed and it does not join, so it is not the cold-join race"


if __name__ == "__main__":
    retry, why = decide(sys.argv[1], open(sys.argv[2], errors="replace").read(), int(sys.argv[3]))
    print(why)
    sys.exit(0 if retry else 1)
