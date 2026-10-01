#!/usr/bin/env python3
"""Which apps a set of changed paths actually reaches.

ci.yml used to pick an app for the wasm + browser matrix whenever ANY file under
`apps/<app>/` changed. So a one-line fix to `apps/mero-design/scripts/dev-node.sh`
(a local dev helper that no CI job runs) built mero-design's wasm and ran its
whole browser e2e. It also missed the other direction entirely: `packages/*` were
in no filter, so a change to a shared package that 11 apps import ran no app CI.

The rule here:

  * `apps/<a>/app/**` and `apps/<a>/logic/**` reach app <a>. They are what CI
    builds and tests. A logic change reaches the frontend job too, because it
    regenerates the client from the committed ABI.
  * `apps/<a>/scripts/local-rig.sh` reaches <a>. The rich browser job boots it.
  * `packages/<p>/**` reaches <p> and every workspace member that depends on it,
    transitively, read from the package.json files.
  * Anything else under `apps/<a>/` (README, dev scripts, Makefile, docs) and any
    `*.md` reaches nothing. No job reads these files.

Reads changed paths (whitespace-separated) on stdin and prints JSON:

  {"app_paths":     ["apps/<a>/", ...],   # for app-packages.sh from-paths
   "logic_paths":   ["apps/<a>/", ...],   # a CONTRACT changed: merobox scope
   "frontend_dirs": ["apps/<a>/app", "packages/<p>", ...]}  # pnpm --filter

Run the tests: python3 scripts/tests/ci-scope-test.py
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

APP_RE = re.compile(r"^apps/(?P<app>[^/]+)/(?P<rest>.+)$")
PKG_RE = re.compile(r"^packages/(?P<pkg>[^/]+)/")

# Files under an app that a CI job executes even though they sit outside app/
# and logic/. Keep this list short, and add to it only when ci.yml calls one.
CI_RUN_APP_FILES = {"scripts/local-rig.sh"}


def workspace_members(root: pathlib.Path) -> dict[str, dict]:
    """dir (relative to root) -> parsed package.json, for every pnpm member."""
    members: dict[str, dict] = {}
    for pattern in ("apps/*/app/package.json", "packages/*/package.json"):
        for pj in sorted(root.glob(pattern)):
            try:
                members[str(pj.parent.relative_to(root))] = json.loads(pj.read_text())
            except (OSError, ValueError):
                continue
    return members


def dependents(members: dict[str, dict], seeds: set[str]) -> set[str]:
    """`seeds` (member dirs) plus every member depending on one, transitively."""
    name_of = {d: m.get("name") for d, m in members.items()}
    deps_of: dict[str, set[str]] = {}
    for d, m in members.items():
        names: set[str] = set()
        for key in ("dependencies", "devDependencies", "peerDependencies"):
            names |= set((m.get(key) or {}).keys())
        deps_of[d] = names

    reached = set(seeds)
    while True:
        names = {name_of[d] for d in reached if name_of.get(d)}
        more = {d for d, ds in deps_of.items() if d not in reached and ds & names}
        if not more:
            return reached
        reached |= more


def scope(paths: list[str], root: pathlib.Path = ROOT) -> dict[str, list[str]]:
    apps: set[str] = set()
    logic: set[str] = set()
    frontend: set[str] = set()
    pkg_seeds: set[str] = set()

    for p in paths:
        p = p.strip()
        if not p or p.endswith(".md"):
            continue
        m = APP_RE.match(p)
        if m:
            app, rest = m["app"], m["rest"]
            if rest.startswith("logic/"):
                apps.add(app)
                logic.add(app)
                # The frontend job regenerates the client from the committed
                # ABI (logic/res/abi.json), so a contract change is its business.
                if (root / "apps" / app / "app").is_dir():
                    frontend.add(f"apps/{app}/app")
            elif rest.startswith("app/"):
                apps.add(app)
                frontend.add(f"apps/{app}/app")
            elif rest in CI_RUN_APP_FILES:
                apps.add(app)
            continue
        m = PKG_RE.match(p)
        if m:
            pkg_seeds.add(f"packages/{m['pkg']}")

    if pkg_seeds:
        for d in dependents(workspace_members(root), pkg_seeds):
            frontend.add(d)
            am = re.match(r"^apps/([^/]+)/app$", d)
            if am:
                apps.add(am[1])

    return {
        "app_paths": sorted(f"apps/{a}/" for a in apps),
        "logic_paths": sorted(f"apps/{a}/" for a in logic),
        "frontend_dirs": sorted(frontend),
    }


def main() -> int:
    paths = sys.stdin.read().split()
    print(json.dumps(scope(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
