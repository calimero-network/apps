#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-../../target}"

# ── Version: auto-bump from the App Registry ────────────────────────────────
# Fetch the latest published appVersion for this package and bump the patch, so
# every build produces the next publishable version without a manual edit. The
# registry GET is public (no auth/secret needed — works in CI). Precedence:
#   1. APP_VERSION_OVERRIDE env  — explicit pin (e.g. a migration bundle)
#   2. <latest published version> + patch bump
#   3. FALLBACK_VERSION          — registry unreachable / package not yet published
# This fork's app identity (Option B). It IS the com.calimero.chat app, so the
# package and frontend URL are fixed constants — not env knobs. Only the version
# stays dynamic (APP_VERSION_OVERRIDE, set from the git tag in CI).
PACKAGE="com.calimero.chat"
FRONTEND_URL="https://mero-chat-pwa.vercel.app/"   # the fork's deployed production alias
PKG_SHORT="${PACKAGE##*.}"   # last dotted segment → .mpk filename prefix
FALLBACK_VERSION="${FALLBACK_VERSION:-0.1.0}"   # offline floor only; registry path is authoritative
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

# First build the WASM file
# Note: wasm-opt validation errors are non-fatal - the WASM file is still created
./build.sh 2>&1 | grep -v "wasm-validator error" || true

# Create bundle directory
mkdir -p res/bundle-temp

# Copy WASM file
cp res/curb.wasm res/bundle-temp/app.wasm

# Copy ABI file if it exists
if [ -f res/abi.json ]; then
    cp res/abi.json res/bundle-temp/abi.json
fi

# Get file sizes for manifest
WASM_SIZE=$(stat -f%z res/curb.wasm 2>/dev/null || stat -c%s res/curb.wasm 2>/dev/null || echo 0)
ABI_SIZE=$(stat -f%z res/abi.json 2>/dev/null || stat -c%s res/abi.json 2>/dev/null || echo 0)

# Launcher icon: embed the 512px PWA icon as a data URI so the desktop can render
# a real per-app launcher icon offline (metadata.icon, a sibling of name/author).
# Recomputed from the file each build so it never drifts. `base64 < file` reads
# stdin (portable macOS/Linux); `tr -d '\n'` strips the wrap GNU base64 adds so
# the URI stays valid inside the JSON string. Bundle app-id = hash(package,
# signer) — NOT metadata — so this does not change the app id.
ICON_SRC="../app/public/icons/icon-512x512.png"
if [ -f "$ICON_SRC" ]; then
    ICON_DATA_URI="data:image/png;base64,$(base64 < "$ICON_SRC" | tr -d '\n')"
else
    echo "WARN: launcher icon not found: $ICON_SRC (bundling without metadata.icon)" >&2
    ICON_DATA_URI=""
fi

# Create manifest.json (metadata.name/description/author used by registry UI)
cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Mero Chat",
    "description": "Mero Chat v2 — group-based context management. Each context is one channel or DM.",
    "author": "Calimero",
    "icon": "${ICON_DATA_URI}"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "abi": {
    "path": "abi.json",
    "size": ${ABI_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "${FRONTEND_URL}"
  }
}
EOF

# ── Signing ─────────────────────────────────────────────────────────────────
# Key: MERO_SIGN_KEY_FILE env (CI writes the MERO_SIGN_KEY secret to a temp
# file) → fallback to the core workspace test key for local dev.
# Tool: mero-sign on PATH (CI installs it from the core repo) → fallback to
# cargo run against a sibling core checkout.
SIGN_KEY="${MERO_SIGN_KEY_FILE:-../../core/scripts/test-signing-key/test-key.json}"
if [ ! -f "$SIGN_KEY" ]; then
    echo "ERROR: signing key not found: $SIGN_KEY (set MERO_SIGN_KEY_FILE)" >&2
    exit 1
fi
if command -v mero-sign >/dev/null; then
    mero-sign sign res/bundle-temp/manifest.json --key "$SIGN_KEY"
else
    cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
        sign res/bundle-temp/manifest.json --key "$SIGN_KEY"
fi

# Create .mpk bundle (tar.gz archive). Filename derives from APP_VERSION so it
# never drifts from the manifest appVersion.
cd res/bundle-temp
MPK="../${PKG_SHORT}-${APP_VERSION}.mpk"
tar -czf "$MPK" manifest.json app.wasm abi.json 2>/dev/null || \
tar -czf "$MPK" manifest.json app.wasm 2>/dev/null

echo "Bundle created: res/${PKG_SHORT}-${APP_VERSION}.mpk"
