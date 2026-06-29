#!/bin/bash
set -e

cd "$(dirname $0)"

# ── Version: auto-bump from the App Registry ────────────────────────────────
# Single source of truth for the published version — the .mpk filename and the
# manifest appVersion both derive from $APP_VERSION (they must not drift).
#
# Rather than hand-editing this on every release, fetch the latest published
# appVersion for this package and bump the patch, so each build produces the
# next publishable version automatically. The registry GET is public (no
# auth/secret needed — works in CI). Precedence:
#   1. APP_VERSION_OVERRIDE env  — explicit pin (e.g. a migration bundle)
#   2. <latest published version> + patch bump
#   3. FALLBACK_VERSION          — registry unreachable / package not yet published
PACKAGE="com.calimero.meromeet"
FALLBACK_VERSION="0.1.0"   # offline floor only; the registry path is authoritative
REGISTRY_URL="${REGISTRY_URL:-https://apps.calimero.network}"
# Frontend the desktop opens for this app. Override for local debugging, e.g.
#   FRONTEND_URL=http://localhost:5173 ./build-bundle.sh
# so `make dev` (Vite + HMR + devtools/console) backs the window instead of prod.
FRONTEND_URL="${FRONTEND_URL:-https://mero-meet.vercel.app/}"
# Source repository, surfaced in the registry UI (links.github).
GITHUB_URL="${GITHUB_URL:-https://github.com/calimero-network/mero-meet}"

resolve_app_version() {
  if [ -n "${APP_VERSION_OVERRIDE:-}" ]; then
    echo "$APP_VERSION_OVERRIDE"; return
  fi
  curl -fsS -m 15 "${REGISTRY_URL}/api/v2/bundles?package=${PACKAGE}" 2>/dev/null \
    | PKG_FALLBACK="$FALLBACK_VERSION" python3 -c '
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
echo "==> appVersion: $APP_VERSION (package: $PACKAGE)"

# Build WASM. wasm-opt validation warnings are non-fatal; the .wasm is still produced.
./build.sh 2>&1 | grep -v "wasm-validator error" || true

# Integrity gate. A manifest that references an artifact the archive doesn't
# contain is exactly what the registry rejects as `binary_missing`, so refuse to
# build a bundle unless the wasm is actually present and non-empty.
[ -s res/mero_meet.wasm ] || { echo "ERROR: res/mero_meet.wasm missing/empty — WASM build failed" >&2; exit 1; }

rm -rf res/bundle-temp
mkdir -p res/bundle-temp

cp res/mero_meet.wasm res/bundle-temp/app.wasm

WASM_SIZE=$(stat -f%z res/mero_meet.wasm 2>/dev/null || stat -c%s res/mero_meet.wasm 2>/dev/null || echo 0)

# NOTE: no `abi` block. build.sh does not emit an abi.json, and the bundle
# manifest's `abi` field is optional (omitted when absent), so we leave it out
# rather than declaring an abi.json the archive doesn't contain (which the
# registry would reject as `binary_missing`).
cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Mero Meet",
    "description": "Decentralized, peer-to-peer video calling on Calimero. WebRTC media; signaling rides your nodes — no signaling server.",
    "author": "Calimero"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "${FRONTEND_URL}",
    "github": "${GITHUB_URL}"
  }
}
EOF

# Sign the manifest if mero-sign is available (same key as the other mero apps).
if cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
    sign res/bundle-temp/manifest.json \
    --key ../../core/scripts/test-signing-key/test-key.json 2>/dev/null; then
    echo "Manifest signed"
else
    echo "mero-sign not available — skipping signing (non-fatal for local dev)"
fi

BUNDLE="mero-meet-${APP_VERSION}.mpk"
( cd res/bundle-temp && tar -czf "../${BUNDLE}" manifest.json app.wasm )

echo "Bundle created: res/${BUNDLE}  (wasm ${WASM_SIZE}B, no abi)"
