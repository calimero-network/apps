#!/bin/bash
# Compile logic/src → logic/res/mero_tag.wasm
set -e

cd "$(dirname "$0")"

rm -rf res target/wasm32-unknown-unknown/app-release/mero_tag.wasm 2>/dev/null || true

TARGET="${CARGO_TARGET_DIR:-target}"

rustup target add wasm32-unknown-unknown

cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res

name=$(cargo read-manifest | jq -r '.name')
sanitized_name=$(echo "$name" | tr '-' '_')

cp "$TARGET/wasm32-unknown-unknown/app-release/$sanitized_name.wasm" "./res/$sanitized_name.wasm"

if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz "./res/$sanitized_name.wasm" -o "./res/$sanitized_name.wasm"
fi

echo "Built res/$sanitized_name.wasm"
