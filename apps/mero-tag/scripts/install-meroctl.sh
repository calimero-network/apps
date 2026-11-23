#!/usr/bin/env bash
# Puts core's `meroctl` on PATH at the core release ci/core-version names: the
# tool that builds the contract into a `calimero:app` component, writes its
# ABI, and packs, signs and inspects the `.mpk` (`make logic-build`,
# `make logic-bundle`, .github/workflows/deploy-bundle.yml).
#
#   scripts/install-meroctl.sh                             # into ~/.local/bin
#   MEROCTL_ROOT=/opt/meroctl scripts/install-meroctl.sh   # into /opt/meroctl/bin
#   MEROCTL_TAG=1.0.0-rc.35 scripts/install-meroctl.sh     # another release
#
# It downloads the release's `meroctl_<target>.tar.gz` (Linux x86_64 and
# aarch64, macOS aarch64) and checks it against that release's SHA256SUMS
# before putting it in place; nothing is compiled.
#
# Installs only when the binary under the root came from this release (a stamp
# file beside it), so a cached root costs nothing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${MEROCTL_TAG:-$(sed -n 's/^CORE_TAG=//p' "$HERE/ci/core-version" | head -1)}"
[ -n "$TAG" ] || { echo "no core release: set MEROCTL_TAG or CORE_TAG in ci/core-version" >&2; exit 1; }
ROOT="${MEROCTL_ROOT:-$HOME/.local}"
BIN="$ROOT/bin"
STAMP="$ROOT/.meroctl-tag"
BASE="https://github.com/calimero-network/core/releases/download/$TAG"

if [ -x "$BIN/meroctl" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TAG" ]; then
  echo "meroctl $TAG already in $BIN"
  exit 0
fi

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64 | Linux/amd64) target=x86_64-unknown-linux-gnu ;;
  Linux/aarch64 | Linux/arm64) target=aarch64-unknown-linux-gnu ;;
  Darwin/arm64 | Darwin/aarch64) target=aarch64-apple-darwin ;;
  *)
    echo "no meroctl release for $(uname -s)/$(uname -m) (Linux x86_64/aarch64, macOS aarch64)" >&2
    exit 1
    ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
else
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

archive="meroctl_$target.tar.gz"
if ! curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$BASE/SHA256SUMS"; then
  echo "release $TAG has no SHA256SUMS at $BASE (is it released?)" >&2
  exit 1
fi
want="$(awk -v f="$archive" '$2 == f || $2 == "*"f { print $1 }' "$tmp/SHA256SUMS")"
if [ -z "$want" ]; then
  echo "release $TAG lists no $archive in its SHA256SUMS" >&2
  exit 1
fi
curl -fsSL --retry 3 -o "$tmp/$archive" "$BASE/$archive"
got="$(sha256 "$tmp/$archive")"
if [ "$got" != "$want" ]; then
  echo "$archive does not match release $TAG's SHA256SUMS (got $got, want $want)" >&2
  exit 1
fi

tar -xzf "$tmp/$archive" -C "$tmp" meroctl
mkdir -p "$BIN"
chmod 0755 "$tmp/meroctl"
mv -f "$tmp/meroctl" "$BIN/meroctl"
echo "$TAG" >"$STAMP"
echo "meroctl $TAG installed in $BIN"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "add $BIN to your PATH: export PATH=\"$BIN:\$PATH\"" ;;
esac
