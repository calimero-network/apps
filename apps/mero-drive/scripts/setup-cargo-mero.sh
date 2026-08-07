#!/bin/bash
set -euo pipefail

# Pinned so the tool that writes bundle contents cannot drift under us.
# This rev is the first with the bundle-manifest capabilities the metadata
# table uses (icon, slug, versioned output path).
REV=e5131f7127289cb89d0b2d8defb4e5feaaecf907

# The CI action needs this value for its cache key; it asks rather than
# grepping this file, so reformatting the line above cannot silently break it.
if [ "${1:-}" = "--print-rev" ]; then
  printf '%s\n' "$REV"
  exit 0
fi

# Which rev the installed binary came from. `command -v` alone would accept a
# cargo-mero built from any other revision - a stale dev machine, a warm
# self-hosted runner - which is the drift the pin exists to prevent.
STAMP="${CARGO_HOME:-$HOME/.cargo}/.cargo-mero-rev"

if ! command -v cargo-mero >/dev/null || [ "$(cat "$STAMP" 2>/dev/null)" != "$REV" ]; then
  cargo install --git https://github.com/calimero-network/core \
    --rev "$REV" cargo-mero --locked --force
  printf '%s' "$REV" >"$STAMP"
fi
