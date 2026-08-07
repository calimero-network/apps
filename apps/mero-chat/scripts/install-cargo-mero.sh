#!/usr/bin/env bash
# Install cargo-mero into ~/.cargo/bin from a calimero-network/core release.
# Defaults to the newest release; pin with CARGO_MERO_TAG=0.11.0-rc.20.
set -euo pipefail

REPO="calimero-network/core"
TAG="${CARGO_MERO_TAG:-$(curl -sSfL "https://api.github.com/repos/$REPO/releases" \
  | jq -r '.[0].tag_name')}"

[ -n "$TAG" ] && [ "$TAG" != "null" ] || { echo "could not resolve a core release tag" >&2; exit 1; }

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset="cargo-mero_aarch64-apple-darwin.tar.gz" ;;
  Linux-x86_64)  asset="cargo-mero_x86_64-unknown-linux-gnu.tar.gz" ;;
  Linux-aarch64) asset="cargo-mero_aarch64-unknown-linux-gnu.tar.gz" ;;
  *) echo "no cargo-mero release binary for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$HOME/.cargo/bin"
curl -sSfL "https://github.com/$REPO/releases/download/$TAG/$asset" \
  | tar -xz -C "$HOME/.cargo/bin"
echo "cargo-mero $TAG -> $HOME/.cargo/bin"

# An older cargo-mero earlier on PATH (Homebrew ships one) silently wins and
# fails later with a confusing "unknown field" against the metadata table.
resolved="$(command -v cargo-mero || true)"
if [ -n "$resolved" ] && [ "$resolved" != "$HOME/.cargo/bin/cargo-mero" ]; then
  echo "ERROR: $resolved shadows the one just installed." >&2
  echo "  remove it (brew uninstall cargo-mero) or put ~/.cargo/bin first on PATH" >&2
  exit 1
fi
