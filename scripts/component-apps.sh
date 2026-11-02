#!/usr/bin/env bash
# Component apps: the app directories whose `logic/Cargo.toml` depends on
# `calimero-app-sdk` (the 1.0 runtime, `wasm32-wasip2`). The v1 pipeline finds
# its apps through `cargo metadata` of the root workspace (scripts/app-packages.sh),
# which a component app is excluded from, so the two lists never overlap.
#
# Usage:
#   scripts/component-apps.sh all          JSON array of every component app dir name
#   scripts/component-apps.sh from-paths   JSON array of those a change reaches (paths on stdin)
#
# A change to what every component app builds against (the pin in the root
# Cargo.toml, tools/component-bundle, packages/merod-local, packages/connect,
# the components workflow) reaches all of them; ci uses `all` for that.
set -euo pipefail

cd "$(dirname "$0")/.."

all() {
  for manifest in apps/*/logic/Cargo.toml; do
    [ -f "$manifest" ] || continue
    if grep -Eq '^calimero-app-sdk[[:space:]]*=' "$manifest"; then
      basename "$(dirname "$(dirname "$manifest")")"
    fi
  done
}

case "${1:-}" in
  all)
    all | jq -Rsc 'split("\n") | map(select(length > 0)) | sort'
    ;;
  from-paths)
    apps=$(all | jq -Rsc 'split("\n") | map(select(length > 0))')
    tr '[:space:]' '\n' | sed '/^$/d' | jq -Rsc --argjson apps "$apps" '
      split("\n") | map(select(length > 0) | (capture("^apps/(?<dir>[^/]+)/") | .dir)?)
      | unique | map(select(. as $d | $apps | index($d))) | sort
    '
    ;;
  *)
    echo "usage: $0 {all|from-paths}" >&2
    exit 2
    ;;
esac
