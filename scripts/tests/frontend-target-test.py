#!/usr/bin/env python3
"""Tests for scripts/frontend-target.sh: the cluster a bundle's frontend is built for.

A staging bundle whose frontend is built for the production cluster publishes
fine, passes every check, and signs its users in against production. So the
refusals are pinned: an environment that lacks CALIMERO_CLUSTER or
CALIMERO_DIRECTORY, or only inherits them from the repository/organization,
fails and prints nothing; production keeps today's values.

Run: python3 scripts/tests/frontend-target-test.py
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "frontend-target.sh"
PROD_DIRECTORY = "https://manager.cloud.calimero.network/api/directory"
STAGING_DIRECTORY = "https://manager.staging.cloud.calimero.network/api/directory"
KEYS = (
    "ENVIRONMENT",
    "CLUSTER",
    "DIRECTORY",
    "MIN_RELEASE",
    "OUTSIDE_CLUSTER",
    "OUTSIDE_DIRECTORY",
    "OUTSIDE_MIN_RELEASE",
)

FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got == want:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}\n         got  {got!r}\n         want {want!r}")
        FAILURES.append(name)


def run(**given: str) -> tuple[int, dict[str, str], str, str]:
    env = {k: v for k, v in os.environ.items() if k not in KEYS}
    env.update(given)
    p = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, check=False
    )
    out = dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)
    return p.returncode, out, p.stdout, p.stderr


def resolves(name: str, want: dict[str, str], **given: str) -> None:
    code, out, _, err = run(**given)
    check(f"{name}: exits 0", code, 0)
    check(f"{name}: resolves", out, want)
    if code:
        print(err)


def refuses(name: str, why: str, **given: str) -> None:
    code, _, stdout, err = run(**given)
    check(f"{name}: exits non-zero", code != 0, True)
    # release jobs append stdout to $GITHUB_OUTPUT: no partial answer.
    check(f"{name}: prints nothing", stdout, "")
    check(f"{name}: says why", why in err, True)


# Production is the repository variables, read the same inside and outside the
# job (there is no environment), exactly as before this script.
REPO = {"OUTSIDE_CLUSTER": "", "OUTSIDE_DIRECTORY": "", "OUTSIDE_MIN_RELEASE": "2.3.137"}

print("production (no environment): today's values")
resolves(
    "repository floor, no cluster",
    {"cluster": "", "floor_cluster": "eu-shared-1", "directory": PROD_DIRECTORY, "min_release": "2.3.137", "cloud_env": ""},
    ENVIRONMENT="", CLUSTER="", DIRECTORY="", MIN_RELEASE="2.3.137", **REPO,
)
resolves(
    "repository cluster set",
    {"cluster": "eu-shared-2", "floor_cluster": "eu-shared-2", "directory": PROD_DIRECTORY, "min_release": "", "cloud_env": ""},
    ENVIRONMENT="", CLUSTER="eu-shared-2", OUTSIDE_CLUSTER="eu-shared-2",
)
resolves(
    "a CALIMERO_DIRECTORY variable does not move production",
    {"cluster": "", "floor_cluster": "eu-shared-1", "directory": PROD_DIRECTORY, "min_release": "", "cloud_env": ""},
    ENVIRONMENT="", DIRECTORY=STAGING_DIRECTORY, OUTSIDE_DIRECTORY=STAGING_DIRECTORY,
)
refuses("production floor not X.Y.Z", "not X.Y.Z", ENVIRONMENT="", MIN_RELEASE="latest")

print("staging environment: its own variables")
STAGING = dict(ENVIRONMENT="staging", CLUSTER="staging-shared-2", DIRECTORY=STAGING_DIRECTORY, **REPO)
resolves(
    "own cluster and directory; repository floor not inherited",
    {"cluster": "staging-shared-2", "floor_cluster": "staging-shared-2", "directory": STAGING_DIRECTORY, "min_release": "", "cloud_env": "staging"},
    **{**STAGING, "MIN_RELEASE": "2.3.137"},
)
resolves(
    "own floor",
    {"cluster": "staging-shared-2", "floor_cluster": "staging-shared-2", "directory": STAGING_DIRECTORY, "min_release": "2.3.140", "cloud_env": "staging"},
    **{**STAGING, "MIN_RELEASE": "2.3.140"},
)
resolves(
    "no floor: derived later",
    {"cluster": "staging-shared-2", "floor_cluster": "staging-shared-2", "directory": STAGING_DIRECTORY, "min_release": "", "cloud_env": "staging"},
    **{**STAGING, "MIN_RELEASE": "", "OUTSIDE_MIN_RELEASE": ""},
)
resolves(
    "trailing slash on the directory is dropped",
    {"cluster": "staging-shared-2", "floor_cluster": "staging-shared-2", "directory": STAGING_DIRECTORY, "min_release": "", "cloud_env": "staging"},
    **{**STAGING, "DIRECTORY": STAGING_DIRECTORY + "/"},
)

print("staging fails closed")
refuses("no cluster", "sets no variable CALIMERO_CLUSTER", **{**STAGING, "CLUSTER": ""})
refuses(
    "cluster inherited from the repository",
    "the repository/organization value",
    **{**STAGING, "CLUSTER": "eu-shared-1", "OUTSIDE_CLUSTER": "eu-shared-1"},
)
refuses("production cluster set on the environment", "production cluster", **{**STAGING, "CLUSTER": "eu-shared-1"})
refuses("no directory", "sets no variable CALIMERO_DIRECTORY", **{**STAGING, "DIRECTORY": ""})
refuses("production directory", "production or repository", **{**STAGING, "DIRECTORY": PROD_DIRECTORY})
refuses("production directory with a slash", "production or repository", **{**STAGING, "DIRECTORY": PROD_DIRECTORY + "/"})
refuses(
    "directory inherited from the repository",
    "production or repository",
    **{**STAGING, "OUTSIDE_DIRECTORY": STAGING_DIRECTORY},
)
refuses("directory not https", "not an https URL", **{**STAGING, "DIRECTORY": "http://manager.staging.cloud.calimero.network/api/directory"})
refuses("cluster not a name", "not a cluster name", **{**STAGING, "CLUSTER": "Staging Shared"})
refuses("own floor not X.Y.Z", "not X.Y.Z", **{**STAGING, "MIN_RELEASE": "2.3"})

print("an environment that names no Calimero Cloud fails closed")
# Its frontend would get no VITE_CALIMERO_ENV, and link to and trust production.
refuses("unknown environment", "names no Calimero Cloud", **{**STAGING, "ENVIRONMENT": "preview"})

if FAILURES:
    print(f"\n{len(FAILURES)} failure(s)")
    sys.exit(1)
print("\nall ok")
