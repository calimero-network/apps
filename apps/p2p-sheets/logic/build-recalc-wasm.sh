#!/bin/bash
# Build the browser WASM recalc engine and commit the artifact into the client.
#
# Prereqs (one-time):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# The generated JS+wasm is committed under app/src/engine/recalc so Vercel needs
# no Rust toolchain (mirrors the committed-generated-client pattern). Re-run this
# whenever crates/recalc or crates/recalc-wasm change; CI verifies it is current.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v wasm-pack > /dev/null; then
  echo "Error: wasm-pack not installed. Run: cargo install wasm-pack" >&2
  exit 1
fi

# Absolute path, deliberately: wasm-pack resolves --out-dir relative to the
# crate dir (crates/recalc-wasm), not the cwd, so a naive relative path here
# would land the artifact in the wrong place.
OUT_DIR="$(pwd)/../app/src/engine/recalc"
wasm-pack build crates/recalc-wasm \
  --target web \
  --release \
  --out-dir "$OUT_DIR" \
  --out-name recalc_wasm

# wasm-pack writes a package.json / .gitignore into the out dir we do not want in
# the client tree — remove them so only the JS + wasm + d.ts are committed.
rm -f "$OUT_DIR/package.json" "$OUT_DIR/.gitignore" "$OUT_DIR/README.md"
echo "recalc-wasm artifact written to app/src/engine/recalc/"
