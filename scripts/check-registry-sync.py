#!/usr/bin/env python3
"""Is what the registry serves the same code as `main`?

    scripts/check-registry-sync.py --bundles DIR      # compare local .mpk files
    scripts/check-registry-sync.py --bundles DIR --only battleships,mero-forum
    scripts/check-registry-sync.py --list             # just show what is published

Nothing else answers this. `Release` publishes on every push to `main` touching
`apps/*/logic/**`, but a failed run, a skipped path filter, or a hand-reverted
commit all leave the registry serving code that `main` no longer contains — and
the symptom is a user hitting a bug that was fixed weeks ago.

⚠️ The obvious check is wrong. Comparing `logic/Cargo.toml`'s `version` to the
registry's `appVersion` proves nothing: publish-bundle.yml says "THE REGISTRY
OWNS THE VERSION" — it asks the registry for the highest published version and
increments the patch, never reading Cargo.toml. Those numbers are unrelated by
design, and reading a mismatch as "unpublished" is a false alarm for every app.

So this compares the WASM BYTES. For each app it downloads the published bundle,
and compares the sha256 of every `services/*.wasm` member against the same
members of a locally built bundle. Equal bytes mean the registry is serving this
source; different bytes mean it is not, whatever the version numbers say.

Where to get the local bundles without a cargo build: CI already builds one per
app and uploads it as `mpk-<app>-<sha>`.

    gh run download <run-id> -n mpk-battleships-<sha> -D /tmp/b

⚠️ Those artifacts are named after the MERGE commit, not the PR head, so
`$(git rev-parse HEAD)` will not find them — list the run's artifacts and match
by name.
"""

import argparse
import glob
import hashlib
import io
import json
import os
import pathlib
import re
import sys
import tarfile
import urllib.error
import urllib.request

REGISTRY = os.environ.get("CALIMERO_REGISTRY", "https://apps.calimero.network")
REPO = pathlib.Path(__file__).resolve().parents[1]

GREEN, RED, YELLOW, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def published():
    """package -> newest published bundle record."""
    with urllib.request.urlopen(f"{REGISTRY}/api/v2/bundles?fresh=1", timeout=60) as h:
        bundles = json.loads(h.read())

    def key(b):
        n = [int(x) for x in re.findall(r"\d+", b.get("appVersion") or "0")[:3]]
        return n + [0] * (3 - len(n))

    out = {}
    for b in bundles:
        pkg = b.get("package")
        if pkg and (pkg not in out or key(b) > key(out[pkg])):
            out[pkg] = b
    return out


def app_packages():
    """app directory -> registry package id, from each app's own manifest."""
    out = {}
    for f in sorted(REPO.glob("apps/*/logic/Cargo.toml")):
        m = re.search(r'^package\s*=\s*"([^"]+)"', f.read_text(), re.M)
        if m:
            out[f.parts[-3]] = m.group(1)
    return out


def wasm_digests(source):
    """{member name: sha256} for every .wasm in an .mpk (a gzipped tar)."""
    if isinstance(source, (str, pathlib.Path)):
        t = tarfile.open(source, "r:gz")
    else:
        t = tarfile.open(fileobj=io.BytesIO(source), mode="r:gz")
    with t:
        return {
            m.name: hashlib.sha256(t.extractfile(m).read()).hexdigest()
            for m in t.getmembers()
            if m.name.endswith(".wasm")
        }


def local_bundle(bundles_dir, app, pkg):
    """CI names the artifact after the DIRECTORY (`dry-run-<app>.mpk`); a
    hand-run `cargo mero build` names it after the PACKAGE. Accept either —
    the two differ for mero-sheets (com.calimero.mero-sheets) and mero-drive
    (com.calimero.mero-drive-docs)."""
    d = pathlib.Path(bundles_dir)
    for pattern in (f"*{app}.mpk", f"{pkg}*.mpk", f"*{pkg}*.mpk"):
        hits = sorted(d.rglob(pattern))
        if hits:
            return hits[0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundles", help="directory holding one .mpk per app")
    ap.add_argument("--only", default="")
    ap.add_argument("--list", action="store_true", help="show published state only")
    args = ap.parse_args()

    only = {s for s in args.only.split(",") if s}
    apps = app_packages()
    if only:
        apps = {a: p for a, p in apps.items() if a in only}
    if not apps:
        sys.exit("no apps matched")

    try:
        reg = published()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"registry unreachable: {e}")

    if args.list or not args.bundles:
        print(f"{'app':20} {'package':32} {'published':10} {'minRuntime':14} verified")
        print("-" * 92)
        for app, pkg in apps.items():
            b = reg.get(pkg)
            if not b:
                print(f"{app:20} {pkg:32} {RED}NOT PUBLISHED{OFF}")
                continue
            print(f"{app:20} {pkg:32} {b['appVersion']:10} "
                  f"{str(b.get('minRuntimeVersion')):14} {b.get('verified')}")
        if not args.bundles:
            print(f"\n{DIM}  Pass --bundles DIR to compare the published WASM against"
                  f" a local build.{OFF}")
        return 0

    print(f"{'app':20} {'published':10} registry wasm vs local build")
    print("-" * 78)
    same = diff = missing = absent = 0
    for app, pkg in apps.items():
        b = reg.get(pkg)
        if not b:
            print(f"{app:20} {'-':10} {RED}NOT PUBLISHED{OFF}")
            absent += 1
            continue
        path = local_bundle(args.bundles, app, pkg)
        if not path:
            print(f"{app:20} {b['appVersion']:10} {YELLOW}no local .mpk to compare{OFF}")
            missing += 1
            continue
        v = b["appVersion"]
        url = f"{REGISTRY}/artifacts/{pkg}/{v}/{pkg}-{v}.mpk"
        try:
            with urllib.request.urlopen(url, timeout=180) as h:
                remote = wasm_digests(h.read())
        except Exception as e:  # noqa: BLE001
            print(f"{app:20} {v:10} {YELLOW}download failed: {e}{OFF}")
            missing += 1
            continue
        local = wasm_digests(path)
        if local == remote:
            print(f"{app:20} {v:10} {GREEN}identical{OFF}  ({len(local)} wasm member(s))")
            same += 1
        else:
            print(f"{app:20} {v:10} {RED}DIFFERENT — registry is not serving this source{OFF}")
            for name in sorted(set(local) | set(remote)):
                l, r = local.get(name, "-"), remote.get(name, "-")
                if l != r:
                    print(f"{'':20} {'':10}   {name}: local={l[:12]} published={r[:12]}")
            diff += 1

    print(f"\n  identical={same}  different={diff}  unpublished={absent}  "
          f"not compared={missing}")
    if diff or absent:
        print(f"\n  {YELLOW}Republish with:{OFF} gh workflow run Release -f app=<app>")
    return 1 if (diff or absent) else 0


if __name__ == "__main__":
    sys.exit(main())
