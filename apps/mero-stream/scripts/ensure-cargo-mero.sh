#!/usr/bin/env bash
# scripts/ensure-cargo-mero.sh — make `cargo mero` available, pinned to the same
# core release the contract compiles against.
#
# `cargo mero` (core `tools/cargo-mero`) is the rc.20 replacement for the
# hand-written build.sh / build-bundle.sh every app used to carry. It:
#   - emits the ABI from the crate's own sources (no build.rs anywhere),
#   - compiles to wasm32-unknown-unknown under the `app-release` profile,
#   - size-optimizes with a BUILT-IN wasm-opt (the `wasm-opt` crate is compiled
#     into the binary, so nothing needs to be on PATH and output is reproducible),
#   - embeds the canonicalized ABI as the wasm `calimero_abi_v1` custom section,
#   - and for `bundle`, stages + hashes + signs + tars a `.mpk`.
#
# The pin matters. cargo-mero's own `DEFAULT_SDK_VERSION` is rc.17 (it only
# affects what `cargo mero new` scaffolds, not what we build), but the ABI
# emitter is versioned with core, so the tool and the `calimero-sdk` /
# `calimero-storage` git tags in logic/Cargo.toml must come from ONE release or
# the embedded ABI can describe a schema the node doesn't share.
#
# Usage:
#   bash scripts/ensure-cargo-mero.sh          # install if missing/mismatched
#   CARGO_MERO_TAG=0.11.0-rc.25 bash scripts/ensure-cargo-mero.sh
#   bash scripts/ensure-cargo-mero.sh --force  # reinstall unconditionally
set -euo pipefail

# Keep in lockstep with the four git tags in logic/Cargo.toml and the merod image
# in workflows/*.yml. See reference: core has NO moving `latest` tag, so an
# explicit rc is the only honest pin.
CARGO_MERO_TAG="${CARGO_MERO_TAG:-0.11.0-rc.25}"
CORE_GIT="${CARGO_MERO_CORE_GIT:-https://github.com/calimero-network/core}"

green() { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

command -v cargo >/dev/null || {
  printf '\033[31m  ✗  cargo not found — install Rust from https://rustup.rs\033[0m\n' >&2
  exit 1
}

# Which core tag the installed binary came from.
#
# NOT `cargo mero --version`: cargo-mero's crate version is its own `0.1.0`, not
# the core workspace version, so comparing it to a release tag never matches and
# the script reinstalls on every single call. `cargo install --list` records the
# git source it was installed from, tag and all:
#
#   cargo-mero v0.1.0 (https://github.com/calimero-network/core?tag=0.11.0-rc.19#c2e8ec3f):
#
# so that line is the honest signal for "is the installed tool the one we pinned".
installed_tag() {
  cargo install --list 2>/dev/null |
    awk '/^cargo-mero v/ { if (match($0, /tag=[^#)]+/)) print substr($0, RSTART+4, RLENGTH-4); exit }'
}

CURRENT="$(installed_tag)"

if ! $FORCE && [ "$CURRENT" = "$CARGO_MERO_TAG" ]; then
  green "cargo mero @ $CURRENT already installed"
  exit 0
fi

if [ -n "$CURRENT" ]; then
  yellow "cargo mero installed from tag '$CURRENT', want '$CARGO_MERO_TAG' — reinstalling"
elif command -v cargo-mero >/dev/null; then
  yellow "cargo mero installed from an untagged source — reinstalling at $CARGO_MERO_TAG"
else
  yellow "cargo mero not installed"
fi

step "Installing cargo-mero @ $CARGO_MERO_TAG (first run compiles; several minutes)"
# --locked uses core's committed Cargo.lock, so this resolves the same dependency
# graph the release was built with instead of whatever is newest today.
cargo install --git "$CORE_GIT" --tag "$CARGO_MERO_TAG" cargo-mero --locked --force

command -v cargo-mero >/dev/null || {
  printf '\033[31m  ✗  cargo mero still not invocable after install\033[0m\n' >&2
  exit 1
}
green "cargo mero @ $(installed_tag) ready"
