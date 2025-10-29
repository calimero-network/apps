#!/bin/bash
set -e

cd "$(dirname $0)"

TARGET="${CARGO_TARGET_DIR:-target}"

rustup target add wasm32-unknown-unknown

cargo build --target wasm32-unknown-unknown --profile app-release

mkdir -p res

cp $TARGET/wasm32-unknown-unknown/app-release/meropass.wasm ./res/

if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz ./res/meropass.wasm -o ./res/meropass.wasm
fi
