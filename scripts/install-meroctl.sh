#!/usr/bin/env bash
# Puts core's `meroctl` on PATH at the release below: the tool whose
# `app codegen` writes an app's typed client (`apps/<app>/app/src/generated/`)
# from its committed ABI. `pnpm -F <app> codegen` runs it, and so does
# scripts/mobile-codegen.sh for the native clients; CI's frontend job runs every
# app's `codegen` and fails when the committed client differs.
#
#   scripts/install-meroctl.sh                       # into ~/.local/bin
#   MEROCTL_ROOT=/opt/meroctl scripts/install-meroctl.sh   # into /opt/meroctl/bin
#
# It downloads the release's `meroctl_<target>.tar.gz` (Linux x86_64 and
# aarch64, macOS aarch64) and checks it against that release's SHA256SUMS
# before putting it in place; nothing is compiled.
#
# The pin is the generator's, not the SDK's: it can run ahead of
# `component-core-tag`. Core's fleet bump rewrites the TAG line below, so keep
# it exactly in that shape. Moving it changes what every generated client looks
# like, so regenerate them all in the same PR (`pnpm -r codegen` and
# `scripts/mobile-codegen.sh`).
#
# Installs only when the binary under the root came from this release (a stamp
# file beside it), so a cached root costs nothing.
set -euo pipefail

TAG="${MEROCTL_TAG:-1.0.0-rc.24}"
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
