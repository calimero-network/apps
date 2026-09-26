#!/usr/bin/env python3
"""Fixture tests for scripts/ci-scope.py.

A wrong answer here never shows up as a failure. Too broad, and every PR runs
the whole matrix; too narrow, and an app is skipped with nothing to notice. So
the cases that must NOT select an app are pinned next to the ones that must.

Run: python3 scripts/tests/ci-scope-test.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ci_scope", HERE.parent / "ci-scope.py")
cs = importlib.util.module_from_spec(SPEC)
sys.modules["ci_scope"] = cs
assert SPEC.loader is not None
SPEC.loader.exec_module(cs)

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}\n         got  {got!r}\n         want {want!r}")
        FAILURES.append(name)


def workspace(tmp: pathlib.Path) -> pathlib.Path:
    def pj(d: str, body: dict) -> None:
        (tmp / d).mkdir(parents=True, exist_ok=True)
        (tmp / d / "package.json").write_text(json.dumps(body))

    pj("packages/join-sync", {"name": "@calimero-apps/join-sync"})
    pj("packages/invite", {"name": "@calimero-apps/invite",
                           "dependencies": {"@calimero-apps/join-sync": "workspace:*"}})
    pj("apps/mero-forum/app", {"name": "mero-forum",
                               "dependencies": {"@calimero-apps/invite": "workspace:*"}})
    pj("apps/mero-pass/app", {"name": "mero-pass",
                              "devDependencies": {"@calimero-apps/join-sync": "workspace:*"}})
    pj("apps/mero-chat/app", {"name": "mero-chat", "dependencies": {"react": "catalog:"}})
    return tmp


with tempfile.TemporaryDirectory() as t:
    root = workspace(pathlib.Path(t))

    def s(*paths: str) -> dict:
        return cs.scope(list(paths), root)

    print("── what must NOT select an app")
    none = {"app_paths": [], "logic_paths": [], "frontend_dirs": []}
    check("a dev script beside the app", s("apps/mero-design/scripts/dev-node.sh"), none)
    check("an app README", s("apps/mero-chat/README.md"), none)
    check("markdown inside app/", s("apps/mero-chat/app/docs/notes.md"), none)
    check("a root-level app file", s("apps/mero-chat/permissions-testing.sh", "apps/mero-chat/Makefile"), none)
    check("repo-level scripts are not apps", s("scripts/merobox-coverage-baseline.json"), none)

    print("── what must")
    check("a frontend file", s("apps/mero-chat/app/src/x.ts"),
          {"app_paths": ["apps/mero-chat/"], "logic_paths": [], "frontend_dirs": ["apps/mero-chat/app"]})
    check("a contract file reaches merobox AND the codegen check", s("apps/mero-chat/logic/res/abi.json"),
          {"app_paths": ["apps/mero-chat/"], "logic_paths": ["apps/mero-chat/"], "frontend_dirs": ["apps/mero-chat/app"]})
    check("a contract with no frontend dir", s("apps/kv-only/logic/src/lib.rs"),
          {"app_paths": ["apps/kv-only/"], "logic_paths": ["apps/kv-only/"], "frontend_dirs": []})
    check("the rig the rich browser job boots", s("apps/mero-docs/scripts/local-rig.sh"),
          {"app_paths": ["apps/mero-docs/"], "logic_paths": [], "frontend_dirs": []})

    print("── shared packages reach their dependents, transitively")
    check("invite → forum", s("packages/invite/src/index.ts"),
          {"app_paths": ["apps/mero-forum/"], "logic_paths": [],
           "frontend_dirs": ["apps/mero-forum/app", "packages/invite"]})
    check("join-sync → invite → forum, and pass via devDependencies", s("packages/join-sync/src/a.ts"),
          {"app_paths": ["apps/mero-forum/", "apps/mero-pass/"], "logic_paths": [],
           "frontend_dirs": ["apps/mero-forum/app", "apps/mero-pass/app",
                             "packages/invite", "packages/join-sync"]})
    check("an app that imports no package is not reached", "apps/mero-chat/" in s("packages/invite/x.ts")["app_paths"], False)

if FAILURES:
    print(f"\n{len(FAILURES)} failed: {', '.join(FAILURES)}")
    sys.exit(1)
print("\nall passed")
