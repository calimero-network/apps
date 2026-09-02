#!/usr/bin/env bash
# Compiles the contract to wasm and writes res/scaffolding_e2e.wasm,
# res/abi.json and res/state-schema.json.
#
# This is a thin wrapper around `cargo mero build`, kept because the Makefile,
# three CI workflows and build-multi-service-bundle.sh all call it by name. The
# work it used to do by hand — rustup target add, cargo build --profile
# app-release, wasm-opt, and a build.rs that re-parsed src/lib.rs to guess the
# ABI — is all inside the tool now, and the tool resolves the ABI from the
# compiled `__calimero_abi()` instead of from the source text, so type aliases
# and re-exports no longer silently vanish from it.
#
# Install the tool with:
#   cargo install --git https://github.com/calimero-network/core \
#     --tag 0.11.0-rc.31 cargo-mero --locked
# Keep that tag equal to the calimero-sdk tag in Cargo.toml: the ABI emitter is
# versioned with core.
set -euo pipefail

cd "$(dirname "$0")"

if ! cargo mero --version >/dev/null 2>&1; then
    echo "ERROR: cargo-mero is not installed. Install it with:" >&2
    echo "  cargo install --git https://github.com/calimero-network/core --tag 0.11.0-rc.31 cargo-mero --locked" >&2
    exit 1
fi

# Was WASM_PROFILING=true, which selected the app-profiling profile. --profiling
# skips wasm-opt and keeps debug info, which is what that profile was for.
if [ "${WASM_PROFILING:-false}" = "true" ]; then
    exec cargo mero build --profiling
fi

exec cargo mero build
