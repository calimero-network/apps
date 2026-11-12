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
   "frontend_dirs": ["apps/<a>/app", "packages/<p>", ...]}  # pnpm --filter

`ci-scope.py components ...` answers the same question for components.yml,
per job rather than per app: see COMPONENTS_DOC below, or `--help`.

Run the tests: python3 scripts/tests/ci-scope-test.py
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent

APP_RE = re.compile(r"^apps/(?P<app>[^/]+)/(?P<rest>.+)$")
PKG_RE = re.compile(r"^packages/(?P<pkg>[^/]+)/")

# Files under an app that a CI job executes even though they sit outside app/
# and logic/. Keep this list short, and add to it only when ci.yml calls one.
CI_RUN_APP_FILES = {"scripts/local-rig.sh"}


def workspace_members(root: pathlib.Path) -> dict[str, dict]:
    """dir (relative to root) -> parsed package.json, for every pnpm member."""
    members: dict[str, dict] = {}
    for pattern in ("apps/*/app/package.json", "apps/*/mcp/package.json", "packages/*/package.json"):
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
                # The frontend job regenerates the client from the committed
                # ABI (logic/res/abi.json), so a contract change is its business.
                if (root / "apps" / app / "app").is_dir():
                    frontend.add(f"apps/{app}/app")
            elif rest.startswith("app/"):
                apps.add(app)
                frontend.add(f"apps/{app}/app")
            elif rest.startswith("mcp/"):
                # An app's MCP server (a pnpm member of its own, beside app/):
                # the frontend job typechecks, tests and builds it. No wasm.
                frontend.add(f"apps/{app}/mcp")
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
        "frontend_dirs": sorted(frontend),
    }


# ════════════════════════════════════════════════════════════════════════════
# `ci-scope.py components`: the per-JOB matrices of components.yml
# ════════════════════════════════════════════════════════════════════════════

COMPONENTS_DOC = """Which component apps a change reaches, and which jobs it reaches them in.

components.yml used to pick an app whenever ANY path under `apps/<app>/`
changed, and then ran every per-app job for it. So:

  * an Android-only PR (#865, `apps/*/mobile/android/**`) ran 66 jobs and 135
    runner-minutes of Rust, scenario e2e and frontend legs, none of which reads
    a byte of `mobile/`;
  * a frontend-only change rebuilt and re-tested the app's contract, which
    reads nothing under `app/` except its icon.

This decides per JOB, not per app:

  rust      fmt, clippy, cargo test, release build, ABI gate, dev bundle.
            Reads `apps/<a>/logic/**`, the files its logic manifest points at
            outside `logic/` (the icon), tools/component-bundle and the core pin.
  e2e       the app's scenarios on `merod local`, driven by packages/merod-local
            on mero-js. Reads the release wasm and the JS that runs it. Each leg
            is `{app, build}`: `build: false` takes the wasm from this run's
            `rust` leg, `build: true` (the contract did not change, only the JS
            that drives it) builds the release wasm itself instead of paying for
            the whole `rust` leg to get it.
  browser   an app's own Playwright suite (`app/playwright.config.ts`). Reads the
            app's frontend and contract, the workspace packages it imports, and
            any other app its e2e harness builds (mero-home's installs KV Store).
  cross_app e2e/cross-app: the apps its config and setup start or bundle.

The frontend (lint, typecheck, test, build, codegen) is ci.yml's `frontend`
job, scoped by `scope()` above; it is not this command's business.

What reaches EVERY app is computed, not listed per app: a workspace package
reaches the pnpm members that depend on it (transitively, read from the
package.json files, `dependents()` above), and the lockfiles and the
workspace manifest are judged by scripts/lockfile-fanout.py. Only the pipeline itself is
named here (`EVERYTHING`), because a change to it can change any answer.

USAGE

  ci-scope.py components --base REV [--head REV]   changed files from git (CI)
  ci-scope.py components --all                     everything (push, dispatch)
  ci-scope.py components PATH...                   these paths (try a diff locally)

  --explain   also print why, per path, to stderr

Prints one JSON object:

  {"all": bool, "rust": [app...], "e2e": [{"app", "build"}...],
   "browser": [app...], "cross_app": bool}

A lockfile among PATH... (no --base to compare against) counts as moving a
shared pin, which covers every app: the safe direction.

Run the tests: python3 scripts/tests/ci-scope-test.py
"""


