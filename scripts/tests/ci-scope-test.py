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
    none = {"app_paths": [], "frontend_dirs": []}
    check("a dev script beside the app", s("apps/mero-design/scripts/dev-node.sh"), none)
    check("an app README", s("apps/mero-chat/README.md"), none)
    check("markdown inside app/", s("apps/mero-chat/app/docs/notes.md"), none)
    check("a root-level app file", s("apps/mero-chat/permissions-testing.sh", "apps/mero-chat/Makefile"), none)
    check("repo-level scripts are not apps", s("scripts/check-app-icons.py"), none)

    print("── what must")
    check("a frontend file", s("apps/mero-chat/app/src/x.ts"),
          {"app_paths": ["apps/mero-chat/"], "frontend_dirs": ["apps/mero-chat/app"]})
    check("a contract file reaches the wasm build AND the codegen check", s("apps/mero-chat/logic/res/abi.json"),
          {"app_paths": ["apps/mero-chat/"], "frontend_dirs": ["apps/mero-chat/app"]})
    check("a contract with no frontend dir", s("apps/kv-only/logic/src/lib.rs"),
          {"app_paths": ["apps/kv-only/"], "frontend_dirs": []})
    check("the rig the rich browser job boots", s("apps/mero-docs/scripts/local-rig.sh"),
          {"app_paths": ["apps/mero-docs/"], "frontend_dirs": []})

    print("── shared packages reach their dependents, transitively")
    check("invite → forum", s("packages/invite/src/index.ts"),
          {"app_paths": ["apps/mero-forum/"], "frontend_dirs": ["apps/mero-forum/app", "packages/invite"]})
    check("join-sync → invite → forum, and pass via devDependencies", s("packages/join-sync/src/a.ts"),
          {"app_paths": ["apps/mero-forum/", "apps/mero-pass/"], "frontend_dirs": ["apps/mero-forum/app", "apps/mero-pass/app",
                             "packages/invite", "packages/join-sync"]})
    check("an app that imports no package is not reached", "apps/mero-chat/" in s("packages/invite/x.ts")["app_paths"], False)

# ════════════════════════════════════════════════════════════════════════════
# `ci-scope.py components`: per-job matrices for components.yml
# ════════════════════════════════════════════════════════════════════════════

COMPONENT = """[package]
name = "{app}"
[dependencies]
calimero-sdk = {{ git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.18" }}
[package.metadata.calimero]
icon = "../app/public/icon-512.png"
frontend-dir = "../app/dist"
"""


def fixture(t: pathlib.Path) -> pathlib.Path:
    def write(path: str, text: str) -> None:
        (t / path).parent.mkdir(parents=True, exist_ok=True)
        (t / path).write_text(text)

    def pj(d: str, body: dict) -> None:
        write(f"{d}/package.json", json.dumps(body))

    for app in ("alpha", "beta", "gamma"):
        write(f"apps/{app}/logic/Cargo.toml", COMPONENT.format(app=app))
    # A v1 app: calimero-sdk from the root workspace, not from git.
    write("apps/legacy/logic/Cargo.toml", '[package]\nname = "legacy"\n[dependencies]\ncalimero-sdk.workspace = true\n')

    pj("packages/merod-local", {"name": "@x/merod-local"})
    pj("packages/ui", {"name": "@x/ui"})
    pj("packages/theme", {"name": "@x/theme"})
    pj("packages/widgets", {"name": "@x/widgets", "dependencies": {"@x/theme": "workspace:*"}})
    pj("apps/alpha/app", {"name": "alpha"})
    pj("apps/beta/app", {"name": "beta", "dependencies": {"@x/ui": "workspace:*"}})
    pj("apps/gamma/app", {"name": "gamma", "devDependencies": {"@x/widgets": "workspace:*"}})
    pj("apps/legacy/app", {"name": "legacy", "dependencies": {"@x/ui": "workspace:*"}})
    # beta has its own Playwright suite, whose setup bundles alpha's contract.
    write("apps/beta/app/playwright.config.ts", "export default {};\n")
    write("apps/beta/app/e2e/global-setup.ts", 'run(["bundle", "apps/alpha/logic", "--dev"]);\n')
    # The cross-app suite serves gamma and bundles alpha.
    pj("e2e/cross-app", {"name": "@x/cross-app-e2e"})
    write("e2e/cross-app/playwright.config.ts", 'webServer: [devServer("gamma", 1)],\n')
    write("e2e/cross-app/global-setup.ts", 'const mpk = devBundle("alpha", "com.x.alpha");\n')
    return t


def short(r: dict) -> dict:
    return {
        "rust": r["rust"],
        "e2e": {e["app"]: e["build"] for e in r["e2e"]},
        "browser": r["browser"],
        "cross_app": r["cross_app"],
    }


NONE = {"rust": [], "e2e": {}, "browser": [], "cross_app": False}

