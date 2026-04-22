#!/bin/bash
# Build the two services, gather their artifacts, and package them as a
# single signed `.mpk` bundle. This mirrors the battleships multi-service
# pattern: one manifest with a `services` array, each service carrying its
# own wasm + abi, signed via `mero-sign` from the sibling core checkout.

set -e
cd "$(dirname $0)"

APP_VERSION=$(grep '^version' crates/registry/Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
PACKAGE="com.calimero.mero-drive-docs"

echo "Building registry service..."
(cd crates/registry && bash build.sh)
echo "Building docs service..."
(cd crates/docs && bash build.sh)

mkdir -p res/bundle-temp
rm -f res/bundle-temp/*

cp crates/registry/res/registry.wasm res/bundle-temp/
cp crates/docs/res/docs.wasm         res/bundle-temp/
cp crates/registry/res/abi.json      res/bundle-temp/registry-abi.json
cp crates/docs/res/abi.json          res/bundle-temp/docs-abi.json

size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}
REG_WASM_SIZE=$(size crates/registry/res/registry.wasm)
DOC_WASM_SIZE=$(size crates/docs/res/docs.wasm)
REG_ABI_SIZE=$(size crates/registry/res/abi.json)
DOC_ABI_SIZE=$(size crates/docs/res/abi.json)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "${PACKAGE}",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Mero Drive Docs",
    "description": "Namespace-based document workspace — registry + docs multi-service bundle.",
    "author": "Calimero"
  },
  "services": [
    {
      "name": "registry",
      "wasm": { "path": "registry.wasm", "size": ${REG_WASM_SIZE}, "hash": null },
      "abi":  { "path": "registry-abi.json", "size": ${REG_ABI_SIZE}, "hash": null }
    },
    {
      "name": "docs",
      "wasm": { "path": "docs.wasm", "size": ${DOC_WASM_SIZE}, "hash": null },
      "abi":  { "path": "docs-abi.json", "size": ${DOC_ABI_SIZE}, "hash": null }
    }
  ],
  "migrations": [],
  "links": {
    "frontend": "http://localhost:5173/"
  }
}
EOF

# Sign the manifest via the sibling core workspace's mero-sign tool. The
# path is relative to this repo sitting next to core/ in the parent dir,
# same layout battleships uses.
if [ -d "../../core" ]; then
    cargo run --manifest-path ../../core/Cargo.toml -p mero-sign --quiet -- \
        sign res/bundle-temp/manifest.json \
        --key ../../core/scripts/test-signing-key/test-key.json
else
    echo "warning: ../../core not found — bundle will be UNSIGNED (dev use only)"
fi

# Package as .mpk (tar.gz). Bundle into dist/ (committed per project
# convention — see .gitignore: `!logic/dist/`).
mkdir -p dist
BUNDLE="dist/${PACKAGE}-${APP_VERSION}.mpk"
cd res/bundle-temp
tar -czf "../../${BUNDLE}" \
    manifest.json \
    registry.wasm registry-abi.json \
    docs.wasm     docs-abi.json
cd ../..

echo "Bundle created: ${BUNDLE}"
