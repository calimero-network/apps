#!/bin/bash
# Builds the v1 bundle FIXTURE that workflows/migrate-v1-v2.yml installs and
# then upgrades to the bundle CI builds from ../logic (v2).
#
# The file name is CI's hook, not a description: ci.yml's wasm job runs
# `apps/<app>/logic/build-multi-service-bundle.sh` when it exists, and that job
# is the only one with a Rust toolchain. The output lands in res/, which the
# job uploads for the e2e job alongside the app's own bundle.
#
# v1 is crates/v1, the contract frozen as it shipped. It is built from a
# SCRATCH COPY so `cargo mero build` does not leave crates/v1/res/abi.json in
# the tree, where the ABI-freshness and merobox-coverage gates would read it as
# a second service.
#
# Same package id as the app on purpose: an upgrade moves a context from one
# application to another of the same package. Signed with the well-known dev
# key, which the registry refuses — this is never published.
set -euo pipefail

cd "$(dirname "$0")"
LOGIC="$PWD"
OUT="$LOGIC/res/mero-standup-v1.mpk"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH" "$LOGIC/crates/v1/res"' EXIT

cargo mero build -p mero-standup-v1

mkdir -p "$SCRATCH/bundle"
cp crates/v1/res/mero_standup_v1.wasm "$SCRATCH/bundle/app.wasm"
cp crates/v1/res/abi.json "$SCRATCH/bundle/abi.json"

sha256_hex() { sha256sum "$1" | cut -d' ' -f1; }
file_size() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }

# minRuntimeVersion matches the workspace pin: this wasm imports the host
# functions of that release.
MIN_RUNTIME=$(sed -n 's/^min-runtime-version *= *"\(.*\)"/\1/p' ../../../Cargo.toml)

cat > "$SCRATCH/bundle/manifest.json" <<EOF
{
  "version": "1.0",
  "package": "com.calimero.mero-standup",
  "appVersion": "0.0.0-v1",
  "minRuntimeVersion": "${MIN_RUNTIME}",
  "wasm": {
    "path": "app.wasm",
    "size": $(file_size "$SCRATCH/bundle/app.wasm"),
    "hash": "$(sha256_hex "$SCRATCH/bundle/app.wasm")"
  },
  "abi": {
    "path": "abi.json",
    "size": $(file_size "$SCRATCH/bundle/abi.json"),
    "hash": "$(sha256_hex "$SCRATCH/bundle/abi.json")"
  }
}
EOF

# Signs in place; the signature covers the artifact hashes above.
cargo mero sign "$SCRATCH/bundle/manifest.json" --dev

mkdir -p res
tar -czf "$OUT" -C "$SCRATCH/bundle" manifest.json app.wasm abi.json
echo "v1 fixture bundle: $OUT"