def _load_fanout():
    spec = importlib.util.spec_from_file_location("lockfile_fanout", ROOT / "scripts" / "lockfile-fanout.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules.setdefault("lockfile_fanout", mod)
    spec.loader.exec_module(mod)
    return mod


fanout = _load_fanout()

ALL = "all"

# The pipeline: any change here can change what every leg does or which legs
# run, so it runs everything (these scripts' tests run in ci.yml's `metadata`).
EVERYTHING = re.compile(
    r"^("
    r"\.github/workflows/components\.yml"
    r"|\.github/actions/"
    r"|scripts/(component-apps\.sh|ci-scope\.py|lockfile-fanout\.py)"
    r"|tools/component-bundle/"
    r"|rust-toolchain(\.toml)?"
    r")"
)

# What runs the contract on a node: every e2e leg, every browser suite and the
# cross-app suite start their cluster through it.
RUNNER_PACKAGE = "packages/merod-local"

# JS that is everyone's by definition. The catalog and the lockfile are judged
# by lockfile-fanout.py instead (an arriving app only adds to them).
JS_EVERYONE = {"package.json", "tsconfig.base.json"}

C_APP_RE = re.compile(r"^apps/(?P<app>[^/]+)/(?P<rest>.+)$")
C_PKG_RE = re.compile(r"^(?P<member>(packages|e2e)/[^/]+)/")
CROSS_APP = "e2e/cross-app"

# In an e2e harness: `apps/<a>/logic`, `apps/<a>/app`, or the cross-app
# config's `devServer("<a>", …)` / `devBundle("<a>", …)`.
HARNESS_REF = re.compile(
    r"apps/(?P<app>[a-z0-9][a-z0-9-]*)/(?P<part>logic|app)\b"
    r"|dev(?P<kind>Server|Bundle)\(\s*[\"'](?P<named>[a-z0-9][a-z0-9-]*)[\"']"
)


# ── the repository, read once ───────────────────────────────────────────────


def component_apps(root: pathlib.Path) -> list[str]:
    """Same rule as scripts/component-apps.sh: logic/Cargo.toml takes calimero-sdk from git."""
    pat = re.compile(r"^calimero-sdk\s*=.*[{,]\s*git\s*=", re.M)
    out = []
    for manifest in sorted(root.glob("apps/*/logic/Cargo.toml")):
        try:
            if pat.search(manifest.read_text()):
                out.append(manifest.parent.parent.name)
        except OSError:
            continue
    return out


def _strings(node, key=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, k)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v, key)
    elif isinstance(node, str):
        yield key, node


def logic_inputs_outside(root: pathlib.Path, app: str) -> set[str]:
    """Files an app's logic manifests point at outside logic/ (its icon).

    `frontend-dir` is left out: the rust job bundles `--no-frontend`.
    """
    found: set[str] = set()
    logic = root / "apps" / app / "logic"
    for manifest in [logic / "Cargo.toml", *sorted(logic.glob("crates/*/Cargo.toml"))]:
        try:
            doc = tomllib.loads(manifest.read_text())
        except (OSError, tomllib.TOMLDecodeError):
            continue
        for key, value in _strings(doc):
            if key == "frontend-dir" or not value.startswith("../"):
                continue
            target = (manifest.parent / value).resolve()
            try:
                rel = target.relative_to(root.resolve()).as_posix()
            except ValueError:
                continue
            if not rel.startswith(f"apps/{app}/logic/"):
                found.add(rel)
    return found


def harness_refs(files: list[pathlib.Path], apps: set[str]) -> set[tuple[str, str]]:
    """(app, "logic"|"app") pairs an e2e harness builds or serves."""
    refs: set[tuple[str, str]] = set()
    for f in files:
        try:
            text = f.read_text()
        except OSError:
            continue
        for m in HARNESS_REF.finditer(text):
            if m["app"] in apps:
                refs.add((m["app"], m["part"]))
            elif m["named"] in apps:
                # A dev server is the app's frontend against its contract; a dev
                # bundle is its contract.
                refs.add((m["named"], "logic"))
                if m["kind"] == "Server":
                    refs.add((m["named"], "app"))
    return refs


