#!/bin/bash
# logic/build-bundle.sh — package a signed .mpk via `cargo mero bundle` (rc.19).
#
# WHAT CHANGED vs. the previous version of this script, and why it matters:
#
# It used to hand-write manifest.json as a heredoc mirroring the node's
# `BundleManifest` type, with nothing forcing the two to agree. Three concrete
# defects came out of that, all fixed by letting the tool construct the canonical
# type instead of imitating it (core #3374 documents the drift):
#
#   - `"hash": null` — the node REJECTS a bundle with a null artifact hash as
#     malformed, before it ever checks the signature. The old heredoc could not
#     compute a hash, so it emitted null and hoped.
#   - unwritable metadata — `license`, `tags`, `links.github`, `links.docs` and
#     `icon` had no producer anywhere, so published bundles carried blank slots
#     that the registry renders.
#   - no `abi.json` sidecar, because the old build emitted no ABI at all.
#
# `cargo mero bundle` stages the wasm + ABI, computes each artifact's size and
# SHA-256, writes the manifest from `[package.metadata.calimero]` in Cargo.toml,
# signs it, and tars `dist/<package>.mpk`. Bundle metadata is edited in
# Cargo.toml now — NOT in this script.
#
# Usage:
#   ./build-bundle.sh                        # dev-signed (local install only)
#   ./build-bundle.sh --key path/to/key.json # production
#   APP_VERSION_OVERRIDE=0.2.0 ./build-bundle.sh
#
# Generate a production key with:  cargo mero key generate --output my-key.json
set -euo pipefail

cd "$(dirname "$0")"

PACKAGE="com.calimero.mero-stream"
FALLBACK_VERSION="0.1.0"
REGISTRY_URL="${REGISTRY_URL:-https://apps.calimero.network}"

green() { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

bash ../scripts/ensure-cargo-mero.sh

# ── Signing method ────────────────────────────────────────────────────────────
# --dev uses cargo-mero's well-known development key: fine for `meroctl app
# install` against a local node, REFUSED by the registry. Pass --key for anything
# publishable. Note a node derives the ApplicationId from (package, signer), so a
# dev-signed and a prod-signed build of byte-identical wasm install as DIFFERENT
# applications — don't mix them on one node and expect the ids to match.
SIGN_ARGS=(--dev)
PASSTHRU=()
while [ $# -gt 0 ]; do
  case "$1" in
    --key)
      SIGN_ARGS=(--key "$2")
      shift 2
      ;;
    --dev)
      SIGN_ARGS=(--dev)
      shift
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done
[ "${SIGN_ARGS[0]}" = "--dev" ] && yellow "signing with the DEV key — the registry will refuse this bundle"

# ── appVersion: registry auto-bump ────────────────────────────────────────────
# Same convention as mero-meet: read the latest published appVersion for this
# package and patch-bump it. Public GET, no secret needed. The version lives in
# the manifest, not the filename, so the .mpk path is stable across versions.
resolve_app_version() {
  if [ -n "${APP_VERSION_OVERRIDE:-}" ]; then
    echo "$APP_VERSION_OVERRIDE"
    return
  fi
  curl -fsS -m 15 "${REGISTRY_URL}/api/v2/bundles?package=${PACKAGE}" 2>/dev/null |
    PKG_FALLBACK="$FALLBACK_VERSION" python3 -c '
import sys, os, json
fb = os.environ["PKG_FALLBACK"]
def key(v):
    out = []
    for part in str(v).split(".")[:3]:
        digits = "".join(c for c in part if c.isdigit())
        out.append(int(digits) if digits else 0)
    while len(out) < 3: out.append(0)
    return tuple(out)
try:
    data = json.load(sys.stdin)
    vers = [b.get("appVersion") for b in data if isinstance(b, dict) and b.get("appVersion")]
    if not vers:
        print(fb); sys.exit(0)
    a, b, c = key(max(vers, key=key))
    print(f"{a}.{b}.{c + 1}")
except Exception:
    print(fb)
' 2>/dev/null || echo "$FALLBACK_VERSION"
}

APP_VERSION="$(resolve_app_version)"
[ -n "$APP_VERSION" ] || APP_VERSION="$FALLBACK_VERSION"
step "appVersion: $APP_VERSION (package: $PACKAGE)"

# ── Bundle ────────────────────────────────────────────────────────────────────
# `bundle` runs the build itself (ABI emit -> compile -> wasm-opt -> embed), so
# there is no separate ./build.sh call here to drift out of sync.
step "Bundling"
cargo mero bundle \
  --app-version "$APP_VERSION" \
  "${SIGN_ARGS[@]}" \
  ${PASSTHRU[0]+"${PASSTHRU[@]}"}

MPK="dist/${PACKAGE}.mpk"
[ -f "$MPK" ] || {
  printf '\033[31m  ✗  expected %s\033[0m\n' "$MPK" >&2
  exit 1
}

# Prove the two defects above are actually gone rather than trusting the tool.
step "Verifying the manifest"
python3 - "$MPK" <<'PYEOF'
import json, sys, tarfile

with tarfile.open(sys.argv[1], "r:gz") as tar:
    member = tar.extractfile("manifest.json")
    if member is None:
        sys.exit("  x  manifest.json missing from the bundle")
    manifest = json.load(member)

problems = []
if not manifest.get("signature"):
    problems.append("manifest is unsigned")

# Every artifact needs a non-null hash: the node rejects a null one as malformed
# before it ever verifies the signature. The artifact shape has moved around
# across releases, so walk for anything artifact-like instead of one fixed key.
def artifacts(node):
    if isinstance(node, dict):
        if "path" in node and ("hash" in node or "size" in node):
            yield node
        for value in node.values():
            yield from artifacts(value)
    elif isinstance(node, list):
        for item in node:
            yield from artifacts(item)

found = list(artifacts(manifest))
if not found:
    problems.append("no artifacts recorded in the manifest")
for art in found:
    if not art.get("hash"):
        problems.append(f"artifact {art.get('path')!r} has a null/absent hash")

if problems:
    sys.exit("  x  " + "\n  x  ".join(problems))

print(f"  ok  signed, {len(found)} artifact(s), all hashed")
for art in found:
    print(f"        {art.get('path')}  {art.get('size')} bytes")
PYEOF

green "bundle: logic/$MPK  (appVersion $APP_VERSION)"
printf '  Install locally:  \033[36mmeroctl app install --path logic/%s\033[0m\n' "$MPK"
