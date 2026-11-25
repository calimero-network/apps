#!/usr/bin/env python3
"""Tests for scripts/registry-target.sh: which registry a Release run publishes to.

Wrong here is silent and irreversible. A staging branch resolved to production
publishes a version nobody can withdraw; production resolved to staging ships
nothing while every run is green; and an unknown branch that resolves to
ANYTHING publishes from a branch nobody meant to release from. So the refusals
are pinned next to the two branches that must resolve.

Run: python3 scripts/tests/registry-target-test.py
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "registry-target.sh"
PROD = "https://apps.calimero.network"
STAGING = "https://apps.staging.cloud.calimero.network"

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}\n         got  {got!r}\n         want {want!r}")
        FAILURES.append(name)


def run(*args: str) -> tuple[int, dict[str, str], str]:
    p = subprocess.run(
        ["bash", str(SCRIPT), *args], capture_output=True, text=True, check=False
    )
    out = dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)
    return p.returncode, out, p.stdout


def resolves(ref: str, want: dict[str, str]) -> None:
    code, out, _ = run(ref)
    check(f"{ref} exits 0", code, 0)
    check(f"{ref} resolves", out, want)


def refuses(name: str, *args: str) -> None:
    code, _, stdout = run(*args)
    check(f"{name}: exits non-zero", code != 0, True)
    # Nothing on stdout: release.yml appends stdout to $GITHUB_OUTPUT, and a
    # partial answer must not reach it.
    check(f"{name}: prints nothing", stdout, "")


print("branches that publish")
resolves(
    "refs/heads/main",
    {"registry_url": PROD, "environment": "", "publish_on_push": "gated"},
)
resolves(
    "refs/heads/staging-test",
    {"registry_url": STAGING, "environment": "staging", "publish_on_push": "always"},
)

print("fail closed")
refuses("no ref")
refuses("empty ref", "")
refuses("unknown branch", "refs/heads/feature/x")
refuses("future prod branch, not mapped yet", "refs/heads/prod")
refuses("branch named like a mapped one", "refs/heads/main-old")
refuses("bare branch name, not a ref", "main")
refuses("tag", "refs/tags/main")
refuses("pull-request ref", "refs/pull/1/merge")
refuses("empty branch", "refs/heads/")

# The guard that keeps the production key off other hosts: any registry but
# production must come with an environment. Exercised on a copy of the script
# with the staging line's environment blanked, the mistake it exists for.
print("a non-production registry without an environment")
broken = SCRIPT.read_text().replace(
    "registry_url=$STAGING environment=staging", "registry_url=$STAGING environment=\"\""
)
if broken == SCRIPT.read_text():
    check("the staging line is where this test expects it", False, True)
else:
    p = subprocess.run(
        ["bash", "-s", "refs/heads/staging-test"],
        input=broken,
        capture_output=True,
        text=True,
        check=False,
    )
    check("refused", p.returncode != 0, True)
    check("prints nothing", p.stdout, "")

# The scripts the publish calls default to production when CALIMERO_REGISTRY_URL
# is UNSET (a laptop run). Set but empty means the mapped URL was lost on the
# way, and must stop the run rather than read as production.
print("an empty registry is not production")
SCRIPTS = SCRIPT.parent
for name, argv in (
    ("registry-release.sh next-version", ["bash", str(SCRIPTS / "registry-release.sh"), "next-version", "com.example.x"]),
    ("registry-release.sh check-signer", ["bash", str(SCRIPTS / "registry-release.sh"), "check-signer", "com.example.x", "did:key:z6Mk"]),
    ("registry-unchanged.py", [sys.executable, str(SCRIPTS / "registry-unchanged.py"), "/dev/null", "com.example.x"]),
):
    p = subprocess.run(
        argv,
        env={**os.environ, "CALIMERO_REGISTRY_URL": ""},
        capture_output=True,
        text=True,
        check=False,
    )
    check(f"{name}: refused", p.returncode, 2)
    check(f"{name}: says why", "set but empty" in p.stderr, True)
    check(f"{name}: prints nothing", p.stdout, "")

if FAILURES:
    print(f"\n{len(FAILURES)} failure(s)")
    sys.exit(1)
print("\nall ok")
