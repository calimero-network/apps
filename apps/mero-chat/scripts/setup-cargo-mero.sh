#!/bin/bash
set -euo pipefail

# Install the released cargo-mero binary from core, so the tool that writes
# bundle contents cannot drift under us. Keep this equal to the calimero-sdk tag
# in logic/Cargo.toml. (0.11.0-rc.20 was the first release carrying the
# bundle-manifest capabilities the metadata table uses: icon, slug, versioned
# output path.)
RELEASE=0.11.0-rc.25

# Per-asset SHA-256, so a re-uploaded asset under the same tag cannot swap the
# binary silently. Refresh these together with RELEASE:
#   shasum -a 256 cargo-mero_<target>.tar.gz
CHECKSUM_aarch64_apple_darwin=6d818c4f167d39afcb31cdb00def63db7f4d2fd8c0789ae0c05d4c1ae9cf1270
CHECKSUM_aarch64_unknown_linux_gnu=bcb4ba6f03917c878ceab1776b2d4c124420c13916afd578f12650461913e05c
CHECKSUM_x86_64_unknown_linux_gnu=11005616f7ef1df6d5ee9f26c4998f8ebbee4919d0cb450ee0a62adf8e374c9b

# The CI action asks for this rather than grepping the line above, so
# reformatting it cannot silently break the action.
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

# Another copy earlier on PATH is the one `cargo mero` actually runs, and it can
# be any version. Homebrew ships this tool, so this is not hypothetical: a stale
# one surfaces much later as `unknown field 'icon'` against the metadata table.
shadow_check() {
  found=$(command -v cargo-mero || true)
  if [ -n "$found" ] && [ "$found" != "$BIN_DIR/cargo-mero" ]; then
    echo "cargo-mero on PATH is $found, not the pinned $BIN_DIR/cargo-mero" >&2
    echo "remove it (e.g. brew uninstall cargo-mero) or put $BIN_DIR first on PATH" >&2
    exit 1
  fi
}

if [ "$(cat "$STAMP" 2>/dev/null)" = "$RELEASE" ] && [ -x "$BIN_DIR/cargo-mero" ]; then
  shadow_check
  echo "cargo-mero $RELEASE already installed"
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
echo "cargo-mero $RELEASE -> $BIN_DIR"

shadow_check
