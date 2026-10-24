#!/usr/bin/env python3
"""frontend-dir.py reads the TOML key, never greps for it."""

import pathlib
import shutil
import subprocess
import sys
import tempfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "frontend-dir.py"


def run(root, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args], capture_output=True, text=True
    )


def app(root, name, metadata):
    logic = root / "apps" / name / "logic"
    logic.mkdir(parents=True)
    (logic / "Cargo.toml").write_text(f'[package]\nname = "{name}"\n{metadata}')


with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    app(root, "with", '[package.metadata.calimero]\nfrontend-dir = "../app/dist"\n')
    app(root, "without", '[package.metadata.calimero]\nname = "x"\n')
    app(root, "commented", '[package.metadata.calimero]\n# frontend-dir = "../app/dist"\n')
    app(root, "other-table", '[package.metadata.other]\nfrontend-dir = "../app/dist"\n')
    app(root, "not-a-string", "[package.metadata.calimero]\nfrontend-dir = 3\n")

    assert run(root, "with").stdout.strip() == "apps/with/app/dist"
    for name in ("without", "commented", "other-table"):
        r = run(root, name)
        assert r.returncode == 0 and r.stdout == "", (name, r)
    r = run(root, "not-a-string")
    assert r.returncode != 0 and "frontend-dir" in r.stderr, r
    r = run(root, "missing")
    assert r.returncode != 0, r
    shutil.rmtree(root / "apps" / "not-a-string")
    assert run(root, "--list").stdout.split() == ["with"], run(root, "--list")

print("ok")
