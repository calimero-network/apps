#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-../../target}"

rustup target add wasm32-unknown-unknown 2>/dev/null || true

# Optional cargo features (e.g. DOCS_FEATURES=schema_v2 for the migration
# target build). Empty by default — existing callers are unaffected.
FEATURES_ARG=""
if [ -n "${DOCS_FEATURES:-}" ]; then
  FEATURES_ARG="--features ${DOCS_FEATURES}"
fi

cargo build --target wasm32-unknown-unknown --profile app-release ${FEATURES_ARG}

mkdir -p res

cp $TARGET/wasm32-unknown-unknown/app-release/mero_drive_docs.wasm ./res/docs.wasm

if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/docs.wasm -o ./res/docs.wasm 2>&1 | grep -v "wasm-validator error" || true
fi
