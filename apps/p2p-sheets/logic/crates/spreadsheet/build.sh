#!/bin/bash
# Build this crate to wasm and copy into ./res/<SVC_NAME>.wasm.
#
# Driven by the parent build-bundle.sh which sets SVC_NAME and SVC_CRATE.
# Fall-back when invoked directly: SVC_NAME = directory basename;
# SVC_CRATE parsed from Cargo.toml [package].name.
set -e
cd "$(dirname $0)"

SVC_NAME="${SVC_NAME:-$(basename "$PWD")}"
SVC_CRATE="${SVC_CRATE:-$(awk -F\" '/^name *= *"/ {print $2; exit}' Cargo.toml)}"
WASM_BASENAME="${SVC_CRATE//-/_}.wasm"

TARGET="${CARGO_TARGET_DIR:-../../target}"

rustup target add wasm32-unknown-unknown 2>/dev/null || true
cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res
cp "$TARGET/wasm32-unknown-unknown/app-release/$WASM_BASENAME" "./res/$SVC_NAME.wasm"

if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz "./res/$SVC_NAME.wasm" -o "./res/$SVC_NAME.wasm"
fi

echo "Built: res/$SVC_NAME.wasm (from $WASM_BASENAME)"
