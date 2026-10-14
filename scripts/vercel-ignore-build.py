#!/usr/bin/env python3
"""Vercel's Ignored Build Step: skip an app's deploy when nothing it ships changed.

WHY THIS EXISTS

Every app is its own Vercel project, and every project is linked to this one
repository. Vercel's Git integration builds EVERY linked project on EVERY push,
to `main` and to each PR branch alike. So a one-line change to mero-chess paid
for twenty full `tsc -b && vite build` runs, nineteen of them producing the
exact bytes already deployed. That is most of the Vercel build bill.

Each `apps/<app>/app/vercel.json` names this script as its `ignoreCommand`.
Vercel runs it from the project's Root Directory before installing anything:

  exit 0  -> skip this deploy (Vercel marks it "Canceled by Ignored Build Step")
  exit 1  -> build as usual

WHAT COUNTS AS A CHANGE

The same rules CI already uses to scope its frontend job, imported rather than
copied so the two cannot drift:

  * `apps/<app>/app/**` reaches <app>. `apps/<app>/logic/**` does NOT: the
    deployed bundle is built from the committed generated client, and CI's
    codegen-diff check makes an ABI change touch `app/` in the same commit.
  * `packages/<p>/**` reaches every app that depends on <p>, transitively
    (scripts/ci-scope.py).
  * `pnpm-lock.yaml` and `pnpm-workspace.yaml` reach the apps whose resolution
    actually moved (scripts/lockfile-fanout.py), which for a catalog bump is all
    of them.
  * The root `package.json`, `tsconfig.base.json` and this script reach every app.

Anything it cannot prove — no previous deploy to compare with, a base commit it
cannot fetch, a git error — BUILDS. A wasted build costs minutes; a skipped one
leaves a stale frontend in production with nothing to notice.

Run the tests: python3 scripts/tests/vercel-ignore-build-test.py
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

SKIP = 0
BUILD = 1

PRODUCTION_BRANCH = "main"

# Workspace-wide files with no finer-grained rule: any edit reaches every app.
EVERY_APP_FILES = {
    "package.json",
    "tsconfig.base.json",
    "scripts/vercel-ignore-build.py",
    "scripts/ci-scope.py",
    "scripts/lockfile-fanout.py",
}


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


ci_scope = _load("ci_scope", "ci-scope.py")
fanout = _load("lockfile_fanout", "lockfile-fanout.py")


def reaches(
    app_dir: str,
    changed: list[str],
    pnpm_lock_fanout: list[str],
    catalog_fanout: list[str],
    root: pathlib.Path = ROOT,
) -> str | None:
    """Why `app_dir` must rebuild for this change set, or None when it need not.

    `*_fanout` are lockfile-fanout.py's answers for the two pnpm files, empty
    when the file did not change.
    """
    for p in changed:
        if p in EVERY_APP_FILES:
            return f"{p} changed"

    for answer, what in ((pnpm_lock_fanout, "pnpm-lock.yaml"),
                         (catalog_fanout, "pnpm-workspace.yaml")):
        if fanout.ALL in answer:
            return f"{what} changed for every app"
        if app_dir in answer:
            return f"{what} changed for {app_dir}"

    # The deployed bundle never reads logic/; see the module docstring.
    frontend_paths = [p for p in changed if "/logic/" not in p]
    dirs = ci_scope.scope(frontend_paths, root)["frontend_dirs"]
    if app_dir in dirs:
        return f"{app_dir} or a package it imports changed"
    return None


# ── git glue ────────────────────────────────────────────────────────────────


def git(*args: str) -> str:
    # Never wait on a credential prompt: a fetch that needs one fails, and the
    # caller falls back to building.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True, env=env
    ).stdout


def have(rev: str) -> bool:
    try:
        git("cat-file", "-e", f"{rev}^{{commit}}")
        return True
    except subprocess.CalledProcessError:
        return False


def repo_url() -> str | None:
    """The repository's public URL, from Vercel's own variables.

    Vercel's checkout has no `origin` that main can be fetched from, so a PR's
    first push could not read main and built every app. The repository is
    public, so its URL serves main without credentials.
    """
    if url := os.environ.get("VERCEL_IGNORE_REPO_URL", "").strip():
        return url
    owner = os.environ.get("VERCEL_GIT_REPO_OWNER", "").strip()
    slug = os.environ.get("VERCEL_GIT_REPO_SLUG", "").strip()
    if os.environ.get("VERCEL_GIT_PROVIDER", "github") == "github" and owner and slug:
        return f"https://github.com/{owner}/{slug}.git"
    return None


def ensure(rev: str) -> bool:
    """Make `rev` readable. Vercel clones shallow (depth 10), and the last
    deployed commit is often older; a diff needs only the two trees, so one
    commit's worth of history is enough."""
    if have(rev):
        return True
    remote = rev.removeprefix("origin/")
    refspec = f"{remote}:refs/remotes/origin/{remote}" if remote != rev else rev
    for source in ("origin", repo_url()):
        if not source:
            continue
        try:
            git("fetch", "--quiet", "--depth=1", source, refspec)
        except subprocess.CalledProcessError as e:
            print(f"note: cannot fetch {rev} from {source}: {e.stderr.strip()[:200]}")
            continue
        if have(rev):
            return True
    return False


