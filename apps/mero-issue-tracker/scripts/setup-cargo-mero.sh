#!/bin/bash
# shellcheck disable=SC2034  # CHECKSUM_* are selected indirectly by the eval below
set -euo pipefail

# Install the released cargo-mero binary from core, so the tool that writes and
# signs bundle contents cannot drift under us. This release is the first with
# `cargo mero publish`; it also requires the SDK to emit `__calimero_abi`, so it
# moves together with the SDK tags in logic/Cargo.toml.
RELEASE=0.11.0-rc.20

# Per-asset SHA-256, so a re-uploaded asset under the same tag cannot swap the
# binary silently. Refresh these together with RELEASE:
#   shasum -a 256 cargo-mero_<target>.tar.gz
CHECKSUM_aarch64_apple_darwin=9c28ec40692669cbf2249c07afa824ab3296c720fb26670c90de2ca515261d86
CHECKSUM_aarch64_unknown_linux_gnu=68e5746d499fdd75b428f78628a27053158fdcf1ea7149f48f51a68c8c8eac8d
CHECKSUM_x86_64_unknown_linux_gnu=86e32bd1a7fd976dafaa8269dfdfe4e8d89b35f0a62f3a6f6d3c4a6387ec9331

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)  TARGET=aarch64-apple-darwin       ;;
  Linux/aarch64) TARGET=aarch64-unknown-linux-gnu  ;;
  Linux/x86_64)  TARGET=x86_64-unknown-linux-gnu   ;;
  *) echo "no released cargo-mero for $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac
eval "EXPECTED=\$CHECKSUM_${TARGET//-/_}"

BIN_DIR="${CARGO_HOME:-$HOME/.cargo}/bin"
# Which release the installed binary came from. A bare `command -v` would
# accept a cargo-mero of any version - a stale dev machine, a warm CI image -
# which is the drift the pin exists to prevent.
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
