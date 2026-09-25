#!/usr/bin/env bash
# logic/stage-bundle.sh — build the dev bundle and stage it at a fixed path.
#
# WHY THIS EXISTS
#
# Every `workflows/*.yml` scenario installs the app with
# `type: install_application, dev: true`. Until rc.41 that step was handed
# `../logic/res/curb.wasm` — the raw module — and the node took it.
#
# It does not any more. `install_application_from_path` (core
# crates/node/primitives/.../application/install.rs) now reads the file and
# refuses anything that is not a signed bundle:
#
#     not a signed application bundle: /.../curb.wasm
#
# surfacing through merobox as a bare 500 on the install step, which reads like
# a node problem rather than a payload problem. The id also derives from the
# manifest's (package, signer) pair, so a payload without a manifest has no
# re-derivable application id — there is nothing for the node to fall back to.
#
# WHY NOT JUST NAME THE .mpk IN THE SCENARIOS
#
# `cargo mero bundle` writes `dist/<package>-<version>.mpk`, so the filename
# carries `[package] version` from Cargo.toml. Naming it in five scenario files
# means a version bump silently breaks all five, and the breakage only shows up
# in a 45-minute CI job. `--print-output-path` is the supported way to ask where
# it landed, so ask, and copy it somewhere the scenarios can hard-code.
#
# The staged copy is `dist/com.calimero.chat.mpk` — the name the monorepo's CI
# gives the bundle it hands every scenario (`dist/<package id>.mpk`), so a
# scenario runs unchanged locally and in CI. `dist/` is gitignored; locally,
# scripts/setup-nodes.sh and dev-node.sh run this before any scenario.
#
# Usage:  ./stage-bundle.sh          # dev key, for local + CI scenarios
set -euo pipefail

cd "$(dirname "$0")"

STAGED="dist/com.calimero.chat.mpk"

# --dev signs with the well-known development key. That is correct here and
# wrong for a release: the registry refuses this signature. The release job
# (the monorepo's publish-bundle.yml) builds its own bundle with the real key
# and does not use this script.
#
# `--print-output-path` writes the path as the LAST line of stdout, after the
# human-readable summary, so take the tail rather than the whole stream.
MPK="$(cargo mero bundle --dev --print-output-path | tail -1)"

if [ ! -f "$MPK" ]; then
  echo "ERROR: cargo mero bundle reported '$MPK', which is not a file" >&2
  exit 1
fi

mkdir -p dist
# `cp` rather than a symlink: merobox copies the file into the container's data
# directory, and a symlink pointing outside that directory does not resolve
# there.
cp -f "$MPK" "$STAGED"

echo "staged $MPK -> logic/$STAGED"
