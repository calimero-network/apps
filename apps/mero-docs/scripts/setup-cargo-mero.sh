#!/bin/bash
set -euo pipefail

# Install the released cargo-mero binary from core, so the tool that writes
# bundle contents cannot drift under us.
#
# ⚠️ Keep this on the release the workspace pins. `fleet-bump` does not rewrite
# it; CI fails when RELEASE differs from the core tag in the root Cargo.toml.
# Bump RELEASE and the three checksums together - a stale checksum fails closed.
RELEASE=1.0.0-rc.6

# Per-asset SHA-256, so a re-uploaded asset under the same tag cannot swap the
# binary silently. Refresh these together with RELEASE:
#   shasum -a 256 cargo-mero_<target>.tar.gz
CHECKSUM_aarch64_apple_darwin=25efe919c34df997b44ab8d74183b2f9d6e4d671ee5979020a5f8fa157fd5854
CHECKSUM_aarch64_unknown_linux_gnu=29158dbc555ba122d57aa8cc3d5a36187d8ad39867361e73ae0da3cfaaceba68
CHECKSUM_x86_64_unknown_linux_gnu=634c3fd86c37d00ff6e0575f08261908a903d746de755c191c6e34dfc365303f

# The CI action needs this value for its cache key; it asks rather than
# grepping this file, so reformatting the line above cannot silently break it.
if [ "${1:-}" = "--print-release" ]; then
  printf '%s\n' "$RELEASE"
  exit 0
fi

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)  TARGET=aarch64-apple-darwin       ;;
  Linux/aarch64) TARGET=aarch64-unknown-linux-gnu  ;;
  Linux/x86_64)  TARGET=x86_64-unknown-linux-gnu   ;;
  *) echo "no released cargo-mero for $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac
eval "EXPECTED=\$CHECKSUM_${TARGET//-/_}"

BIN_DIR="${CARGO_HOME:-$HOME/.cargo}/bin"
# Which release the installed binary came from. A bare `command -v` would
# accept a cargo-mero of any version - a stale dev machine, a warm self-hosted
# runner - which is the drift the pin exists to prevent.
STAMP="${CARGO_HOME:-$HOME/.cargo}/.cargo-mero-release"

if [ "$(cat "$STAMP" 2>/dev/null)" = "$RELEASE" ] && [ -x "$BIN_DIR/cargo-mero" ]; then
  # Installed, but another copy earlier on PATH would be the one `cargo mero`
  # actually runs, and it can be any version. Say so rather than pass silently.
  found=$(command -v cargo-mero || true)
  if [ -n "$found" ] && [ "$found" != "$BIN_DIR/cargo-mero" ]; then
    echo "cargo-mero on PATH is $found, not the pinned $BIN_DIR/cargo-mero" >&2
    echo "remove it or put $BIN_DIR first on PATH" >&2
    exit 1
  fi
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
TARBALL="$TMP/cargo-mero.tar.gz"

curl -fsSL --retry 3 --retry-delay 2 --max-time 120 -o "$TARBALL" \
  "https://github.com/calimero-network/core/releases/download/$RELEASE/cargo-mero_$TARGET.tar.gz"

ACTUAL=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "cargo-mero_$TARGET.tar.gz checksum mismatch: expected $EXPECTED, got $ACTUAL" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
tar -xzf "$TARBALL" -C "$TMP" cargo-mero
install -m 0755 "$TMP/cargo-mero" "$BIN_DIR/cargo-mero"
printf '%s' "$RELEASE" >"$STAMP"
