#!/bin/bash
# logic/build.sh — compile the contract to wasm via `cargo mero build` (rc.20).
#
# This used to be a hand-rolled `cargo build --target wasm32-unknown-unknown` plus
# a `cp` and an optional `wasm-opt`. `cargo mero build` does all of that AND the
# two things the hand-rolled version could not:
#
#   - emits the ABI from src/*.rs (res/abi.json + res/state-schema.json) with no
#     build.rs, and embeds it as the wasm `calimero_abi_v1` custom section, which
#     is what meroctl/devtools introspection and the identity-downgrade gate read;
#   - runs wasm-opt -Oz from a copy compiled INTO the tool, so the optimizer no
#     longer has to be on PATH and output is reproducible across machines. The old
#     script silently SKIPPED optimization when wasm-opt was absent — same source,
#     different bytes depending on the machine.
#
# Output: res/mero_stream.wasm (+ res/abi.json, res/state-schema.json)
#
# Usage:
#   ./build.sh              # release build, wasm-opt -Oz, ABI embedded
#   ./build.sh --profiling  # keep debug info, skip wasm-opt (for flamegraphs)
set -euo pipefail

cd "$(dirname "$0")"

# Pinned to the same core release as the calimero-sdk / calimero-storage tags in
# Cargo.toml — the ABI emitter is versioned with core.
bash ../scripts/ensure-cargo-mero.sh

rm -rf res

cargo mero build "$@"

WASM="res/mero_stream.wasm"
[ -f "$WASM" ] || {
  printf '\033[31m  ✗  expected %s — did the crate name change?\033[0m\n' "$WASM" >&2
  exit 1
}

# A wasm with no `calimero_abi_v1` section still INSTALLS fine (the
# identity-downgrade gate fail-opens and only fires on migration upgrades), so
# without this check a regression here would stay invisible until someone noticed
# introspection was blank. Warn, don't fail: the wasm is still usable.
if ! cargo mero abi extract "$WASM" >/dev/null 2>&1; then
  printf '\033[33m  !  no calimero_abi_v1 section in %s — introspection will be blank\033[0m\n' "$WASM" >&2
fi

SIZE=$(stat -f%z "$WASM" 2>/dev/null || stat -c%s "$WASM" 2>/dev/null || echo '?')
printf '\033[32m  ✓  built %s (%s bytes, ABI embedded)\033[0m\n' "$WASM" "$SIZE"
