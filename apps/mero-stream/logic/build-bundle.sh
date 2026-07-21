#!/bin/bash
set -e

cd "$(dirname $0)"

# Registry auto-bump (same convention as mero-meet): fetch the latest published
# appVersion for this package and patch-bump it. Public GET, no secret needed.
PACKAGE="com.calimero.merostream"
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

# Build the WASM (wasm-opt validation errors are non-fatal).
./build.sh 2>&1 | grep -v "wasm-validator error" || true

mkdir -p res/bundle-temp
cp res/mero_stream.wasm res/bundle-temp/app.wasm
WASM_SIZE=$(stat -f%z res/mero_stream.wasm 2>/dev/null || stat -c%s res/mero_stream.wasm 2>/dev/null || echo 0)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Mero Stream",
    "description": "Capacity probe: streaming media OVER Calimero — the codec runs in the WASM contract, not the browser. Experimental; not shippable media.",
    "author": "Calimero"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "https://mero-stream.vercel.app/"
  }
}
EOF

# Sign the manifest (registry rejects unsigned bundles). Same key convention as
# mero-meet: installed `mero-sign` or a sibling core checkout; test key for dev.
MERO_SIGN="$(command -v mero-sign || true)"
[ -n "$MERO_SIGN" ] || MERO_SIGN="cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet --"
SIGNING_KEY="${SIGNING_KEY:-../../core/scripts/test-signing-key/test-key.json}"
$MERO_SIGN sign res/bundle-temp/manifest.json --key "$SIGNING_KEY"
echo "Manifest signed with $SIGNING_KEY"

cd res/bundle-temp
MPK="../mero-stream-${APP_VERSION}.mpk"
tar -czf "$MPK" manifest.json app.wasm
echo "Bundle created: res/mero-stream-${APP_VERSION}.mpk"