with tempfile.TemporaryDirectory() as t:
    repo = cs.Repo(fixture(pathlib.Path(t)))

    def s(*paths: str, verdicts=None) -> dict:
        r = cs.decide(list(paths), repo, verdicts).result()
        return {"all": True} if r["all"] else short(r)

    check("component apps are the git-pinned ones", repo.apps, ["alpha", "beta", "gamma"])

    print("── what must NOT select anything")
    check("mobile only", s("apps/alpha/mobile/android/app/src/Main.kt", "apps/beta/mobile/ios/project.yml"), NONE)
    check("README / LICENSE / CHANGELOG", s("apps/alpha/README.md", "apps/alpha/LICENSE", "apps/beta/CHANGELOG.md"), NONE)
    check("a markdown file inside logic/", s("apps/alpha/logic/NOTES.md"), NONE)
    check("docs and repo guards", s("docs/COMPONENT-APPS.md", "scripts/check-app-icons.py", "README.md"), NONE)
    check("another workflow", s(".github/workflows/ci.yml", ".github/workflows/mero-chat-ios.yml"), NONE)
    check("a v1 app", s("apps/legacy/logic/src/lib.rs", "apps/legacy/app/src/main.tsx"), NONE)
    check("frontend of an app with no suite and no harness link", s("apps/alpha/app/src/App.tsx"), NONE)
    check("a package no component app imports", s("packages/theme/src/x.ts".replace("theme", "nothing")), NONE)
    check("Cargo.toml: only [workspace].exclude moved", s("Cargo.toml", verdicts={"manifest": []}), NONE)
    check("Cargo.lock (root, v1 only)", s("Cargo.lock"), NONE)
    check("catalog: only new entries", s("pnpm-workspace.yaml", verdicts={"catalog": []}), NONE)
    check("pnpm-lock: a new importer of a v1 app", s("pnpm-lock.yaml", verdicts={"pnpm": ["apps/legacy/app"]}), NONE)

    print("── a contract")
    check(
        "alpha's logic: its rust + e2e, beta's suite (bundles alpha), cross-app (bundles alpha)",
        s("apps/alpha/logic/src/lib.rs"),
        {"rust": ["alpha"], "e2e": {"alpha": False}, "browser": ["beta"], "cross_app": True},
    )
    check(
        "gamma's logic: no suite links to it but cross-app's dev server",
        s("apps/gamma/logic/Cargo.lock"),
        {"rust": ["gamma"], "e2e": {"gamma": False}, "browser": [], "cross_app": True},
    )
    check(
        "the icon the logic manifest packs",
        s("apps/beta/app/public/icon-512.png"),
        {"rust": ["beta"], "e2e": {"beta": False}, "browser": ["beta"], "cross_app": False},
    )

    print("── a frontend")
    check("beta's frontend: its own suite only", s("apps/beta/app/src/App.tsx"), {**NONE, "browser": ["beta"]})
    check("gamma's frontend: cross-app serves it", s("apps/gamma/app/src/App.tsx"), {**NONE, "cross_app": True})

    print("── a workspace package")
    check("packages/ui reaches beta (and legacy, not a component app)", s("packages/ui/src/a.ts"), {**NONE, "browser": ["beta"]})
    check("packages/theme reaches gamma transitively via widgets", s("packages/theme/src/a.ts"), {**NONE, "cross_app": True})
    check("e2e/cross-app itself", s("e2e/cross-app/cross-app.spec.ts"), {**NONE, "cross_app": True})
    check(
        "pnpm-lock: beta's importer moved",
        s("pnpm-lock.yaml", verdicts={"pnpm": ["apps/beta/app"]}),
        {**NONE, "browser": ["beta"]},
    )

    runner = {"rust": [], "e2e": {"alpha": True, "beta": True, "gamma": True}, "browser": ["beta"], "cross_app": True}
    print("── the JS that drives a node: every e2e, built in the e2e leg, no rust leg")
    check("packages/merod-local", s("packages/merod-local/src/cli.ts"), runner)
    check("root package.json", s("package.json"), runner)
    check("catalog pin moved", s("pnpm-workspace.yaml", verdicts={"catalog": ["all"]}), runner)
    check("pnpm-lock shared resolution moved", s("pnpm-lock.yaml", verdicts={"pnpm": ["all"]}), runner)
    check("a lockfile with no verdict (no base) is the safe answer", s("pnpm-lock.yaml"), runner)
    check(
        "runner + one contract: that one comes from rust, the rest build",
        s("packages/merod-local/src/cli.ts", "apps/beta/logic/src/lib.rs"),
        {"rust": ["beta"], "e2e": {"alpha": True, "beta": False, "gamma": True}, "browser": ["beta"], "cross_app": True},
    )

    print("── everything")
    for p in (
        ".github/workflows/components.yml",
        ".github/actions/setup-playwright/action.yml",
        "tools/component-bundle/src/main.rs",
        "scripts/component-apps.sh",
        "scripts/lockfile-fanout.py",
        "scripts/ci-scope.py",
    ):
        check(p, s(p), {"all": True})
    check("Cargo.toml: the core pin moved", s("Cargo.toml", verdicts={"manifest": ["all"]}), {"all": True})
    check("Cargo.toml with no verdict", s("Cargo.toml"), {"all": True})
    full = cs.decide([".github/workflows/components.yml"], repo).result()
    check("everything = every app built in rust, no e2e self-build", {e["build"] for e in full["e2e"]}, {False})
    check("everything covers each app once", full["rust"], ["alpha", "beta", "gamma"])

print("── the real repository's harness links")
real = cs.Repo(cs.ROOT)
check("mero-home's suite bundles KV Store's contract", ("kv-store", "logic") in real.browser_refs.get("mero-home", set()), True)
check(
    "cross-app serves Chat, Home and KV Store",
    {a for a, _ in real.cross_refs} >= {"mero-chat", "mero-home", "kv-store"},
    True,
)
outside = [a for a in real.apps if 'icon = "../' in (cs.ROOT / "apps" / a / "logic" / "Cargo.toml").read_text().replace("icon        =", "icon =")]
check("an icon outside logic/ is found for every app that has one", [a for a in outside if not real.icons[a]], [])
check("...and that is most apps (the scan is not silently empty)", len(outside) > len(real.apps) // 2, True)

if FAILURES:
    print(f"\n{len(FAILURES)} failed: {', '.join(FAILURES)}")
    sys.exit(1)
print("\nall passed")
