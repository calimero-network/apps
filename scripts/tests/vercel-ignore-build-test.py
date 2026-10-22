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
    pj("packages/e2e-node", {"name": "@calimero-apps/e2e-node"})
    pj("apps/mero-forum/app", {"name": "mero-forum",
                               "dependencies": {"@calimero-apps/invite": "workspace:*"},
                               "devDependencies": {"@calimero-apps/e2e-node": "workspace:*"}})
    pj("apps/mero-chat/app", {"name": "mero-chat", "dependencies": {"react": "catalog:"},
                              "devDependencies": {"@calimero-apps/e2e-node": "workspace:*"}})
    (tmp / "package.json").write_text(json.dumps(
        {"name": "root", "scripts": {"build": "pnpm -r build"}, "packageManager": "pnpm@9.6.0"}))
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
    check("a lockfile change to a package this app does not import",
          builds(CHAT, "pnpm-lock.yaml", lock=["packages/invite"]), False)
    check("a catalog addition (fan-out empty)", builds(FORUM, "pnpm-workspace.yaml", catalog=[]), False)
    check("the e2e harness package", builds(FORUM, "packages/e2e-node/src/journey.ts"), False)
    check("the e2e harness package's lockfile importer",
          builds(FORUM, "pnpm-lock.yaml", lock=["packages/e2e-node"]), False)
    check("the CI scope scripts", builds(FORUM, "scripts/ci-scope.py",
                                         "scripts/lockfile-fanout.py",
                                         "scripts/vercel-ignore-build.py"), False)
    check("nothing changed", builds(FORUM), False)

    print("── what must BUILD")
    check("this app's frontend", builds(FORUM, "apps/mero-forum/app/src/App.tsx"), True)
    check("this app's vercel.json", builds(FORUM, "apps/mero-forum/app/vercel.json"), True)
    check("a package it imports directly", builds(FORUM, "packages/invite/src/index.ts"), True)
    check("a package it imports transitively", builds(FORUM, "packages/join-sync/src/a.ts"), True)
    check("a lockfile change in its own importer", builds(FORUM, "pnpm-lock.yaml", lock=[FORUM]), True)
    check("a lockfile change to a package it imports",
          builds(FORUM, "pnpm-lock.yaml", lock=["packages/join-sync"]), True)
    check("a lockfile change for everyone", builds(FORUM, "pnpm-lock.yaml", lock=["all"]), True)
    check("a catalog pin moving", builds(CHAT, "pnpm-workspace.yaml", catalog=["all"]), True)
    for f in sorted(vib.EVERY_APP_FILES):
        check(f"{f} reaches every app", builds(CHAT, f), True)

print("── no app ships a test-only package")