def _harness_files(d: pathlib.Path, everything: bool = False) -> list[pathlib.Path]:
    """An app's Playwright config and e2e/; for a suite dir, all its TypeScript."""
    if everything:
        return sorted(p for p in d.rglob("*.ts") if p.is_file() and "node_modules" not in p.parts)
    files = sorted(d.glob("playwright*.config.ts"))
    if (d / "e2e").is_dir():
        files += sorted(p for p in (d / "e2e").rglob("*.ts") if p.is_file())
    return files


class Repo:
    def __init__(self, root: pathlib.Path):
        self.root = root
        self.apps = component_apps(root)
        apps = set(self.apps)
        self.icons = {a: logic_inputs_outside(root, a) for a in self.apps}
        self.browser_apps = [a for a in self.apps if (root / "apps" / a / "app" / "playwright.config.ts").is_file()]
        # browser app -> what its harness also builds or serves (besides itself)
        self.browser_refs = {
            a: harness_refs(_harness_files(root / "apps" / a / "app"), apps) - {(a, "logic"), (a, "app")}
            for a in self.browser_apps
        }
        self.cross_refs = harness_refs(_harness_files(root / CROSS_APP, everything=True), apps) if (root / CROSS_APP).is_dir() else set()
        self.members = workspace_members(root)
        for pj in sorted(root.glob(f"{CROSS_APP}/package.json")):
            try:
                self.members[CROSS_APP] = json.loads(pj.read_text())
            except (OSError, ValueError):
                pass


# ── the decision ────────────────────────────────────────────────────────────


class Scope:
    def __init__(self, repo: Repo):
        self.repo = repo
        self.all = False
        self.rust: set[str] = set()
        self.e2e: set[str] = set()
        self.browser: set[str] = set()
        self.cross_app = False
        self.why: list[str] = []

    def everything(self, why: str) -> None:
        self.all = True
        self.why.append(f"{why} -> every app, every job")

    def runner_everywhere(self, why: str) -> None:
        """The JS that drives a node changed: every e2e, browser and cross-app leg."""
        self.e2e |= set(self.repo.apps)
        self.browser |= set(self.repo.browser_apps)
        self.cross_app = True
        self.why.append(f"{why} -> e2e + browser + cross-app for every app (no Rust rebuild)")

    def touch(self, app: str, part: str, why: str) -> None:
        """`part` of `app` changed: "logic" (the contract) or "app" (the frontend)."""
        jobs = []
        if part == "logic":
            self.rust.add(app)
            self.e2e.add(app)
            jobs += ["rust", "e2e"]
        if app in self.repo.browser_apps:
            self.browser.add(app)
            jobs.append("browser")
        for b, refs in self.repo.browser_refs.items():
            if (app, part) in refs:
                self.browser.add(b)
                jobs.append(f"browser({b})")
        if (app, part) in self.repo.cross_refs:
            self.cross_app = True
            jobs.append("cross-app")
        self.why.append(f"{why} -> {', '.join(jobs) if jobs else 'nothing in this workflow'}")

    def package(self, member: str, why: str) -> None:
        reached = dependents(self.repo.members, {member})
        if RUNNER_PACKAGE in reached:
            self.runner_everywhere(why)
            return
        hit = []
        for d in sorted(reached):
            m = re.match(r"^apps/([^/]+)/app$", d)
            if m and m[1] in self.repo.apps:
                self.touch(m[1], "app", f"  {d} (imports {member})")
                hit.append(m[1])
            elif d == CROSS_APP:
                self.cross_app = True
                hit.append("cross-app")
        self.why.append(f"{why} -> reaches {', '.join(hit) if hit else 'no component app'}")

    def result(self) -> dict:
        if self.all:
            apps = list(self.repo.apps)
            return {
                "all": True,
                "rust": apps,
                "e2e": [{"app": a, "build": False} for a in apps],
                "browser": list(self.repo.browser_apps),
                "cross_app": bool(self.repo.cross_refs) or (self.repo.root / CROSS_APP).is_dir(),
            }
        e2e = sorted(self.e2e | self.rust)
        return {
            "all": False,
            "rust": sorted(self.rust),
            "e2e": [{"app": a, "build": a not in self.rust} for a in e2e],
            "browser": sorted(self.browser),
            "cross_app": self.cross_app,
        }


