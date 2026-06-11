#!/bin/bash
set -e

cd "$(dirname $0)"

# Build WASM first
./build.sh 2>&1 | grep -v "wasm-validator error" || true

mkdir -p res/bundle-temp

cp res/merodesign.wasm res/bundle-temp/app.wasm

if [ -f res/abi.json ]; then
    cp res/abi.json res/bundle-temp/abi.json
fi

WASM_SIZE=$(stat -f%z res/merodesign.wasm 2>/dev/null || stat -c%s res/merodesign.wasm 2>/dev/null || echo 0)
ABI_SIZE=$(stat -f%z res/abi.json 2>/dev/null || stat -c%s res/abi.json 2>/dev/null || echo 0)

cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.merodesign",
  "appVersion": "2.2.0",
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
  "abi": {
    "path": "abi.json",
    "size": ${ABI_SIZE},
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

cd res/bundle-temp
tar -czf ../merodesign-0.1.0.mpk manifest.json app.wasm abi.json 2>/dev/null || \
tar -czf ../merodesign-0.1.0.mpk manifest.json app.wasm 2>/dev/null

echo "Bundle created: res/merodesign-0.1.0.mpk"
