#!/usr/bin/env python3
"""No lockfile may live inside a pnpm workspace member.

pnpm resolves the whole workspace from the ROOT `pnpm-lock.yaml` and ignores any
lockfile inside a member package. Dependabot does not: it scans every lockfile
it finds. So a stale nested lockfile installs nothing, fixes nothing, and
generates security alerts forever.

Measured on this repo before they were removed — of 182 open Dependabot alerts:

    apps/mero-sign/app/pnpm-lock.yaml        123 alerts (3 critical)
    apps/mero-drive/app/package-lock.json     53 alerts (1 critical)
    pnpm-lock.yaml  (the one pnpm uses)        6 alerts (0 critical)

97% of the alerts, and ALL FOUR criticals, came from files that did not affect a
single installed byte. Chasing them would have meant bumping dependencies that
were already patched.

A lockfile OUTSIDE the workspace globs is fine and expected — e.g.
`apps/scaffolding-e2e/sync-test-server/package-lock.json`, a standalone npm
package that is not an `apps/*/app` member and is run by hand.
"""

import fnmatch
import pathlib
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCKFILES = {"pnpm-lock.yaml", "package-lock.json", "yarn.lock", "npm-shrinkwrap.json"}

globs = yaml.safe_load((ROOT / "pnpm-workspace.yaml").read_text())["packages"]

tracked = subprocess.run(
    ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
).stdout.split()

def in_member(path: str) -> str | None:
    parent = str(pathlib.PurePosixPath(path).parent)
    for g in globs:
        if fnmatch.fnmatch(parent, g.rstrip("/")):
            return g
    return None

offenders = []
for f in tracked:
    name = pathlib.PurePosixPath(f).name
    if name not in LOCKFILES:
        continue
    if f == "pnpm-lock.yaml":       # the root lockfile, the one pnpm uses
        continue
    g = in_member(f)
    if g:
        offenders.append((f, g))

if offenders:
    print("lockfiles inside pnpm workspace members:\n")
    for f, g in offenders:
        print(f"  ✗ {f}")
        print(f"      inside workspace glob '{g}' — pnpm ignores it, Dependabot scans it")
    print("\n  Delete them. The root pnpm-lock.yaml is the only lockfile that installs anything.")
    sys.exit(1)

print(f"ok: no lockfile inside a workspace member ({', '.join(globs)})")
