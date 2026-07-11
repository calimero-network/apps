#!/bin/bash
set -e
cd "$(dirname $0)"

rm -rf res
TARGET="${CARGO_TARGET_DIR:-target}"
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res
name=mero_blocks
cp "$TARGET/wasm32-unknown-unknown/app-release/$name.wasm" ./res/

if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz ./res/$name.wasm -o ./res/$name.wasm
fi
echo "built res/$name.wasm ($(du -h res/$name.wasm | cut -f1))"