def decide(paths: list[str], repo: Repo, verdicts: dict[str, list[str]] | None = None) -> Scope:
    """`verdicts`: lockfile-fanout.py's answer per changed shared file
    ("manifest", "catalog", "pnpm"). A shared file with no verdict counts as `all`.
    """
    verdicts = verdicts or {}
    s = Scope(repo)
    importers: list[str] = []

    for p in (p.strip() for p in paths):
        if not p:
            continue
        if EVERYTHING.match(p):
            s.everything(p)
            continue
        if p == "Cargo.toml":
            v = verdicts.get("manifest", [ALL])
            if ALL in v:
                s.everything("Cargo.toml (the workspace or the core pin moved)")
            else:
                s.why.append("Cargo.toml (only [workspace].exclude) -> nothing")
            continue
        if p in JS_EVERYONE:
            s.runner_everywhere(p)
            continue
        if p == "pnpm-workspace.yaml":
            v = verdicts.get("catalog", [ALL])
            if ALL in v:
                s.runner_everywhere("pnpm-workspace.yaml (an existing catalog pin moved)")
            else:
                s.why.append("pnpm-workspace.yaml (only new catalog entries) -> nothing")
            continue
        if p == "pnpm-lock.yaml":
            v = verdicts.get("pnpm", [ALL])
            if ALL in v:
                s.runner_everywhere("pnpm-lock.yaml (shared resolution moved)")
            else:
                importers += v
                s.why.append(f"pnpm-lock.yaml -> only importers {v or '[]'}")
            continue
        if p.endswith(".md"):
            continue
        m = C_APP_RE.match(p)
        if m:
            app, rest = m["app"], m["rest"]
            if app not in repo.apps:
                continue
            if rest.startswith("logic/"):
                s.touch(app, "logic", p)
            elif p in repo.icons.get(app, set()):
                s.touch(app, "logic", f"{p} (packed by the logic manifest)")
            elif rest.startswith("app/"):
                s.touch(app, "app", p)
            # mobile/, README, LICENSE, CHANGELOG: no job here reads them.
            continue
        m = C_PKG_RE.match(p)
        if m:
            s.package(m["member"], p)
            continue
        # docs/, other workflows, scripts/check-*.py (run by `checks`/ci.yml), ...

    for imp in importers:
        imp = imp.rstrip("/")
        m = re.match(r"^apps/([^/]+)/app$", imp)
        if m and m[1] in repo.apps:
            s.touch(m[1], "app", f"{imp} (its pnpm resolution moved)")
        elif C_PKG_RE.match(imp + "/"):
            s.package(imp, f"{imp} (its pnpm resolution moved)")
    return s


# ── git ─────────────────────────────────────────────────────────────────────


def changed_files(base: str, head: str) -> list[str] | None:
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", f"{base}...{head}"], cwd=ROOT, capture_output=True, check=True, text=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return out.stdout.split()


def git_verdicts(paths: list[str], base: str, head: str) -> dict[str, list[str]]:
    kinds = {"Cargo.toml": "manifest", "pnpm-workspace.yaml": "catalog", "pnpm-lock.yaml": "pnpm"}
    out: dict[str, list[str]] = {}
    for path, kind in kinds.items():
        if path not in paths:
            continue
        before, after = fanout.read_rev(base, path), fanout.read_rev(head, path)
        if before is None or after is None:
            out[kind] = [ALL]
        elif kind == "manifest":
            out[kind] = fanout.manifest_fanout(before, after, "components")
        elif kind == "catalog":
            out[kind] = fanout.catalog_fanout(before, after)
        else:
            out[kind] = fanout.pnpm_fanout(before, after)
    return out


def components_main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="ci-scope.py components", description=COMPONENTS_DOC, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--base")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--explain", action="store_true")
    args = ap.parse_args(argv)

    repo = Repo(ROOT)
    if args.all:
        s = Scope(repo)
        s.everything("--all")
    elif args.base:
        paths = None if set(args.base) <= {"0"} else changed_files(args.base, args.head)
        if paths is None:
            s = Scope(repo)
            s.everything(f"no usable base ({args.base})")
        else:
            s = decide(paths, repo, git_verdicts(paths, args.base, args.head))
    else:
        s = decide(args.paths or sys.stdin.read().split(), repo)

    if args.explain:
        for line in s.why:
            print(f"  {line}", file=sys.stderr)
    print(json.dumps(s.result()))
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["components"]:
        return components_main(argv[1:])
    paths = sys.stdin.read().split()
    print(json.dumps(scope(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
