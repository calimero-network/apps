#!/usr/bin/env python3
"""`app-packages.sh workflows` lists exactly the scenarios the e2e job globs."""

import glob
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/app-packages.sh"


def run(*args, stdin=""):
    return subprocess.run(["bash", str(SCRIPT), *args], input=stdin, capture_output=True, text=True, check=True).stdout


apps = json.loads(run("all"))
got = json.loads(run("workflows", stdin=json.dumps(apps)))
want = sorted(
    (p.split("/")[1], pathlib.Path(p).stem)
    for a in apps
    for p in glob.glob(f"apps/{a}/logic/workflows/*.yml", root_dir=ROOT)
)
assert want, "no scenarios found - the glob is wrong"
assert sorted((e["app"], e["workflow"]) for e in got) == want, (got, want)
assert not any("probes" in e["workflow"] for e in got)
assert json.loads(run("workflows", stdin="[]")) == []
assert json.loads(run("workflows", stdin='["no-such-app"]')) == []

print(f"ok: {len(got)} scenarios across {len(apps)} apps")
