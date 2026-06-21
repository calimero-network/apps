#!/bin/bash
set -e

cd "$(dirname $0)"

# ── Version: auto-bump from the App Registry ────────────────────────────────
# Single source of truth for the published version — the .mpk filename and the
# manifest appVersion both derive from $APP_VERSION. Fetch the latest published
# appVersion for this package and bump the patch, so each build produces the
# next publishable version automatically. Precedence:
#   1. APP_VERSION_OVERRIDE env  — explicit pin
#   2. <latest published version> + patch bump
#   3. FALLBACK_VERSION          — registry unreachable / package not yet published
PACKAGE="com.calimero.meropixart"
FALLBACK_VERSION="0.1.0"
REGISTRY_URL="${REGISTRY_URL:-https://apps.calimero.network}"

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

# Integrity gate.
[ -s res/meropixart.wasm ] || { echo "ERROR: res/meropixart.wasm missing/empty — WASM build failed" >&2; exit 1; }

rm -rf res/bundle-temp
mkdir -p res/bundle-temp

cp res/meropixart.wasm res/bundle-temp/app.wasm

WASM_SIZE=$(stat -f%z res/meropixart.wasm 2>/dev/null || stat -c%s res/meropixart.wasm 2>/dev/null || echo 0)

# NOTE: no `abi` block — the calimero-wasm-abi emitter doesn't resolve type
# aliases (e.g. `type LayerId = String`), so the app ships without an ABI. The
# bundle manifest's `abi` field is optional, so we leave it out.
cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "MeroPixArt",
    "description": "Collaborative p2p image editor on the Calimero network. Photoshop-style layers, masks, and adjustments — your pixels on your nodes.",
    "author": "Calimero"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "https://mero-pixart.vercel.app/"
  }
}
EOF

# Sign the manifest if mero-sign is available
if cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
    sign res/bundle-temp/manifest.json \
    --key ../../core/scripts/test-signing-key/test-key.json 2>/dev/null; then
    echo "Manifest signed"
else
    echo "mero-sign not available — skipping signing (non-fatal for local dev)"
fi

BUNDLE="meropixart-${APP_VERSION}.mpk"
( cd res/bundle-temp && tar -czf "../${BUNDLE}" manifest.json app.wasm )

echo "Bundle created: res/${BUNDLE}  (wasm ${WASM_SIZE}B, no abi)"
