#!/usr/bin/env python3
"""Whether a built component bundle equals the registry's latest of its package.

    scripts/registry-unchanged.py INSPECT PACKAGE [EXPLICIT_VERSION]

INSPECT is what `meroctl app inspect` printed for the built bundle, after it
verified the signature: `{"bundleHash": ..., "manifest": {...}}`, of which the
signed manifest (`.manifest`) is compared. Anything else is refused (exit 2):
comparing the wrapper would never match, and a bare manifest would mean the
signature was not checked by the step that wrote it.
Prints `same=true` or `same=false` for $GITHUB_OUTPUT, and why on stderr.
CALIMERO_REGISTRY_URL overrides https://apps.calimero.network.

Every Release dispatch rebuilds every app, and a version that equals the
latest only adds about 14 KB to the registry's Redis (which filled at ~1,600
versions). So publish-component.yml skips a bundle whose manifest equals the
registry's latest, and this decides "equal".

THE WHOLE SIGNED MANIFEST IS COMPARED, minus what differs per publish
(EXCLUDED_*). Not a list of fields that matter: nodes act on `outbound`,
`frontendAliases`, `upgrades`, `links`, `handlers`, `frontend.entry`, and a
field core adds later is compared by default, so a change to it is never
silently not shipped. An exclusion here is a field that can never ship by
publishing, so it cannot hide a change.

THE FULL MANIFEST COMES FROM THE VERSION ENDPOINT. The latest-version listing
(`?package=X`) drops `metadata.guide` (app-registry bundle-sanitize.js
`sanitizeBundles`: guides are large), so comparing against it never matched an
app with a guide; dropping `guide` on both sides instead would never ship a
guide-only change. So the listing names the latest version and
`?package=X&version=V` (`sanitizeBundle`, which keeps the guide) gives its
manifest. Both with `fresh=1`, as the registry asks of publish jobs: the edge
cache is ~60 s stale otherwise.

An explicit version is an operator forcing a release: never skipped. Anything
the registry does not answer cleanly publishes, as before this check existed.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

# Per publish, by construction: the version the registry resolved and the
# signature over it. The signer is pinned per package by
# `registry-release.sh check-signer`, so it is not this check's business.
EXCLUDED_TOP = {"appVersion", "signerId", "signature"}

# What the registry's sanitizer adds to a stored manifest in its responses
# (app-registry packages/backend/src/lib/bundle-sanitize.js, api/v2/bundles):
# none of it is in a .mpk. Its server-stamped `_installSize`/`_publishedAt`
# are `_` keys, dropped below with every other `_` key, which the registry
# itself leaves out of signature verification (lib/verify.js).
EXCLUDED_RESPONSE = {
    "min_runtime_version",
    "verified",
    "publisherVerified",
    "installSize",
    "publishedAt",
    "yanked",
    "downloads",
    "visibility",
}

# `metadata.author` is server-owned: push.js deletes the manifest's and stamps
# the package's first publisher's username, so it never equals the built one
# and a change to it cannot ship. `metadata._*` is server-owned too
# (`_ownerEmail`, `_adminVerified`).
EXCLUDED_METADATA = {"author"}

DEFAULT_REGISTRY = "https://apps.calimero.network"


def _prune(value):
    """Drops null, [] and {}: serde leaves an empty Option/Vec out, the
    registry may answer it as null or {} (`metadata: {}`), and all three mean
    absent to a node. Lists of `{path, ...}` are ordered by path."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            v = _prune(v)
            if v not in (None, [], {}):
                out[k] = v
        return out
    if isinstance(value, list):
        items = [_prune(v) for v in value]
        if items and all(isinstance(v, dict) and isinstance(v.get("path"), str) for v in items):
            items.sort(key=lambda v: v["path"])
        return items
    return value


def comparable(manifest):
    """The manifest with every per-publish and registry-added field removed."""
    out = {
        k: v
        for k, v in manifest.items()
        if k not in EXCLUDED_TOP and k not in EXCLUDED_RESPONSE and not k.startswith("_")
    }
    if isinstance(out.get("metadata"), dict):
        out["metadata"] = {
            k: v for k, v in out["metadata"].items() if k not in EXCLUDED_METADATA and not k.startswith("_")
        }
    return _prune(out)


def differences(a, b, prefix=""):
    """The dotted paths at which two comparable manifests differ."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += differences(a.get(k), b.get(k), f"{prefix}{k}.")
        return out
    return [] if a == b else [prefix.rstrip(".") or "(root)"]


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def latest_manifest(registry, package, fetch=fetch_json):
    """The registry's latest non-yanked manifest of `package`, guide included,
    or None when there is none or it cannot be read."""
    api = registry.rstrip("/") + "/api/v2/bundles"
    q = urllib.parse.urlencode({"package": package, "fresh": "1"})
    listing = fetch(f"{api}?{q}")
    if not isinstance(listing, list) or not listing or not isinstance(listing[0], dict):
        return None
    version = listing[0].get("appVersion")
    if not isinstance(version, str) or not version:
        return None
    q = urllib.parse.urlencode({"package": package, "version": version, "fresh": "1"})
    full = fetch(f"{api}?{q}")
    if not isinstance(full, list) or not full or not isinstance(full[0], dict):
        return None
    if full[0].get("appVersion") != version:
        return None
    return full[0]


def decide(built, package, explicit_version="", registry=DEFAULT_REGISTRY, fetch=fetch_json):
    """(same, reason)."""
    if explicit_version:
        return False, f"explicit version {explicit_version} requested: publishing"
    try:
        latest = latest_manifest(registry, package, fetch)
    except Exception as e:  # noqa: BLE001 - any failure publishes
        return False, f"could not read the registry's latest ({e}): publishing"
    if latest is None:
        return False, "no latest version on the registry: publishing"
    diff = differences(comparable(built), comparable(latest))
    if diff:
        return False, f"differs from the registry's {latest['appVersion']} in {', '.join(diff)}: publishing"
    return True, f"identical to the registry's {latest['appVersion']}"


def built_manifest(inspected):
    """The signed manifest out of `meroctl app inspect`'s output, or None
    when it is not that shape."""
    if isinstance(inspected, dict) and isinstance(inspected.get("manifest"), dict) and "bundleHash" in inspected:
        return inspected["manifest"]
    return None


def main(argv):
    if len(argv) not in (3, 4):
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    with open(argv[1]) as f:
        built = built_manifest(json.load(f))
    if built is None:
        print(f"{argv[1]} is not `meroctl app inspect` output ({{bundleHash, manifest}})", file=sys.stderr)
        return 2
    explicit = argv[3] if len(argv) == 4 else ""
    registry = os.environ.get("CALIMERO_REGISTRY_URL") or DEFAULT_REGISTRY
    same, reason = decide(built, argv[2], explicit, registry)
    print(f"::notice::{argv[2]}: {reason}", file=sys.stderr)
    print(f"same={'true' if same else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
