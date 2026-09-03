#!/bin/bash
# Builds a two-service .mpk FIXTURE for group-multi-service.yml.
#
# Deliberately hand-rolled rather than `cargo mero bundle`: both services are the
# SAME wasm under two names, which is the whole point — it exercises merod's
# multi-service install and `service_name` selection, not the toolchain. cargo
# mero's `services` support builds each service from its own crate, so using it
# here would mean inventing a second crate and would stop testing the thing this
# fixture exists for.
#
# It IS signed, with the well-known dev key. `install_dev_application` is not an
# unsigned path — a manifest with no `signature` is rejected as malformed:
#   manifest is missing required 'signature' field
# The dev key keeps that reproducible with no key material in the repo; the
# registry refuses dev signatures, which is correct, as this is never published.
set -e

cd "$(dirname $0)"

# Build the WASM first
# Note: wasm-opt validation errors are non-fatal
./build.sh 2>&1 | grep -v "wasm-validator error" || true

mkdir -p res/multi-bundle-temp

# Both services use the same WASM — this is what we want to test:
# the multi-service bundle install + service_name selection path in merod.
cp res/scaffolding_e2e.wasm res/multi-bundle-temp/store-a.wasm
cp res/scaffolding_e2e.wasm res/multi-bundle-temp/store-b.wasm

ABI_ARGS=""
if [ -f res/abi.json ]; then
    cp res/abi.json res/multi-bundle-temp/store-a-abi.json
    cp res/abi.json res/multi-bundle-temp/store-b-abi.json
    ABI_ARGS="store-a-abi.json store-b-abi.json"
fi

# `hash` is what binds an artifact's bytes to the manifest, so the node requires
# it as a string and then re-digests the file to check it. This fixture used to
# emit `"hash": null`, which parsed fine on older nodes and is rejected outright
# from 0.11 on:
#   failed to parse manifest.json: invalid type: null, expected a string
# Hex-encoded SHA-256, compared case-insensitively.
sha256_hex() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        # macOS
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

file_size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

WASM_SIZE=$(file_size res/scaffolding_e2e.wasm)
WASM_HASH=$(sha256_hex res/scaffolding_e2e.wasm)

# Emitted per service so the ABI block can be dropped wholesale when there is no
# abi.json to hash — an `"abi"` key pointing at a file the archive does not carry
# would fail the same integrity check the hashes exist for.
ABI_BLOCK_A=""
ABI_BLOCK_B=""
if [ -f res/abi.json ]; then
    ABI_SIZE=$(file_size res/abi.json)
    ABI_HASH=$(sha256_hex res/abi.json)
    ABI_BLOCK_A=$(printf ',
      "abi": {
        "path": "store-a-abi.json",
        "size": %s,
        "hash": "%s"
      }' "$ABI_SIZE" "$ABI_HASH")
    ABI_BLOCK_B=$(printf ',
      "abi": {
        "path": "store-b-abi.json",
        "size": %s,
        "hash": "%s"
      }' "$ABI_SIZE" "$ABI_HASH")
fi

# minRuntimeVersion matches the calimero-sdk tag, not the old "0.0.0": this wasm
# is the same one logic/ builds, so it imports host functions that only exist
# from that release on. Claiming it runs anywhere would let an older node install
# it and then fail at context creation with `link error: unknown import`.
cat > res/multi-bundle-temp/manifest.json <<EOF
{
  "version": "1.0",
  "package": "com.calimero.scaffolding-e2e-multi",
  "appVersion": "0.1.0",
  "minRuntimeVersion": "0.11.0-rc.32",
  "services": [
    {
      "name": "store-a",
      "wasm": {
        "path": "store-a.wasm",
        "size": ${WASM_SIZE},
        "hash": "${WASM_HASH}"
      }${ABI_BLOCK_A}
    },
    {
      "name": "store-b",
      "wasm": {
        "path": "store-b.wasm",
        "size": ${WASM_SIZE},
        "hash": "${WASM_HASH}"
      }${ABI_BLOCK_B}
    }
  ]
}
EOF

# Signs in place, so it must happen before the tar. The signature covers the
# manifest, which carries the artifact hashes — which is why those had to be real
# before this could mean anything.
cargo mero sign res/multi-bundle-temp/manifest.json --dev

cd res/multi-bundle-temp
tar -czf ../scaffolding-e2e-multi-0.1.0.mpk manifest.json store-a.wasm store-b.wasm ${ABI_ARGS} 2>/dev/null || \
tar -czf ../scaffolding-e2e-multi-0.1.0.mpk manifest.json store-a.wasm store-b.wasm 2>/dev/null

cd ..
rm -rf multi-bundle-temp

echo "Multi-service bundle created: res/scaffolding-e2e-multi-0.1.0.mpk"
