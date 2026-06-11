#!/bin/bash
set -e

cd "$(dirname $0)"

# Single source of truth for the published version. The .mpk filename and the
# manifest appVersion are both derived from this — they must not drift (the old
# script hardcoded a 0.1.0 filename while publishing appVersion 2.2.1).
APP_VERSION="2.2.4"

# Build WASM. wasm-opt validation warnings are non-fatal; the .wasm is still produced.
./build.sh 2>&1 | grep -v "wasm-validator error" || true

# Integrity gate. A manifest that references an artifact the archive doesn't
# contain is exactly what the registry rejects as `binary_missing`, so refuse to
# build a bundle unless the wasm is actually present and non-empty.
[ -s res/merodesign.wasm ] || { echo "ERROR: res/merodesign.wasm missing/empty — WASM build failed" >&2; exit 1; }

rm -rf res/bundle-temp
mkdir -p res/bundle-temp

cp res/merodesign.wasm res/bundle-temp/app.wasm

WASM_SIZE=$(stat -f%z res/merodesign.wasm 2>/dev/null || stat -c%s res/merodesign.wasm 2>/dev/null || echo 0)

# NOTE: no `abi` block. This contract's ABI cannot be generated — the
# calimero-wasm-abi emitter doesn't resolve type aliases (e.g. `type ElementId =
# String`) and panics, so the app has always shipped without an ABI. The bundle
# manifest's `abi` field is optional (Option, omitted when absent), so we leave
# it out rather than declaring an abi.json the archive doesn't contain (the old
# script claimed `abi.json` size 0 and never bundled it → `binary_missing`).
cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.merodesign",
  "appVersion": "${APP_VERSION}",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "MeroDesign",
    "description": "Collaborative design tool on the Calimero p2p network. Figma-style canvas, your data on your nodes.",
    "author": "Calimero"
  },
  "wasm": {
    "path": "app.wasm",
    "size": ${WASM_SIZE},
    "hash": null
  },
  "migrations": [],
  "links": {
    "frontend": "https://mero-design.vercel.app/"
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

BUNDLE="merodesign-${APP_VERSION}.mpk"
( cd res/bundle-temp && tar -czf "../${BUNDLE}" manifest.json app.wasm )

echo "Bundle created: res/${BUNDLE}  (wasm ${WASM_SIZE}B, no abi)"
