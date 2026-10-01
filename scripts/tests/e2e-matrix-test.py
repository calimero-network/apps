#!/usr/bin/env python3
"""e2e-matrix.py lists the scenarios the e2e job globs, each with a time budget."""

import glob
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MATRIX = ROOT / "scripts/e2e-matrix.py"


def run(apps, root=ROOT):
    out = subprocess.run(
        [sys.executable, str(MATRIX), str(root)], input=json.dumps(apps), capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


apps = json.loads(subprocess.run(["bash", str(ROOT / "scripts/app-packages.sh"), "all"], capture_output=True, text=True, check=True).stdout)
got = run(apps)
want = sorted(
    (p.split("/")[1], pathlib.Path(p).stem)
    for a in apps
    for p in glob.glob(f"apps/{a}/logic/workflows/*.yml", root_dir=ROOT)
)
assert want, "no scenarios found - the glob is wrong"
assert sorted((e["app"], e["workflow"]) for e in got) == want, (got, want)
assert not any("probes" in e["workflow"] for e in got)
assert run([]) == []
assert run(["no-such-app"]) == []

with tempfile.TemporaryDirectory() as d:
    wf = pathlib.Path(d, "apps/a/logic/workflows")
    (wf / "probes").mkdir(parents=True)
    (wf / "probes/p.yml").write_text("steps: []\n")
    (wf / "plain.yml").write_text("steps:\n  - {type: call}\n")
    (wf / "fuzzy.yml").write_text(
        "steps:\n  - {type: fuzzy_test, duration_minutes: 15}\n  - {type: fuzzy_test, duration_minutes: 5}\n"
    )
    by_name = {e["workflow"]: e for e in run(["a"], d)}
    assert sorted(by_name) == ["fuzzy", "plain"], by_name
    assert by_name["plain"]["attempt_minutes"] == 10 and by_name["plain"]["timeout_minutes"] == 25, by_name
    assert by_name["fuzzy"]["attempt_minutes"] == 30 and by_name["fuzzy"]["timeout_minutes"] == 45, by_name

real = {(e["app"], e["workflow"]): e for e in got}
# The fuzzy soak lives in workflows/soak/ and runs nightly (soak.yml), never per PR.
assert ROOT.joinpath("apps/scaffolding-e2e/logic/workflows/soak/fuzzy-test.yml").is_file(), "the soak scenario moved"
assert ("scaffolding-e2e", "fuzzy-test") not in real, "a soak/ scenario leaked into the per-PR matrix"

print(f"ok: {len(got)} scenarios across {len(apps)} apps")
