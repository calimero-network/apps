#!/bin/bash
set -euo pipefail

# Install the released cargo-mero binary from core, so the tool that writes
# bundle contents cannot drift under us.
#
# ⚠️ Keep this on the release the workspace pins. Nothing in CI calls this
# script and `fleet-bump` does not rewrite it, so it is free to rot: it sat on
# rc.28 while the fleet moved to rc.34. Bump RELEASE and the three checksums
# together — a stale checksum fails closed, a stale RELEASE does not.
RELEASE=0.11.0-rc.34

# Per-asset SHA-256, so a re-uploaded asset under the same tag cannot swap the
# binary silently. Refresh these together with RELEASE:
#   shasum -a 256 cargo-mero_<target>.tar.gz
CHECKSUM_aarch64_apple_darwin=d076001e7ba216985be1ce301169413f697e75e600b25deaf2ec2a175d98f44b
CHECKSUM_aarch64_unknown_linux_gnu=a3d846c906c2b15e605098c21f163649ae37ff5650ab9c59463e45194db601c4
CHECKSUM_x86_64_unknown_linux_gnu=454db30e7b7381c1c9a77336c7d4ba938319f0afbfe7438f67718de170f12fef

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