def changed_between(base: str, head: str) -> list[str] | None:
    """Files that differ between two commits, or None when git cannot tell."""
    if not ensure(base):
        return None
    try:
        return git("diff", "--name-only", base, head).split()
    except subprocess.CalledProcessError:
        return None


def why_rebuild(app_dir: str, base: str, head: str, changed: list[str]) -> str | None:
    def lock(kind: str, path: str) -> list[str]:
        if path not in changed:
            return []
        b, h = fanout.read_rev(base, path), fanout.read_rev(head, path)
        if b is None or h is None:
            return [fanout.ALL]
        return {"pnpm": fanout.pnpm_fanout, "catalog": fanout.catalog_fanout}[kind](b, h)

    return reaches(app_dir, changed,
                   lock("pnpm", "pnpm-lock.yaml"),
                   lock("catalog", "pnpm-workspace.yaml"))


def main() -> int:
    app_dir = os.path.relpath(pathlib.Path.cwd().resolve(), ROOT)
    previous = os.environ.get("VERCEL_GIT_PREVIOUS_SHA", "").strip()
    head = os.environ.get("VERCEL_GIT_COMMIT_SHA", "").strip() or "HEAD"
    ref = os.environ.get("VERCEL_GIT_COMMIT_REF", "")

    # A PR branch previews only the apps the PR itself changes. Compared with
    # main's tip, a branch that has merged main differs only by its own work, so
    # an app the PR leaves alone skips even when merging main moved it since the
    # branch's last deploy. (A branch behind main also counts main's newer
    # changes here: that over-builds, never under-builds.) If main cannot be
    # read, fall through to the previous-deploy rule below.
    if ref and ref != PRODUCTION_BRANCH and ensure(f"origin/{PRODUCTION_BRANCH}"):
        main_tip = git("rev-parse", f"origin/{PRODUCTION_BRANCH}").strip()
        vs_main = changed_between(main_tip, head)
        if vs_main is not None and not why_rebuild(app_dir, main_tip, head, vs_main):
            print(f"skip: this branch does not change {app_dir} relative to "
                  f"{PRODUCTION_BRANCH} ({len(vs_main)} files changed elsewhere)")
            return SKIP
        if not previous:
            # A branch's first push has no deploy of its own; the PR changes
            # this app, so build it.
            print(f"build: this branch changes {app_dir} relative to {PRODUCTION_BRANCH}")
            return BUILD

    if not previous:
        print(f"build: no previous deploy of {app_dir} on this branch to compare with")
        return BUILD

    changed = changed_between(previous, head)
    if changed is None:
        print(f"build: cannot diff against the previous deploy's commit {previous}")
        return BUILD

    why = why_rebuild(app_dir, previous, head, changed)
    if why:
        print(f"build: {why} since {previous[:12]}")
        return BUILD
    print(f"skip: nothing {app_dir} ships changed since {previous[:12]} "
          f"({len(changed)} files changed elsewhere)")
    return SKIP


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never let a bug in here skip a real deploy
        print(f"build: vercel-ignore-build.py failed ({e!r}); building to be safe")
        sys.exit(BUILD)
