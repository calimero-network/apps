#!/usr/bin/env python3
"""e2e-retry-decision.py retries only a failure at a joining step."""

import pathlib
import subprocess
import sys
import tempfile

DECIDE = pathlib.Path(__file__).resolve().parents[1] / "e2e-retry-decision.py"

WORKFLOW = """\
name: t
steps:
  - name: Node 2 joins the namespace
    type: join_namespace
  - name: Bob joins G4 by inheritance
    type: join_subgroup_inheritance
  - type: call
"""


def decide(log: str, exit_code: int = 1) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as d:
        wf = pathlib.Path(d, "wf.yml")
        wf.write_text(WORKFLOW)
        lg = pathlib.Path(d, "run.log")
        lg.write_text(log)
        return subprocess.run(
            [sys.executable, str(DECIDE), str(wf), str(lg), str(exit_code)],
            capture_output=True,
            text=True,
        )


def failed(step: str) -> str:
    return f"noise\n2026-09-30T12:23:28Z ❌ Step '{step}' failed\n❌ Workflow failed!\n"


join = decide(failed("Node 2 joins the namespace"))
assert join.returncode == 0, join

other = decide(failed("Bob joins G4 by inheritance"))
assert other.returncode == 1, other
assert "Bob joins G4 by inheritance" in other.stdout and "join_subgroup_inheritance" in other.stdout, other.stdout

erred = decide("❌ Step 'Node 2 joins the namespace' failed with error: boom\n")
assert erred.returncode == 0, erred

unnamed = decide(failed("Step 3"))
assert unnamed.returncode == 1 and "call" in unnamed.stdout, unnamed

timeout = decide(failed("Node 2 joins the namespace"), exit_code=124)
assert timeout.returncode == 1 and "timed out" in timeout.stdout, timeout

no_step = decide("Workflow failed before any step ran\n")
assert no_step.returncode == 1, no_step

unknown = decide(failed("A step the workflow does not have"))
assert unknown.returncode == 1, unknown

print("ok")
