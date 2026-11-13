#!/usr/bin/env bash
# Builds a component app's crate with core's `meroctl app build` and writes the
# two files the repository keeps beside it:
#
#   <logic>/res/<lib>.wasm   the release `calimero:app` component
#   <logic>/res/abi.json     its ABI (`meroctl app abi show`), committed and
#                            diffed in CI; the frontend's tests read it
#
#   scripts/component-build.sh apps/kv-store/logic
#
# `<lib>` is the crate's `[lib] name`, else its package name with `-` as `_`:
# the name cargo gives the artifact. Prints the wasm's path on stdout.
#
# meroctl comes from scripts/install-meroctl.sh. Cargo's target directory is
# $CARGO_TARGET_DIR when set (CI shares one across apps), else <logic>/target.
# It is passed to meroctl as an absolute `--target-dir`: meroctl 1.0.0-rc.24
# ignores CARGO_TARGET_DIR and resolves a relative crate path's default target
# under the crate itself (core#5064).
set -euo pipefail

if [ $# -ne 1 ] || [ ! -f "$1/Cargo.toml" ]; then
  echo "usage: $0 <logic-dir>   (the app's crate, holding its Cargo.toml)" >&2
  exit 2
fi
command -v meroctl >/dev/null 2>&1 || {
  echo "meroctl is not on PATH: run scripts/install-meroctl.sh" >&2
  exit 1
}

LOGIC="${1%/}"
lib="$(awk '
  /^[[:space:]]*\[/ { section = $0; gsub(/[[:space:]]/, "", section); next }
  /^[[:space:]]*name[[:space:]]*=/ {
    v = $0; sub(/^[^=]*=[[:space:]]*"/, "", v); sub(/".*$/, "", v)
    if (section == "[package]" && pkg == "") pkg = v
    if (section == "[lib]" && libname == "") libname = v
  }
  END { if (libname != "") print libname; else { gsub(/-/, "_", pkg); print pkg } }
' "$LOGIC/Cargo.toml")"
[ -n "$lib" ] || {
  echo "$LOGIC/Cargo.toml names no package" >&2
  exit 1
}

target="${CARGO_TARGET_DIR:-$LOGIC/target}"
case "$target" in
  /*) ;;
  *) target="$PWD/$target" ;;
esac

mkdir -p "$LOGIC/res"
wasm="$LOGIC/res/$lib.wasm"
meroctl app build "$LOGIC" --out "$wasm" --target-dir "$target" >&2
meroctl app abi show "$wasm" >"$LOGIC/res/abi.json"
echo "$wasm"
