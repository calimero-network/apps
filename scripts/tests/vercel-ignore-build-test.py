#!/usr/bin/env python3
"""Fixture tests for scripts/vercel-ignore-build.py.

Both wrong answers are silent. Too broad, and Vercel rebuilds every app on every
push, which is the bill this script exists to cut. Too narrow, and a changed
frontend never deploys and production quietly serves the old one. So the cases
that must skip are pinned next to the ones that must build.

Run: python3 scripts/tests/vercel-ignore-build-test.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "vercel_ignore_build", HERE.parent / "vercel-ignore-build.py"
)
vib = importlib.util.module_from_spec(SPEC)
sys.modules["vercel_ignore_build"] = vib
assert SPEC.loader is not None
SPEC.loader.exec_module(vib)

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
    pj("apps/mero-chat/app", {"name": "mero-chat", "dependencies": {"react": "catalog:"}})
    return tmp


FORUM = "apps/mero-forum/app"
CHAT = "apps/mero-chat/app"

with tempfile.TemporaryDirectory() as t:
    root = workspace(pathlib.Path(t))

    def builds(app: str, *paths: str, lock=(), catalog=()) -> bool:
        return vib.reaches(app, list(paths), list(lock), list(catalog), root) is not None

    print("── what must SKIP")
    check("another app's frontend", builds(FORUM, "apps/mero-chat/app/src/App.tsx"), False)
    check("this app's contract (bundle uses the committed client)",
          builds(FORUM, "apps/mero-forum/logic/src/lib.rs"), False)
    check("this app's README and dev scripts",
          builds(FORUM, "apps/mero-forum/README.md", "apps/mero-forum/scripts/dev-node.sh"), False)
    check("CI workflow and Cargo files", builds(FORUM, ".github/workflows/ci.yml", "Cargo.lock"), False)
    check("a package this app does not import", builds(CHAT, "packages/invite/src/index.ts"), False)
    check("a lockfile change confined to another importer",
          builds(FORUM, "pnpm-lock.yaml", lock=[CHAT]), False)
    check("a catalog addition (fan-out empty)", builds(FORUM, "pnpm-workspace.yaml", catalog=[]), False)
    check("nothing changed", builds(FORUM), False)

    print("── what must BUILD")
    check("this app's frontend", builds(FORUM, "apps/mero-forum/app/src/App.tsx"), True)
    check("this app's vercel.json", builds(FORUM, "apps/mero-forum/app/vercel.json"), True)
    check("a package it imports directly", builds(FORUM, "packages/invite/src/index.ts"), True)
    check("a package it imports transitively", builds(FORUM, "packages/join-sync/src/a.ts"), True)
    check("a lockfile change in its own importer", builds(FORUM, "pnpm-lock.yaml", lock=[FORUM]), True)
    check("a lockfile change for everyone", builds(FORUM, "pnpm-lock.yaml", lock=["all"]), True)
    check("a catalog pin moving", builds(CHAT, "pnpm-workspace.yaml", catalog=["all"]), True)
    for f in sorted(vib.EVERY_APP_FILES):
        check(f"{f} reaches every app", builds(CHAT, f), True)

print("── the script end to end, in a scratch repo")


def run(repo: pathlib.Path, cwd: str, **env: str) -> int:
    e = {k: v for k, v in os.environ.items() if not k.startswith("VERCEL_")}
    e.update(env)
    return subprocess.run(
        [sys.executable, str(repo / "scripts/vercel-ignore-build.py")],
        cwd=repo / cwd, env=e, capture_output=True, text=True,
    ).returncode


with tempfile.TemporaryDirectory() as t:
    repo = workspace(pathlib.Path(t))
    (repo / "scripts").mkdir()
    for f in ("vercel-ignore-build.py", "ci-scope.py", "lockfile-fanout.py"):
        (repo / "scripts" / f).write_text((HERE.parent / f).read_text())

    def g(*a: str) -> str:
        return subprocess.run(["git", "-C", str(repo), *a], check=True,
                              capture_output=True, text=True).stdout.strip()

    g("init", "-q", "-b", "main")
    g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base")
    base = g("rev-parse", "HEAD")
    (repo / "apps/mero-chat/app/index.html").write_text("<p>hi</p>")
    g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "chat")

    check("skips the app the commit did not touch",
          run(repo, FORUM, VERCEL_GIT_PREVIOUS_SHA=base), vib.SKIP)
    check("builds the app it did touch",
          run(repo, CHAT, VERCEL_GIT_PREVIOUS_SHA=base), vib.BUILD)
    check("builds when there is no previous deploy on main", run(repo, FORUM), vib.BUILD)
    check("builds when the previous commit cannot be fetched",
          run(repo, FORUM, VERCEL_GIT_PREVIOUS_SHA="0" * 40), vib.BUILD)

    # A PR branch that changes chat, then merges main after main changed forum.
    # Diffed against its previous deploy, forum moved; diffed against main, the
    # branch only changes chat, so forum's preview is skipped.
    def commit(path: str, body: str, msg: str) -> str:
        (repo / path).write_text(body)
        g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
        g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg)
        return g("rev-parse", "HEAD")

    g("checkout", "-q", "-b", "pr", base)
    pr_deploy = commit("apps/mero-chat/app/pr.html", "<p>pr</p>", "pr: chat")
    g("checkout", "-q", "main")
    commit("apps/mero-forum/app/index.html", "<p>main</p>", "main: forum")
    g("update-ref", "refs/remotes/origin/main", "main")
    g("checkout", "-q", "pr")
    g("-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-edit", "main")
    pr = dict(VERCEL_GIT_COMMIT_REF="pr", VERCEL_GIT_PREVIOUS_SHA=pr_deploy)

    check("a PR skips an app only merging main moved",
          run(repo, FORUM, **pr), vib.SKIP)
    check("a PR builds the app it changes",
          run(repo, CHAT, **pr), vib.BUILD)
    check("a PR's first push skips apps it does not change",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="pr"), vib.SKIP)
    check("a PR's first push builds the app it changes",
          run(repo, CHAT, VERCEL_GIT_COMMIT_REF="pr"), vib.BUILD)
    check("main still diffs against its previous deploy",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="main", VERCEL_GIT_PREVIOUS_SHA=base), vib.BUILD)

print("── main read from the repository URL when origin cannot serve it")

# Vercel's checkout has no `origin` it can fetch main from, so a PR's first
# push fell back to building every app. The repository is public: main is read
# from its URL instead. Here a local clone stands in for that URL.
with tempfile.TemporaryDirectory() as t:
    upstream = workspace(pathlib.Path(t) / "upstream")
    (upstream / "scripts").mkdir()
    for f in ("vercel-ignore-build.py", "ci-scope.py", "lockfile-fanout.py"):
        (upstream / "scripts" / f).write_text((HERE.parent / f).read_text())

    def u(*a: str, cwd: pathlib.Path = upstream) -> str:
        return subprocess.run(["git", "-C", str(cwd), *a], check=True,
                              capture_output=True, text=True).stdout.strip()

    u("init", "-q", "-b", "main")
    u("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
    u("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base")

    # Vercel's view: a one-commit-deep checkout of the PR head, no origin.
    clone = pathlib.Path(t) / "clone"
    subprocess.run(["git", "clone", "-q", "--no-local", str(upstream), str(clone)], check=True)
    u("remote", "remove", "origin", cwd=clone)
    u("checkout", "-q", "-b", "pr", cwd=clone)
    (clone / "apps/mero-chat/app/pr.html").write_text("<p>pr</p>")
    u("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A", cwd=clone)
    u("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "pr: chat", cwd=clone)
    u("update-ref", "-d", "refs/remotes/origin/main", cwd=clone)

    first_push = dict(VERCEL_GIT_COMMIT_REF="pr", VERCEL_IGNORE_REPO_URL=str(upstream))
    check("a PR's first push skips an app it does not change, with no origin",
          run(clone, FORUM, **first_push), vib.SKIP)
    check("and still builds the app it changes",
          run(clone, CHAT, **first_push), vib.BUILD)

if FAILURES:
    print(f"\n{len(FAILURES)} failed: {', '.join(FAILURES)}")
    sys.exit(1)
print("\nall passed")