for src in sorted((HERE.parent.parent / "apps").glob("*/app/src")):
    names = {json.loads((HERE.parent.parent / t / "package.json").read_text())["name"]
             for t in vib.TEST_ONLY_PACKAGES}
    hits = [str(f.relative_to(src.parent.parent.parent.parent))
            for f in src.rglob("*") if f.is_file() and f.suffix in (".ts", ".tsx", ".js", ".jsx")
            and any(n in f.read_text(errors="replace") for n in names)]
    check(f"{src.parent.parent.name} src/ imports no test-only package", hits, [])

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

    # Only main deploys. A branch is skipped whatever it changes, even an app
    # it touches and even with no previous deploy to compare with.
    check("a branch skips an app it does not change",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="pr", VERCEL_GIT_PREVIOUS_SHA=base), vib.SKIP)
    check("a branch skips the app it changes",
          run(repo, CHAT, VERCEL_GIT_COMMIT_REF="pr", VERCEL_GIT_PREVIOUS_SHA=base), vib.SKIP)
    check("a branch's first push skips",
          run(repo, CHAT, VERCEL_GIT_COMMIT_REF="pr"), vib.SKIP)
    check("main builds the app it changes",
          run(repo, CHAT, VERCEL_GIT_COMMIT_REF="main", VERCEL_GIT_PREVIOUS_SHA=base), vib.BUILD)
    check("main skips the app it does not change",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="main", VERCEL_GIT_PREVIOUS_SHA=base), vib.SKIP)
    check("main builds with no previous deploy",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="main"), vib.BUILD)
    check("main builds when the previous commit id is malformed",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="main", VERCEL_GIT_PREVIOUS_SHA="--upload-pack=x"),
          vib.BUILD)
    check("a forced deploy of a branch builds",
          run(repo, FORUM, VERCEL_GIT_COMMIT_REF="pr", VERCEL_FORCE_BUILD="1"), vib.BUILD)

    def commit(path: str, body: str, msg: str) -> None:
        (repo / path).write_text(body)
        g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
        g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg)

    # The root package.json: a new script reaches no app, a new override does.
    on_main = dict(VERCEL_GIT_COMMIT_REF="main")
    before = g("rev-parse", "HEAD")
    root_pj = json.loads((repo / "package.json").read_text())
    root_pj["scripts"]["landing:generate"] = "node scripts/landing/generate.mjs"
    commit("package.json", json.dumps(root_pj), "root: a script")
    check("a root package.json script reaches no app",
          run(repo, FORUM, VERCEL_GIT_PREVIOUS_SHA=before, **on_main), vib.SKIP)
    before = g("rev-parse", "HEAD")
    root_pj["pnpm"] = {"overrides": {"base-x": "3.0.11"}}
    commit("package.json", json.dumps(root_pj), "root: an override")
    check("a root package.json override reaches every app",
          run(repo, FORUM, VERCEL_GIT_PREVIOUS_SHA=before, **on_main), vib.BUILD)

print("── every app's vercel.json turns off Git deployments of other branches")

for cfg in sorted((HERE.parent.parent / "apps").glob("*/app/vercel.json")):
    check(f"{cfg.parent.parent.name} deploys main only",
          json.loads(cfg.read_text()).get("git"),
          {"deploymentEnabled": {"**": False, "main": True}})

print("── an older commit read from the repository URL when origin cannot serve it")

# Vercel's checkout has no `origin`, and its clone is shallow, so the previous
# deploy's commit is often missing. The repository is public: the commit is read
# from its URL instead. Here a local clone stands in for that URL.
with tempfile.TemporaryDirectory() as t:
    upstream = workspace(pathlib.Path(t) / "upstream")
    (upstream / "scripts").mkdir()
    for f in ("vercel-ignore-build.py", "ci-scope.py", "lockfile-fanout.py"):
        (upstream / "scripts" / f).write_text((HERE.parent / f).read_text())

    def u(*a: str, cwd: pathlib.Path = upstream) -> str:
        return subprocess.run(["git", "-C", str(cwd), *a], check=True,
                              capture_output=True, text=True).stdout.strip()

    ident = ("-c", "user.name=t", "-c", "user.email=t@t")
    u("init", "-q", "-b", "main")
    u(*ident, "add", "-A")
    u(*ident, "commit", "-qm", "base")
    previous = u("rev-parse", "HEAD")
    (upstream / "apps/mero-chat/app/index.html").write_text("<p>hi</p>")
    u(*ident, "add", "-A")
    u(*ident, "commit", "-qm", "chat")

    # Vercel's view: a one-commit-deep checkout of main's head, no origin.
    clone = pathlib.Path(t) / "clone"
    subprocess.run(["git", "clone", "-q", "--depth=1", f"file://{upstream}", str(clone)],
                   check=True)
    u("remote", "remove", "origin", cwd=clone)

    on_main = dict(VERCEL_GIT_COMMIT_REF="main", VERCEL_GIT_PREVIOUS_SHA=previous,
                   VERCEL_IGNORE_REPO_URL=f"file://{upstream}")
    check("main skips an app it does not change, with no origin",
          run(clone, FORUM, **on_main), vib.SKIP)
    check("and still builds the app it changes",
          run(clone, CHAT, **on_main), vib.BUILD)

if FAILURES:
    print(f"\n{len(FAILURES)} failed: {', '.join(FAILURES)}")
    sys.exit(1)
print("\nall passed")
