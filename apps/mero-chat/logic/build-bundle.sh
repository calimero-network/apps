#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-../../target}"

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

# Create manifest.json (metadata.name/description/author used by registry UI)
cat > res/bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.curb",
  "appVersion": "0.1.0",
  "minRuntimeVersion": "0.1.0",
  "metadata": {
    "name": "Curb Chat",
    "description": "Calimero Curb Chat is a P2P chat application built on top of the Calimero Network.",
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
    "frontend": "http://localhost:5173/"
  }
}
EOF

# Sign the manifest
mero-sign sign --key key.json res/bundle-temp/manifest.json

# Create .mpk bundle (tar.gz archive)
cd res/bundle-temp
tar -czf ../curb-1.0.0.mpk manifest.json app.wasm abi.json 2>/dev/null || \
tar -czf ../curb-1.0.0.mpk manifest.json app.wasm 2>/dev/null

echo "Bundle created: res/curb-1.0.0.mpk"
