#!/usr/bin/env python3
"""Vercel's Ignored Build Step: skip an app's deploy when nothing it ships changed.

WHY THIS EXISTS

Every app is its own Vercel project, and every project is linked to this one
repository. Vercel's Git integration builds EVERY linked project on EVERY push,
to `main` and to each PR branch alike. So a one-line change to mero-chess paid
for twenty full `tsc -b && vite build` runs, nineteen of them producing the
exact bytes already deployed. That is most of the Vercel build bill.

Only `main` deploys. Each `vercel.json` disables Git deployments for every
other branch (`git.deploymentEnabled`), so a PR never reaches this script; if
one does anyway (a branch cut before that setting, a re-linked project), it is
skipped here too. No preview is worth a build of every app a catalog bump
touches.

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
    of them. A moved `packages/<p>` importer reaches <p>'s dependents, as a
    change to <p>'s own files does.
  * The root `package.json` and `tsconfig.base.json` reach every app, except
    a root `package.json` edit confined to scripts no install runs.
  * `packages/e2e-node` reaches no app. It is the browser e2e harness: apps
    list it only as a devDependency and import it only from tests and
    Playwright configs (TEST_ONLY_PACKAGES).
  * This script and the CI scope scripts it imports reach no app. Changing
    them changes no bundle; after fixing a skip that was wrong, redeploy the
    app that missed out from the dashboard.

Anything it cannot prove — no previous deploy to compare with, a base commit it
cannot fetch, a git error — BUILDS. A wasted build costs minutes; a skipped one
leaves a stale frontend in production with nothing to notice.

Run the tests: python3 scripts/tests/vercel-ignore-build-test.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

SKIP = 0
BUILD = 1

PRODUCTION_BRANCH = "main"

# Set in a deployment's build environment (`vercel deploy -b VERCEL_FORCE_BUILD=1`)
# to build whatever the branch and the diff say.
FORCE_ENV = "VERCEL_FORCE_BUILD"

# Workspace-wide files with no finer-grained rule: any edit reaches every app.
# The root package.json only counts when more than its `scripts` moved; see
# why_rebuild().
EVERY_APP_FILES = {
    "package.json",
    "tsconfig.base.json",
}

# Workspace packages that only tests import. A change to one cannot change a
# bundle, though ci-scope.py rightly maps it to every app for CI.
# scripts/tests/vercel-ignore-build-test.py fails if anything shipped depends on
# or imports one.
TEST_ONLY_PACKAGES = {"packages/e2e-node"}

LOGIC_RE = re.compile(r"^apps/[^/]+/logic/")


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

    def shipped(paths: list[str]) -> list[str]:
        return [p for p in paths
                if not any(p.startswith(f"{t}/") for t in TEST_ONLY_PACKAGES)]

    # pnpm-lock importers arrive as bare dirs (`apps/x/app`, `packages/p`);
    # give each a file so it maps the way a changed source file does, as
    # ci.yml does. catalog_fanout is only ever [] or [ALL], handled above.
    importers = shipped([f"{d}/package.json" for d in pnpm_lock_fanout])
    if app_dir in ci_scope.scope(importers, root)["frontend_dirs"]:
        return f"the lockfile moved {app_dir} or a package it imports"

    # The deployed bundle never reads logic/; see the module docstring.
    frontend_paths = shipped([p for p in changed if not LOGIC_RE.match(p)])
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

    Vercel's checkout has no `origin` that an older commit can be fetched from.
    The repository is public, so its URL serves it without credentials.
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
    for source in ("origin", repo_url()):
        if not source:
            continue
        try:
            git("fetch", "--quiet", "--depth=1", "--end-of-options", source, rev)
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


# Root scripts pnpm runs during Vercel's install; editing one can change a build.
INSTALL_SCRIPTS = {"preinstall", "install", "postinstall",
                   "preprepare", "prepare", "postprepare", "pnpm:devPreinstall"}


def root_manifest_moved(base: str, head: str) -> bool:
    """Whether the root package.json changed outside the `scripts` no app
    build runs. Unreadable or unparsable counts as moved."""
    try:
        b, h = (json.loads(fanout.read_rev(r, "package.json") or "")
                for r in (base, head))
    except ValueError:
        return True
    if not (isinstance(b, dict) and isinstance(h, dict)):
        return True
    for m in (b, h):
        scripts = m.pop("scripts", None)
        if isinstance(scripts, dict):
            m["scripts"] = {k: v for k, v in scripts.items() if k in INSTALL_SCRIPTS}
        elif scripts is not None:
            m["scripts"] = scripts
    return b != h


def why_rebuild(app_dir: str, base: str, head: str, changed: list[str]) -> str | None:
    def lock(kind: str, path: str) -> list[str]:
        if path not in changed:
            return []
        b, h = fanout.read_rev(base, path), fanout.read_rev(head, path)
        if b is None or h is None:
            return [fanout.ALL]
        return {"pnpm": fanout.pnpm_fanout, "catalog": fanout.catalog_fanout}[kind](b, h)

    if "package.json" in changed and not root_manifest_moved(base, head):
        changed = [p for p in changed if p != "package.json"]

    return reaches(app_dir, changed,
                   lock("pnpm", "pnpm-lock.yaml"),
                   lock("catalog", "pnpm-workspace.yaml"))


def main() -> int:
    app_dir = os.path.relpath(pathlib.Path.cwd().resolve(), ROOT)
    previous = os.environ.get("VERCEL_GIT_PREVIOUS_SHA", "").strip()
    head = os.environ.get("VERCEL_GIT_COMMIT_SHA", "").strip() or "HEAD"
    ref = os.environ.get("VERCEL_GIT_COMMIT_REF", "")

    if os.environ.get(FORCE_ENV) == "1":
        print(f"build: {FORCE_ENV}=1")
        return BUILD

    # Previews are off (see the module docstring). Only an unknown ref falls
    # through to the diff, because that cannot prove it is not production.
    if ref and ref != PRODUCTION_BRANCH:
        print(f"skip: {ref} is not {PRODUCTION_BRANCH}; only {PRODUCTION_BRANCH} deploys")
        return SKIP

    # Vercel sets it; anything but a full commit id is treated as absent
    # rather than handed to git.
    if previous and not re.fullmatch(r"[0-9a-f]{40}", previous):
        print(f"note: ignoring VERCEL_GIT_PREVIOUS_SHA={previous[:60]!r}")
        previous = ""

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
