#!/usr/bin/env bash
# logic/build-bundle.sh — package the built wasm into a signed .mpk bundle.
#
# `cargo mero build` (0.11.0-rc.26) only emits res/curb.wasm; it does not
# produce a bundle. The registry pipeline (.github/workflows/deploy-bundle.yml)
# builds one in CI with a release key, which is no help locally — and a raw-wasm
# install carries no manifest, so the node ends up with empty metadata and
# Calimero Desktop shows neither a name, an icon, nor an "Open" entry (it gates
# those on metadata.links.frontend).
#
# An .mpk is just a tar.gz of a signed manifest.json + app.wasm (+ abi.json).
# This rebuilds that locally so a dev node can install a real package.
#
# Manifest values come from [package.metadata.calimero] in Cargo.toml, so the
# frontend URL has exactly one source of truth.
#
# Bundle app-id = hash(package, signer) — NOT the metadata — so changing the
# frontend URL here does not change the app id. Changing the SIGNING KEY does.
#
# Usage:
#   ./build-bundle.sh                       # uses APP_VERSION or 0.1.0
#   APP_VERSION=1.2.3 ./build-bundle.sh
#   MERO_SIGN_KEY_FILE=/path/key.json ./build-bundle.sh

set -euo pipefail

cd "$(dirname "$0")"

APP_VERSION="${APP_VERSION:-0.1.0}"

manifest_value() {
  sed -n "s/^$1  *= *\"\(.*\)\"/\1/p" Cargo.toml | tail -1
}

PACKAGE=$(manifest_value package)
APP_NAME=$(manifest_value name)
DESCRIPTION=$(manifest_value description)
AUTHOR=$(manifest_value author)
# Local testing needs the bundle to point at a dev server rather than the
# published site. Override without editing Cargo.toml:
#   CURB_FRONTEND_URL=http://localhost:5173 ./build-bundle.sh
FRONTEND_URL="${CURB_FRONTEND_URL:-$(manifest_value frontend)}"
ICON_SRC=$(manifest_value icon)
PKG_SHORT="${PACKAGE##*.}"

[ -n "$PACKAGE" ] || { echo "ERROR: no 'package' in [package.metadata.calimero]" >&2; exit 1; }
[ -f res/curb.wasm ] || { echo "ERROR: res/curb.wasm missing — run 'cargo mero build' first" >&2; exit 1; }

echo "  package:  $PACKAGE"
echo "  version:  $APP_VERSION"
echo "  frontend: ${FRONTEND_URL:-<none>}"

rm -rf res/bundle-temp
mkdir -p res/bundle-temp
cp res/curb.wasm res/bundle-temp/app.wasm
[ -f res/abi.json ] && cp res/abi.json res/bundle-temp/abi.json

WASM_SIZE=$(stat -f%z res/curb.wasm 2>/dev/null || stat -c%s res/curb.wasm)
# merod verifies each artifact's bytes against this digest (sha256 hex) and
# rejects the manifest outright if `hash` is null, so it must be real.
WASM_HASH=$(shasum -a 256 res/curb.wasm | awk '{print $1}')

# Embed the launcher icon as a data URI so the desktop can render it offline.
ICON_DATA_URI=""
if [ -n "$ICON_SRC" ] && [ -f "$ICON_SRC" ]; then
  ICON_DATA_URI="data:image/png;base64,$(base64 < "$ICON_SRC" | tr -d '\n')"
else
  echo "  WARN: icon not found: ${ICON_SRC:-<unset>} — bundling without metadata.icon" >&2
fi

# jq builds the JSON so the icon data URI and any punctuation in the
# description are escaped correctly.
jq -n \
  --arg pkg "$PACKAGE" --arg ver "$APP_VERSION" \
  --arg name "$APP_NAME" --arg desc "$DESCRIPTION" --arg author "$AUTHOR" \
  --arg icon "$ICON_DATA_URI" --arg frontend "$FRONTEND_URL" \
  --argjson wasmSize "$WASM_SIZE" --arg wasmHash "$WASM_HASH" \
  '{
     version: "1.0",
     package: $pkg,
     appVersion: $ver,
     minRuntimeVersion: "0.1.0",
     metadata: { name: $name, description: $desc, author: $author, icon: $icon },
     wasm: { path: "app.wasm", size: $wasmSize, hash: $wasmHash },
     migrations: [],
     links: { frontend: $frontend }
   }' > res/bundle-temp/manifest.json

if [ -f res/abi.json ]; then
  ABI_SIZE=$(stat -f%z res/abi.json 2>/dev/null || stat -c%s res/abi.json)
  ABI_HASH=$(shasum -a 256 res/abi.json | awk '{print $1}')
  jq --argjson abiSize "$ABI_SIZE" --arg abiHash "$ABI_HASH" \
    '.abi = { path: "abi.json", size: $abiSize, hash: $abiHash }' \
    res/bundle-temp/manifest.json > res/bundle-temp/manifest.tmp
  mv res/bundle-temp/manifest.tmp res/bundle-temp/manifest.json
fi

# Signing key: explicit env → core's test key (local dev only).
SIGN_KEY="${MERO_SIGN_KEY_FILE:-}"
if [ -z "$SIGN_KEY" ]; then
  SIGN_KEY=$(find "$(cd ../.. && pwd)/core" -path "*/scripts/test-signing-key/test-key.json" 2>/dev/null | head -1)
fi
[ -n "$SIGN_KEY" ] && [ -f "$SIGN_KEY" ] || {
  echo "ERROR: no signing key. Set MERO_SIGN_KEY_FILE, or run: mero-sign generate-key" >&2
  exit 1
}
echo "  signing with: $SIGN_KEY"

command -v mero-sign >/dev/null || { echo "ERROR: mero-sign not on PATH" >&2; exit 1; }
mero-sign sign res/bundle-temp/manifest.json --key "$SIGN_KEY"

MPK="${PKG_SHORT}-${APP_VERSION}.mpk"
( cd res/bundle-temp && tar -czf "../$MPK" manifest.json app.wasm $([ -f abi.json ] && echo abi.json) )

echo "  ✓ built logic/res/$MPK"
